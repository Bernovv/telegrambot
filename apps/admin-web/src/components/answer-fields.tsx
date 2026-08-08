"use client";

import { AdminApiError, saveParticipantAnswer } from "@/lib/admin-api";
import type { EventParticipantFieldDefinition } from "@ticket-platform/contracts/admin-accommodation";
import type { EventParticipantRow } from "@ticket-platform/contracts/admin-participants";
import { Check } from "lucide-react";
import { useState } from "react";

/**
 * Поля ответов анкеты с сохранением по одному.
 *
 * Ответ уходит на сервер, как только поле потеряло фокус, а не по кнопке внизу формы:
 * анкеты вносят стопкой по полсотни, и обрыв связи не должен стоить всей стопки. Компонент
 * общий для ввода стопкой и для карточки участника — иначе два экрана сохраняли бы по-разному.
 */
export function AnswerFields({
  eventId,
  row,
  fields,
  readOnly,
  onSaved
}: {
  readonly eventId: string;
  readonly row: EventParticipantRow;
  readonly fields: readonly EventParticipantFieldDefinition[];
  readonly readOnly: boolean;
  readonly onSaved: () => Promise<void>;
}) {
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valueOf = (fieldId: string) =>
    row.customFields.find((field) => field.fieldId === fieldId)?.value ?? "";

  async function save(fieldId: string, next: string) {
    if (readOnly || next === valueOf(fieldId)) {
      return;
    }
    setSavingField(fieldId);
    setError(null);
    try {
      await saveParticipantAnswer(eventId, {
        ...(row.orderId ? { orderId: row.orderId } : {}),
        ...(row.participantId ? { participantId: row.participantId } : {}),
        fieldId,
        value: next.trim() === "" ? null : next.trim()
      });
      setSavedField(fieldId);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось сохранить ответ.");
    } finally {
      setSavingField(null);
    }
  }

  return (
    <>
      {error ? <div className="accommodation-warning"><span>{error}</span></div> : null}
      <div className="participant-form">
        {fields.map((field) => (
          // Ключ включает участника: при переходе к следующему человеку поле должно
          // перечитать defaultValue, а не показать ответ предыдущего.
          <label className="field" key={`${row.key}:${field.id}`}>
            <span>
              {field.label}
              {savingField === field.id ? (
                <small className="muted"> сохраняем…</small>
              ) : savedField === field.id ? (
                <small className="questionnaire-saved">
                  <Check size={12} /> сохранено
                </small>
              ) : null}
            </span>
            {field.type === "select" ? (
              <select
                defaultValue={valueOf(field.id)}
                disabled={readOnly}
                onChange={(e) => void save(field.id, e.target.value)}
              >
                <option value="">Не выбрано</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                type={inputTypeOf(field.type)}
                defaultValue={valueOf(field.id)}
                maxLength={500}
                readOnly={readOnly}
                onBlur={(e) => void save(field.id, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
    </>
  );
}

function inputTypeOf(type: EventParticipantFieldDefinition["type"]): string {
  if (type === "number") {
    return "number";
  }
  return type === "date" ? "date" : "text";
}
