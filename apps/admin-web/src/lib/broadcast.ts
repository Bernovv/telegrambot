import { AdminApiError } from "@/lib/admin-api";
import { orderStatusLabel } from "@/lib/format";
import type { AdminOrderStatus } from "@ticket-platform/contracts";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";

export function describeAudience(
  targetEventId: string,
  targetOrderStatus: AdminOrderStatus | "",
  events: readonly AdminEventSummary[]
): string {
  const eventTitle = events.find((item) => item.id === targetEventId)?.title;
  const scope = eventTitle ? `мероприятия «${eventTitle}»` : "всех мероприятий";
  if (!targetOrderStatus) {
    return `Получатели: все участники ${scope}, у кого есть хотя бы один заказ.`;
  }
  return `Получатели: участники ${scope} с заказом в статусе «${orderStatusLabel(targetOrderStatus)}».`;
}

export function recipientCountLabel(count: number): string {
  return `${count} ${pluralizeRecipients(count)}`;
}

/** «1 получатель», «2 получателя», «5 получателей» — иначе число в интерфейсе выглядит машинным. */
export function pluralizeRecipients(count: number): string {
  const tail = Math.abs(count) % 100;
  if (tail >= 11 && tail <= 14) {
    return "получателей";
  }
  switch (tail % 10) {
    case 1:
      return "получатель";
    case 2:
    case 3:
    case 4:
      return "получателя";
    default:
      return "получателей";
  }
}

export function audienceWarning(
  recipientCount: number,
  truncated: boolean,
  limit: number
): string | null {
  if (truncated) {
    return `Под условия попадает ${recipientCountLabel(recipientCount)}, но за один раз уходит не больше ${limit}. Сузьте условия.`;
  }
  if (recipientCount === 0) {
    return "Под эти условия не попадает никто — сообщение никуда не уйдёт.";
  }
  return null;
}

export function broadcastErrorMessage(error: unknown): string {
  if (!(error instanceof AdminApiError)) {
    return "Сервис рассылок временно недоступен.";
  }
  if (error.status === 403) {
    return "Для отправки рассылок требуется разрешение broadcasts.send.";
  }
  if (error.code === "INVALID_BROADCAST_REQUEST") {
    return "Проверьте текст сообщения и выбранные условия.";
  }
  return error.message;
}
