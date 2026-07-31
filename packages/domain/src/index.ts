export type MoneyKopecks = bigint;

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly eventId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: TPayload;
  readonly occurredAt: Date;
}

export function kopecks(value: number): MoneyKopecks {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Money amount must be a non-negative integer number of kopecks");
  }

  return BigInt(value);
}

export * from "./messenger.js";
export * from "./wallet.js";
export * from "./pricing.js";
export * from "./order.js";
export * from "./referral.js";
export * from "./accommodation.js";
