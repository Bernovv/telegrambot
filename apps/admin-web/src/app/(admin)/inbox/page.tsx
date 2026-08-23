"use client";

import { ConversationFeed } from "@/components/conversation-feed";
import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  linkConversation,
  listInbox,
  listOutreachPeople,
  markConversationRead
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import {
  ADMIN_INBOX_FILTERS,
  type AdminInboxFilter,
  type AdminInboxItem,
  type AdminInboxPage
} from "@ticket-platform/contracts/admin-conversations";
import type { OutreachPerson } from "@ticket-platform/contracts/admin-outreach";
import { ArrowRight, RefreshCw, Search, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Переписки.
 *
 * Тот же материал, что в карточке человека, собранный с другой стороны. Карточка отвечает
 * на вопрос «что у нас с этим человеком», список — на вопрос «кому мы ещё не ответили», и
 * второй задают каждые десять минут.
 *
 * Строка списка — диалог, а не человек: бот и аккаунт компании в одном мессенджере это два
 * разных собеседника, и ответ уходит туда, откуда спросили. Открытый диалог показывает при
 * этом **всю** переписку человека, всеми каналами: разговор у него с нами один.
 */

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

/**
 * Как часто список сам ходит на сервер.
 *
 * Полминуты — это компромисс между «узнать о новом сообщении сразу» и «не долбить api с
 * каждой открытой вкладки». Опрос идёт только когда вкладка на переднем плане: свёрнутое
 * окно не ждёт ответа никто.
 */
const POLL_MS = 30_000;

const FILTER_LABELS: Record<AdminInboxFilter, string> = {
  all: "Все",
  mine: "Мои",
  unread: "Непрочитанные",
  unlinked: "Без карточки"
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "TG",
  max: "MAX",
  whatsapp: "WA"
};

export default function InboxPage() {
  const [page, setPage] = useState<AdminInboxPage | null>(null);
  const [filter, setFilter] = useState<AdminInboxFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [feedToken, setFeedToken] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const loaded = await listInbox(
        { filter, limit: PAGE_SIZE, ...(search === "" ? {} : { search }) },
        signal
      );
      if (!signal?.aborted) {
        setPage(loaded);
      }
    } catch (caught) {
      if (!signal?.aborted && !quiet) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить переписки.");
      }
    } finally {
      if (!signal?.aborted && !quiet) {
        setLoading(false);
      }
    }
  }, [filter, search]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloads]);

  // Опрос: список и открытая лента обновляются вместе, иначе в списке видно новое
  // сообщение, а в ленте его ещё нет — и менеджер решает, что панель врёт.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void load(undefined, true);
      setFeedToken((current) => current + 1);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const items = page?.items ?? [];
  const selected = useMemo(
    () => items.find((item) => item.conversationId === selectedId) ?? null,
    [items, selectedId]
  );

  /**
   * Открыть диалог.
   *
   * Кружок гасим сразу и на месте, не дожидаясь ответа сервера: отметка о прочтении — это
   * бухгалтерия, а менеджер уже читает. Если запрос не дойдёт, следующий опрос вернёт
   * кружок обратно, и это честнее, чем ждать полсекунды на каждый клик.
   */
  const open = useCallback((item: AdminInboxItem) => {
    setSelectedId(item.conversationId);
    if (item.unreadCount === 0) {
      return;
    }
    setPage((current) => current === null ? current : {
      ...current,
      items: current.items.map((row) => row.conversationId === item.conversationId
        ? { ...row, unreadCount: 0 }
        : row),
      counts: {
        ...current.counts,
        unread: Math.max(current.counts.unread - 1, 0)
      }
    });
    void markConversationRead(item.conversationId).catch(() => undefined);
  }, []);

  if (loading && page === null) {
    return <PageLoading label="Собираем переписки" />;
  }
  if (error && page === null) {
    return <PageError message={error} retry={() => setReloads((current) => current + 1)} />;
  }

  return (
    <div className="inbox-page">
      <div className="inbox-heading">
        <div>
          <p className="eyebrow">Работа</p>
          <h1>Переписки</h1>
        </div>
        <div className="inbox-filters">
          {ADMIN_INBOX_FILTERS.map((value) => (
            <button
              key={value}
              className={value === filter ? "chip-button chip-button-active" : "chip-button"}
              type="button"
              aria-pressed={value === filter}
              onClick={() => setFilter(value)}
            >
              {FILTER_LABELS[value]}
              <span className="chip-count">{page?.counts[value] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="inbox-search">
          <Search size={15} />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Имя, телефон или ник"
            maxLength={100}
          />
        </label>
        <button
          className="icon-button"
          type="button"
          aria-label="Обновить"
          title="Обновить"
          onClick={() => setReloads((current) => current + 1)}
        >
          <RefreshCw size={17} />
        </button>
      </div>

      {error ? <p className="inbox-stale">{error}</p> : null}

      <div className="inbox-split">
        <div className="inbox-list">
          {items.length === 0 ? (
            <p className="conversation-empty">
              {filter === "all"
                ? "Переписок пока нет."
                : "В этом отборе пусто."}
            </p>
          ) : null}
          {items.map((item) => (
            <button
              key={item.conversationId}
              className={item.conversationId === selectedId
                ? "inbox-row inbox-row-active"
                : "inbox-row"}
              type="button"
              aria-current={item.conversationId === selectedId}
              onClick={() => open(item)}
            >
              <span
                className={item.contactId === null ? "inbox-ava inbox-ava-unknown" : "inbox-ava"}
                aria-hidden="true"
              >
                {item.contactId === null ? "?" : initials(item.title)}
              </span>
              <span className="inbox-who">
                {item.title}
                <span className={`inbox-src inbox-src-${item.channel}`}>
                  {CHANNEL_LABELS[item.channel] ?? item.channel}
                  {item.transport === "bot" ? " · бот" : ""}
                </span>
              </span>
              <span className="inbox-when">{shortTime(item.lastMessageAt)}</span>
              <span className="inbox-last">
                {item.lastMessageDirection === "outbound" ? "Вы: " : ""}
                {item.lastMessagePreview ?? "—"}
              </span>
              {item.unreadCount > 0 ? (
                <span className="inbox-badge">{item.unreadCount}</span>
              ) : null}
            </button>
          ))}
          {page?.hasMore ? (
            <p className="inbox-more">
              Показаны свежие {PAGE_SIZE}. Остальные ищутся поиском.
            </p>
          ) : null}
        </div>

        <div className="inbox-chat">
          {selected === null ? (
            <p className="conversation-empty">Выберите диалог слева.</p>
          ) : (
            <>
              <div className="inbox-chat-head">
                <strong>{selected.title}</strong>
                {selected.phone ? <span>{selected.phone}</span> : null}
                <span className={`inbox-src inbox-src-${selected.channel}`}>
                  {CHANNEL_LABELS[selected.channel] ?? selected.channel}
                  {selected.transport === "bot" ? " · бот" : " · аккаунт"}
                </span>
                {selected.assignedAdminName ? (
                  <span className="inbox-owner">
                    В работе: <b>{selected.assignedAdminName}</b>
                  </span>
                ) : null}
                {selected.contactId ? (
                  <Link className="inbox-card-link" href={`/base/${selected.contactId}`}>
                    Карточка <ArrowRight size={14} />
                  </Link>
                ) : null}
              </div>

              {selected.contactId === null ? (
                <UnknownPerson
                  conversationId={selected.conversationId}
                  title={selected.title}
                  onLinked={() => setReloads((current) => current + 1)}
                />
              ) : null}

              <ConversationFeed
                key={selected.conversationId}
                contactId={selected.contactId}
                conversationId={selected.contactId === null ? selected.conversationId : null}
                refreshToken={feedToken}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Разбор безымянного диалога.
 *
 * Человек написал первым, а кто он — мы не знаем: в Telegram у него нет ника, и завести
 * карточку по одному числовому идентификатору нельзя, её потом никто не найдёт. Два
 * выхода, и оба здесь: узнать человека в базе или записать телефон, который он назвал.
 */
function UnknownPerson({
  conversationId,
  title,
  onLinked
}: {
  readonly conversationId: string;
  readonly title: string;
  readonly onLinked: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "search" | "phone">("idle");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<readonly OutreachPerson[]>([]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current !== null) {
      clearTimeout(searchTimer.current);
    }
    if (mode !== "search" || query.trim().length < 2) {
      setFound([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void listOutreachPeople({ search: query.trim(), filter: "all", limit: 8 })
        .then((result) => setFound(result.items))
        .catch(() => setFound([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimer.current !== null) {
        clearTimeout(searchTimer.current);
      }
    };
  }, [mode, query]);

  async function link(input: { readonly contactId?: string; readonly phone?: string }) {
    setSaving(true);
    setNotice(null);
    try {
      const result = await linkConversation(conversationId, {
        ...input,
        ...(name.trim() === "" ? {} : { displayName: name.trim() })
      });
      if (result.status === "merged_into_existing") {
        setNotice("Такой телефон уже был в базе — диалог уехал в ту карточку.");
      }
      if (result.status === "already_linked") {
        setNotice("Диалог уже привязан к карточке.");
      }
      onLinked();
    } catch (caught) {
      setNotice(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось привязать диалог.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inbox-unknown">
      <div className="inbox-unknown-head">
        <UserPlus size={16} />
        <span>
          Диалог не привязан к карточке: <b>{title}</b> — это всё, что мы о нём знаем.
        </span>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setMode(mode === "search" ? "idle" : "search")}
        >
          Найти в базе
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setMode(mode === "phone" ? "idle" : "phone")}
        >
          Записать телефон
        </button>
      </div>

      {mode === "search" ? (
        <div className="inbox-unknown-body">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Имя, телефон, Telegram или MAX"
            maxLength={100}
          />
          {found.map((person) => (
            <button
              key={person.contactId}
              className="inbox-found"
              type="button"
              disabled={saving}
              onClick={() => void link({ contactId: person.contactId })}
            >
              <strong>{person.displayName ?? "Без имени"}</strong>
              <span>{person.phone ?? person.telegramUsername ?? person.maxIdentifier ?? "—"}</span>
            </button>
          ))}
          {query.trim().length >= 2 && found.length === 0 ? (
            <p className="inbox-unknown-hint">Никого не нашлось.</p>
          ) : null}
        </div>
      ) : null}

      {mode === "phone" ? (
        <div className="inbox-unknown-body">
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+7 900 123-45-67"
            maxLength={30}
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Имя, если знаете"
            maxLength={200}
          />
          <button
            className="primary-button"
            type="button"
            disabled={saving || phone.trim().length < 5}
            onClick={() => void link({ phone: phone.trim() })}
          >
            {saving ? "Привязываем…" : "Привязать"}
          </button>
          <p className="inbox-unknown-hint">
            Если такой телефон уже есть в базе, диалог уедет в существующую карточку, а не
            заведёт человеку вторую.
          </p>
        </div>
      ) : null}

      {notice ? <p className="inbox-unknown-hint">{notice}</p> : null}
    </div>
  );
}

function initials(title: string): string {
  const clean = title.replace(/^[@+]/, "").trim();
  return clean === "" ? "?" : clean.slice(0, 1).toUpperCase();
}

/** В списке время нужно коротким: «14:26» сегодня и дата раньше. */
function shortTime(value: string | null): string {
  if (value === null) {
    return "";
  }
  const at = new Date(value);
  const now = new Date();
  if (at.toDateString() === now.toDateString()) {
    return at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return formatDateTime(value).replace(/,.*$/, "");
}
