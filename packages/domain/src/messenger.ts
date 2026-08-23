/**
 * Канал, в котором можно **продать билет**: там живёт бот со сценарием, оплатой и QR.
 *
 * Тот же перечень объявлен в `@ticket-platform/contracts` — см. там же почему.
 */
export type MessengerChannel = "telegram" | "max";

/**
 * Канал, в котором можно **разговаривать**. Шире предыдущего на WhatsApp.
 *
 * Два типа вместо одного — потому что это два разных вопроса, и до WhatsApp они совпадали
 * случайно. Продажа завязана на бота: оплата, билет, напоминания, верифицированный профиль.
 * У аккаунта компании в WhatsApp ничего этого нет и не будет — он только разговаривает.
 *
 * Слить их обратно в один перечень значит завести в системе заказ, оплату и билет в
 * WhatsApp: состояние, которого не бывает, но которое пришлось бы обрабатывать в каждом
 * `switch` по каналу — и однажды кто-то обработает его неправильно. Ровно та же граница
 * проведена в базе: `conversations.channel` знает три значения, `orders.channel` — два.
 */
export type ConversationChannel = MessengerChannel | "whatsapp";

export interface ParsedStartPayload {
  readonly rawPayload: string | null;
  readonly source: string | null;
  readonly campaign: string | null;
  readonly partnerCode: string | null;
  readonly eventSlug: string | null;
}

export function normalizeTelegramUsername(username: string | null | undefined): string | null {
  if (!username) {
    return null;
  }

  const normalized = username.trim().replace(/^@+/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function parseStartPayload(payload: string | null | undefined): ParsedStartPayload {
  const rawPayload = normalizePayload(payload);

  if (!rawPayload) {
    return emptyPayload(null);
  }

  const result = emptyPayload(rawPayload);
  const parts = rawPayload.split("__");

  return parts.reduce<ParsedStartPayload>((current, part) => mergePayloadPart(current, part), result);
}

function normalizePayload(payload: string | null | undefined): string | null {
  if (!payload) {
    return null;
  }

  const trimmed = payload.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emptyPayload(rawPayload: string | null): ParsedStartPayload {
  return {
    rawPayload,
    source: null,
    campaign: null,
    partnerCode: null,
    eventSlug: null
  };
}

function mergePayloadPart(current: ParsedStartPayload, part: string): ParsedStartPayload {
  if (part.startsWith("partner_")) {
    return { ...current, partnerCode: part.slice("partner_".length) || null };
  }

  if (part.startsWith("event_")) {
    return { ...current, eventSlug: part.slice("event_".length) || null };
  }

  if (part.startsWith("source_")) {
    const value = part.slice("source_".length);
    return { ...current, source: value || null, campaign: value || null };
  }

  return current;
}
