/// <reference types="@prebuilt-tdlib/types" />
import { readFile } from "node:fs/promises";
import {
  AccountBroadcastSendError,
  type AccountBroadcastFailureKind,
  type AccountBroadcastSender,
  type PendingSavedMessageFile,
  type SavedMessageFileSource,
  type SavedMessageSnapshot,
  type SavedMessagesSource
} from "@ticket-platform/application";
import type { Client } from "tdl";
import type {
  file as TdFile,
  message as TdMessage,
  minithumbnail as TdMinithumbnail,
  Update as TdUpdate
} from "tdlib-types";
import type { TdlibSendConfirmations } from "./reply-sender.js";

/**
 * «Избранное» рабочего аккаунта как источник рассылки.
 *
 * У Telegram «Избранное» — это личный чат аккаунта с самим собой, и его номер совпадает с
 * номером аккаунта. Отсюда всё просто: прочитать историю этого чата, а при рассылке
 * скопировать из него выбранные сообщения получателю. Копия (`send_copy`) уходит без
 * пометки «переслано из», с тем же оформлением текста и тем же файлом на серверах Telegram:
 * кружок не перекачивается и не пережимается.
 */

/** Сообщение «Избранного» на языке рассылки. Чистая функция — проверяется без сессии. */
export function savedMessageOf(message: TdMessage): SavedMessageSnapshot {
  const content = message.content;
  const base = {
    externalMessageId: String(message.id),
    sentAt: new Date(message.date * 1_000)
  };

  switch (content._) {
    case "messageText":
      return {
        ...base,
        kind: "text",
        body: textOf(content.text.text),
        durationSeconds: null,
        minithumbnailBase64: null,
        ...noFile()
      };
    case "messageVideoNote":
      return {
        ...base,
        kind: "video_note",
        body: null,
        durationSeconds: content.video_note.duration,
        minithumbnailBase64: thumbnailOf(content.video_note.minithumbnail),
        // Имя своё: у кружка его нет, а в ленте файл называется по имени.
        ...fileOf(content.video_note.video, "Кружок.mp4", "video/mp4")
      };
    case "messagePhoto": {
      const largest = content.photo.sizes[content.photo.sizes.length - 1];
      return {
        ...base,
        kind: "photo",
        body: textOf(content.caption.text),
        durationSeconds: null,
        minithumbnailBase64: thumbnailOf(content.photo.minithumbnail),
        ...(largest === undefined ? noFile() : fileOf(largest.photo, "Фото.jpg", "image/jpeg"))
      };
    }
    case "messageVideo":
      return {
        ...base,
        kind: "video",
        body: textOf(content.caption.text),
        durationSeconds: content.video.duration,
        minithumbnailBase64: thumbnailOf(content.video.minithumbnail),
        ...fileOf(
          content.video.video,
          content.video.file_name === "" ? "Видео.mp4" : content.video.file_name,
          content.video.mime_type === "" ? "video/mp4" : content.video.mime_type
        )
      };
    case "messageVoiceNote":
      return {
        ...base,
        kind: "voice",
        body: textOf(content.caption.text),
        durationSeconds: content.voice_note.duration,
        minithumbnailBase64: null,
        ...fileOf(
          content.voice_note.voice,
          "Голосовое.ogg",
          content.voice_note.mime_type === "" ? "audio/ogg" : content.voice_note.mime_type
        )
      };
    case "messageAudio":
      return {
        ...base,
        kind: "audio",
        body: textOf(content.caption.text),
        durationSeconds: content.audio.duration,
        minithumbnailBase64: null,
        ...noFile()
      };
    case "messageDocument":
      return {
        ...base,
        kind: "document",
        body: textOf(content.caption.text) ?? textOf(content.document.file_name),
        durationSeconds: null,
        minithumbnailBase64: null,
        ...noFile()
      };
    case "messageAnimation":
      return {
        ...base,
        kind: "animation",
        body: textOf(content.caption.text),
        durationSeconds: content.animation.duration,
        minithumbnailBase64: thumbnailOf(content.animation.minithumbnail),
        ...noFile()
      };
    default:
      return {
        ...base,
        kind: "other",
        body: null,
        durationSeconds: null,
        minithumbnailBase64: null,
        ...noFile()
      };
  }
}

/**
 * Удаление из «Избранного» — сразу, а не к следующему просмотру истории. Иначе панель ещё
 * полминуты показывала бы кружок, которого уже нет.
 */
export function deletedSavedMessageIds(
  update: TdUpdate,
  selfChatId: number
): readonly string[] | null {
  if (update._ !== "updateDeleteMessages" || update.chat_id !== selfChatId) {
    return null;
  }
  // `from_cache` — TDLib просто выкинул сообщение из своей памяти; на сервере оно живо.
  if (!update.is_permanent || update.from_cache) {
    return null;
  }
  return update.message_ids.map((id) => String(id));
}

