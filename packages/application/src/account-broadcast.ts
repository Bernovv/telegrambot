import {
  ACCOUNT_BROADCAST_MAX_PARTS,
  type AccountBroadcastAudienceResult,
  type AccountBroadcastPace,
  type AccountBroadcastSummary,
  type AccountSavedMessageKind,
  type AccountSavedMessagesResult,
  type AdminRequestActor
} from "@ticket-platform/contracts";
import { parseTelegramUsername } from "@ticket-platform/domain";
import { nextCallSlot, type CallWindow } from "./call-window.js";
import type { IdGenerator } from "./identity.js";

/**
 * Рассылка от рабочего аккаунта Telegram.
 *
 * Чем она отличается от рассылки бота — и почему это отдельный путь, а не ещё одна галочка
 * в старой форме.
 *
 * **Содержимое не набирается, а копируется.** Кружок нельзя написать в панели: его
 * записывают на телефоне. Поэтому всё, что уходит, сначала кладут в «Избранное» рабочего
 * аккаунта, а рассылка копирует выбранные сообщения как есть (решение владельца от
 * 19.11.2026). Заодно сохраняется оформление текста и родное качество видео.
 *
 * **Пишет живое имя, а не бот.** Telegram ограничивает аккаунт, который много пишет
 * незнакомым, — и ограничивает именно тот аккаунт, через который идут ответы клиентам и
 * приветствия. Поэтому отправка идёт по одному сообщению с паузой, с потолком на сутки и
 * только днём, а просьбу Telegram подождать отправитель выполняет целиком, для всех
 * рассылок сразу.
 *
 * **Список получателей снимается в момент запуска.** Дальше он не меняется: история должна
 * показывать ровно тех, кому рассылку отправляли, а не тех, кто подходит под условия сейчас.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Предел получателей одной рассылки. При потолке 150 в сутки это месяц отправки. */
export const ACCOUNT_BROADCAST_AUDIENCE_LIMIT = 5_000;
/** Сколько последних сообщений «Избранного» показывает панель. */
export const ACCOUNT_SAVED_MESSAGES_LIST_LIMIT = 30;
export const ACCOUNT_BROADCAST_HISTORY_LIMIT = 30;

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------------------
// Панель: что лежит в «Избранном», кому уйдёт, запуск, история, остановка.
// ---------------------------------------------------------------------------------------

export interface AccountSavedMessageRecord {
  readonly id: string;
  readonly kind: AccountSavedMessageKind;
  readonly body: string | null;
  readonly durationSeconds: number | null;
  readonly minithumbnailBase64: string | null;
  readonly hasFile: boolean;
  readonly sentAt: Date;
}

export interface AccountBroadcastAudienceCounts {
  readonly participants: number;
  readonly reachable: number;
  readonly alreadyReceived: number;
  readonly notInTelegram: number;
}

export interface AccountBroadcastTestRecipient {
  readonly contactId: string | null;
  readonly conversationId: string;
  readonly externalChatId: string;
  readonly displayName: string | null;
}

export type CreateAccountBroadcastOutcome =
  | { readonly kind: "created"; readonly recipientCount: number }
  /** Одно из сообщений исчезло из «Избранного» или его нельзя копировать. */
  | { readonly kind: "saved_message_unavailable" }
  /** По этому мероприятию уже идёт рассылка. */
  | { readonly kind: "already_sending" }
  | { readonly kind: "no_recipients" }
  | { readonly kind: "too_many_recipients"; readonly count: number };

