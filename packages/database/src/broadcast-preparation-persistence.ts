import type {
  BroadcastPreparationRepository,
  PendingBroadcastPreparation
} from "@ticket-platform/application";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";
import { PostgresOutboxWriter } from "./telegram-start-persistence.js";

interface DueBroadcastRow {
  readonly broadcast_id: string;
  readonly broadcast_version_id: string;
  readonly audience_snapshot_id: string;
  readonly scheduled_at: Date | string;
}

interface PreparationCountsRow {
  readonly planned: string;
  readonly reachable: string;
  readonly skipped: string;
}

export class PostgresBroadcastPreparationRepository
implements BroadcastPreparationRepository {
  constructor(private readonly session: TransactionSession) {}

  async claimDue(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<readonly PendingBroadcastPreparation[]> {
    const result = await this.session.query<DueBroadcastRow>(
      `select broadcasts.id as broadcast_id,
              versions.id as broadcast_version_id,
              versions.audience_snapshot_id,
              broadcasts.scheduled_at
       from public.broadcasts broadcasts
       join public.broadcast_versions versions
         on versions.id = broadcasts.scheduled_version_id
       where broadcasts.lifecycle_status = 'scheduled'
         and broadcasts.scheduled_at <= $1
         and versions.status = 'published'
       order by broadcasts.scheduled_at, broadcasts.id
       for update of broadcasts skip locked
       limit $2`,
      [input.at, input.batchSize]
    );
    for (const row of result.rows) {
      const updated = await this.session.query(
        `update public.broadcasts
         set lifecycle_status = 'preparing',
             updated_at = $2
         where id = $1 and lifecycle_status = 'scheduled'`,
        [row.broadcast_id, input.at]
      );
      if (updated.rowCount !== 1) {
        throw new Error("Broadcast preparation lock was lost");
      }
    }
    return result.rows.map((row) => ({
      broadcastId: row.broadcast_id,
      broadcastVersionId: row.broadcast_version_id,
      audienceSnapshotId: row.audience_snapshot_id,
      scheduledAt: asDate(row.scheduled_at)
    }));
  }

  async materialize(input: {
    readonly broadcast: PendingBroadcastPreparation;
    readonly preparedAt: Date;
  }) {
    await this.session.query(
      `with recipients as (
         select members.user_id,
                identity.id as telegram_identity_id,
                identity.external_user_id,
                coalesce(identity.is_bot_blocked, false) as is_bot_blocked
         from public.segment_audience_snapshot_members members
         left join lateral (
           select id, external_user_id, is_bot_blocked
           from public.messenger_identities
           where user_id = members.user_id
             and channel = 'telegram'
           order by last_seen_at desc, id
           limit 1
         ) identity on true
         where members.snapshot_id = $3
       )
       insert into public.broadcast_deliveries (
         idempotency_key, broadcast_id, broadcast_version_id,
         audience_snapshot_id, user_id, telegram_identity_id,
         recipient_external_user_id, status, last_error_code,
         scheduled_at, created_at, updated_at
       )
       select
         'broadcast:' || $1::text || ':' || recipients.user_id::text,
         $1, $2, $3, recipients.user_id, recipients.telegram_identity_id,
         recipients.external_user_id,
         case
           when recipients.external_user_id is null then 'skipped'
           when recipients.is_bot_blocked then 'skipped'
           else 'pending'
         end,
         case
           when recipients.external_user_id is null then 'RecipientUnavailable'
           when recipients.is_bot_blocked then 'RecipientBlocked'
           else null
         end,
         $4, $5, $5
       from recipients
       on conflict (broadcast_id, user_id) do nothing`,
      [
        input.broadcast.broadcastId,
        input.broadcast.broadcastVersionId,
        input.broadcast.audienceSnapshotId,
        input.broadcast.scheduledAt,
        input.preparedAt
      ]
    );
    const counts = await this.session.query<PreparationCountsRow>(
      `select count(*)::text as planned,
              count(*) filter (where status = 'pending')::text as reachable,
              count(*) filter (where status = 'skipped')::text as skipped
       from public.broadcast_deliveries
       where broadcast_id = $1`,
      [input.broadcast.broadcastId]
    );
    const row = counts.rows[0];
    if (!row || !validCount(row.planned, row.reachable, row.skipped)) {
      throw new Error("Broadcast preparation counts are invalid");
    }
    const updated = await this.session.query(
      `update public.broadcasts
       set prepared_at = $2,
           planned_recipient_count = $3::bigint,
           reachable_recipient_count = $4::bigint,
           skipped_recipient_count = $5::bigint,
           updated_at = $2
       where id = $1
         and lifecycle_status = 'preparing'
         and scheduled_version_id = $6`,
      [
        input.broadcast.broadcastId,
        input.preparedAt,
        row.planned,
        row.reachable,
        row.skipped,
        input.broadcast.broadcastVersionId
      ]
    );
    if (updated.rowCount !== 1) {
      throw new Error("Prepared broadcast aggregate was not updated");
    }
    return row;
  }
}

export function createBroadcastPreparationPersistence(
  pool: SqlConnectionPool
) {
  const session = new TransactionSession();
  return {
    repository: new PostgresBroadcastPreparationRepository(session),
    unitOfWork: new PostgresUnitOfWork(pool, session),
    outboxWriter: new PostgresOutboxWriter(session)
  };
}

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Broadcast schedule timestamp is invalid");
  }
  return date;
}

function validCount(
  planned: string,
  reachable: string,
  skipped: string
): boolean {
  const pattern = /^(0|[1-9]\d*)$/;
  return pattern.test(planned)
    && pattern.test(reachable)
    && pattern.test(skipped)
    && BigInt(planned) === BigInt(reachable) + BigInt(skipped);
}
