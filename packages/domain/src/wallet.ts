import type { MoneyKopecks } from "./index.js";

export type WalletBucket = "bonus" | "referral" | "cash_equivalent" | "refund";

export type WalletTransactionType =
  | "PHONE_BONUS"
  | "REFERRAL_REWARD"
  | "ADMIN_ADJUSTMENT"
  | "ORDER_HOLD"
  | "ORDER_CAPTURE"
  | "ORDER_RELEASE"
  | "REFUND_CREDIT"
  | "REFERRAL_REVERSAL"
  | "EXPIRATION"
  | "MIGRATION_OPENING_BALANCE";

export interface WalletBalance {
  readonly available: MoneyKopecks;
  readonly held: MoneyKopecks;
}

export function creditWallet(balance: WalletBalance, amount: MoneyKopecks): WalletBalance {
  assertPositiveKopecks(amount);
  assertWalletBalance(balance);

  return {
    available: balance.available + amount,
    held: balance.held
  };
}

export function createWalletHold(balance: WalletBalance, amount: MoneyKopecks): WalletBalance {
  assertPositiveKopecks(amount);
  assertWalletBalance(balance);

  if (amount > balance.available) {
    throw new Error("Wallet hold exceeds available balance");
  }

  return {
    available: balance.available - amount,
    held: balance.held + amount
  };
}

export function captureWalletHold(balance: WalletBalance, amount: MoneyKopecks): WalletBalance {
  assertPositiveKopecks(amount);
  assertWalletBalance(balance);

  if (amount > balance.held) {
    throw new Error("Wallet capture exceeds held balance");
  }

  return {
    available: balance.available,
    held: balance.held - amount
  };
}

export function releaseWalletHold(balance: WalletBalance, amount: MoneyKopecks): WalletBalance {
  assertPositiveKopecks(amount);
  assertWalletBalance(balance);

  if (amount > balance.held) {
    throw new Error("Wallet release exceeds held balance");
  }

  return {
    available: balance.available + amount,
    held: balance.held - amount
  };
}

export function assertWalletBalance(balance: WalletBalance): void {
  if (balance.available < 0n || balance.held < 0n) {
    throw new Error("Wallet balances cannot be negative");
  }
}

export function assertPositiveKopecks(amount: MoneyKopecks): void {
  if (amount <= 0n) {
    throw new Error("Wallet amount must be greater than zero kopecks");
  }
}
