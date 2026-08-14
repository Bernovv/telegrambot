"use client";

import {
  AdminApiError,
  setEventParticipantFieldValue,
  updateEventParticipant
} from "@/lib/admin-api";
import { formatKopecks, kopecksToRublesInput, rublesInputToKopecks } from "@/lib/format";
import type {
  EventParticipant,
  EventParticipantFieldDefinition,
  EventParticipantSource
} from "@ticket-platform/contracts/admin-accommodation";
import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

const SOURCE_LABELS: Record<EventParticipantSource, string> = {
  max: "MAX",
  site: "Сайт",
  timepad: "Timepad",
  direct: "Договорились напрямую",
  other: "Другое"
};

export function ParticipantDrawer({
  eventId,
  participant,
  fields,
  canManage,
  onClose,
  onSaved
}: {
  readonly eventId: string;
  readonly participant: EventParticipant;
  readonly fields: readonly EventParticipantFieldDefinition[];
  readonly canManage: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valueOf = (fieldId: string) =>
    participant.customFields.find((field) => field.fieldId === fieldId)?.value ?? "";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };

    setSaving(true);
    setError(null);
    try {
      const amount = text("amount");
      const paidAt = text("paidAt");
      const paymentMethod = text("paymentMethod");
      await updateEventParticipant(eventId, {
        participantId: participant.id,
        displayName: text("displayName"),
        phone: text("phone") === "" ? null : text("phone"),
        source: text("source") as EventParticipantSource,
        ticketTitle: text("ticketTitle"),
        adults: Number.parseInt(text("adults") || "0", 10),
        children: Number.parseInt(text("children") || "0", 10),
        sleepingPlaces: Number.parseInt(text("sleepingPlaces") || "0", 10),
        note: text("note"),
        amountKopecks: amount === "" ? null : rublesInputToKopecks(amount),
        paidAt: paidAt === "" ? null : new Date(paidAt).toISOString(),
        paymentMethod: paymentMethod === "" ? null : paymentMethod
      });

      for (const field of fields) {
        const next = text(`field_${field.id}`);
        if (next !== valueOf(field.id)) {
          await setEventParticipantFieldValue({
            eventId,
            participantId: participant.id,
            fieldId: field.id,
            value: next === "" ? null : next
          });
        }
      }

      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось сохранить карточку.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="outreach-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="outreach-drawer outreach-lead-drawer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="section-title-row">
          <div>
            <h2>{participant.displayName}</h2>
            <span>
              {SOURCE_LABELS[participant.source]}
              {participant.amountKopecks
                ? ` · ${formatKopecks(participant.amountKopecks)}`
                : ""}
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {participant.outreachContactId ? (
          <div className="outreach-drawer-actions">
            <Link
              className="secondary-button"
              href={`/base/${participant.outreachContactId}`}
            >
              Карточка в базе
              <ExternalLink size={15} />
            </Link>
          </div>
        ) : null}

        {error ? <div className="accommodation-warning"><span>{error}</span></div> : null}

        <form className="participant-form" onSubmit={(event) => void save(event)}>
          <label className="field">
            <span>Имя</span>
            <input name="displayName" defaultValue={participant.displayName} required maxLength={200} />
          </label>
          <label className="field">
            <span>Телефон</span>
            {/* Номер приводит к единому виду сервер: правя телефон, натыкаться на отказ
                браузера из-за формы записи не за что. */}
            <input
              name="phone"
              defaultValue={participant.phone ?? ""}
              placeholder="8 999 123-45-67"
              maxLength={100}
            />
          </label>
          <label className="field">
            <span>Откуда</span>
            <select name="source" defaultValue={participant.source}>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Тариф</span>
            <input name="ticketTitle" defaultValue={participant.ticketTitle} maxLength={200} />
          </label>
          <label className="field">
            <span>Взрослых</span>
            <input name="adults" type="number" min={0} max={100} defaultValue={participant.adults} required />
          </label>
          <label className="field">
            <span>Детей</span>
            <input name="children" type="number" min={0} max={100} defaultValue={participant.children} required />
          </label>
          <label className="field">
            <span>Спальных мест</span>
            <input
              name="sleepingPlaces"
              type="number"
              min={0}
              max={200}
              defaultValue={participant.sleepingPlaces}
              required
            />
          </label>
          <label className="field">
            <span>Сумма, ₽</span>
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={
                participant.amountKopecks
                  ? kopecksToRublesInput(participant.amountKopecks)
                  : ""
              }
              placeholder="3990"
            />
          </label>
          <label className="field">
            <span>Когда оплатил</span>
            <input
              name="paidAt"
              type="datetime-local"
              defaultValue={toLocalInput(participant.paidAt)}
            />
          </label>
          <label className="field">
            <span>Способ оплаты</span>
            <input
              name="paymentMethod"
              defaultValue={participant.paymentMethod ?? ""}
              maxLength={80}
              placeholder="Перевод"
            />
          </label>
          <label className="field field-full">
            <span>Заметка</span>
            <input name="note" defaultValue={participant.note} maxLength={500} />
          </label>

          {fields.map((field) => (
            <label className="field" key={field.id}>
              <span>{field.label}</span>
              {field.type === "select" ? (
                <select name={`field_${field.id}`} defaultValue={valueOf(field.id)}>
                  <option value="">Не выбрано</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  name={`field_${field.id}`}
                  type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                  defaultValue={valueOf(field.id)}
                  maxLength={500}
                />
              )}
            </label>
          ))}

          {canManage ? (
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          ) : null}
        </form>
      </aside>
    </div>
  );
}

/**
 * `datetime-local` не понимает ISO с зоной, а показывать время нужно в том же поясе, в
 * котором менеджер его вводил.
 */
function toLocalInput(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
