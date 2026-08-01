"use client";

import { PageError, PageLoading } from "@/components/page-state";
import { AdminApiError, createBroadcast, listEvents } from "@/lib/admin-api";
import { broadcastErrorMessage, describeAudience } from "@/lib/broadcast";
import { orderStatusLabel } from "@/lib/format";
import {
  ADMIN_ORDER_STATUSES,
  type AdminOrderStatus
} from "@ticket-platform/contracts";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";
import { BadgeCheck, LoaderCircle, Megaphone } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

const MESSAGE_LIMIT = 3_500;

export default function BroadcastsPage() {
  const [events, setEvents] = useState<readonly AdminEventSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [targetEventId, setTargetEventId] = useState("");
  const [targetOrderStatus, setTargetOrderStatus] = useState<AdminOrderStatus | "">("");
  const [sending, setSending] = useState(false);
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

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const text = messageText.trim();
    if (sending || text.length === 0) {
      return;
    }
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createBroadcast({
        messageText: text,
        ...(targetEventId ? { targetEventId } : {}),
        ...(targetOrderStatus ? { targetOrderStatus } : {})
      });
      setMessageText("");
      setNotice(
        `Рассылка ${result.broadcastId} поставлена в очередь. Сообщения уйдут фоновым воркером.`
      );
    } catch (caught) {
      setError(broadcastErrorMessage(caught));
    } finally {
      setSending(false);
    }
  }

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
          <form className="broadcast-form" onSubmit={(value) => void submit(value)}>
            <div className="broadcast-filters">
              <label className="field">
                <span>Мероприятие</span>
                <select
                  value={targetEventId}
                  disabled={sending}
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
                  disabled={sending}
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
                disabled={sending}
                placeholder="Напишите текст так, как его увидит участник в чате."
                onChange={(changeEvent) => setMessageText(changeEvent.target.value)}
              />
            </label>
            <p className="broadcast-counter">
              {messageText.trim().length} / {MESSAGE_LIMIT}
            </p>

            <p className="muted">
              {describeAudience(
                targetEventId,
                targetOrderStatus,
                events
              )}
            </p>

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
                disabled={sending || messageText.trim().length === 0}
              >
                {sending
                  ? <LoaderCircle className="spin" size={17} />
                  : <Megaphone size={17} />}
                {sending ? "Ставим в очередь..." : "Отправить рассылку"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </>
  );
}