export interface AdminAccountBroadcastRepository {
  listSavedMessages(input: {
    readonly limit: number;
  }): Promise<{
    readonly items: readonly AccountSavedMessageRecord[];
    readonly lastSyncedAt: Date | null;
  }>;
  /** Файл сообщения «Избранного» у нас на диске — для просмотра кружка в панели. */
  findSavedMessageFile(savedMessageId: string): Promise<{
    readonly storagePath: string;
    readonly fileName: string | null;
    readonly mimeType: string | null;
  } | null>;
  eventExists(eventId: string): Promise<boolean>;
  countAudience(input: {
    readonly eventId: string;
    readonly savedMessageIds: readonly string[];
  }): Promise<AccountBroadcastAudienceCounts>;
  findTestRecipient(input: {
    readonly username: string | null;
    readonly phoneE164: string | null;
  }): Promise<AccountBroadcastTestRecipient | null>;
  /**
   * Рассылка, её части и получатели — одной транзакцией. Получатели боевой снимаются тем же
   * отбором, что и в подсчёте, внутри транзакции: между «посчитали» и «запустили» состав мог
   * поменяться, и в базу должно лечь то, что есть на момент запуска.
   */
  createBroadcast(input: {
    readonly broadcastId: string;
    readonly adminId: string;
    readonly savedMessageIds: readonly string[];
    readonly target:
      | { readonly kind: "event"; readonly eventId: string; readonly limit: number }
      | { readonly kind: "test"; readonly recipient: AccountBroadcastTestRecipient; readonly recipientId: string };
    readonly at: Date;
  }): Promise<CreateAccountBroadcastOutcome>;
  listBroadcasts(limit: number): Promise<readonly AccountBroadcastSummary[]>;
  cancelBroadcast(input: {
    readonly broadcastId: string;
    readonly adminId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<boolean>;
}

/** Причина отказа — для менеджера, по-русски и про дело. */
export class AccountBroadcastRequestError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "event_not_found"
      | "test_recipient_not_found"
      | "saved_message_unavailable"
      | "already_sending"
      | "no_recipients"
      | "too_many_recipients",
    readonly reason: string
  ) {
    super(reason);
    this.name = "AccountBroadcastRequestError";
  }
}

export class AdminAccountBroadcastService {
  constructor(
    private readonly repository: AdminAccountBroadcastRepository,
    private readonly ids: IdGenerator,
    private readonly pace: AccountBroadcastPace
  ) {}

