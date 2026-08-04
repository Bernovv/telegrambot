import { AdminApiError } from "@/lib/admin-api";
import { orderStatusLabel } from "@/lib/format";
import type {
  AdminBroadcastAudience,
  AdminBroadcastSummary,
  AdminOrderStatus
} from "@ticket-platform/contracts";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";

export const BROADCAST_TEXT_LIMIT = 3_500;
export const BROADCAST_CAPTION_LIMIT = 1_024;
export const BROADCAST_IMAGE_MAX_BYTES = 1_048_576;

export function messageLimit(hasImage: boolean): number {
  return hasImage ? BROADCAST_CAPTION_LIMIT : BROADCAST_TEXT_LIMIT;
}

export function audienceLabel(audience: AdminBroadcastAudience): string {
  return audience === "bot_users"
    ? "Все, кто открывал бота"
    : "У кого есть заказ";
}

export function describeAudience(
  targetAudience: AdminBroadcastAudience,
  targetEventId: string,
  targetOrderStatus: AdminOrderStatus | "",
  events: readonly AdminEventSummary[]
): string {
  if (targetAudience === "bot_users") {
    return "Получатели: все, кто открывал бота, — включая тех, кто ничего не покупал.";
  }
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

export function broadcastStatusLabel(status: AdminBroadcastSummary["status"]): string {
  switch (status) {
    case "pending":
      return "В очереди";
    case "sending":
      return "Отправляется";
    case "completed":
      return "Отправлена";
    default:
      return "Не состоялась";
  }
}

/** Что показать в колонке результата: пока не отправлено — счётчикам верить нечему. */
export function broadcastResultLabel(summary: AdminBroadcastSummary): string {
  if (summary.status === "pending") {
    return "—";
  }
  const parts = [`${summary.sentCount} отправлено`];
  if (summary.failedCount > 0) {
    parts.push(`${summary.failedCount} не дошло`);
  }
  return parts.join(", ");
}

export function broadcastTargetLabel(
  summary: AdminBroadcastSummary
): string {
  if (summary.isTest) {
    return "Пробная";
  }
  if (summary.targetAudience === "bot_users") {
    return audienceLabel("bot_users");
  }
  const parts = [summary.targetEventTitle ?? "Все мероприятия"];
  if (summary.targetOrderStatus) {
    parts.push(orderStatusLabel(summary.targetOrderStatus));
  }
  return parts.join(" · ");
}

export function imageErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError && error.code === "INVALID_BROADCAST_IMAGE") {
    return "Не подходит: нужен PNG или JPEG до 1 МБ, не слишком вытянутый по сторонам.";
  }
  return broadcastErrorMessage(error);
}

export function broadcastErrorMessage(error: unknown): string {
  if (!(error instanceof AdminApiError)) {
    return "Сервис рассылок временно недоступен.";
  }
  if (error.status === 403) {
    return "Для отправки рассылок требуется разрешение broadcasts.send.";
  }
  if (error.status === 413) {
    return "Файл слишком большой — нужен PNG или JPEG до 1 МБ.";
  }
  if (error.code === "INVALID_BROADCAST_IMAGE") {
    return "Не подходит: нужен PNG или JPEG до 1 МБ, не слишком вытянутый по сторонам.";
  }
  if (error.code === "INVALID_BROADCAST_REQUEST") {
    return "Проверьте текст сообщения и выбранные условия.";
  }
  return error.message;
}
