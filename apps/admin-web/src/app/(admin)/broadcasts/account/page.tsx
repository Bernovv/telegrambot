"use client";

import { PageError, PageLoading } from "@/components/page-state";
import {
  accountSavedMessageFileUrl,
  AdminApiError,
  cancelAccountBroadcast,
  countAccountBroadcastAudience,
  createAccountBroadcast,
  listAccountBroadcasts,
  listAccountSavedMessages,
  listEvents
} from "@/lib/admin-api";
import {
  accountBroadcastErrorMessage,
  accountBroadcastParts,
  accountBroadcastStatus,
  accountBroadcastTarget,
  describePace,
  estimateSending,
  formatDuration,
  formatMoment,
  plural,
  savedKindLabel,
  truncate
} from "@/lib/account-broadcast";
import { useNotice } from "@/lib/use-notice";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";
import {
  ACCOUNT_BROADCAST_MAX_PARTS,
  type AccountBroadcastAudienceResult,
  type AccountBroadcastSummary,
  type AccountSavedMessageView,
  type AccountSavedMessagesResult
} from "@ticket-platform/contracts/admin-account-broadcasts";
import {
  ArrowLeft,
  BadgeCheck,
  CircleStop,
  LoaderCircle,
  RefreshCw,
  Send,
  TestTube
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const AUDIENCE_DEBOUNCE_MS = 300;
/** Пока рассылка идёт, история обновляется сама: счётчик «отправлено» растёт на глазах. */
const HISTORY_REFRESH_MS = 30_000;

/**
 * Рассылка от рабочего аккаунта Telegram.
 *
 * Содержимое не пишется здесь: его кладут в «Избранное» рабочего аккаунта с телефона —
 * кружок там же и записывают, — а экран показывает, что там лежит, и даёт выбрать.
 * Рассылка копирует выбранное как есть, без пометки «переслано».
 */
export default function AccountBroadcastPage() {
  const search = useSearchParams();
  const [events, setEvents] = useState<readonly AdminEventSummary[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AccountSavedMessagesResult | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [refreshingSaved, setRefreshingSaved] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [eventId, setEventId] = useState(search.get("event") ?? "");
  const [audience, setAudience] = useState<AccountBroadcastAudienceResult | null>(null);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [testRecipient, setTestRecipient] = useState("");
  const [history, setHistory] = useState<readonly AccountBroadcastSummary[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"live" | "test" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();

  const loadSaved = useCallback(async (signal?: AbortSignal) => {
    setSavedError(null);
    setRefreshingSaved(true);
    try {
      const result = await listAccountSavedMessages(signal);
      setSaved(result);
      // Выбранное, которого больше нет в «Избранном», снимаем: отправить его нельзя.
      setSelected((current) => current.filter((id) => result.items.some((item) => item.id === id)));
    } catch (caught) {
      if (!signal?.aborted) {
        setSavedError(accountBroadcastErrorMessage(caught));
      }
    } finally {
      setRefreshingSaved(false);
    }
  }, []);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setHistoryError(null);
    try {
      const result = await listAccountBroadcasts(signal);
      setHistory(result.items);
    } catch (caught) {
      if (!signal?.aborted) {
        setHistoryError(accountBroadcastErrorMessage(caught));
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    listEvents({ limit: 100 }, controller.signal)
      .then((page) => setEvents(page.items))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setEventsError(
            caught instanceof AdminApiError ? caught.message : "Не удалось загрузить мероприятия."
          );
        }
      });
    void loadSaved(controller.signal);
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadSaved, loadHistory]);

  const sending = history?.some((item) => item.status === "sending") ?? false;
  useEffect(() => {
    if (!sending) {
      return;
    }
    const timer = setInterval(() => void loadHistory(), HISTORY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [sending, loadHistory]);

  // Аудитория зависит и от выбранных сообщений: кто их уже получил, второй раз не получит.
  const selectedKey = selected.join(",");
  useEffect(() => {
    if (!eventId) {
      setAudience(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setAudienceError(null);
      countAccountBroadcastAudience(
        { eventId, savedMessageIds: selectedKey === "" ? [] : selectedKey.split(",") },
        controller.signal
      )
        .then((result) => setAudience(result))
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) {
            setAudience(null);
            setAudienceError(accountBroadcastErrorMessage(caught));
          }
        });
    }, AUDIENCE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [eventId, selectedKey]);

  // В «Избранном» порядок — по времени, а рассылка уходит в том же порядке: показываем
  // выбранное именно так, чтобы не было сюрприза «текст пришёл раньше кружка».
  const selectedInOrder = useMemo(() => {
    const items = saved?.items ?? [];
    return [...items]
      .filter((item) => selected.includes(item.id))
      .sort((left, right) => left.sentAt.localeCompare(right.sentAt));
  }, [saved, selected]);

  function toggle(item: AccountSavedMessageView) {
    setError(null);
    setSelected((current) => {
      if (current.includes(item.id)) {
        return current.filter((id) => id !== item.id);
      }
      if (current.length >= ACCOUNT_BROADCAST_MAX_PARTS) {
        setError(`Не больше ${ACCOUNT_BROADCAST_MAX_PARTS} сообщений в одной рассылке.`);
        return current;
      }
      return [...current, item.id];
    });
  }

  async function sendTest() {
    if (busy !== null || selected.length === 0 || testRecipient.trim() === "") {
      return;
    }
    setBusy("test");
    setError(null);
    try {
      await createAccountBroadcast({
        savedMessageIds: selected,
        testRecipient: testRecipient.trim()
      });
      setNotice("Пробная в очереди — придёт в течение минуты. Выбор сохранён.");
      void loadHistory();
    } catch (caught) {
      setError(accountBroadcastErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function sendLive() {
    if (busy !== null || selected.length === 0 || !eventId || audience === null) {
      return;
    }
    const eventTitle = events?.find((item) => item.id === eventId)?.title ?? "мероприятия";
    const count = audience.willReceive;
    const confirmed = window.confirm(
      `Разослать от рабочего аккаунта ${count} ${plural(count, "человеку", "людям", "людям")} `
        + `из «${eventTitle}»?\n\n`
        + `Что уйдёт: ${selectedInOrder.map((item) => savedKindLabel(item.kind)).join(" + ")}.\n`
        + `Займёт ${estimateSending(count, audience.pace)}. Остановить можно в любой момент, `
        + "но уже ушедшее не отзовётся."
    );
    if (!confirmed) {
      return;
    }
    setBusy("live");
    setError(null);
    try {
      const result = await createAccountBroadcast({ savedMessageIds: selected, eventId });
      setNotice(
        `Рассылка запущена: ${result.recipientCount} ${plural(result.recipientCount, "получатель", "получателя", "получателей")}.`
      );
      setSelected([]);
      void loadHistory();
    } catch (caught) {
      setError(accountBroadcastErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(item: AccountBroadcastSummary) {
    if (busy !== null) {
      return;
    }
    if (!window.confirm(`Остановить рассылку? Ещё не отправлено: ${item.pendingCount}.`)) {
      return;
    }
    setBusy("cancel");
    try {
      await cancelAccountBroadcast(item.id);
      setNotice("Рассылка остановлена. Кому уже ушло — у тех останется.");
      void loadHistory();
    } catch (caught) {
      setError(accountBroadcastErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const canSend = selected.length > 0 && busy === null;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Коммуникации</p>
          <h1>Рассылка от рабочего аккаунта</h1>
          <p>
            Кружки, текст и фото из «Избранного» рабочего аккаунта Telegram уходят участникам
            мероприятия от живого имени, а не от бота.
          </p>
        </div>
        <Link className="secondary-button" href={eventId ? `/broadcasts?event=${encodeURIComponent(eventId)}` : "/broadcasts"}>
          <ArrowLeft size={16} /> Рассылка от бота
        </Link>
      </div>

      <section className="data-section" aria-label="Что отправить">
        <div className="section-title-row">
          <div>
            <h2>1. Что отправить</h2>
            <span>
              Запишите кружок или напишите текст в Telegram с рабочего аккаунта и отправьте в
              «Избранное». Через несколько секунд он появится здесь.
            </span>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={refreshingSaved}
            onClick={() => void loadSaved()}
          >
            <RefreshCw size={15} className={refreshingSaved ? "spin" : undefined} /> Обновить
          </button>
        </div>

        <div className="account-broadcast-body">
          {saved === null && savedError === null ? <PageLoading label="Смотрим «Избранное»" /> : null}
          {savedError ? <PageError message={savedError} retry={() => void loadSaved()} /> : null}
          {saved !== null && saved.items.length === 0 ? (
            <p className="muted">
              {saved.lastSyncedAt === null
                ? "Аккаунт ещё ни разу не заглядывал в «Избранное». Если так долго — процесс tg-account на сервере не запущен или не обновлён."
                : "В «Избранном» пусто. Отправьте туда кружок или текст с рабочего аккаунта и нажмите «Обновить»."}
            </p>
          ) : null}
          {saved !== null && saved.items.length > 0 ? (
            <>
              <ul className="account-saved-grid">
                {saved.items.map((item) => (
                  <SavedMessageCard
                    key={item.id}
                    item={item}
                    position={selectedInOrder.findIndex((entry) => entry.id === item.id)}
                    onToggle={() => toggle(item)}
                  />
                ))}
              </ul>
              <p className="muted account-saved-sync">
                {saved.lastSyncedAt
                  ? `Аккаунт смотрел «Избранное» ${formatMoment(saved.lastSyncedAt)}. `
                  : ""}
                Выбрано {selected.length} из {ACCOUNT_BROADCAST_MAX_PARTS}. Уйдут в том порядке, в каком лежат в «Избранном».
              </p>
            </>
          ) : null}
        </div>
      </section>

      <section className="data-section" aria-label="Кому">
        <div className="section-title-row">
          <div>
            <h2>2. Кому</h2>
            <span>Участники мероприятия, которых рабочий аккаунт нашёл в Telegram</span>
          </div>
        </div>

        <div className="account-broadcast-body">
          {eventsError ? <p className="form-error">{eventsError}</p> : null}
          <label className="field">
            <span>Мероприятие</span>
            <select
              value={eventId}
              disabled={events === null || busy !== null}
              onChange={(changeEvent) => setEventId(changeEvent.target.value)}
            >
              <option value="">Выберите мероприятие</option>
              {(events ?? []).map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </label>

          {audienceError ? <p className="form-error">Не удалось посчитать: {audienceError}</p> : null}
          {eventId && audience === null && audienceError === null ? (
            <p className="muted">Считаем получателей…</p>
          ) : null}
          {audience !== null ? (
            <>
              <dl className="account-audience">
                <div><dt>Участников</dt><dd>{audience.participants}</dd></div>
                <div><dt>Есть переписка с аккаунтом</dt><dd>{audience.reachable}</dd></div>
                <div><dt>Нет в Telegram</dt><dd>{audience.notInTelegram}</dd></div>
                <div><dt>Номер ещё не проверен</dt><dd>{audience.notChecked}</dd></div>
                {selected.length > 0 ? (
                  <div><dt>Уже получили эти сообщения</dt><dd>{audience.alreadyReceived}</dd></div>
                ) : null}
                <div className="account-audience-total"><dt>Уйдёт</dt><dd>{audience.willReceive}</dd></div>
              </dl>
              <p className="muted">
                {describePace(audience.pace)}
                {audience.willReceive > 0
                  ? ` Эта рассылка займёт ${estimateSending(audience.willReceive, audience.pace)}.`
                  : ""}
              </p>
              {audience.notChecked > 0 ? (
                <p className="muted">
                  Номера проверяются сами, понемногу в день. Кого проверят после запуска, в эту
                  рассылку уже не попадёт.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      <section className="data-section" aria-label="Отправка">
        <div className="section-title-row">
          <div>
            <h2>3. Отправка</h2>
            <span>Сначала пробная себе — посмотреть, как выглядит у получателя</span>
          </div>
        </div>
        <div className="account-broadcast-body">
          <div className="account-test-row">
            <label className="field">
              <span>Пробная — кому</span>
              <input
                value={testRecipient}
                maxLength={200}
                disabled={busy !== null}
                placeholder="@ник или +7 999 123-45-67"
                onChange={(changeEvent) => setTestRecipient(changeEvent.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={!canSend || testRecipient.trim() === ""}
              onClick={() => void sendTest()}
              title="У получателя должна быть переписка с рабочим аккаунтом"
            >
              {busy === "test" ? <LoaderCircle className="spin" size={16} /> : <TestTube size={16} />}
              Отправить пробную
            </button>
          </div>
          <p className="muted">
            Пробная уходит только тому, у кого уже есть переписка с рабочим аккаунтом: напишите
            ему со своего Telegram любое сообщение, если ещё не писали.
          </p>

          {error ? <p className="form-error">{error}</p> : null}
          {notice ? (
            <p className="broadcast-notice"><BadgeCheck size={16} /> {notice}</p>
          ) : null}

          <div className="broadcast-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!canSend || !eventId || audience === null || audience.willReceive === 0}
              onClick={() => void sendLive()}
            >
              {busy === "live" ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
              {audience && audience.willReceive > 0
                ? `Запустить рассылку — ${audience.willReceive} ${plural(audience.willReceive, "человек", "человека", "человек")}`
                : "Запустить рассылку"}
            </button>
          </div>
        </div>
      </section>

      <section className="data-section" aria-label="История">
        <div className="section-title-row">
          <div>
            <h2>История</h2>
            <span>Последние 30 рассылок от аккаунта</span>
          </div>
        </div>
        {history === null && historyError === null ? <PageLoading /> : null}
        {historyError ? <PageError message={historyError} retry={() => void loadHistory()} /> : null}
        {history !== null && history.length === 0 ? (
          <p className="muted account-broadcast-body">Рассылок от аккаунта пока не было.</p>
        ) : null}
        {history !== null && history.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Кому</th>
                  <th>Что</th>
                  <th>Статус</th>
                  <th>Отправлено</th>
                  <th>Кто запустил</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{formatMoment(item.createdAt)}</td>
                    <td>{accountBroadcastTarget(item)}</td>
                    <td className="account-history-parts">{accountBroadcastParts(item)}</td>
                    <td>
                      {accountBroadcastStatus(item)}
                      {item.pausedUntil && item.pauseReason ? (
                        <p className="account-history-note">{truncate(item.pauseReason, 220)}</p>
                      ) : null}
                    </td>
                    <td>
                      {item.sentCount} из {item.recipientCount}
                      {item.failedCount > 0 ? `, не дошло ${item.failedCount}` : ""}
                      {item.status === "sending" && item.pendingCount > 0
                        ? `, ждут ${item.pendingCount}`
                        : ""}
                      {item.failureReasons.map((reason) => (
                        <p className="account-history-note" key={reason.reason}>
                          {reason.count} × {truncate(reason.reason, 120)}
                        </p>
                      ))}
                    </td>
                    <td>{item.createdByAdminName ?? "—"}</td>
                    <td>
                      {item.status === "sending" ? (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy !== null}
                          onClick={() => void cancel(item)}
                        >
                          <CircleStop size={15} /> Остановить
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}

function SavedMessageCard({
  item,
  position,
  onToggle
}: {
  readonly item: AccountSavedMessageView;
  /** Номер в рассылке, начиная с нуля; -1 — не выбрано. */
  readonly position: number;
  readonly onToggle: () => void;
}) {
  const selected = position >= 0;
  const poster = item.minithumbnailBase64
    ? `data:image/jpeg;base64,${item.minithumbnailBase64}`
    : undefined;
  const isRoundVideo = item.kind === "video_note";
  const playable = item.hasFile && (item.kind === "video_note" || item.kind === "video");

  return (
    <li className={`account-saved-card${selected ? " is-selected" : ""}`}>
      <label className="account-saved-pick">
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <span>{selected ? `№${position + 1}` : "Выбрать"}</span>
      </label>
      <div className="account-saved-media">
        {playable ? (
          <video
            className={isRoundVideo ? "account-saved-circle" : "account-saved-video"}
            src={accountSavedMessageFileUrl(item.id)}
            poster={poster}
            preload="none"
            controls
            playsInline
          />
        ) : item.kind === "photo" && item.hasFile ? (
          // Обычный img: файл отдаёт наш прокси по сессии, оптимизатор Next её не несёт.
          <img
            className="account-saved-photo"
            src={accountSavedMessageFileUrl(item.id)}
            alt="Фото из «Избранного»"
            loading="lazy"
          />
        ) : poster ? (
          <img
            className={isRoundVideo ? "account-saved-circle is-blurred" : "account-saved-photo is-blurred"}
            src={poster}
            alt=""
          />
        ) : null}
      </div>
      <p className="account-saved-kind">
        {savedKindLabel(item.kind)}
        {item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : ""}
      </p>
      {item.body ? <p className="account-saved-text">{truncate(item.body, 280)}</p> : null}
      <p className="account-saved-meta">{formatMoment(item.sentAt)}</p>
    </li>
  );
}
