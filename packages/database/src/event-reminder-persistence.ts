import type {
  DueReminder,
  EventReminderRepository,
  IdGenerator,
  ReminderCadenceStep
} from "@ticket-platform/application";
import {
  PostgresOutboxWriter
} from "./telegram-start-persistence.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface CandidateRow {
  readonly order_id: string;
  readonly event_id: string;
  readonly user_id: string;
  readonly cadence_step: string;
}

/**
 * Claims (order, cadence step) pairs whose non-overlapping time window has arrived
 * (event_reminder_dispatches, 20260728090000_participant_engagement.sql) and appends one
 * EventReminderDue outbox event per claim — modeled directly on order-expiry-persistence.ts's
 * claimExpiredOrders (`for update skip locked` + append-inside-the-same-transaction).
 *
 * Windows are non-overlapping so an order paid late (e.g. three days before the event) lands
 * directly in whichever single window "now" falls into instead of firing every earlier step it
 * skipped past.
 */
export class PostgresEventReminderRepository implements EventReminderRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly idGenerator: IdGenerator
  ) {}

  async claimDueReminders(at: Date, batchSize: number): Promise<readonly DueReminder[]> {
    const candidates = await this.session.query<CandidateRow>(
      `select o.id as order_id, o.event_id, o.user_id, step.cadence_step
       from public.orders o
       join public.events e on e.id = o.event_id
       cross join lateral (
         values
           ('10d', e.starts_at - interval '10 days', e.starts_at - interval '7 days'),
           ('7d', e.starts_at - interval '7 days', e.starts_at - interval '3 days'),
           ('3d', e.starts_at - interval '3 days', e.starts_at - interval '1 days'),
           ('1d', e.starts_at - interval '1 days', date_trunc('day', e.starts_at)),
           ('day_of', date_trunc('day', e.starts_at), e.starts_at)
       ) as step(cadence_step, window_start, window_end)
       where o.status = 'paid'
         and $1::timestamptz >= step.window_start
         and $1::timestamptz < step.window_end
         and not exists (
           select 1
           from public.event_reminder_dispatches d
           where d.order_id = o.id and d.cadence_step = step.cadence_step
         )
       order by e.starts_at, o.id
       for update of o skip locked
       limit $2`,
      [at, batchSize]
    );

    const claimed: DueReminder[] = [];
    for (const row of candidates.rows) {
      const inserted = await this.session.query(
        `insert into public.event_reminder_dispatches (id, order_id, event_id, cadence_step, dispatched_at)
         values ($1, $2, $3, $4, $5)
         on conflict (order_id, cadence_step) do nothing`,
        [this.idGenerator.newId(), row.order_id, row.event_id, row.cadence_step, at]
      );
      if (inserted.rowCount === 1) {
        claimed.push({
          orderId: row.order_id,
          eventId: row.event_id,
          userId: row.user_id,
          cadenceStep: row.cadence_step as ReminderCadenceStep
        });
      }
    }

    return claimed;
  }
}

export function createEventReminderPersistence(pool: SqlConnectionPool, idGenerator: IdGenerator) {
  const session = new TransactionSession();

  return {
    eventReminderRepository: new PostgresEventReminderRepository(session, idGenerator),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}
