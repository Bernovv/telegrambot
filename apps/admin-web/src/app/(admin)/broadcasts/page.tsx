"use client";

import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  countBroadcastAudience,
  createBroadcast,
  listEvents
} from "@/lib/admin-api";
import {
  audienceWarning,
  broadcastErrorMessage,
  describeAudience,
  recipientCountLabel
} from "@/lib/broadcast";
import { orderStatusLabel } from "@/lib/format";
import {
  ADMIN_ORDER_STATUSES,
  type AdminBroadcastAudienceResult,
  type AdminOrderStatus
} from "@ticket-platform/contracts";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";
import { BadgeCheck, LoaderCircle, Megaphone, TestTube } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

const MESSAGE_LIMIT = 3_500;
const AUDIENCE_DEBOUNCE_MS = 300;

export default function BroadcastsPage() {
  const [events, setEvents] = useState<readonly AdminEventSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [targetEventId, setTargetEventId] = useState("");
  const [targetOrderStatus, setTargetOrderStatus] = useState<AdminOrderStatus | "">("");
  const [audience, setAudience] = useState<AdminBroadcastAudienceResult | null>(null);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [sending, setSending] = useState<"live" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadEvents = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const page = await listEvents({ limit: 100 }, signal);
      setEvents(page.items);
    } catch (caught) {
      if (signal?.aborted) {
        return;
      }
      setLoadError(
        caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить список мероприятий."
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadEvents(controller.signal);
    return () => controller.abort();
  }, [loadEvents]);

  // Пересчитываем аудиторию при смене условий. Пауза — чтобы переключение двух списков подряд
  // не отправляло два запроса, отмена — чтобы ответ на устаревшие условия не перезаписал свежий.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setAudienceError(null);
      countBroadcastAudience(
        {
          ...(targetEventId ? { targetEventId } : {}),
          ...(targetOrderStatus ? { targetOrderStatus } : {})
        },
        controller.signal
      )
        .then((result) => setAudience(result))
        .catch((caught: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          setAudience(null);
          setAudienceError(broadcastErrorMessage(caught));
        });
    }, AUDIENCE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [targetEventId, targetOrderStatus]);

  async function send(mode: "live" | "test") {
    const text = messageText.trim();
    if (sending !== null || text.length === 0) {
      return;
    }
    if (mode === "live" && !confirmLiveSend(audience)) {
      return;
    }

    setSending(mode);
    setError(null);
    setNotice(null);
    try {
      await createBroadcast({
        messageText: text,
        ...(targetEventId ? { targetEventId } : {}),
        ...(targetOrderStatus ? { targetOrderStatus } : {}),
        ...(mode === "test" ? { isTest: true } : {})
      });
      setNotice(
        mode === "test"
          ? "Пробное сообщение поставлено в очередь — оно придёт только в административные чаты. Текст в форме сохранён."
          : "Рассылка поставлена в очередь. Сообщения уйдут фоновым воркером."
      );
      if (mode === "live") {
        setMessageText("");
      }
    } catch (caught) {
      setError(broadcastErrorMessage(caught));
    } finally {
      setSending(null);
    }
  }

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    void send("live");
  }

  const warning = audience
    ? audienceWarning(audience.recipientCount, audience.truncated, audience.limit)
    : null;
  const busy = sending !== null;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Коммуникации</p>
          <h1>Рассылки</h1>
          <p>Сообщение уходит всем, кто попадает под выбранные условия.</p>
        </div>
      </div>

      <section className="data-section" aria-label="Новая рассылка">
        <div className="section-title-row">
          <div>
            <h2>Новая рассылка</h2>
            <span>Отправляется через очередь, не мгновенно</span>
          </div>
        </div>

        {events === null && loadError === null ? <PageLoading /> : null}
        {loadError ? (
          <PageError message={loadError} retry={() => void loadEvents()} />
        ) : null}

        {events !== null ? (
          <form className="broadcast-form" onSubmit={submit}>
            <div className="broadcast-filters">
              <label className="field">
                <span>Мероприятие</span>
                <select
                  value={targetEventId}
                  disabled={busy}
                  onChange={(changeEvent) =>
                    setTargetEventId(changeEvent.target.value)}
                >
                  <option value="">Все мероприятия</option>
                  {events.map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Статус заказа</span>
                <select
                  value={targetOrderStatus}
                  disabled={busy}
                  onChange={(changeEvent) =>
                    setTargetOrderStatus(
                      changeEvent.target.value as AdminOrderStatus | ""
                    )}
                >
                  <option value="">Любой статус</option>
                  {ADMIN_ORDER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {orderStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Текст сообщения</span>
              <textarea
                className="broadcast-textarea"
                value={messageText}
                maxLength={MESSAGE_LIMIT}
                required
                disabled={busy}
                placeholder="Напишите текст так, как его увидит участник в чате."
                onChange={(changeEvent) => setMessageText(changeEvent.target.value)}
              />
            </label>
            <p className="broadcast-counter">
              {messageText.trim().length} / {MESSAGE_LIMIT}
            </p>

            <p className="muted">
              {describeAudience(targetEventId, targetOrderStatus, events)}
            </p>
            <p className="broadcast-audience" aria-live="polite">
              {audienceError
                ? `Не удалось посчитать получателей: ${audienceError}`
                : audience === null
                  ? "Считаем получателей..."
                  : `Сейчас под условия попадает ${recipientCountLabel(audience.recipientCount)}.`}
            </p>
            {warning ? <p className="form-error">{warning}</p> : null}

            {error ? <p className="form-error">{error}</p> : null}
            {notice ? (
              <p className="broadcast-notice">
                <BadgeCheck size={16} />
                {notice}
              </p>
            ) : null}

            <div className="broadcast-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={busy || messageText.trim().length === 0}
              >
                {sending === "live"
                  ? <LoaderCircle className="spin" size={17} />
                  : <Megaphone size={17} />}
                {sending === "live" ? "Ставим в очередь..." : "Отправить рассылку"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy || messageText.trim().length === 0}
                onClick={() => void send("test")}
                title="Сообщение придёт только в административные чаты"
              >
                {sending === "test"
                  ? <LoaderCircle className="spin" size={17} />
                  : <TestTube size={17} />}
                {sending === "test" ? "Отправляем..." : "Сначала себе"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </>
  );
}

// Отправку нельзя отозвать, поэтому число получателей проговариваем вслух прямо перед стартом.
function confirmLiveSend(audience: AdminBroadcastAudienceResult | null): boolean {
  const target = audience === null
    ? "всем, кто попадает под выбранные условия"
    : recipientCountLabel(audience.recipientCount);
  return window.confirm(
    `Отправить сообщение ${target}? Отменить отправку будет нельзя.`
  );
}
