import type {
  AccountBroadcastPace,
  AccountBroadcastSummary,
  AccountSavedMessageKind
} from "@ticket-platform/contracts/admin-account-broadcasts";
import { AdminApiError } from "./admin-api";

/** Подписи и расчёты экрана «Рассылка от рабочего аккаунта». */

export function savedKindLabel(kind: AccountSavedMessageKind): string {
  switch (kind) {
    case "text":
      return "Текст";
    case "video_note":
      return "Кружок";
    case "photo":
      return "Фото";
    case "video":
      return "Видео";
    case "voice":
      return "Голосовое";
    case "audio":
      return "Аудио";
    case "document":
      return "Документ";
    case "animation":
      return "GIF";
    default:
      return "Сообщение";
  }
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "";
  }
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Сколько займёт отправка — грубо, но честно: средняя пауза, потолок на сутки, окно дня.
 * Ночь в расчёт входит только через сутки: «уйдёт за 3 дня» человеку понятнее, чем часы.
 */
export function estimateSending(count: number, pace: AccountBroadcastPace): string {
  if (count <= 0) {
    return "";
  }
  const days = Math.ceil(count / pace.dailyLimit);
  if (days > 1) {
    return `около ${days} ${plural(days, "дня", "дней", "дней")} — не больше ${pace.dailyLimit} в сутки`;
  }
  const averageSeconds = (pace.pauseMinSeconds + pace.pauseMaxSeconds) / 2;
  const minutes = Math.max(1, Math.round((count * averageSeconds) / 60));
  return minutes < 90
    ? `около ${minutes} мин`
    : `около ${Math.round(minutes / 60)} ч`;
}

export function describePace(pace: AccountBroadcastPace): string {
  const zone = pace.timeZone === "Europe/Moscow" ? "МСК" : pace.timeZone;
  return `По одному сообщению раз в ${pace.pauseMinSeconds}–${pace.pauseMaxSeconds} секунд, `
    + `до ${pace.dailyLimit} человек в сутки, с ${pace.windowStartHour}:00 до `
    + `${pace.windowEndHour}:00 ${zone}. Пробная уходит сразу и в любое время.`;
}

export function accountBroadcastStatus(item: AccountBroadcastSummary): string {
  if (item.status === "completed") {
    return "Завершена";
  }
  if (item.status === "cancelled") {
    return item.stopReason ? `Остановлена: ${item.stopReason}` : "Остановлена";
  }
  if (item.pausedUntil) {
    return `Пауза до ${formatMoment(item.pausedUntil)}`;
  }
  return "Идёт";
}

export function accountBroadcastTarget(item: AccountBroadcastSummary): string {
  if (item.isTest) {
    return `Пробная: ${item.testRecipientName ?? "один получатель"}`;
  }
  return item.eventTitle ?? "Мероприятие";
}

export function accountBroadcastParts(item: AccountBroadcastSummary): string {
  return item.parts
    .map((part) => {
      const duration = part.durationSeconds ? ` ${formatDuration(part.durationSeconds)}` : "";
      const text = part.body ? `: ${truncate(part.body, 50)}` : "";
      return `${savedKindLabel(part.kind)}${duration}${text}`;
    })
    .join(" + ");
}

export function accountBroadcastErrorMessage(error: unknown): string {
  if (!(error instanceof AdminApiError)) {
    return "Сервис рассылок временно недоступен.";
  }
  if (error.status === 403) {
    return "Для отправки рассылок требуется разрешение broadcasts.send.";
  }
  if (error.status === 404 && error.code === "NOT_FOUND") {
    return "Раздел ещё не включён на сервере: api не обновлён.";
  }
  return error.message;
}

export function formatMoment(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}
