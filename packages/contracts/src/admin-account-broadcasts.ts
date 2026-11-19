/**
 * Рассылка от рабочего аккаунта Telegram — то, что панель видит и отправляет.
 *
 * Содержимое не набирается в панели: его кладут в «Избранное» рабочего аккаунта с телефона
 * (кружок записывают там же), а рассылка копирует выбранные сообщения как есть. Отсюда
 * в запросе не текст, а номера сообщений «Избранного».
 */

export type AccountSavedMessageKind =
  | "text"
  | "video_note"
  | "photo"
  | "video"
  | "voice"
  | "audio"
  | "document"
  | "animation"
  | "other";

/** Сколько сообщений «Избранного» можно собрать в одну рассылку: кружок, текст, фото… */
export const ACCOUNT_BROADCAST_MAX_PARTS = 5;

export interface AccountSavedMessageView {
  readonly id: string;
  readonly kind: AccountSavedMessageKind;
  /** Текст сообщения или подпись к медиа. */
  readonly body: string | null;
  readonly durationSeconds: number | null;
  /** Размытая превьюшка из самого сообщения, JPEG в base64. */
  readonly minithumbnailBase64: string | null;
  /** Наша копия файла есть: панель может показать кружок целиком. */
  readonly hasFile: boolean;
  readonly sentAt: string;
}

export interface AccountSavedMessagesResult {
  readonly items: readonly AccountSavedMessageView[];
  /** Когда процесс аккаунта последний раз заглядывал в «Избранное». Пусто — ни разу. */
  readonly lastSyncedAt: string | null;
}

/** Темп отправки — те же настройки, по которым шлёт процесс аккаунта. */
export interface AccountBroadcastPace {
  readonly pauseMinSeconds: number;
  readonly pauseMaxSeconds: number;
  readonly dailyLimit: number;
  readonly windowStartHour: number;
  readonly windowEndHour: number;
  readonly timeZone: string;
}

export interface AccountBroadcastAudienceResult {
  /** Людей у мероприятия: заявки, участники, покупатели — без повторов. */
  readonly participants: number;
  /** Из них аккаунт может написать: есть ветка переписки в Telegram. */
  readonly reachable: number;
  /** Уже получили хотя бы одно из выбранных сообщений — им второй раз не уйдёт. */
  readonly alreadyReceived: number;
  /** Номер проверили — в Telegram такого нет. */
  readonly notInTelegram: number;
  /** Номер ещё не проверяли или проверка не прошла. */
  readonly notChecked: number;
  /** Кому уйдёт, если запустить сейчас. */
  readonly willReceive: number;
  readonly pace: AccountBroadcastPace;
}

export interface CreateAccountBroadcastRequest {
  readonly savedMessageIds: readonly string[];
  /** Боевая рассылка: участникам этого мероприятия. */
  readonly eventId?: string;
  /** Пробная: одному человеку — ник `@name` или телефон. Ему нужна переписка с аккаунтом. */
  readonly testRecipient?: string;
}

export interface CreateAccountBroadcastResult {
  readonly broadcastId: string;
  readonly recipientCount: number;
}

export type AccountBroadcastStatus = "sending" | "completed" | "cancelled";

export interface AccountBroadcastPartView {
  readonly kind: AccountSavedMessageKind;
  readonly body: string | null;
  readonly durationSeconds: number | null;
}

export interface AccountBroadcastFailureReason {
  readonly reason: string;
  readonly count: number;
}

export interface AccountBroadcastSummary {
  readonly id: string;
  readonly status: AccountBroadcastStatus;
  readonly isTest: boolean;
  readonly eventId: string | null;
  readonly eventTitle: string | null;
  /** Кому ушла пробная — имя из карточки. */
  readonly testRecipientName: string | null;
  readonly parts: readonly AccountBroadcastPartView[];
  readonly createdByAdminName: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly stopReason: string | null;
  readonly pausedUntil: string | null;
  readonly pauseReason: string | null;
  readonly recipientCount: number;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly pendingCount: number;
  readonly cancelledCount: number;
  readonly lastSentAt: string | null;
  /** Почему не дошло — самые частые причины. */
  readonly failureReasons: readonly AccountBroadcastFailureReason[];
}

export interface AccountBroadcastListResult {
  readonly items: readonly AccountBroadcastSummary[];
}

export interface CancelAccountBroadcastResult {
  readonly cancelled: boolean;
}
