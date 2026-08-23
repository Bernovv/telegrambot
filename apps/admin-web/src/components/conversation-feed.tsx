"use client";

import {
  conversationAttachmentUrl,
  getPersonConversations,
  sendConversationFile,
  sendConversationReply
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import { conversationAcceptsReply } from "@ticket-platform/contracts/admin-conversations";
import type {
  AdminConversationAttachment,
  AdminConversationMessage,
  AdminConversationThread,
  AdminPersonConversations
} from "@ticket-platform/contracts/admin-conversations";
import {
  AlertTriangle,
  Bot,
  Clock,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  User,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Переписка в карточке человека.
 *
 * Лента одна на все мессенджеры: писавший вчера в MAX, а сегодня в Telegram ведёт с нами
 * один разговор. Канал подписан у каждой реплики — иначе ответ уходил бы не туда, где его
 * ждут.
 *
 * Порядок как в мессенджере: старое сверху, свежее внизу, и лента открывается на свежем.
 * Обратный порядок здесь пробовать не стоит — разговор, прочитанный снизу вверх, перестаёт
 * быть разговором.
 */

/** Сколько реплик тянем за раз. Хватает на пару экранов, дальше — по кнопке. */
const PAGE_SIZE = 50;

/** Пауза перед поиском: человек печатает «билет» шестью нажатиями, а не одним. */
const SEARCH_DEBOUNCE_MS = 350;

/** Столько же принимают прокси панели и api. Проверяем здесь, чтобы сказать до отправки. */
const FILE_LIMIT_BYTES = 5 * 1_024 * 1_024;

export function ConversationFeed({ contactId }: { readonly contactId: string }) {
  const [data, setData] = useState<AdminPersonConversations | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloads, setReloads] = useState(0);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getPersonConversations(
      contactId,
      { limit: PAGE_SIZE, ...(query === "" ? {} : { search: query }) },
      controller.signal
    )
      .then((loaded) => {
        setData(loaded);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(errorText(cause));
        setLoading(false);
      });
    return () => controller.abort();
  }, [contactId, query, reloads]);

  // Открываемся на свежем сообщении — там, где менеджер и продолжит разговор. Только при
  // первой загрузке: подгрузка ранних реплик не должна утаскивать его обратно вниз.
  useEffect(() => {
    if (!loading && data && query === "") {
      bottom.current?.scrollIntoView({ block: "nearest" });
    }
  }, [loading, data, query]);

  const loadEarlier = useCallback(() => {
    if (!data || data.messages.length === 0) {
      return;
    }
    const oldest = data.messages[data.messages.length - 1];
    if (!oldest) {
      return;
    }
    setLoadingMore(true);
    getPersonConversations(contactId, {
      limit: PAGE_SIZE,
      before: oldest.occurredAt,
      ...(query === "" ? {} : { search: query })
    })
      .then((earlier) => {
        setData((current) => current === null ? earlier : {
          threads: current.threads,
          messages: [...current.messages, ...earlier.messages],
          hasMore: earlier.hasMore
        });
        setLoadingMore(false);
      })
      .catch((cause: unknown) => {
        setError(errorText(cause));
        setLoadingMore(false);
      });
  }, [contactId, data, query]);

  if (loading) {
    return <p className="conversation-empty">Загружаем переписку…</p>;
  }
  if (error) {
    return <p className="conversation-empty conversation-error">{error}</p>;
  }
  if (!data || data.threads.length === 0) {
    return (
      <p className="conversation-empty">
        Переписки нет: человек не писал ни в один наш мессенджер, либо диалог начался до
        того, как мы начали её сохранять.
      </p>
    );
  }

  // Старое сверху: сервер отдаёт свежие первыми, потому что так работает курсор.
  const ordered = [...data.messages].reverse();

  return (
    <div className="conversation-feed">
      <div className="conversation-threads">
        {data.threads.map((thread) => (
          <ThreadChip key={thread.conversationId} thread={thread} />
        ))}
      </div>

      <label className="conversation-search">
        <Search size={14} />
        <input
          type="search"
          value={search}
          placeholder="Поиск по переписке"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      {query !== "" && ordered.length === 0 ? (
        <p className="conversation-empty">По запросу «{query}» ничего не нашлось.</p>
      ) : null}

      {data.hasMore ? (
        <button
          type="button"
          className="conversation-earlier"
          onClick={loadEarlier}
          disabled={loadingMore}
        >
          {loadingMore ? "Загружаем…" : "Показать более ранние"}
        </button>
      ) : null}

      <ol className="conversation-messages">
        {ordered.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
      </ol>
      <div ref={bottom} />

      <ReplyComposer
        threads={data.threads.filter(answerable)}
        readOnly={data.threads.filter((thread) => !answerable(thread))}
        onSent={() => setReloads((value) => value + 1)}
      />
    </div>
  );
}