  async listSavedMessages(input: {
    readonly actor: AdminRequestActor;
  }): Promise<AccountSavedMessagesResult> {
    requirePermission(input.actor);
    const listed = await this.repository.listSavedMessages({
      limit: ACCOUNT_SAVED_MESSAGES_LIST_LIMIT
    });

    return {
      items: listed.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        body: item.body,
        durationSeconds: item.durationSeconds,
        minithumbnailBase64: item.minithumbnailBase64,
        hasFile: item.hasFile,
        sentAt: item.sentAt.toISOString()
      })),
      lastSyncedAt: listed.lastSyncedAt?.toISOString() ?? null
    };
  }

  async openSavedMessageFile(input: {
    readonly actor: AdminRequestActor;
    readonly savedMessageId: string;
  }): Promise<{
    readonly storagePath: string;
    readonly fileName: string | null;
    readonly mimeType: string | null;
  } | null> {
    requirePermission(input.actor);
    requireUuid(input.savedMessageId);
    return await this.repository.findSavedMessageFile(input.savedMessageId);
  }

  async countAudience(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly savedMessageIds?: readonly string[];
  }): Promise<AccountBroadcastAudienceResult> {
    requirePermission(input.actor);
    requireUuid(input.eventId);
    const savedMessageIds = parseSavedMessageIds(input.savedMessageIds ?? [], true);
    if (!(await this.repository.eventExists(input.eventId))) {
      throw new AccountBroadcastRequestError("event_not_found", "Мероприятие не найдено");
    }

    const counts = await this.repository.countAudience({
      eventId: input.eventId,
      savedMessageIds
    });

    return {
      participants: counts.participants,
      reachable: counts.reachable,
      alreadyReceived: counts.alreadyReceived,
      notInTelegram: counts.notInTelegram,
      notChecked: Math.max(0, counts.participants - counts.reachable - counts.notInTelegram),
      willReceive: Math.max(0, counts.reachable - counts.alreadyReceived),
      pace: this.pace
    };
  }

  async create(input: {
    readonly actor: AdminRequestActor;
    readonly savedMessageIds: readonly string[];
    readonly eventId?: string;
    readonly testRecipient?: string;
    readonly now: Date;
  }): Promise<{ readonly broadcastId: string; readonly recipientCount: number }> {
    requirePermission(input.actor);
    const savedMessageIds = parseSavedMessageIds(input.savedMessageIds, false);
    if ((input.eventId === undefined) === (input.testRecipient === undefined)) {
      throw new AccountBroadcastRequestError(
        "invalid",
        "Нужно одно из двух: мероприятие для рассылки или получатель для пробной"
      );
    }

    const broadcastId = this.ids.newId();
    let outcome: CreateAccountBroadcastOutcome;
    if (input.eventId !== undefined) {
      requireUuid(input.eventId);
      if (!(await this.repository.eventExists(input.eventId))) {
        throw new AccountBroadcastRequestError("event_not_found", "Мероприятие не найдено");
      }
      outcome = await this.repository.createBroadcast({
        broadcastId,
        adminId: input.actor.adminId,
        savedMessageIds,
        target: {
          kind: "event",
          eventId: input.eventId,
          limit: ACCOUNT_BROADCAST_AUDIENCE_LIMIT
        },
        at: input.now
      });
    } else {
      const handle = parseTestRecipient(input.testRecipient ?? "");
      const recipient = await this.repository.findTestRecipient(handle);
      if (recipient === null) {
        throw new AccountBroadcastRequestError(
          "test_recipient_not_found",
          "У этого человека нет переписки с рабочим аккаунтом. Напишите аккаунту с этого "
            + "Telegram любое сообщение и повторите — тогда аккаунту будет куда отправить."
        );
      }
      outcome = await this.repository.createBroadcast({
        broadcastId,
        adminId: input.actor.adminId,
        savedMessageIds,
        target: { kind: "test", recipient, recipientId: this.ids.newId() },
        at: input.now
      });
    }

    switch (outcome.kind) {
      case "created":
        return { broadcastId, recipientCount: outcome.recipientCount };
      case "saved_message_unavailable":
        throw new AccountBroadcastRequestError(
          "saved_message_unavailable",
          "Одно из выбранных сообщений пропало из «Избранного». Обновите список и выберите заново."
        );
      case "already_sending":
        throw new AccountBroadcastRequestError(
          "already_sending",
          "По этому мероприятию уже идёт рассылка. Дождитесь конца или остановите её."
        );
      case "no_recipients":
        throw new AccountBroadcastRequestError(
          "no_recipients",
          "Отправлять некому: у участников нет переписки с аккаунтом, или они эти сообщения уже получили."
        );
      case "too_many_recipients":
        throw new AccountBroadcastRequestError(
          "too_many_recipients",
          `Получателей ${outcome.count} — больше предела ${ACCOUNT_BROADCAST_AUDIENCE_LIMIT}.`
        );
    }
  }

  async list(input: {
    readonly actor: AdminRequestActor;
  }): Promise<{ readonly items: readonly AccountBroadcastSummary[] }> {
    requirePermission(input.actor);
    return { items: await this.repository.listBroadcasts(ACCOUNT_BROADCAST_HISTORY_LIMIT) };
  }

  async cancel(input: {
    readonly actor: AdminRequestActor;
    readonly broadcastId: string;
    readonly now: Date;
  }): Promise<{ readonly cancelled: boolean }> {
    requirePermission(input.actor);
    requireUuid(input.broadcastId);
    const cancelled = await this.repository.cancelBroadcast({
      broadcastId: input.broadcastId,
      adminId: input.actor.adminId,
      reason: "остановлена в панели",
      at: input.now
    });
    return { cancelled };
  }
}

function requirePermission(actor: AdminRequestActor): void {
  if (actor.permission !== "broadcasts.send" || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator broadcast permission is invalid");
  }
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new AccountBroadcastRequestError("invalid", "Неверный идентификатор");
  }
}

