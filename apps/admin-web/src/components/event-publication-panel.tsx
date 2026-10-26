"use client";

import { AdminApiError, publishEvent } from "@/lib/admin-api";
import { eventPublicationRequirements } from "@/lib/event-publication";
import type { AdminEventDetail } from "@ticket-platform/contracts/admin-events";
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  Rocket
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

export function EventPublicationPanel({
  event,
  onPublished
}: {
  readonly event: AdminEventDetail;
  readonly onPublished: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requirements = eventPublicationRequirements(event);
  const ready = requirements.every((requirement) => requirement.ready);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!ready || publishing || reason.trim().length < 3) {
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      await publishEvent(event.id, {
        expectedLockVersion: event.lockVersion,
        reason: reason.trim()
      });
      await onPublished();
    } catch (caught) {
      setError(publicationErrorMessage(caught));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <form className="publication-panel" onSubmit={(value) => void submit(value)}>
      <div className="publication-readiness">
        {requirements.map((requirement) => (
          <Link
            className={requirement.ready ? "requirement-ready" : "requirement-missing"}
            href={requirement.href}
            key={requirement.label}
          >
            {requirement.ready
              ? <CheckCircle2 size={17} />
              : <AlertTriangle size={17} />}
            <span>{requirement.label}</span>
          </Link>
        ))}
      </div>
      <label className="field publication-reason">
        <span>Причина публикации</span>
        <input
          type="text"
          value={reason}
          minLength={3}
          maxLength={500}
          required
          disabled={publishing}
          onChange={(changeEvent) => setReason(changeEvent.target.value)}
        />
      </label>
      {error ? <p className="form-error publication-error">{error}</p> : null}
      <div className="publication-actions">
        <span>
          {ready
            ? "Все обязательные данные готовы"
            : "Устраните отмеченные замечания"}
        </span>
        <button
          className="primary-button"
          type="submit"
          disabled={!ready || publishing || reason.trim().length < 3}
        >
          {publishing ? <LoaderCircle className="spin" size={17} /> : <Rocket size={17} />}
          {publishing ? "Публикация..." : "Опубликовать мероприятие"}
        </button>
      </div>
    </form>
  );
}

function publicationErrorMessage(error: unknown): string {
  if (!(error instanceof AdminApiError)) {
    return "Сервис публикации временно недоступен.";
  }
  if (error.code === "ADMIN_EVENT_PUBLICATION_REQUIREMENTS_FAILED") {
    return "Состав мероприятия изменился. Обновите страницу и проверьте готовность.";
  }
  if (error.code === "ADMIN_EVENT_VERSION_CONFLICT") {
    return "Мероприятие уже изменено другим администратором. Обновите страницу.";
  }
  if (error.status === 403) {
    return "Для публикации требуется разрешение events.publish.";
  }
  return error.message;
}
