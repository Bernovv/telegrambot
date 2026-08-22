import type { ChannelIdentity } from "./identity.js";
import type {
  ListTelegramTicketsCommand,
  ListTelegramTicketsResult,
  RequestTelegramTicketRedeliveryCommand,
  RequestTelegramTicketRedeliveryResult,
  TelegramTicketSummary
} from "@ticket-platform/contracts";
import type { DomainEvent } from "@ticket-platform/domain";
import type {
  IdGenerator,
  IdempotencyRepository,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";

export interface RedeliverableTicket {
  readonly ticketId: string;
  readonly ticketNumber: string;
  readonly orderId: string;
  readonly ownerUserId: string;
  readonly status: TelegramTicketSummary["status"];
}

export interface TelegramTicketAccessRepository {
  listForTelegramUser(
    sender: ChannelIdentity
  ): Promise<readonly TelegramTicketSummary[] | null>;
  lockOwnedTicketForRedelivery(
    ticketId: string,
    sender: ChannelIdentity
  ): Promise<RedeliverableTicket | null>;
}

export class ListTelegramTicketsService {
  constructor(private readonly repository: TelegramTicketAccessRepository) {}

  async execute(command: ListTelegramTicketsCommand): Promise<ListTelegramTicketsResult> {
    if (!isTelegramUserId(command.senderExternalUserId)) {
      return { identityFound: false, tickets: [] };
    }

    const tickets = await this.repository.listForTelegramUser({
      channel: command.channel,
      externalUserId: command.senderExternalUserId
    });
    return tickets === null
      ? { identityFound: false, tickets: [] }
      : { identityFound: true, tickets };
  }
}

export class RequestTelegramTicketRedeliveryService {
  constructor(
    private readonly repository: TelegramTicketAccessRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly outbox: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  execute(
    command: RequestTelegramTicketRedeliveryCommand
  ): Promise<RequestTelegramTicketRedeliveryResult> {
    if (
      !isUuid(command.ticketId)
      || !isTelegramUserId(command.senderExternalUserId)
      || !/^\d{1,30}$/.test(command.updateId)
      || Number.isNaN(command.requestedAt.getTime())
    ) {
      return Promise.resolve({ accepted: false, reason: "ticket_unavailable" });
    }

    return this.unitOfWork.transact(async () => {
      const ticket = await this.repository.lockOwnedTicketForRedelivery(
        command.ticketId,
        { channel: command.channel, externalUserId: command.senderExternalUserId }
      );
      if (!ticket || ticket.status !== "issued") {
        return { accepted: false, reason: "ticket_unavailable" };
      }

      const idempotencyKey = `telegram_update:${command.updateId}`;
      const newlyRequested = await this.idempotency.tryBegin({
        key: idempotencyKey,
        scope: "telegram_update",
        occurredAt: command.requestedAt
      });
      if (!newlyRequested) {
        return {
          accepted: true,
          newlyRequested: false,
          ticketNumber: ticket.ticketNumber
        };
      }

      await this.outbox.append(ticketRedeliveryRequestedEvent(
        this.idGenerator.newId(),
        ticket,
        command.requestedAt
      ));
      await this.idempotency.markProcessed(idempotencyKey, command.requestedAt);

      return {
        accepted: true,
        newlyRequested: true,
        ticketNumber: ticket.ticketNumber
      };
    });
  }
}

function ticketRedeliveryRequestedEvent(
  eventId: string,
  ticket: RedeliverableTicket,
  occurredAt: Date
): DomainEvent<{
  orderId: string;
  ownerUserId: string;
  ticketIds: readonly string[];
}> {
  return {
    eventId,
    aggregateType: "ticket",
    aggregateId: ticket.ticketId,
    eventType: "TicketRedeliveryRequested",
    schemaVersion: 1,
    payload: {
      orderId: ticket.orderId,
      ownerUserId: ticket.ownerUserId,
      ticketIds: [ticket.ticketId]
    },
    occurredAt
  };
}

function isTelegramUserId(value: string): boolean {
  return /^\d{1,20}$/.test(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