function parseSavedMessageIds(
  values: readonly string[],
  allowEmpty: boolean
): readonly string[] {
  const unique = [...new Set(values)];
  if (unique.length !== values.length || unique.some((value) => !UUID_PATTERN.test(value))) {
    throw new AccountBroadcastRequestError("invalid", "Сообщения выбраны неверно");
  }
  if ((!allowEmpty && unique.length === 0) || unique.length > ACCOUNT_BROADCAST_MAX_PARTS) {
    throw new AccountBroadcastRequestError(
      "invalid",
      `Выберите от одного до ${ACCOUNT_BROADCAST_MAX_PARTS} сообщений из «Избранного»`
    );
  }
  return unique;
}

/**
 * Ник или телефон пробного получателя.
 *
 * Телефон разбираем сами и только российский или уже в E.164: это одно поле для «себе»,
 * а не загрузка базы, и тянуть сюда разборщик номеров незачем.
 */
export function parseTestRecipient(value: string): {
  readonly username: string | null;
  readonly phoneE164: string | null;
} {
  const text = value.trim();
  const digits = text.replace(/[^\d]/g, "");
  const looksLikePhone = /^[+\d\s()-]+$/.test(text) && digits.length >= 10;
  if (looksLikePhone) {
    const phone = digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))
      ? `+7${digits.slice(1)}`
      : digits.length === 10 && digits.startsWith("9")
        ? `+7${digits}`
        : `+${digits}`;
    if (/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      return { username: null, phoneE164: phone };
    }
  }
  const username = parseTelegramUsername(text);
  if (username !== null) {
    return { username: username.toLowerCase(), phoneE164: null };
  }
  throw new AccountBroadcastRequestError(
    "invalid",
    "Для пробной укажите ник Telegram (@name) или телефон"
  );
}

// ---------------------------------------------------------------------------------------
// Процесс аккаунта: синхронизация «Избранного».
// ---------------------------------------------------------------------------------------

/** Сообщение «Избранного» так, как его видит процесс аккаунта. */
export interface SavedMessageSnapshot {
  readonly externalMessageId: string;
  readonly kind: AccountSavedMessageKind;
  readonly body: string | null;
  readonly durationSeconds: number | null;
  readonly minithumbnailBase64: string | null;
  /** Файл у мессенджера. Пусто — у сообщения нет файла или он нам не нужен. */
  readonly externalFileId: string | null;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly sentAt: Date;
}

export interface PendingSavedMessageFile {
  readonly savedMessageId: string;
  readonly externalFileId: string;
  readonly kind: AccountSavedMessageKind;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly attempts: number;
}

export interface AccountSavedMessagesRepository {
  /**
   * Записывает увиденное. Сообщения, которые были в просмотренном окне, а теперь пропали, —
   * удалены из «Избранного»: окно задаётся самым старым из увиденных.
   */
  syncSeen(input: {
    readonly ids: readonly string[];
    readonly messages: readonly SavedMessageSnapshot[];
    readonly fileKinds: readonly AccountSavedMessageKind[];
    readonly maxFileBytes: number;
    readonly at: Date;
  }): Promise<void>;
  markDeleted(input: {
    readonly externalMessageIds: readonly string[];
    readonly at: Date;
  }): Promise<void>;
  listPendingFiles(input: {
    readonly limit: number;
    readonly maxAttempts: number;
  }): Promise<readonly PendingSavedMessageFile[]>;
  markFileStored(input: {
    readonly savedMessageId: string;
    readonly storagePath: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly at: Date;
  }): Promise<void>;
  markFileFailed(input: {
    readonly savedMessageId: string;
    readonly giveUp: boolean;
    readonly at: Date;
  }): Promise<void>;
}

/** Откуда берётся «Избранное». Реализация — у TDLib. */
export interface SavedMessagesSource {
  readRecent(limit: number): Promise<readonly SavedMessageSnapshot[]>;
}

