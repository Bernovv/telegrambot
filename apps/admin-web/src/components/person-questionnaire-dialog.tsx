"use client";

import { AnswerFields } from "@/components/answer-fields";
import { AdminApiError, getEventParticipants } from "@/lib/admin-api";
import type { EventParticipantFieldDefinition }
  from "@ticket-platform/contracts/admin-accommodation";
import type { EventParticipantRow }
  from "@ticket-platform/contracts/admin-participants";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Анкета участника прямо из карточки клиента.
 *
 * Ответы и раньше были видны в карточке, а заполнить их можно было только на вкладке
 * мероприятия — то есть надо было помнить, на какое событие человек ездил, и уйти туда со
 * страницы. Спрашивают же анкету ровно тогда, когда смотрят на человека.
 *
 * Список участников подгружается по требованию: он нужен только чтобы найти строку этого
 * человека и набор вопросов мероприятия, и тянуть его в каждую карточку заранее незачем.
 */
export function PersonQuestionnaireDialog({
  eventId,
  eventTitle,
  participantId,
  onClose,
  onSaved
}: {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly participantId: string;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const [row, setRow] = useState<EventParticipantRow | null>(null);
  const [fields, setFields] =
    useState<readonly EventParticipantFieldDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void getEventParticipants(eventId, controller.signal)
      .then((view) => {
        const found = view.rows.find(
          (candidate) => candidate.participantId === participantId
        );
        if (!found) {
          setError("Человека нет в списке участников этого мероприятия.");
          return;
        }
        setRow(found);
        setFields(view.fields);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof AdminApiError
            ? caught.message
            : "Не удалось открыть анкету.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [eventId, participantId]);

  return (
    <div className="outreach-modal-backdrop" role="presentation">
      <section
        className="outreach-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="questionnaire-title"
      >
        <div className="section-title-row">
          <div>
            <h2 id="questionnaire-title">Анкета</h2>
            <span>{eventTitle}</span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {loading ? <p className="muted person-empty">Открываем анкету…</p> : null}
        {error ? <p className="page-warning">{error}</p> : null}
        {row && fields.length === 0 ? (
          <p className="muted person-empty">
            У этого мероприятия нет вопросов анкеты.
          </p>
        ) : null}
        {row && fields.length > 0 ? (
          <div className="person-questionnaire-body">
            <AnswerFields
              eventId={eventId}
              row={row}
              fields={fields}
              readOnly={false}
              onSaved={onSaved}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
