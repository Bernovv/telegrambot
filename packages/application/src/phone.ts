import type {
  HandleTelegramContactCommand,
  HandleTelegramContactResult
} from "@ticket-platform/contracts";
import type { DomainEvent, MoneyKopecks } from "@ticket-platform/domain";
import type {
  IdGenerator,
  IdempotencyRepository,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";

export interface VerifyPhoneInput {
  readonly userId: string;
  readonly phoneE164: string;
  readonly source: "telegram_contact";
  readonly verifiedAt: Date;
}

export interface PhoneVerificationRepository {
  verifyPhone(input: VerifyPhoneInput): Promise<{ readonly newlyVerified: boolean }>;
}

export interface TelegramUserResolver {
  resolveUserId(externalUserId: string): Promise<string>;
}

export interface CreditPhoneBonusInput {
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: Date;
}

export interface CreditPhoneBonusResult {
  readonly credited: boolean;
  readonly reason: "credited" | "already_credited" | "campaign_inactive";
  readonly amount: MoneyKopecks;
  readonly availableBalance: MoneyKopecks;
  readonly currency: string;
}

export interface PhoneBonusRepository {
  creditPhoneBonus(input: CreditPhoneBonusInput): Promise<CreditPhoneBonusResult>;
}

export interface PhoneNormalizer {
  normalize(rawPhone: string): string;
}

export class HandleTelegramContactService {
  constructor(
    private readonly phoneNormalizer: PhoneNormalizer,
    private readonly telegramUserResolver: TelegramUserResolver,
    private readonly phoneRepository: PhoneVerificationRepository,
    private readonly phoneBonusRepository: PhoneBonusRepository,
    private readonly idempotencyRepository: IdempotencyRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(command: HandleTelegramContactCommand): Promise<HandleTelegramContactResult> {
    if (command.contact.externalUserId !== command.senderExternalUserId) {
      return { accepted: false, reason: "third_party_contact" };
    }

    const phoneE164 = this.phoneNormalizer.normalize(command.contact.phoneNumber);

    return this.unitOfWork.transact(async () => {
      const shouldProcess = await this.idempotencyRepository.tryBegin({
        key: `telegram_update:${command.updateId}`,
        scope: "telegram_update",
        occurredAt: command.receivedAt
      });
      const userId = await this.telegramUserResolver.resolveUserId(command.senderExternalUserId);
      const verification = await this.phoneRepository.verifyPhone({
        userId,
        phoneE164,
        source: "telegram_contact",
        verifiedAt: command.receivedAt
      });
      const bonus = await this.phoneBonusRepository.creditPhoneBonus({
        userId,
        idempotencyKey: `phone_bonus:${userId}`,
        occurredAt: command.receivedAt
      });

      if (shouldProcess && verification.newlyVerified) {
        await this.outboxWriter.append(
          phoneVerifiedEvent(this.idGenerator.newId(), userId, command.receivedAt)
        );
      }

      if (shouldProcess && bonus.credited) {
        await this.outboxWriter.append(
          phoneBonusCreditedEvent(
            this.idGenerator.newId(),
            userId,
            bonus.amount,
            bonus.currency,
            command.receivedAt
          )
        );
      }

      if (shouldProcess) {
        await this.idempotencyRepository.markProcessed(
          `telegram_update:${command.updateId}`,
          command.receivedAt
        );
      }

      return {
        accepted: true,
        phoneNewlyVerified: verification.newlyVerified,
        bonusCredited: bonus.credited,
        bonusReason: bonus.reason,
        bonusAmountKopecks: bonus.amount.toString(),
        availableBalanceKopecks: bonus.availableBalance.toString()
      };
    });
  }
}

function phoneVerifiedEvent(eventId: string, userId: string, occurredAt: Date): DomainEvent<{ userId: string }> {
  return {
    eventId,
    aggregateType: "user",
    aggregateId: userId,
    eventType: "PhoneVerified",
    schemaVersion: 1,
    payload: { userId },
    occurredAt
  };
}

function phoneBonusCreditedEvent(
  eventId: string,
  userId: string,
  amount: MoneyKopecks,
  currency: string,
  occurredAt: Date
): DomainEvent<{ userId: string; amountKopecks: string; currency: string }> {
  return {
    eventId,
    aggregateType: "wallet",
    aggregateId: userId,
    eventType: "PhoneBonusCredited",
    schemaVersion: 1,
    payload: { userId, amountKopecks: amount.toString(), currency },
    occurredAt
  };
}
