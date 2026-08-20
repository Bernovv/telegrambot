import type {
  OutreachChannel,
  OutreachContactStatus,
  OutreachLostReason,
  OutreachPipelineColumnOutcome,
  OutreachPipelineStage,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";

/**
 * Подписи к справочникам работы с базой.
 *
 * Живут отдельно от страниц потому, что одни и те же слова нужны в кампании, на доске задач
 * и в карточке клиента. Пока они лежали копиями внутри страниц, «Оплатил» на одной успевал
 * стать «Оплачено» на другой, и менеджеры считали это разными состояниями.
 */

export function statusLabel(status: OutreachContactStatus): string {
  return {
    new: "Не обрабатывали",
    sent: "Отправлено",
    no_answer: "Не ответил",
    answered: "Ответил",
    callback: "Перезвонить",
    interested: "Заинтересован",
    declined: "Отказ",
    converted: "Оплатил",
    invalid: "Неверный контакт"
  }[status];
}

export function channelLabel(channel: OutreachChannel): string {
  return {
    phone: "Звонок",
    telegram: "Telegram",
    max: "MAX",
    whatsapp: "WhatsApp",
    sms: "SMS",
    other: "Другое"
  }[channel];
}

export function taskTypeLabel(type: OutreachTaskType): string {
  return {
    call: "Позвонить",
    message: "Написать",
    other: "Другое"
  }[type];
}

export function lostReasonLabel(reason: OutreachLostReason): string {
  return {
    declined: "Отказался",
    not_relevant: "Неактуально",
    invalid_contact: "Неверный контакт",
    duplicate: "Дубль",
    other: "Другое"
  }[reason];
}

/** Названия стартовых стадий. Переименованные менеджером приходят с сервера своим label. */
export function stageLabel(stage: OutreachPipelineStage): string {
  return (({
    new: "Новые",
    first_contact: "Первичный контакт",
    dialogue: "В диалоге",
    follow_up: "Думает / перезвонить",
    interested: "Заинтересован",
    won: "Оплатил / зарегистрировался",
    lost: "Закрыто без результата"
  }) as Record<string, string>)[stage] ?? stage;
}

// Отдельные стадии в середине воронки не имеют закреплённого смысла — менеджер волен их
// переименовать и переставить. Поэтому цвет берётся только из признака исхода.
export function stageTone(
  outcome: OutreachPipelineColumnOutcome
): "positive" | "warning" | "neutral" | "danger" {
  if (outcome === "won") {
    return "positive";
  }
  if (outcome === "lost") {
    return "danger";
  }
  return "neutral";
}

export const LOST_REASONS: readonly OutreachLostReason[] = [
  "declined",
  "not_relevant",
  "invalid_contact",
  "duplicate",
  "other"
];
