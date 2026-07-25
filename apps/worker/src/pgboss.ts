import type { DomainEventJobV1 } from "@ticket-platform/contracts";
import type { OutboxJobPublisher } from "@ticket-platform/application";
import type { QueueResult, SendOptions } from "pg-boss";

export const OUTBOX_DISPATCH_QUEUE = "outbox-dispatch";
export const OUTBOX_DISPATCH_DEAD_LETTER_QUEUE = "outbox-dispatch-dead-letter";

export interface PgBossPublisherClient {
  send(
    name: string,
    data: object | null,
    options?: SendOptions
  ): Promise<string | null>;
  getQueue(name: string): Promise<QueueResult | null>;
}

export class PgBossOutboxPublisher implements OutboxJobPublisher {
  constructor(
    private readonly boss: PgBossPublisherClient,
    private readonly queueName = OUTBOX_DISPATCH_QUEUE
  ) {}

  async publish(eventId: string, job: DomainEventJobV1): Promise<void> {
    await this.boss.send(this.queueName, job, { id: eventId });
  }
}

export async function assertPgBossQueuesProvisioned(boss: PgBossPublisherClient): Promise<void> {
  const [queue, deadLetterQueue] = await Promise.all([
    boss.getQueue(OUTBOX_DISPATCH_QUEUE),
    boss.getQueue(OUTBOX_DISPATCH_DEAD_LETTER_QUEUE)
  ]);

  if (!queue || !deadLetterQueue) {
    throw new Error("Required pg-boss queues are not provisioned by a versioned migration");
  }

  if (queue.deadLetter !== OUTBOX_DISPATCH_DEAD_LETTER_QUEUE) {
    throw new Error("Outbox dispatch queue must use the configured dead-letter queue");
  }
}
