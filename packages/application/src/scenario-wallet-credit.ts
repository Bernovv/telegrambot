import { createHash } from "node:crypto";
import type { DomainEvent, MoneyKopecks } from "@ticket-platform/domain";
import type {
  IdGenerator,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAXIMUM_SCENARIO_CREDIT_KOPECKS = 1_000_000n;

export interface CreditScenarioWalletCommand {
  readonly userId: string;
  readonly eventId: string;
  readonly scenarioSessionId: string;
  readonly scenarioVersionId: string;
  readonly nodeId: string;
  readonly amountKopecks: string;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly creditedAt: Date;
}

export interface ExistingScenarioWalletCredit {
  readonly transactionId: string;
  readonly transactionType: string;
  readonly status: string;
  readonly requestHash: string | null;
  readonly userId: string;
  readonly amount: MoneyKopecks;
  readonly currency: string;
  readonly availableBalance: MoneyKopecks;
}

export interface PersistScenarioWalletCreditInput {
  readonly transactionId: string;
  readonly entryId: string;
  readonly requestHash: string;
  readonly command: CreditScenarioWalletCommand;
  readonly amount: MoneyKopecks;
}

export interface ScenarioWalletCreditRepository {
  lockIdempotencyKey(idempotencyKey: string): Promise<void>;
  findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<ExistingScenarioWalletCredit | null>;
  persistCredit(input: PersistScenarioWalletCreditInput): Promise<{
    readonly availableBalance: MoneyKopecks;
  }>;
}

export interface CreditScenarioWalletResult {
  readonly transactionId: string;
  readonly amountKopecks: string;
  readonly currency: string;
  readonly availableBalanceKopecks: string;
  readonly credited: boolean;
}

export class CreditScenarioWalletService {
  constructor(
    private readonly repository: ScenarioWalletCreditRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  execute(command: CreditScenarioWalletCommand): Promise<CreditScenarioWalletResult> {
    const amount = validateCommand(command);
    const requestHash = hashRequest(command);

    return this.unitOfWork.transact(async () => {
      await this.repository.lockIdempotencyKey(command.idempotencyKey);
      const existing = await this.repository.findByIdempotencyKey(
        command.idempotencyKey
      );
      if (existing) {
        validateExisting(existing, command, amount, requestHash);
        return result(existing, false);
      }

      const transactionId = this.idGenerator.newId();
      const persisted = await this.repository.persistCredit({
        transactionId,
        entryId: this.idGenerator.newId(),
        requestHash,
        command,
        amount
      });
      await this.outboxWriter.append(walletCreditedEvent(
        this.idGenerator.newId(),
        transactionId,
        command,
        amount
      ));

      return {
        transactionId,
        amountKopecks: amount.toString(),
        currency: command.currency,
        availableBalanceKopecks: persisted.availableBalance.toString(),
        credited: true
      };
    });
  }
}

function validateCommand(command: CreditScenarioWalletCommand): MoneyKopecks {
  for (const id of [
    command.userId,
    command.eventId,
    command.scenarioSessionId,
    command.scenarioVersionId,
    command.nodeId
  ]) {
    if (!UUID_PATTERN.test(id)) {
      throw new Error("Scenario wallet credit identity is invalid");
    }
  }
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(command.idempotencyKey)) {
    throw new Error("Scenario wallet credit idempotency key is invalid");
  }
  if (!/^[1-9]\d{0,6}$/.test(command.amountKopecks)) {
    throw new Error("Scenario wallet credit amount must be positive integer kopecks");
  }
  const amount = BigInt(command.amountKopecks);
  if (amount > MAXIMUM_SCENARIO_CREDIT_KOPECKS) {
    throw new Error("Scenario wallet credit amount exceeds the per-node limit");
  }
  if (!/^[A-Z]{3}$/.test(command.currency)) {
    throw new Error("Scenario wallet credit currency is invalid");
  }
  const reason = command.reason.trim();
  if (reason.length < 3 || reason.length > 200) {
    throw new Error("Scenario wallet credit reason is invalid");
  }
  if (Number.isNaN(command.creditedAt.getTime())) {
    throw new Error("Scenario wallet credit time is invalid");
  }
  return amount;
}

function validateExisting(
  existing: ExistingScenarioWalletCredit,
  command: CreditScenarioWalletCommand,
  amount: MoneyKopecks,
  requestHash: string
): void {
  if (
    existing.transactionType !== "SCENARIO_CREDIT"
    || existing.status !== "posted"
    || existing.requestHash !== requestHash
    || existing.userId !== command.userId
    || existing.amount !== amount
    || existing.currency !== command.currency
  ) {
    throw new Error(
      "Scenario wallet credit idempotency key was already used for another operation"
    );
  }
}

function hashRequest(command: CreditScenarioWalletCommand): string {
  return createHash("sha256").update(JSON.stringify({
    userId: command.userId,
    eventId: command.eventId,
    amountKopecks: command.amountKopecks,
    currency: command.currency,
    idempotencyKey: command.idempotencyKey,
    reason: command.reason.trim()
  })).digest("hex");
}

function result(
  existing: ExistingScenarioWalletCredit,
  credited: boolean
): CreditScenarioWalletResult {
  return {
    transactionId: existing.transactionId,
    amountKopecks: existing.amount.toString(),
    currency: existing.currency,
    availableBalanceKopecks: existing.availableBalance.toString(),
    credited
  };
}

function walletCreditedEvent(
  eventId: string,
  transactionId: string,
  command: CreditScenarioWalletCommand,
  amount: MoneyKopecks
): DomainEvent<{
  transactionId: string;
  userId: string;
  eventId: string;
  scenarioSessionId: string;
  scenarioVersionId: string;
  nodeId: string;
  amountKopecks: string;
  currency: string;
}> {
  return {
    eventId,
    aggregateType: "wallet",
    aggregateId: command.userId,
    eventType: "ScenarioWalletCredited",
    schemaVersion: 1,
    payload: {
      transactionId,
      userId: command.userId,
      eventId: command.eventId,
      scenarioSessionId: command.scenarioSessionId,
      scenarioVersionId: command.scenarioVersionId,
      nodeId: command.nodeId,
      amountKopecks: amount.toString(),
      currency: command.currency
    },
    occurredAt: command.creditedAt
  };
}
