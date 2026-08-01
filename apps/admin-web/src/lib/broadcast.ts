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