/** Сообщение пришло в «Избранное» — повод посмотреть его сразу, не дожидаясь прохода. */
export function isNewSavedMessage(update: TdUpdate, selfChatId: number): boolean {
  return update._ === "updateNewMessage" && update.message.chat_id === selfChatId;
}

export function createTdlibSavedMessagesSource(
  client: Pick<Client, "invoke">,
  selfChatId: number
): SavedMessagesSource {
  return {
    async readRecent(limit) {
      // Чат с собой обязан быть в памяти TDLib, иначе история отдаёт «чат не найден».
      await client.invoke({ _: "createPrivateChat", user_id: selfChatId, force: false });

      // TDLib отдаёт историю порциями и первую — часто из одного сообщения: остальное он
      // в этот момент только догружает с сервера. Поэтому спрашиваем, пока не наберём своё
      // или пока история не кончится, но не бесконечно.
      const collected: TdMessage[] = [];
      let fromMessageId = 0;
      for (let round = 0; round < 5 && collected.length < limit; round += 1) {
        const page = await client.invoke({
          _: "getChatHistory",
          chat_id: selfChatId,
          from_message_id: fromMessageId,
          offset: 0,
          limit: limit - collected.length,
          only_local: false
        });
        const messages = page.messages.filter((item): item is TdMessage => item !== null);
        if (messages.length === 0) {
          break;
        }
        for (const message of messages) {
          // Ещё не ушедшее на сервер (временный номер) копировать нельзя.
          if ((message.sending_state ?? null) === null && !collected.some((item) => item.id === message.id)) {
            collected.push(message);
          }
        }
        fromMessageId = messages[messages.length - 1]?.id ?? 0;
      }

      return collected.map(savedMessageOf);
    }
  };
}

export function createTdlibSavedMessageFileSource(
  client: Pick<Client, "invoke">,
  options: { readonly onCleanupFailure?: (error: unknown) => void } = {}
): SavedMessageFileSource {
  return {
    async download(file: PendingSavedMessageFile): Promise<Uint8Array | null> {
      const fileId = Number(file.externalFileId);
      if (!Number.isSafeInteger(fileId) || fileId <= 0) {
        return null;
      }
      const downloaded = await client.invoke({
        _: "downloadFile",
        file_id: fileId,
        priority: 1,
        offset: 0,
        limit: 0,
        synchronous: true
      });
      if (!downloaded.local.is_downloading_completed || downloaded.local.path === "") {
        return null;
      }
      const bytes = await readFile(downloaded.local.path);
      // Копия лежит у нас; у TDLib её убираем, как и у вложений переписки. Сообщение в
      // «Избранном» от этого не страдает: копируется оно на серверах Telegram.
      try {
        await client.invoke({ _: "deleteFile", file_id: fileId });
      } catch (error) {
        options.onCleanupFailure?.(error);
      }
      return bytes;
    }
  };
}

/**
 * Отправка рассылки: копия сообщений «Избранного» в личный чат.
 *
 * Ждём подтверждения по каждому сообщению, как у ответов из панели: первый ответ TDLib —
 * это заготовка, а настоящая судьба приходит отдельным обновлением.
 */
export function createTdlibBroadcastSender(
  client: Pick<Client, "invoke">,
  confirmations: Pick<TdlibSendConfirmations, "confirm">,
  selfChatId: number
): AccountBroadcastSender {
  return {
    async copy(input) {
      const chatId = Number(input.externalChatId);
      if (!Number.isSafeInteger(chatId) || chatId <= 0) {
        throw new AccountBroadcastSendError(
          "recipient",
          `Не похоже на личный чат Telegram: ${input.externalChatId}`
        );
      }
      const messageIds = input.externalMessageIds.map(Number);
      if (messageIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        throw new AccountBroadcastSendError("source", "Номер сообщения «Избранного» испорчен");
      }

      try {
        await client.invoke({ _: "createPrivateChat", user_id: chatId, force: false });
        const ordered = [...messageIds].sort((left, right) => left - right);
        const forwarded = await client.invoke({
          _: "forwardMessages",
          chat_id: chatId,
          from_chat_id: selfChatId,
          message_ids: ordered,
          send_copy: true,
          remove_caption: false
        });

        /**
         * Пустое место в ответе — TDLib это сообщение пропустил, остальные уже отправляет.
         *
         * Чаще всего виноват не источник, а получатель: у человека с Telegram Premium можно
         * закрыть приём голосовых и видеосообщений, и тогда кружок к нему не пропускается,
         * а текст рядом с ним — пропускается. 19.11.2026 первая же боевая рассылка встала
         * целиком на двенадцатом человеке именно так: пропуск приняли за пропажу сообщения
         * из «Избранного». Поэтому сначала проверяем, живо ли пропущенное у нас, — и только
         * если его правда нет, останавливаем рассылку.
         */
        const skipped = ordered.filter((_, index) => (forwarded.messages[index] ?? null) === null);
        if (skipped.length > 0 && !(await allExist(client, selfChatId, skipped))) {
          throw new AccountBroadcastSendError(
            "source",
            "сообщения больше нет в «Избранном»"
          );
        }
        const drafts = forwarded.messages.filter((message): message is TdMessage => message !== null);
        if (drafts.length === 0) {
          throw new AccountBroadcastSendError(
            "recipient",
            "Telegram не пропускает этому человеку: закрыты голосовые и видеосообщения или личка"
          );
        }
        // Ждём все разом: подтверждения приходят в любом порядке, а ждать их по очереди
        // значило бы пропустить уже пришедшее.
        const confirmed = await Promise.allSettled(
          drafts.map((draft) => confirmations.confirm(chatId, draft.id))
        );
        const sent = confirmed.flatMap((outcome) =>
          outcome.status === "fulfilled" ? [outcome.value] : []
        );
        const firstFailure = confirmed.find((outcome) => outcome.status === "rejected");
        // Ушла хотя бы часть — это уже отправлено: повтор продублировал бы ушедшее.
        if (sent.length === 0 && firstFailure !== undefined) {
          throw firstFailure.reason;
        }
        return {
          providerMessageIds: sent,
          skippedExternalMessageIds: skipped.map(String)
        };
      } catch (error) {
        throw toSendError(error);
      }
    }
  };
}

