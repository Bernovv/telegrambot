/**
 * Канал мессенджера.
 *
 * Тот же перечень объявлен в `./telegram.ts` и в домене: контракты по правилу репозитория
 * не зависят ни от каких пакетов, поэтому общий тип им взять неоткуда.
 */
import type { MessengerChannel } from "./telegram.js";

/** Где оформлен заказ: мессенджер, панель или сайт. */
export type OrderChannel = MessengerChannel | "admin" | "web";

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
  /**
   * Где оформлен заказ.
   *
   * Для мессенджера это адрес доставки билета: он уйдёт туда же, где заказ оформили.
   * `admin` и `web` мессенджерами не являются — по таким заказам билет уходит туда, где
   * человек в последний раз был.
   */
  readonly channel: OrderChannel;
  readonly createdAt: Date;
}

export interface CreateOrderResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly publicToken: string;
  readonly offerPublicUrl: string | null;
  readonly status: "awaiting_offer" | "awaiting_payment";
  readonly currency: string;
  readonly totalKopecks: string;
  readonly walletAppliedKopecks: string;
  readonly externalDueKopecks: string;
  readonly expiresAt: string;
  readonly created: boolean;
}