/**
 * Поле ответа.
 *
 * Канал выбирается диалогом, а не галочкой: писать можно только туда, где разговор уже
 * начался. Бот первым написать не может — это ограничение мессенджера, а не наше, и
 * притворяться, что кнопка «написать в MAX» что-то даст, значит врать менеджеру.
 *
 * Ответ уходит в очередь и появляется в ленте сразу со статусом «отправляется». Отдельного
 * «отправлено» здесь нет: его показывает сама лента, когда воркер доложит.
 */
function ReplyComposer({
  threads,
  readOnly,
  onSent
}: {
  readonly threads: readonly AdminConversationThread[];
  /** Ветки, в которые отвечать нельзя. Нужны, чтобы объяснить пустое место. */
  readonly readOnly: readonly AdminConversationThread[];
  readonly onSent: () => void;
}) {
  const [conversationId, setConversationId] = useState(
    threads[0]?.conversationId ?? ""
  );
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [takeOverFrom, setTakeOverFrom] = useState<string | null>(null);
  const filePicker = useRef<HTMLInputElement | null>(null);

  const send = useCallback(
    (takeOver: boolean) => {
      const body = text.trim();
      // Без файла нужен текст; с файлом текст необязателен — он идёт подписью.
      if (conversationId === "" || (body === "" && file === null)) {
        return;
      }
      if (file !== null && file.size > FILE_LIMIT_BYTES) {
        setError(`Файл больше ${formatSize(FILE_LIMIT_BYTES)} — столько не примет панель.`);
        return;
      }
      setBusy(true);
      setError(null);
      const sending = file === null
        ? sendConversationReply(conversationId, { text: body, takeOver })
        : sendConversationFile(conversationId, {
          file,
          ...(body === "" ? {} : { caption: body }),
          takeOver
        });
      sending
        .then((result) => {
          setBusy(false);
          if (result.status === "read_only") {
            // Запрет пришёл с сервера — значит, ветка стала только для чтения уже после
            // того, как панель нарисовала поле. Текст показываем как есть: он объясняет,
            // куда отвечать вместо этого.
            setError(result.reason);
            return;
          }
          if (result.status === "assigned_to_other") {
            // Не ошибка, а развилка: диалог ведёт коллега, и перехватить его — решение
            // человека. Текст и файл при этом остаются, чтобы не набирать заново.
            setTakeOverFrom(result.assignedAdminName);
            return;
          }
          setText("");
          setFile(null);
          if (filePicker.current) {
            filePicker.current.value = "";
          }
          setTakeOverFrom(null);
          onSent();
        })
        .catch((cause: unknown) => {
          setBusy(false);
          setError(errorText(cause));
        });
    },
    [conversationId, file, onSent, text]
  );

  if (threads.length === 0) {
    // Ветка бота MAX — единственный случай, когда переписка есть, а отвечать в неё нельзя.
    // Объяснить это важнее, чем спрятать: иначе менеджер решит, что панель сломалась.
    if (readOnly.some((thread) => thread.channel === "max")) {
      return (
        <p className="conversation-empty">
          В MAX отвечает аккаунт компании, а не бот. Эта ветка — только для чтения; чтобы
          ответить, человек должен написать аккаунту, либо напишите ему сами из MAX.
        </p>
      );
    }

    return (
      <p className="conversation-empty">
        Ответить некуда: человек нам не писал, а первым бот написать не может.
      </p>
    );
  }

  return (
    <div className="conversation-composer">
      {threads.length > 1 ? (
        <div className="conversation-composer-channels" role="radiogroup" aria-label="Куда ответить">
          {threads.map((thread) => (
            <button
              key={thread.conversationId}
              type="button"
              role="radio"
              aria-checked={thread.conversationId === conversationId}
              className={thread.conversationId === conversationId
                ? "conversation-composer-channel conversation-composer-channel-active"
                : "conversation-composer-channel"}
              onClick={() => setConversationId(thread.conversationId)}
            >
              {threadName(thread, threads)}
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        className="conversation-composer-text"
        value={text}
        rows={3}
        maxLength={4000}
        placeholder={`Ответ в ${(() => {
          const thread = threads.find((item) => item.conversationId === conversationId);

          return thread ? threadName(thread, threads) : "Telegram";
        })()}`}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter переносит строку, отправляет Ctrl+Enter. Наоборот было бы быстрее, но
          // цена опечатки здесь — сообщение, ушедшее человеку недописанным.
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send(false);
          }
        }}
      />

      {takeOverFrom ? (
        <p className="conversation-composer-takeover">
          Диалог ведёт {takeOverFrom}. Ответить всё равно?
          <button type="button" onClick={() => send(true)} disabled={busy}>
            Перехватить и отправить
          </button>
          <button type="button" onClick={() => setTakeOverFrom(null)} disabled={busy}>
            Отмена
          </button>
        </p>
      ) : null}

      {error ? <p className="conversation-composer-error">{error}</p> : null}

      {file ? (
        <p className="conversation-composer-file">
          <Paperclip size={13} />
          {file.name}
          <span className="conversation-composer-file-size">{formatSize(file.size)}</span>
          <button
            type="button"
            aria-label="Убрать файл"
            onClick={() => {
              setFile(null);
              if (filePicker.current) {
                filePicker.current.value = "";
              }
            }}
          >
            <X size={13} />
          </button>
        </p>
      ) : null}

      <div className="conversation-composer-actions">
        <input
          ref={filePicker}
          type="file"
          hidden
          onChange={(event) => {
            setError(null);
            setFile(event.target.files?.[0] ?? null);
          }}
        />
        <button
          type="button"
          className="conversation-composer-attach"
          disabled={busy}
          onClick={() => filePicker.current?.click()}
        >
          <Paperclip size={15} />
          Файл
        </button>
        <span className="conversation-composer-hint">Ctrl+Enter — отправить</span>
        <button
          type="button"
          className="conversation-composer-send"
          disabled={busy || (text.trim() === "" && file === null)}
          onClick={() => send(false)}
        >
          {busy ? "Отправляем…" : "Отправить"}
        </button>
      </div>
    </div>
  );
}

function ThreadChip({ thread }: { readonly thread: AdminConversationThread }) {
  const Icon = thread.channel === "telegram" ? Send : MessageSquare;
  return (
    <span
      className={`conversation-thread${thread.status === "closed" ? " conversation-thread-closed" : ""}`}
      title={thread.lastMessageAt
        ? `Последняя реплика ${formatDateTime(thread.lastMessageAt)}`
        : "Реплик пока не было"}
    >
      <Icon size={14} />
      {/* Бот и аккаунт компании — два разных собеседника для человека, и в ленте они
          обязаны быть различимы. */}
      {thread.transport === "account" ? `${channelName(thread.channel)} · аккаунт` : channelName(thread.channel)}
      {/* Ветка бота MAX только читается: отвечает аккаунт. Пометка стоит на фишке, а не
          только у поля ответа, — иначе непонятно, почему выбрать её нельзя. */}
      {answerable(thread) ? null : (
        <span className="conversation-thread-readonly">только чтение</span>
      )}
      <span className="conversation-thread-count">{thread.messageCount}</span>
      {thread.assignedAdminName ? (
        <span className="conversation-thread-assignee">{thread.assignedAdminName}</span>
      ) : null}
    </span>
  );
}

function MessageRow({ message }: { readonly message: AdminConversationMessage }) {
  const mine = message.direction === "outbound";
  const Icon = message.authorKind === "client"
    ? User
    : message.authorKind === "bot" ? Bot : Send;

  return (
    <li className={`conversation-message${mine ? " conversation-message-ours" : ""}`}>
      <div className="conversation-bubble">
        <div className="conversation-meta">
          <Icon size={13} />
          <span className="conversation-author">{message.authorName}</span>
          <span className="conversation-channel">{channelName(message.channel)}</span>
          <time dateTime={message.occurredAt}>{formatDateTime(message.occurredAt)}</time>
          {message.isEdit ? (
            <span
              className="conversation-edited"
              title="Человек переписал сообщение. Исходное осталось выше по ленте."
            >
              изменено
            </span>
          ) : null}
        </div>

        {message.body ? (
          <p className="conversation-text">{message.body}</p>
        ) : null}

        {message.attachments.map((attachment) => (
          <AttachmentRow key={attachment.id} attachment={attachment} />
        ))}

        {message.deliveryStatus === "queued" ? (
          <p className="conversation-queued">
            <Clock size={13} />
            Отправляется
          </p>
        ) : null}

        {message.deliveryStatus === "failed" ? (
          <p className="conversation-failed">
            <AlertTriangle size={13} />
            Не доставлено{message.failureReason ? `: ${message.failureReason}` : ""}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function AttachmentRow({
  attachment
}: {
  readonly attachment: AdminConversationAttachment;
}) {
  // «Качается» и «не скачалось» — разные вещи: первое пройдёт само, второе требует руки,
  // и файл у мессенджера живёт не вечно. Поэтому подписи разные, а не общее «нет файла».
  if (!attachment.isAvailable) {
    return (
      <p className="conversation-attachment">
        {attachmentName(attachment)}
        <span className="conversation-attachment-note">
          {" · "}
          {attachment.failureReason
            ? `не удалось забрать: ${attachment.failureReason}`
            : "ещё качается"}
        </span>
      </p>
    );
  }

  const url = conversationAttachmentUrl(attachment.id);
  const size = attachment.sizeBytes ? ` · ${formatSize(attachment.sizeBytes)}` : "";

  if (attachment.kind === "photo") {
    return (
      <a className="conversation-attachment-photo" href={url} target="_blank" rel="noreferrer">
        {/* Обычный img, а не next/image: файл отдаёт наш же прокси по сессии, а
            оптимизатор Next ходил бы за ним отдельным запросом без неё и получал бы 401. */}
        <img src={url} alt={attachmentName(attachment)} loading="lazy" />
      </a>
    );
  }

  if (attachment.kind === "voice" || attachment.kind === "audio") {
    return (
      <div className="conversation-attachment-audio">
        {/* Голосовые Telegram приходят в ogg/opus: Chrome и Firefox играют их сами, Safari
            до сих пор нет. Поэтому рядом с плеером всегда ссылка — иначе на маке
            голосовое просто не открыть. */}
        <audio controls preload="none" src={url} />
        <a href={url} target="_blank" rel="noreferrer">
          Открыть файл{size}
        </a>
      </div>
    );
  }

  return (
    <p className="conversation-attachment">
      <a href={url} target="_blank" rel="noreferrer">
        {attachmentName(attachment)}
      </a>
      {size}
    </p>
  );
}

function attachmentName(attachment: AdminConversationAttachment): string {
  if (attachment.fileName) {
    return attachment.fileName;
  }
  switch (attachment.kind) {
    case "photo":
      return "Фотография";
    case "voice":
      return "Голосовое сообщение";
    case "video":
      return "Видео";
    case "audio":
      return "Аудио";
    case "document":
      return "Документ";
    case "sticker":
      return "Стикер";
    case "contact":
      return "Контакт";
    case "location":
      return "Геопозиция";
    default:
      return "Вложение";
  }
}

function channelName(channel: "telegram" | "max"): string {
  return channel === "telegram" ? "Telegram" : "MAX";
}

/**
 * Как называется ветка в выборе «куда ответить».
 *
 * Пометка про транспорт появляется только тогда, когда без неё не обойтись — когда в том же
 * мессенджере есть и бот, и аккаунт компании. Две одинаковые надписи «Telegram» здесь не
 * мелкая неаккуратность: менеджер выбирает вслепую и отвечает не от того имени, с которым
 * человек разговаривал. Там, где ветка одна, лишнее слово только мешает.
 */
/** Ветка, в которую можно ответить. Правило общее с сервером — оно в договорённостях. */
function answerable(thread: AdminConversationThread): boolean {
  return conversationAcceptsReply(thread.channel, thread.transport);
}

function threadName(
  thread: AdminConversationThread,
  threads: readonly AdminConversationThread[]
): string {
  const ambiguous = threads.some((other) =>
    other.conversationId !== thread.conversationId && other.channel === thread.channel);
  if (!ambiguous) {
    return channelName(thread.channel);
  }

  return `${channelName(thread.channel)} · ${thread.transport === "account" ? "аккаунт" : "бот"}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1_024) {
    return `${String(bytes)} Б`;
  }
  const units = ["КБ", "МБ", "ГБ"];
  let value = bytes / 1_024;
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? "КБ"}`;
}

function errorText(cause: unknown): string {
  return cause instanceof Error && cause.message !== ""
    ? cause.message
    : "Переписку не удалось загрузить";
}