/**
 * Ответ Telegram → что с ним делать.
 *
 * Тексты ошибок у TDLib — коды сервера Telegram или его собственные фразы; список не
 * закрыт, поэтому неузнанное считается временным и повторяется.
 */
export function classifyTdlibSendError(message: string): {
  readonly kind: AccountBroadcastFailureKind;
  readonly retryAfterSeconds: number | null;
} {
  const retry = /retry after (\d+)/i.exec(message) ?? /FLOOD_WAIT_(\d+)/i.exec(message);
  if (retry?.[1] !== undefined) {
    return { kind: "flood", retryAfterSeconds: Number(retry[1]) };
  }
  // Приватность проверяем раньше ограничения аккаунта: в обоих бывает слово «restricted».
  if (
    /PRIVACY|USER_IS_BLOCKED|YOU_BLOCKED_USER|blocked|DEACTIVATED|deleted account|PEER_ID_INVALID|USER_ID_INVALID|Chat not found|User not found|ALLOW_PAYMENT|PAYMENT_REQUIRED|Have no rights|Can't write|not allowed to send|premium/i
      .test(message)
  ) {
    return { kind: "recipient", retryAfterSeconds: null };
  }
  if (/PEER_FLOOD|USER_BANNED_IN_CHANNEL|spam|restricted|CHAT_WRITE_FORBIDDEN/i.test(message)) {
    return { kind: "account", retryAfterSeconds: null };
  }
  if (/Message not found|MESSAGE_ID_INVALID|can't be forwarded|can't be copied|MESSAGE_EMPTY|Message to forward not found/i.test(message)) {
    return { kind: "source", retryAfterSeconds: null };
  }
  return { kind: "transient", retryAfterSeconds: null };
}

/** Живы ли сообщения в «Избранном». Ответ «не найдено» — нет; любой другой сбой — не знаем. */
async function allExist(
  client: Pick<Client, "invoke">,
  selfChatId: number,
  messageIds: readonly number[]
): Promise<boolean> {
  for (const messageId of messageIds) {
    try {
      await client.invoke({ _: "getMessage", chat_id: selfChatId, message_id: messageId });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (/not found/i.test(text)) {
        return false;
      }
      // Сеть моргнула — не повод останавливать рассылку. Считаем живым: если сообщения
      // правда нет, следующий проход «Избранного» отметит его удалённым, и рассылка встанет.
    }
  }
  return true;
}

function toSendError(error: unknown): AccountBroadcastSendError {
  if (error instanceof AccountBroadcastSendError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const classified = classifyTdlibSendError(message);
  return new AccountBroadcastSendError(classified.kind, message, classified.retryAfterSeconds);
}

function thumbnailOf(thumbnail: TdMinithumbnail | undefined): string | null {
  return thumbnail === undefined || thumbnail.data === "" ? null : thumbnail.data;
}

function fileOf(file: TdFile, fileName: string, mimeType: string) {
  const size = file.size > 0 ? file.size : (file.expected_size > 0 ? file.expected_size : null);
  return {
    externalFileId: String(file.id),
    fileName,
    mimeType,
    sizeBytes: size
  };
}

function noFile() {
  return { externalFileId: null, fileName: null, mimeType: null, sizeBytes: null };
}

function textOf(value: string): string | null {
  const text = value.trim();
  return text === "" ? null : text;
}
