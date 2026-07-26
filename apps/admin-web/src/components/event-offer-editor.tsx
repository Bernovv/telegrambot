"use client";

import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  deactivateEventOffer,
  publishEventOfferVersion
} from "@/lib/admin-api";
import { formatEventDateTime } from "@/lib/format";
import type {
  AdminEventDetail,
  AdminEventOfferVersion
} from "@ticket-platform/contracts/admin-events";
import {
  CircleOff,
  ExternalLink,
  FileCheck2,
  Plus,
  Save,
  X
} from "lucide-react";
import { type FormEvent, useState } from "react";

export function EventOfferEditor({
  event,
  reload
}: {
  readonly event: AdminEventDetail;
  readonly reload: () => Promise<void>;
}) {
  const [publishing, setPublishing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  async function saved() {
    await reload();
    setPublishing(false);
    setDeactivating(false);
  }

  return (
    <>
      {publishing ? (
        <OfferPublishForm
          event={event}
          cancel={() => setPublishing(false)}
          saved={saved}
        />
      ) : null}
      {deactivating && event.activeOffer ? (
        <OfferDeactivateForm
          event={event}
          cancel={() => setDeactivating(false)}
          saved={saved}
        />
      ) : null}

      <section className="detail-section offer-editor-section">
        <div className="section-title-row">
          <div>
            <h2>История версий</h2>
            <span>{event.offerVersions.length} опубликовано</span>
          </div>
          <div className="heading-actions">
            {event.activeOffer ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDeactivating(true)}
              >
                <CircleOff size={16} />
                Снять активную
              </button>
            ) : null}
            <button
              className="primary-button"
              type="button"
              onClick={() => setPublishing(true)}
            >
              <Plus size={16} />
              Новая версия
            </button>
          </div>
        </div>

        {event.offerVersions.length === 0 ? (
          <p className="section-empty">Версии оферты пока не опубликованы.</p>
        ) : (
          <div className="offer-version-list">
            {event.offerVersions.map((version) => (
              <OfferVersionRow
                key={version.id}
                version={version}
                timezone={event.timezone}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function OfferVersionRow({
  version,
  timezone
}: {
  readonly version: AdminEventOfferVersion;
  readonly timezone: string;
}) {
  return (
    <article className="offer-version-row">
      <div className="offer-version-heading">
        <div>
          <div className="title-with-status">
            <h3>Версия {version.versionNumber}</h3>
            <StatusPill tone={version.isActive ? "positive" : "neutral"}>
              {version.isActive ? "Активна" : "История"}
            </StatusPill>
          </div>
          <span>
            {version.documentTitle} ·{" "}
            {formatEventDateTime(version.publishedAt, timezone)}
          </span>
        </div>
        <a
          className="icon-button bordered"
          href={version.publicUrl}
          target="_blank"
          rel="noreferrer"
          title="Открыть опубликованный снимок"
          aria-label={`Открыть версию ${version.versionNumber}`}
        >
          <ExternalLink size={16} />
        </a>
      </div>
      <dl className="offer-version-facts">
        <div>
          <dt>Формат</dt>
          <dd>{version.contentType}</dd>
        </div>
        <div>
          <dt>Принятий</dt>
          <dd>{version.acceptanceCount}</dd>
        </div>
        <div>
          <dt>Источник</dt>
          <dd>{sourceTypeLabel(version.sourceType)}</dd>
        </div>
        <div>
          <dt>Редакция</dt>
          <dd>{version.sourceRevisionId ?? "—"}</dd>
        </div>
      </dl>
      <div className="offer-checksum">
        <span>SHA-256</span>
        <code>{version.sha256}</code>
      </div>
      {version.sourceUrl ? (
        <a
          className="offer-source-link"
          href={version.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Исходный документ
          <ExternalLink size={14} />
        </a>
      ) : null}
    </article>
  );
}

function OfferPublishForm({
  event,
  cancel,
  saved
}: {
  readonly event: AdminEventDetail;
  readonly cancel: () => void;
  readonly saved: () => Promise<void>;
}) {
  const latest = event.offerVersions[0];
  const [sourceType, setSourceType] = useState<"google_docs" | "html">(
    latest?.sourceType === "google_docs" ? "google_docs" : "html"
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = new FormData(formEvent.currentTarget);
      await publishEventOfferVersion(event.id, {
        expectedLockVersion: event.lockVersion,
        reason: requiredValue(data, "reason"),
        offer: {
          documentTitle: requiredValue(data, "documentTitle"),
          sourceType,
          sourceUrl: nullableValue(data, "sourceUrl"),
          sourceRevisionId: nullableValue(data, "sourceRevisionId"),
          displayTextSnapshot: requiredValue(data, "displayTextSnapshot")
        }
      });
      await saved();
    } catch (caught) {
      setError(offerMutationMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      className="event-form-section catalog-form"
      onSubmit={(formEvent) => void submit(formEvent)}
    >
      <FormHeading
        title="Публикация новой версии"
        subtitle={`Версия мероприятия ${event.lockVersion}`}
        cancel={cancel}
      />
      <div className="event-form-grid">
        <label className="field">
          <span>Название документа</span>
          <input
            name="documentTitle"
            required
            maxLength={250}
            defaultValue={latest?.documentTitle ?? "Договор оферты"}
          />
        </label>
        <label className="field">
          <span>Тип источника</span>
          <select
            name="sourceType"
            value={sourceType}
            onChange={(event) =>
              setSourceType(event.target.value as "google_docs" | "html")
            }
          >
            <option value="google_docs">Google Docs</option>
            <option value="html">Текст в системе</option>
          </select>
        </label>
        <label className="field field-full">
          <span>URL источника</span>
          <input
            name="sourceUrl"
            type="url"
            required={sourceType === "google_docs"}
            maxLength={2_000}
            defaultValue={latest?.sourceUrl ?? ""}
          />
        </label>
        <label className="field">
          <span>Идентификатор редакции</span>
          <input
            name="sourceRevisionId"
            maxLength={250}
            defaultValue={latest?.sourceRevisionId ?? ""}
          />
        </label>
        <label className="field field-full">
          <span>Согласованный текст оферты</span>
          <textarea
            name="displayTextSnapshot"
            rows={18}
            minLength={1}
            maxLength={50_000}
            required
            defaultValue={latest?.displayTextSnapshot ?? ""}
          />
        </label>
        <label className="check-field field-full">
          <input name="confirmed" type="checkbox" required />
          <span>Подтверждаю публикацию этой неизменяемой редакции</span>
        </label>
        <label className="field field-full">
          <span>Причина публикации</span>
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={2}
          />
        </label>
      </div>
      <FormActions
        submitting={submitting}
        cancel={cancel}
        error={error}
        submitLabel="Опубликовать"
      />
    </form>
  );
}

function OfferDeactivateForm({
  event,
  cancel,
  saved
}: {
  readonly event: AdminEventDetail;
  readonly cancel: () => void;
  readonly saved: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = new FormData(formEvent.currentTarget);
      await deactivateEventOffer(event.id, {
        expectedLockVersion: event.lockVersion,
        reason: requiredValue(data, "reason")
      });
      await saved();
    } catch (caught) {
      setError(offerMutationMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      className="event-form-section catalog-form"
      onSubmit={(formEvent) => void submit(formEvent)}
    >
      <FormHeading
        title="Снять активную оферту"
        subtitle={`Версия ${event.activeOffer?.versionNumber ?? "—"}`}
        cancel={cancel}
      />
      <div className="event-form-grid">
        <label className="field field-full">
          <span>Причина снятия</span>
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={3}
          />
        </label>
        <label className="check-field field-full">
          <input name="confirmed" type="checkbox" required />
          <span>Подтверждаю снятие оферты с новых заказов</span>
        </label>
      </div>
      <FormActions
        submitting={submitting}
        cancel={cancel}
        error={error}
        submitLabel="Снять оферту"
      />
    </form>
  );
}

function FormHeading({
  title,
  subtitle,
  cancel
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly cancel: () => void;
}) {
  return (
    <div className="section-title-row">
      <div>
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      <button
        className="icon-button"
        type="button"
        title="Закрыть"
        aria-label="Закрыть"
        onClick={cancel}
      >
        <X size={18} />
      </button>
    </div>
  );
}

function FormActions({
  submitting,
  cancel,
  error,
  submitLabel
}: {
  readonly submitting: boolean;
  readonly cancel: () => void;
  readonly error: string | null;
  readonly submitLabel: string;
}) {
  return (
    <>
      {error ? <p className="form-error catalog-form-error">{error}</p> : null}
      <div className="catalog-form-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={submitting}
          onClick={cancel}
        >
          Отмена
        </button>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitLabel === "Опубликовать" ? (
            <FileCheck2 size={16} />
          ) : (
            <Save size={16} />
          )}
          {submitting ? "Сохранение..." : submitLabel}
        </button>
      </div>
    </>
  );
}

function sourceTypeLabel(value: AdminEventOfferVersion["sourceType"]): string {
  if (value === "google_docs") {
    return "Google Docs";
  }
  if (value === "upload") {
    return "Загрузка";
  }
  return "Текст в системе";
}

function stringValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function requiredValue(data: FormData, name: string): string {
  const value = stringValue(data, name);
  if (!value) {
    throw new Error("required");
  }
  return value;
}

function nullableValue(data: FormData, name: string): string | null {
  return stringValue(data, name) || null;
}

function offerMutationMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "ADMIN_EVENT_VERSION_CONFLICT") {
      return "Черновик уже изменен другим администратором. Обновите страницу.";
    }
    if (error.code === "ADMIN_OFFER_STORAGE_UNAVAILABLE") {
      return "Хранилище снимков оферты не настроено или временно недоступно.";
    }
    if (error.code === "ADMIN_EVENT_OFFER_DOCUMENT_AMBIGUOUS") {
      return "У мероприятия найдено несколько документов оферты. Нужна проверка данных.";
    }
    if (error.code === "ADMIN_EVENT_OFFER_NOT_ACTIVE") {
      return "Активная версия уже снята. Обновите страницу.";
    }
    if (error.status === 403) {
      return "У учетной записи нет разрешения events.write.";
    }
    return error.message;
  }
  return "Проверьте обязательные поля, URL источника и длину текста.";
}
