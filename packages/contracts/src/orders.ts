export interface CreateOrderLineCommand {
  readonly productId: string;
  readonly quantity: number;
}

export type WalletApplicationCommand =
  | { readonly mode: "none" }
  | { readonly mode: "all" }
  | { readonly mode: "amount"; readonly amountKopecks: string };

export interface CreateOrderCommand {
  readonly idempotencyKey: string;
  readonly userId: string;
  readonly eventId: string;
  readonly currency: string;
  readonly items: readonly CreateOrderLineCommand[];
  readonly wallet: WalletApplicationCommand;
  readonly source: string;
  readonly createdAt: Date;
}

export interface CreateOrderResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly publicToken: string;
  readonly status: "awaiting_offer" | "awaiting_payment";
  readonly currency: string;
  readonly totalKopecks: string;
  readonly walletAppliedKopecks: string;
  readonly externalDueKopecks: string;
  readonly expiresAt: string;
  readonly created: boolean;
}