/** Скачивание файла сообщения у мессенджера. */
export interface SavedMessageFileSource {
  download(file: PendingSavedMessageFile): Promise<Uint8Array | null>;
}

export interface SavedMessageFileStorage {
  save(input: {
    readonly id: string;
    readonly bytes: Uint8Array;
    readonly fileName: string | null;
    readonly mimeType: string | null;
  }): Promise<{ readonly storagePath: string; readonly sha256: string; readonly sizeBytes: number }>;
}

/**
 * Что из «Избранного» качаем к себе. Кружок, фото и голосовое — маленькие и нужны в ленте
 * получателя; видео — если влезает в предел. Документы не качаем: в «Избранном» живого
 * аккаунта лежит что угодно, и тащить к себе чужие файлы ради ленты незачем.
 */
export const SAVED_MESSAGE_FILE_KINDS: readonly AccountSavedMessageKind[] = [
  "video_note",
  "photo",
  "voice",
  "video"
];

export class SyncAccountSavedMessagesService {
  constructor(
    private readonly repository: AccountSavedMessagesRepository,
    private readonly source: SavedMessagesSource,
    private readonly files: {
      readonly source: SavedMessageFileSource;
      readonly storage: SavedMessageFileStorage;
      readonly maxBytes: number;
    } | null,
    private readonly options: { readonly limit: number; readonly maxFileAttempts: number }
  ) {}

  async execute(input: { readonly at: Date }): Promise<{
    readonly seen: number;
    readonly stored: number;
    readonly failed: number;
  }> {
    const messages = await this.source.readRecent(this.options.limit);
    if (messages.length > 0) {
      await this.repository.syncSeen({
        ids: messages.map((message) => message.externalMessageId),
        messages,
        fileKinds: this.files === null ? [] : SAVED_MESSAGE_FILE_KINDS,
        maxFileBytes: this.files?.maxBytes ?? 0,
        at: input.at
      });
    }

    let stored = 0;
    let failed = 0;
    if (this.files !== null) {
      const pending = await this.repository.listPendingFiles({
        limit: 3,
        maxAttempts: this.options.maxFileAttempts
      });
      for (const file of pending) {
        try {
          const bytes = await this.files.source.download(file);
          if (bytes === null) {
            throw new Error("файл не скачался");
          }
          const saved = await this.files.storage.save({
            id: file.savedMessageId,
            bytes,
            fileName: file.fileName,
            mimeType: file.mimeType
          });
          await this.repository.markFileStored({
            savedMessageId: file.savedMessageId,
            storagePath: saved.storagePath,
            sha256: saved.sha256,
            sizeBytes: saved.sizeBytes,
            at: input.at
          });
          stored += 1;
        } catch {
          // Без файла рассылка всё равно уходит — Telegram копирует сообщение у себя.
          // Теряется только просмотр кружка в панели и в ленте, поэтому без шума.
          await this.repository.markFileFailed({
            savedMessageId: file.savedMessageId,
            giveUp: file.attempts + 1 >= this.options.maxFileAttempts,
            at: input.at
          });
          failed += 1;
        }
      }
    }

    return { seen: messages.length, stored, failed };
  }
}

// ---------------------------------------------------------------------------------------
// Процесс аккаунта: отправка.
// ---------------------------------------------------------------------------------------

export interface ClaimedBroadcastPart {
  readonly savedMessageId: string;
  readonly externalMessageId: string;
  readonly kind: AccountSavedMessageKind;
  readonly body: string | null;
  readonly durationSeconds: number | null;
  readonly deleted: boolean;
  readonly storagePath: string | null;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  readonly sha256: string | null;
}

export interface ClaimedBroadcastRecipient {
  readonly recipientId: string;
  readonly broadcastId: string;
  readonly isTest: boolean;
  readonly contactId: string | null;
  readonly conversationId: string;
  readonly externalChatId: string;
  readonly attempts: number;
  /** Кто запустил: он и значится автором реплики в ленте. */
  readonly actorAdminId: string;
  readonly parts: readonly ClaimedBroadcastPart[];
}

