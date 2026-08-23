"use client";

import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  countBroadcastAudience,
  createBroadcast,
  listBroadcasts,
  listEvents,
  uploadBroadcastImage
} from "@/lib/admin-api";
import {
  audienceLabel,
  audienceWarning,
  BROADCAST_IMAGE_MAX_BYTES,
  broadcastErrorMessage,
  broadcastResultLabel,
  broadcastStatusLabel,
  broadcastTargetLabel,
  describeAudience,
  imageErrorMessage,
  messageLimit,
  recipientCountLabel
} from "@/lib/broadcast";
import { orderStatusLabel } from "@/lib/format";
import {
  ADMIN_BROADCAST_AUDIENCES,
  ADMIN_ORDER_STATUSES,
  type AdminBroadcastAudience,
  type AdminBroadcastAudienceResult,
  type AdminBroadcastSummary,
  type AdminOrderStatus
} from "@ticket-platform/contracts";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";
import {
  BadgeCheck,
  Image as ImageIcon,
  LoaderCircle,
  Megaphone,
  TestTube,
  X
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

const AUDIENCE_DEBOUNCE_MS = 300;

interface AttachedImage {
  readonly imageId: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}

export default function BroadcastsPage() {
  // Мероприятие приходит адресом, когда рассылку открыли из самого мероприятия. Отдельного
  // раздела «Рассылки» в меню больше нет: письмо почти всегда пишут про конкретное событие.
  const search = useSearchParams();
  const preselectedEventId = search.get("event") ?? "";
  const [events, setEvents] = useState<readonly AdminEventSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [targetAudience, setTargetAudience] = useState<AdminBroadcastAudience>("orders");
  const [targetEventId, setTargetEventId] = useState(preselectedEventId);
  const [targetOrderStatus, setTargetOrderStatus] = useState<AdminOrderStatus | "">("");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [image, setImage] = useState<AttachedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [audience, setAudience] = useState<AdminBroadcastAudienceResult | null>(null);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly AdminBroadcastSummary[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
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

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setHistoryError(null);
    try {
      const result = await listBroadcasts(signal);
      setHistory(result.items);
    } catch (caught) {
      if (signal?.aborted) {
        return;
      }
      setHistoryError(broadcastErrorMessage(caught));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadEvents(controller.signal);
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadEvents, loadHistory]);

  // Пересчитываем аудиторию при смене условий. Пауза — чтобы переключение двух списков подряд
  // не отправляло два запроса, отмена — чтобы ответ на устаревшие условия не перезаписал свежий.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setAudienceError(null);
      countBroadcastAudience(
        {
          targetAudience,
          ...(targetAudience === "orders" && targetEventId ? { targetEventId } : {}),
          ...(targetAudience === "orders" && targetOrderStatus ? { targetOrderStatus } : {})
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
  }, [targetAudience, targetEventId, targetOrderStatus]);

  async function attachImage(file: File) {
    setError(null);
    if (file.size > BROADCAST_IMAGE_MAX_BYTES) {
      setError("Файл больше 1 МБ — уменьшите картинку.");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadBroadcastImage({
        fileName: file.name,
        contentBase64: await readBase64(file)
      });
      setImage({
        imageId: result.imageId,
        fileName: file.name,
        byteSize: result.byteSize,
        width: result.width,
        height: result.height
      });
      // С картинкой предел текста падает до подписи: обрезаем сразу, а не при отправке.
      setMessageText((current) => current.slice(0, messageLimit(true)));
    } catch (caught) {
      setError(imageErrorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  async function send(mode: "live" | "test") {
    const text = messageText.trim();
    if (sending !== null || uploading || text.length === 0) {
      return;
    }
    const button = buttonText.trim() && buttonUrl.trim()
      ? { text: buttonText.trim(), url: buttonUrl.trim() }
      : undefined;
    if (Boolean(buttonText.trim()) !== Boolean(buttonUrl.trim())) {
      setError("У кнопки нужны и надпись, и ссылка — или ни того, ни другого.");
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
        targetAudience,
        ...(targetAudience === "orders" && targetEventId ? { targetEventId } : {}),
        ...(targetAudience === "orders" && targetOrderStatus ? { targetOrderStatus } : {}),
        ...(button ? { button } : {}),
        ...(image ? { imageId: image.imageId } : {}),
        ...(mode === "test" ? { isTest: true } : {})
      });
      setNotice(
        mode === "test"
          ? "Пробное сообщение поставлено в очередь — оно придёт только в административные чаты. Форма сохранена."
          : "Рассылка поставлена в очередь. Сообщения уйдут фоновым воркером."
      );
      if (mode === "live") {
        setMessageText("");
        setButtonText("");
        setButtonUrl("");
        setImage(null);
      }
      void loadHistory();
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

  const limit = messageLimit(image !== null);
  const warning = audience
    ? audienceWarning(audience.recipientCount, audience.truncated, audience.limit)
    : null;
  const busy = sending !== null || uploading;

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
                <span>Кому</span>
                <select
                  value={targetAudience}
                  disabled={busy}
                  onChange={(changeEvent) =>
                    setTargetAudience(changeEvent.target.value as AdminBroadcastAudience)}
                >
                  {ADMIN_BROADCAST_AUDIENCES.map((value) => (
                    <option key={value} value={value}>{audienceLabel(value)}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Мероприятие</span>
                <select
                  value={targetEventId}
                  disabled={busy || targetAudience !== "orders"}
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
                  disabled={busy || targetAudience !== "orders"}
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
                maxLength={limit}
                required
                disabled={busy}
                placeholder="Напишите текст так, как его увидит участник в чате."
                onChange={(changeEvent) => setMessageText(changeEvent.target.value)}
              />
            </label>
            <p className="broadcast-counter">
              {messageText.trim().length} / {limit}
              {image ? " — с картинкой текст уходит подписью к фото" : ""}
            </p>

            <div className="broadcast-extras">
              <div className="field">
                <span>Картинка</span>
                {image ? (
                  <p className="broadcast-image-chip">
                    <ImageIcon size={15} />
                    {image.fileName} · {image.width}×{image.height} · {formatSize(image.byteSize)}
                    <button
                      type="button"
                      className="secondary-button broadcast-image-remove"
                      disabled={busy}
                      onClick={() => setImage(null)}
                    >
                      <X size={14} /> убрать
                    </button>
                  </p>
                ) : (
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    disabled={busy}
                    onChange={(changeEvent) => {
                      const file = changeEvent.target.files?.[0];
                      changeEvent.target.value = "";
                      if (file) {
                        void attachImage(file);
                      }
                    }}
                  />
                )}
                <span className="muted">PNG или JPEG до 1 МБ</span>
              </div>
              <label className="field">
                <span>Надпись на кнопке</span>
                <input
                  value={buttonText}
                  maxLength={64}
                  disabled={busy}
                  placeholder="Например: Купить билет"
                  onChange={(changeEvent) => setButtonText(changeEvent.target.value)}
                />
              </label>
              <label className="field">
                <span>Ссылка кнопки</span>
                <input
                  value={buttonUrl}
                  maxLength={2_048}
                  disabled={busy}
                  placeholder="https://biz-day.ru/..."
                  onChange={(changeEvent) => setButtonUrl(changeEvent.target.value)}
                />
              </label>
            </div>

            <p className="muted">
              {describeAudience(targetAudience, targetEventId, targetOrderStatus, events)}
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

      <section className="data-section" aria-label="История рассылок">
        <div className="section-title-row">
          <div>
            <h2>История</h2>
            <span>Последние 50 рассылок</span>
          </div>
        </div>

        {history === null && historyError === null ? <PageLoading /> : null}
        {historyError ? (
          <PageError message={historyError} retry={() => void loadHistory()} />
        ) : null}

        {history !== null && history.length === 0 ? (
          <p className="muted">Рассылок пока не было.</p>
        ) : null}

        {history !== null && history.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Кому</th>
                  <th>Сообщение</th>
                  <th>Статус</th>
                  <th>Результат</th>
                  <th>Кто отправил</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{formatMoment(item.createdAt)}</td>
                    <td>{broadcastTargetLabel(item)}</td>
                    <td className="broadcast-history-text">
                      {item.hasImage ? <ImageIcon size={14} /> : null}
                      {truncate(item.messageText)}
                      {item.buttonText ? (
                        <span className="broadcast-history-button">[{item.buttonText}]</span>
                      ) : null}
                    </td>
                    <td>{broadcastStatusLabel(item.status)}</td>
                    <td>{broadcastResultLabel(item)}</td>
                    <td>{item.createdByAdminName ?? "—"}</td>
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

// Отправку нельзя отозвать, поэтому число получателей проговариваем вслух прямо перед стартом.
function confirmLiveSend(audience: AdminBroadcastAudienceResult | null): boolean {
  const target = audience === null
    ? "всем, кто попадает под выбранные условия"
    : recipientCountLabel(audience.recipientCount);
  return window.confirm(
    `Отправить сообщение ${target}? Отменить отправку будет нельзя.`
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma === -1) {
        reject(new Error("Не удалось прочитать файл"));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  return bytes < 1_024
    ? `${bytes} Б`
    : `${Math.round(bytes / 1_024)} КБ`;
}

function formatMoment(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function truncate(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}
