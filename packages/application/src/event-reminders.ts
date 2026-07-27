import type { DomainEvent } from "@ticket-platform/domain";
import type { IdGenerator, OutboxWriter, UnitOfWork } from "./identity.js";

/**
 * Full pre-event reminder cadence (docs/bots/BOT_FLOWS.md "После оплаты" → "Напоминания до
 * события": 10/7/3/1 days before + day-of), which neither bot had implemented — MAX only ever
 * shipped a one-time "payment nudge" (max-bot/src/jobs/paymentNudgeJob.ts). Modeled directly on
 * ExpireOrdersBatchService/order-expiry.ts: a worker sweep claims due work inside a transaction and
 * appends one outbox event per claim; actual Telegram delivery happens later via the existing
 * outbox -> pg-boss -> HandleNotificationJobService path (notification-delivery.ts), same as
 * TicketsIssued/AdminPurchaseNotificationRequested/ParticipantQuestionnaireRequested.
 */

export type ReminderCadenceStep = "10d" | "7d" | "3d" | "1d" | "day_of";

export interface DueReminder {
  readonly orderId: string;
  readonly eventId: string;
  readonly userId: string;
  readonly cadenceStep: ReminderCadenceStep;
}

export interface EventReminderRepository {
  /**
   * Atomically claims up to `batchSize` (order, cadence step) pairs whose window has arrived and
   * that have never been claimed before (see event_reminder_dispatches unique(order_id,
   * cadence_step)) — a claimed pair is guaranteed not to be returned by a later call, even under
   * concurrent workers.
   */
  claimDueReminders(at: Date, batchSize: number): Promise<readonly DueReminder[]>;
}

export interface SendEventRemindersBatchInput {
  readonly at: Date;
  readonly batchSize: number;
}

export interface SendEventRemindersBatchResult {
  readonly claimed: number;
}

export class SendEventRemindersBatchService {
  constructor(
    private readonly repository: EventReminderRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: SendEventRemindersBatchInput): Promise<SendEventRemindersBatchResult> {
    validateInput(input);

    return this.unitOfWork.transact(async () => {
      const due = await this.repository.claimDueReminders(input.at, input.batchSize);

      for (const reminder of due) {
        await this.outboxWriter.append(reminderEvent(reminder, input.at, this.idGenerator));
      }

      return { claimed: due.length };
    });
  }
}

function validateInput(input: SendEventRemindersBatchInput): void {
  if (Number.isNaN(input.at.getTime())) {
    throw new Error("Reminder sweep time is invalid");
  }
  if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 500) {
    throw new Error("Reminder batch size must be between 1 and 500");
  }
}

function reminderEvent(reminder: DueReminder, occurredAt: Date, idGenerator: IdGenerator): DomainEvent {
  return {
    eventId: idGenerator.newId(),
    aggregateType: "order",
    aggregateId: reminder.orderId,
    eventType: "EventReminderDue",
    schemaVersion: 1,
    payload: {
      orderId: reminder.orderId,
      eventId: reminder.eventId,
      userId: reminder.userId,
      cadenceStep: reminder.cadenceStep
    },
    occurredAt
  };
}