export interface AccountBroadcastQueue {
  /** Действующая пауза аккаунта — после просьбы Telegram подождать. */
  activePause(at: Date): Promise<{ readonly until: Date; readonly reason: string } | null>;
  countSentSince(since: Date): Promise<number>;
  /**
   * Следующий получатель. Пробные — первыми и в любое время: их ждут у экрана. Боевые —
   * только если `includeLive`. Взятая строка арендуется до `leaseUntil`: процесс, упавший
   * посреди отправки, отдаст её следующему проходу.
   */
  claimNext(input: {
    readonly at: Date;
    readonly includeLive: boolean;
    readonly leaseUntil: Date;
  }): Promise<ClaimedBroadcastRecipient | null>;
  markSent(input: {
    readonly recipient: ClaimedBroadcastRecipient;
    /** Что дошло. Telegram может пропустить часть — например, кружок тому, кто их закрыл. */
    readonly parts: readonly ClaimedBroadcastPart[];
    readonly messageId: string;
    readonly attachmentIds: readonly string[];
    readonly providerMessageIds: readonly string[];
    readonly body: string | null;
    /** Почему дошло не всё. Пусто — дошло всё. */
    readonly partialReason: string | null;
    readonly at: Date;
  }): Promise<void>;
  markFailed(input: {
    readonly recipientId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<void>;
  /** Вернуть в очередь. `countAttempt: false` — неудача была не у этого человека. */
  release(input: {
    readonly recipientId: string;
    readonly reason: string | null;
    readonly retryAt: Date | null;
    readonly countAttempt: boolean;
    readonly at: Date;
  }): Promise<void>;
  pauseAll(input: { readonly until: Date; readonly reason: string; readonly at: Date }): Promise<void>;
  stopBroadcast(input: {
    readonly broadcastId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<void>;
  /** Рассылки, где ждать больше некого, становятся завершёнными. */
  completeFinished(at: Date): Promise<number>;
}

export interface AccountBroadcastSender {
  /** Копирует сообщения «Избранного» в чат. Ждёт подтверждения от Telegram по каждому. */
  copy(input: {
    readonly externalChatId: string;
    readonly externalMessageIds: readonly string[];
  }): Promise<{
    readonly providerMessageIds: readonly string[];
    /** Что Telegram этому человеку не пропустил, хотя в «Избранном» оно есть. */
    readonly skippedExternalMessageIds?: readonly string[];
  }>;
}

/**
 * Отказ Telegram, разобранный по тому, что с ним делать.
 *
 * - `flood` — «подождите N секунд»: ждём, и ждём все рассылки сразу.
 * - `account` — аккаунт ограничен (жалобы на спам): встаём на сутки, человеку пора
 *   посмотреть @SpamBot.
 * - `recipient` — этому человеку не написать: закрылся приватностью, удалился, заблокировал.
 *   Повтор не поможет.
 * - `source` — пропало то, что копируем. Встаёт вся рассылка: остальным уйдёт то же.
 * - `transient` — сеть, таймаут: повторим позже.
 */
export type AccountBroadcastFailureKind = "flood" | "account" | "recipient" | "source" | "transient";

export class AccountBroadcastSendError extends Error {
  constructor(
    readonly kind: AccountBroadcastFailureKind,
    message: string,
    readonly retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = "AccountBroadcastSendError";
  }
}

export interface AccountBroadcastSendOptions {
  readonly enabled: boolean;
  readonly pauseMinMs: number;
  readonly pauseMaxMs: number;
  readonly idlePollMs: number;
  readonly dailyLimit: number;
  readonly window: CallWindow;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  /** Сколько держим строку за собой, пока ждём подтверждения Telegram. */
  readonly leaseMs: number;
  /** Пауза после ограничения аккаунта: столько обычно длится временный спам-блок. */
  readonly accountPauseMs: number;
}

export type AccountBroadcastPassResult =
  | { readonly kind: "disabled"; readonly nextRunAt: Date }
  | { readonly kind: "paused"; readonly until: Date; readonly reason: string; readonly nextRunAt: Date }
  | {
    readonly kind: "idle";
    readonly reason: "empty" | "outside_window" | "daily_limit";
    readonly nextRunAt: Date;
  }
  | { readonly kind: "sent"; readonly broadcastId: string; readonly nextRunAt: Date }
  | {
    readonly kind: "failed" | "retry" | "stopped";
    readonly broadcastId: string;
    readonly reason: string;
    readonly nextRunAt: Date;
  };

export class SendAccountBroadcastsService {
  constructor(
    private readonly queue: AccountBroadcastQueue,
    private readonly sender: AccountBroadcastSender,
    private readonly ids: IdGenerator,
    private readonly options: AccountBroadcastSendOptions,
    /** Случайность вынесена ради тестов. */
    private readonly random: () => number = Math.random
  ) {}

  /** Один проход — не больше одного получателя. Темп задаёт `nextRunAt`. */
  async execute(input: { readonly at: Date }): Promise<AccountBroadcastPassResult> {
    const at = input.at;
    const idle = new Date(at.getTime() + this.options.idlePollMs);
    if (!this.options.enabled) {
      return { kind: "disabled", nextRunAt: idle };
    }

    const pause = await this.queue.activePause(at);
    if (pause !== null) {
      return {
        kind: "paused",
        until: pause.until,
        reason: pause.reason,
        nextRunAt: new Date(Math.min(pause.until.getTime(), at.getTime() + HOUR_MS))
      };
    }

    // Внутри окна `nextCallSlot` возвращает тот же момент — это и есть «сейчас можно».
    const insideWindow = nextCallSlot(at, this.options.window).getTime() === at.getTime();
    const underLimit = insideWindow
      && (await this.queue.countSentSince(new Date(at.getTime() - DAY_MS))) < this.options.dailyLimit;

    const recipient = await this.queue.claimNext({
      at,
      includeLive: underLimit,
      leaseUntil: new Date(at.getTime() + this.options.leaseMs)
    });
    if (recipient === null) {
      return {
        kind: "idle",
        reason: !insideWindow ? "outside_window" : underLimit ? "empty" : "daily_limit",
        nextRunAt: idle
      };
    }

    const result = await this.send(recipient, at);
    await this.queue.completeFinished(at);
    return result;
  }

  private async send(
    recipient: ClaimedBroadcastRecipient,
    at: Date
  ): Promise<AccountBroadcastPassResult> {
    const next = this.nextSendAt(at);
    if (recipient.parts.length === 0 || recipient.parts.some((part) => part.deleted)) {
      const reason = "сообщение удалили из «Избранного» — копировать нечего";
      await this.queue.stopBroadcast({ broadcastId: recipient.broadcastId, reason, at });
      return { kind: "stopped", broadcastId: recipient.broadcastId, reason, nextRunAt: at };
    }

    try {
      const sent = await this.sender.copy({
        externalChatId: recipient.externalChatId,
        externalMessageIds: recipient.parts.map((part) => part.externalMessageId)
      });
      const skipped = new Set(sent.skippedExternalMessageIds ?? []);
      const delivered = recipient.parts.filter((part) => !skipped.has(part.externalMessageId));
      const missed = recipient.parts.filter((part) => skipped.has(part.externalMessageId));
      const stored = delivered.filter((part) => part.storagePath !== null);
      await this.queue.markSent({
        recipient,
        parts: delivered,
        messageId: this.ids.newId(),
        attachmentIds: stored.map(() => this.ids.newId()),
        providerMessageIds: sent.providerMessageIds,
        body: broadcastFeedBody(delivered),
        partialReason: missed.length === 0
          ? null
          : `ушло частично: Telegram не пропустил ${missed.map((part) => kindLabel(part.kind).toLowerCase()).join(", ")} — `
            + "у человека закрыты голосовые и видеосообщения",
        at
      });
      return { kind: "sent", broadcastId: recipient.broadcastId, nextRunAt: next };
    } catch (error) {
      return await this.handleFailure(recipient, error, at, next);
    }
  }

  private async handleFailure(
    recipient: ClaimedBroadcastRecipient,
    error: unknown,
    at: Date,
    next: Date
  ): Promise<AccountBroadcastPassResult> {
    const failure = error instanceof AccountBroadcastSendError
      ? error
      : new AccountBroadcastSendError(
        "transient",
        error instanceof Error ? error.message : String(error)
      );
    const reason = failure.message.slice(0, 500);
    const broadcastId = recipient.broadcastId;

    switch (failure.kind) {
      case "flood": {
        // Пару секунд сверху: ответ «через 30 секунд» буквально означает «не раньше».
        const until = new Date(at.getTime() + ((failure.retryAfterSeconds ?? 60) + 5) * 1_000);
        await this.queue.release({
          recipientId: recipient.recipientId, reason: null, retryAt: null, countAttempt: false, at
        });
        await this.queue.pauseAll({ until, reason: `Telegram попросил подождать: ${reason}`, at });
        return { kind: "retry", broadcastId, reason, nextRunAt: until };
      }
      case "account": {
        const until = new Date(at.getTime() + this.options.accountPauseMs);
        await this.queue.release({
          recipientId: recipient.recipientId, reason: null, retryAt: null, countAttempt: false, at
        });
        await this.queue.pauseAll({
          until,
          reason: "Telegram ограничил аккаунт: писать незнакомым временно нельзя. "
            + `Проверьте @SpamBot с рабочего аккаунта. Ответ Telegram: ${reason}`,
          at
        });
        return { kind: "retry", broadcastId, reason, nextRunAt: until };
      }
      case "source":
        await this.queue.stopBroadcast({
          broadcastId,
          reason: `не удалось скопировать из «Избранного»: ${reason}`,
          at
        });
        return { kind: "stopped", broadcastId, reason, nextRunAt: next };
      case "recipient":
        await this.queue.markFailed({ recipientId: recipient.recipientId, reason, at });
        return { kind: "failed", broadcastId, reason, nextRunAt: next };
      case "transient": {
        const attempts = recipient.attempts + 1;
        if (attempts >= this.options.maxAttempts) {
          await this.queue.markFailed({ recipientId: recipient.recipientId, reason, at });
          return { kind: "failed", broadcastId, reason, nextRunAt: next };
        }
        await this.queue.release({
          recipientId: recipient.recipientId,
          reason,
          retryAt: new Date(at.getTime() + this.options.retryDelayMs * 2 ** recipient.attempts),
          countAttempt: true,
          at
        });
        return { kind: "retry", broadcastId, reason, nextRunAt: next };
      }
    }
  }

  /** Пауза случайная в границах: ровный метроном — тоже примета рассылки. */
  private nextSendAt(at: Date): Date {
    const span = Math.max(0, this.options.pauseMaxMs - this.options.pauseMinMs);
    return new Date(at.getTime() + this.options.pauseMinMs + Math.floor(this.random() * span));
  }
}

/**
 * Текст реплики в ленте получателя.
 *
 * Медиа, чья копия лежит у нас, видно вложением. То, что скачать не вышло, обозначено
 * словом — иначе в ленте у человека была бы пустая реплика, и непонятно, что ему ушло.
 */
export function broadcastFeedBody(parts: readonly ClaimedBroadcastPart[]): string | null {
  const lines = parts.flatMap((part) => {
    const text = part.body?.trim() ?? "";
    const marker = part.kind !== "text" && part.storagePath === null
      ? `[${kindLabel(part.kind)}${part.durationSeconds ? ` · ${formatDuration(part.durationSeconds)}` : ""}]`
      : "";
    return [marker, text].filter((line) => line !== "");
  });
  return lines.length === 0 ? null : lines.join("\n\n");
}

export function kindLabel(kind: AccountSavedMessageKind): string {
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

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
