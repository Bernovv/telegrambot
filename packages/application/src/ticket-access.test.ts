import type { ChannelIdentity } from "./identity.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import type {
  BeginIdempotentOperationInput,
  IdempotencyRepository,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";
import {
  ListTelegramTicketsService,
  RequestTelegramTicketRedeliveryService,
  type RedeliverableTicket,
  type TelegramTicketAccessRepository
} from "./ticket-access.js";

describe("Telegram ticket access", () => {
  it("lists only tickets returned for the Telegram owner", async () => {
    const repository = new MemoryTicketRepository();
    const service = new ListTelegramTicketsService(repository);

    const result = await service.execute({ channel: "telegram" as const, senderExternalUserId: "123456789" });

    assert.equal(result.identityFound, true);
    assert.deepEqual(result.tickets, repository.tickets);
    assert.deepEqual(repository.listRequests, [
      { channel: "telegram", externalUserId: "123456789" }
    ]);
  });

  it("does not query persistence for an invalid Telegram user ID", async () => {
    const repository = new MemoryTicketRepository();
    const service = new ListTelegramTicketsService(repository);

    const result = await service.execute({ channel: "telegram" as const, senderExternalUserId: "not-a-user" });

    assert.deepEqual(result, { identityFound: false, tickets: [] });
    assert.deepEqual(repository.listRequests, []);
  });

  it("emits one owner-bound redelivery event for duplicate execution", async () => {
    const repository = new MemoryTicketRepository();
    const idempotency = new MemoryIdempotencyRepository();
    const outbox = new MemoryOutbox();
    const service = new RequestTelegramTicketRedeliveryService(
      repository,
      idempotency,
      outbox,
      directUnitOfWork,
      { newId() { return eventId; } }
    );
    const command = {
      channel: "telegram" as const,
      ticketId,
      senderExternalUserId: "123456789",
      updateId: "987654321",
      requestedAt: new Date("2026-07-24T14:00:00.000Z")
    };

    const first = await service.execute(command);
    const duplicate = await service.execute(command);

    assert.deepEqual(first, {
      accepted: true,
      newlyRequested: true,
      ticketNumber: "BP-ORDER-T001"
    });
    assert.deepEqual(duplicate, {
      accepted: true,
      newlyRequested: false,
      ticketNumber: "BP-ORDER-T001"
    });
    assert.equal(outbox.events.length, 1);
    assert.deepEqual(outbox.events[0], {
      eventId,
      aggregateType: "ticket",
      aggregateId: ticketId,
      eventType: "TicketRedeliveryRequested",
      schemaVersion: 1,
      payload: {
        orderId,
        ownerUserId,
        ticketIds: [ticketId]
      },
      occurredAt: command.requestedAt
    });
  });

  it("does not reveal or enqueue a ticket that is not redeliverable", async () => {
    const repository = new MemoryTicketRepository({
      ticketId,
      ticketNumber: "BP-ORDER-T001",
      orderId,
      ownerUserId,
      status: "refunded"
    });
    const outbox = new MemoryOutbox();
    const service = new RequestTelegramTicketRedeliveryService(
      repository,
      new MemoryIdempotencyRepository(),
      outbox,
      directUnitOfWork,
      { newId() { return eventId; } }
    );

    const result = await service.execute({
      channel: "telegram" as const,
      ticketId,
      senderExternalUserId: "123456789",
      updateId: "987654322",
      requestedAt: new Date("2026-07-24T14:01:00.000Z")
    });

    assert.deepEqual(result, { accepted: false, reason: "ticket_unavailable" });
    assert.equal(outbox.events.length, 0);
  });
});

class MemoryTicketRepository implements TelegramTicketAccessRepository {
  readonly listRequests: ChannelIdentity[] = [];
  readonly tickets = [{
    ticketId,
    ticketNumber: "BP-ORDER-T001",
    orderNumber: "BP-ORDER",
    eventTitle: "Business Picnic",
    status: "issued" as const,
    issuedAt: "2026-07-24T12:00:00.000Z"
  }];

  constructor(private readonly redeliverable: RedeliverableTicket | null = {
    ticketId,
    ticketNumber: "BP-ORDER-T001",
    orderId,
    ownerUserId,
    status: "issued"
  }) {}

  async listForTelegramUser(sender: ChannelIdentity) {
    this.listRequests.push(sender);
    return this.tickets;
  }

  async lockOwnedTicketForRedelivery() {
    return this.redeliverable;
  }
}

class MemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly processed = new Set<string>();

  async tryBegin(input: BeginIdempotentOperationInput): Promise<boolean> {
    return !this.processed.has(input.key);
  }

  async markProcessed(key: string): Promise<void> {
    this.processed.add(key);
  }
}

class MemoryOutbox implements OutboxWriter {
  readonly events: DomainEvent[] = [];

  async append(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
}

const directUnitOfWork: UnitOfWork = {
  transact(operation) {
    return operation();
  }
};

const ticketId = "019c0123-4567-789a-bcde-f0123456789a";
const orderId = "019c0123-4567-789a-bcde-f0123456789b";
const ownerUserId = "019c0123-4567-789a-bcde-f0123456789c";
const eventId = "019c0123-4567-789a-bcde-f0123456789d";
