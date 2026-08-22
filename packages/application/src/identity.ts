import type {
  HandleTelegramStartCommand,
  HandleTelegramStartResult
} from "@ticket-platform/contracts";
import type {
  DomainEvent,
  MessengerChannel,
  ParsedStartPayload
} from "@ticket-platform/domain";
import { normalizeTelegramUsername, parseStartPayload } from "@ticket-platform/domain";

/**
 * Кто говорит: канал плюс идентификатор человека в нём.
 *
 * Пара, а не один идентификатор. Номер `777` в Telegram и `777` в MAX — это два разных
 * человека, и любой поиск по одному лишь внешнему идентификатору однажды соединит их в
 * одного. Пока канал был один, разницы не было; с появлением MAX она становится ценой
 * ошибки в чужом кошельке.
 */
export interface ChannelIdentity {
  readonly channel: MessengerChannel;
  readonly externalUserId: string;
}

export interface UserRecord {
  readonly id: string;
  readonly phoneStatus: "unknown" | "imported" | "verified" | "rejected";
}

export interface MessengerIdentityRecord {
  readonly id: string;
  readonly userId: string;
}

export interface UpsertTelegramIdentityInput {
  readonly channel: MessengerChannel;
  readonly externalUserId: string;
  readonly username: string | null;
  readonly usernameNormalized: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly languageCode: string | null;
  readonly seenAt: Date;
}

export interface UpsertTelegramIdentityResult {
  readonly user: UserRecord;
  readonly messengerIdentity: MessengerIdentityRecord;
  readonly isNewUser: boolean;
}

export interface RecordTouchpointInput {
  readonly userId: string;
  readonly channel: MessengerChannel;
  readonly payload: ParsedStartPayload;
  readonly occurredAt: Date;
}

export interface IdentityRepository {
  upsertTelegramIdentity(input: UpsertTelegramIdentityInput): Promise<UpsertTelegramIdentityResult>;
  recordTouchpoint(input: RecordTouchpointInput): Promise<void>;
}

export interface IdempotencyRepository {
  tryBegin(input: BeginIdempotentOperationInput): Promise<boolean>;
  markProcessed(key: string, processedAt: Date): Promise<void>;
}

export interface BeginIdempotentOperationInput {
  readonly key: string;
  readonly scope: IdempotencyScope;
  readonly occurredAt: Date;
}

/**
 * Область ключа идемпотентности — своя у каждого канала.
 *
 * Не для порядка: номера апдейтов Telegram и MAX живут в разных пространствах, и при общей
 * области апдейт MAX однажды совпал бы с уже обработанным телеграмным. Совпадение это не
 * ошибка на экране, а молча потерянный диалог — «уже обработано».
 */
export type IdempotencyScope = "telegram_update" | "max_update";

export function updateScope(channel: MessengerChannel): IdempotencyScope {
  return channel === "max" ? "max_update" : "telegram_update";
}

export class HandleTelegramStartService {
  constructor(
    private readonly identityRepository: IdentityRepository,
    private readonly idempotencyRepository: IdempotencyRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(command: HandleTelegramStartCommand): Promise<HandleTelegramStartResult> {
    const scope = updateScope(command.channel);
    const idempotencyKey = `${scope}:${command.updateId}`;

    return this.unitOfWork.transact(async () => {
      const shouldProcess = await this.idempotencyRepository.tryBegin({
        key: idempotencyKey,
        scope,
        occurredAt: command.receivedAt
      });
      const identity = await this.identityRepository.upsertTelegramIdentity({
        channel: command.channel,
        externalUserId: command.user.externalUserId,
        username: command.user.username ?? null,
        usernameNormalized: normalizeTelegramUsername(command.user.username),
        firstName: command.user.firstName ?? null,
        lastName: command.user.lastName ?? null,
        languageCode: command.user.languageCode ?? null,
        seenAt: command.receivedAt
      });

      const parsedPayload = parseStartPayload(command.startPayload);

      if (shouldProcess && parsedPayload.rawPayload) {
        await this.identityRepository.recordTouchpoint({
          userId: identity.user.id,
          channel: command.channel,
          payload: parsedPayload,
          occurredAt: command.receivedAt
        });
      }

      if (shouldProcess && identity.isNewUser) {
        await this.outboxWriter.append(
          userRegisteredEvent(this.idGenerator.newId(), identity.user.id, command.receivedAt)
        );
      }

      if (shouldProcess) {
        await this.idempotencyRepository.markProcessed(idempotencyKey, command.receivedAt);
      }

      return {
        userId: identity.user.id,
        messengerIdentityId: identity.messengerIdentity.id,
        isNewUser: identity.isNewUser,
        phoneRequired: identity.user.phoneStatus !== "verified" && identity.user.phoneStatus !== "imported",
        selectedEventSlug: parsedPayload.eventSlug
      };
    });
  }
}

export interface UnitOfWork {
  transact<T>(work: () => Promise<T>): Promise<T>;
}

export interface OutboxWriter {
  append(event: DomainEvent): Promise<void>;
}

export interface IdGenerator {
  newId(): string;
}

function userRegisteredEvent(
  eventId: string,
  userId: string,
  occurredAt: Date
): DomainEvent<{ userId: string }> {
  return {
    eventId,
    aggregateType: "user",
    aggregateId: userId,
    eventType: "UserRegistered",
    schemaVersion: 1,
    payload: { userId },
    occurredAt
  };
}
