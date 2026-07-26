import type { AdminOrderStatus } from "@ticket-platform/contracts";
import type {
  AdminEventStatus,
  AdminProductType
} from "@ticket-platform/contracts/admin-events";

export function formatKopecks(value: string): string {
  try {
    const kopecks = BigInt(value);
    const sign = kopecks < 0n ? "-" : "";
    const absolute = kopecks < 0n ? -kopecks : kopecks;
    const rubles = absolute / 100n;
    const remainder = absolute % 100n;
    const fraction = remainder === 0n
      ? ""
      : `,${remainder.toString().padStart(2, "0")}`;
    return `${sign}${RUBLE_FORMAT.format(rubles)}${fraction} ₽`;
  } catch {
    return "—";
  }
}

export function rublesInputToKopecks(value: string): string {
  const match = /^(\d{1,17})(?:[,.](\d{1,2}))?$/.exec(value.trim());
  if (!match?.[1]) {
    throw new Error("Invalid ruble amount");
  }
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return (BigInt(match[1]) * 100n + BigInt(fraction || "0")).toString();
}

export function kopecksToRublesInput(value: string): string {
  if (!/^\d{1,19}$/.test(value)) {
    return "";
  }
  const kopecks = BigInt(value);
  const rubles = kopecks / 100n;
  const fraction = (kopecks % 100n).toString().padStart(2, "0");
  return fraction === "00" ? rubles.toString() : `${rubles},${fraction}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return DATE_TIME_FORMAT.format(date);
}

export function formatEventDateTime(
  value: string | null,
  timeZone: string
): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone
    }).format(date);
  } catch {
    return DATE_TIME_FORMAT.format(date);
  }
}

export function formatCompactDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return DATE_FORMAT.format(date);
}

export function orderStatusLabel(status: AdminOrderStatus): string {
  return ORDER_STATUS_LABELS[status];
}

export function orderStatusTone(
  status: AdminOrderStatus
): "positive" | "warning" | "neutral" | "danger" {
  if (status === "paid") {
    return "positive";
  }
  if (status === "awaiting_payment" || status === "payment_processing") {
    return "warning";
  }
  if (status === "cancelled" || status === "expired" || status === "refunded") {
    return "danger";
  }
  return "neutral";
}

export function eventStatusLabel(status: AdminEventStatus): string {
  return EVENT_STATUS_LABELS[status];
}

export function eventStatusTone(
  status: AdminEventStatus
): "positive" | "warning" | "neutral" | "danger" {
  if (status === "published") {
    return "positive";
  }
  if (status === "sales_paused" || status === "sold_out") {
    return "warning";
  }
  if (status === "archived") {
    return "danger";
  }
  return "neutral";
}

export function productTypeLabel(type: AdminProductType): string {
  return PRODUCT_TYPE_LABELS[type];
}

const RUBLE_FORMAT = new Intl.NumberFormat("ru-RU");
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow"
});
const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Moscow"
});

const ORDER_STATUS_LABELS: Record<AdminOrderStatus, string> = {
  draft: "Черновик",
  awaiting_offer: "Ожидает оферту",
  awaiting_payment: "Ожидает оплату",
  payment_processing: "Платёж обрабатывается",
  paid: "Оплачен",
  cancelled: "Отменён",
  expired: "Истёк",
  partially_refunded: "Частичный возврат",
  refunded: "Возвращён"
};

const EVENT_STATUS_LABELS: Record<AdminEventStatus, string> = {
  draft: "Черновик",
  published: "Опубликовано",
  sales_paused: "Продажи приостановлены",
  sold_out: "Мест нет",
  finished: "Завершено",
  archived: "В архиве"
};

const PRODUCT_TYPE_LABELS: Record<AdminProductType, string> = {
  adult_standard: "Взрослый стандарт",
  adult_vip: "Взрослый VIP",
  child: "Детский",
  family_standard: "Семейный стандарт",
  family_vip: "Семейный VIP",
  custom: "Специальный"
};
