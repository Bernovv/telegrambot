/**
 * Единый список участников мероприятия: покупатели бота и заведённые руками в одной таблице.
 *
 * Это отчёт, а не хранилище. Строка про покупателя собирается из оплаченного заказа на лету,
 * строка про ручного участника — из `event_participants`. Ничего не копируется и не
 * материализуется: заказ остаётся единственным источником правды о том, кто и что купил.
 */

import type { EventParticipantFieldValue } from "./admin-accommodation.js";

/** Откуда человек пришёл. Telegram — из бота, остальное заведено руками. */
export const PARTICIPANT_CHANNELS = [
  "telegram",
  "max",
  "site",
  "direct",
  "other"
] as const;

export type ParticipantChannel = typeof PARTICIPANT_CHANNELS[number];

export interface EventParticipantRow {
  /**
   * Устойчивый ключ строки: `order:<id>` или `manual:<id>`. Своего идентификатора у строки
   * нет — она собрана из двух разных таблиц.
   */
  readonly key: string;
  readonly origin: "order" | "manual";
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly participantId: string | null;
  readonly channel: ParticipantChannel;
  readonly displayName: string;
  readonly phone: string | null;
  readonly telegramUsername: string | null;
  /** Тарифы заказа через запятую; у ручного участника — то, что вписали. */
  readonly ticketTitle: string;
  readonly adults: number;
  readonly children: number;
  readonly sleepingPlaces: number;
  readonly amountKopecks: string | null;
  readonly paidAt: string | null;
  readonly paymentMethod: string | null;
  readonly note: string;
  readonly customFields: readonly EventParticipantFieldValue[];
}

export interface EventParticipantTotals {
  readonly people: number;
  readonly guests: number;
  readonly adults: number;
  readonly children: number;
  readonly sleepingPlaces: number;
  readonly amountKopecks: string;
  readonly fromOrders: number;
  readonly fromManual: number;
}

export interface EventParticipantsView {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly calculatedAt: string;
  readonly totals: EventParticipantTotals;
  readonly rows: readonly EventParticipantRow[];
  /** Заказы, помеченные тестовыми: в список не идут, из истории не удалены. */
  readonly excludedOrders: number;
  readonly canManageParticipants: boolean;
}
