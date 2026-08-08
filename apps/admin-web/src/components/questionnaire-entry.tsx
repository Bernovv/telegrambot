"use client";

import { AnswerFields } from "@/components/answer-fields";
import type { EventParticipantFieldDefinition } from "@ticket-platform/contracts/admin-accommodation";
import type { EventParticipantRow } from "@ticket-platform/contracts/admin-participants";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

/**
 * Ввод бумажных анкет стопкой: один человек на экране, стрелка — следующий. Сами поля и
 * их сохранение живут в AnswerFields, общем с карточкой участника.
 */
export function QuestionnaireEntry({
  eventId,
  rows,
  fields,
  onSaved
}: {
  readonly eventId: string;
  readonly rows: readonly EventParticipantRow[];
  readonly fields: readonly EventParticipantFieldDefinition[];
  readonly onSaved: () => Promise<void>;
}) {
  const [index, setIndex] = useState(0);

  const row = rows[Math.min(index, rows.length - 1)];
  if (!row) {
    return (
      <div className="outreach-empty">
        <strong>Некого заполнять</strong>
        <span>В списке участников пока пусто.</span>
      </div>
    );
  }

  const answered = row.customFields.filter(
    (field) => field.value !== null && field.value !== ""
  ).length;

  return (
    <div className="questionnaire-entry">
      <div className="questionnaire-entry-head">
        <div>
          <strong>{row.displayName}</strong>
          <span className="muted">
            {row.phone ?? "телефон не указан"}
            {row.orderNumber ? ` · ${row.orderNumber}` : ""}
            {row.ticketTitle ? ` · ${row.ticketTitle}` : ""}
          </span>
        </div>
        <div className="questionnaire-entry-nav">
          <button
            className="icon-button bordered"
            type="button"
            aria-label="Предыдущий участник"
            title="Предыдущий участник"
            disabled={index === 0}
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft size={18} />
          </button>
          <span className="questionnaire-counter">
            {index + 1} / {rows.length}
          </span>
          <button
            className="icon-button bordered"
            type="button"
            aria-label="Следующий участник"
            title="Следующий участник"
            disabled={index >= rows.length - 1}
            onClick={() => setIndex((current) =>
              Math.min(rows.length - 1, current + 1))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <AnswerFields
        eventId={eventId}
        row={row}
        fields={fields}
        readOnly={false}
        onSaved={onSaved}
      />

      <p className="questionnaire-entry-foot muted">
        {answered === 0
          ? "Анкета пока пустая."
          : `Заполнено ответов: ${answered} из ${fields.length}.`}
        {" "}Ответ сохраняется сам, как только вы уходите из поля.
      </p>
    </div>
  );
}
