"use client";

import {
  AdminApiError,
  createEvent,
  updateEventGeneral
} from "@/lib/admin-api";
import type {
  AdminEventDetail,
  AdminEventGeneralInput
} from "@ticket-platform/contracts/admin-events";
import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

interface EventGeneralFormProps {
  readonly event?: AdminEventDetail;
}

export function EventGeneralForm({ event }: EventGeneralFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = event !== undefined;

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    const data = new FormData(formEvent.currentTarget);
    try {
      const general = readGeneralInput(data);
      const reason = requiredValue(data, "reason");
      const result = editing
        ? await updateEventGeneral(event.id, {
            ...general,
            expectedLockVersion: event.lockVersion,
            reason
          })
        : await createEvent({ ...general, reason });
      router.replace(`/events/${result.eventId}`);
      router.refresh();
    } catch (caught) {
      setError(eventMutationMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <form className="event-form" onSubmit={(formEvent) => void submit(formEvent)}>
      <section className="event-form-section">
        <div className="section-title-row">
          <div>
            <h2>Основное</h2>
            <span>Название и публичный адрес</span>
          </div>
        </div>
        <div className="event-form-grid">
          <label className="field field-wide">
            <span>Название</span>
            <input
              name="title"
              required
              maxLength={250}
              defaultValue={event?.title ?? ""}
            />
          </label>
          <label className="field">
            <span>Slug</span>
            <input
              name="slug"
              required
              minLength={2}
              maxLength={100}
              pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
              placeholder="business-picnic"
              defaultValue={event?.slug ?? ""}
            />
          </label>
          <label className="field">
            <span>Часовой пояс</span>
            <input
              name="timezone"
              required
              maxLength={100}
              placeholder="Europe/Moscow"
              defaultValue={event?.timezone ?? "Europe/Moscow"}
            />
          </label>
          <label className="field field-full">
            <span>Описание</span>
            <textarea
              name="description"
              maxLength={10_000}
              rows={5}
              defaultValue={event?.description ?? ""}
            />
          </label>
        </div>
      </section>

      <section className="event-form-section">
        <div className="section-title-row">
          <div>
            <h2>Расписание и продажи</h2>
            <span>RFC 3339 с часовым смещением</span>
          </div>
        </div>
        <div className="event-form-grid">
          <DateField name="startsAt" label="Начало" required value={event?.startsAt} />
          <DateField name="endsAt" label="Окончание" value={event?.endsAt} />
          <DateField
            name="salesStartsAt"
            label="Старт продаж"
            value={event?.salesStartsAt}
          />
          <DateField
            name="salesEndsAt"
            label="Окончание продаж"
            value={event?.salesEndsAt}
          />
        </div>
      </section>

      <section className="event-form-section">
        <div className="section-title-row">
          <div>
            <h2>Площадка и емкость</h2>
            <span>Операционные параметры</span>
          </div>
        </div>
        <div className="event-form-grid">
          <label className="field">
            <span>Площадка</span>
            <input
              name="locationName"
              maxLength={250}
              defaultValue={event?.locationName ?? ""}
            />
          </label>
          <label className="field">
            <span>Контакт поддержки</span>
            <input
              name="supportContact"
              maxLength={250}
              defaultValue={event?.supportContact ?? ""}
            />
          </label>
          <label className="field field-full">
            <span>Адрес</span>
            <input
              name="locationAddress"
              maxLength={500}
              defaultValue={event?.locationAddress ?? ""}
            />
          </label>
          <label className="field">
            <span>Общая емкость</span>
            <input
              name="capacity"
              type="number"
              required
              min={1}
              max={10_000_000}
              step={1}
              defaultValue={event?.capacity ?? 100}
            />
          </label>
          <label className="field">
            <span>Резерв, минут</span>
            <input
              name="reservationTtlMinutes"
              type="number"
              required
              min={1}
              max={1_440}
              step={1}
              defaultValue={event?.reservationTtlMinutes ?? 30}
            />
          </label>
          <label className="check-field">
            <input
              name="phoneRequiredForPurchase"
              type="checkbox"
              defaultChecked={event?.phoneRequiredForPurchase ?? true}
            />
            <span>Телефон обязателен при покупке</span>
          </label>
          <label className="check-field">
            <input
              name="offerRequired"
              type="checkbox"
              defaultChecked={event?.offerRequired ?? true}
            />
            <span>Требуется принятие оферты</span>
          </label>
        </div>
      </section>

      <section className="event-form-section">
        <div className="section-title-row">
          <div>
            <h2>Аудит</h2>
            <span>Причина административного изменения</span>
          </div>
        </div>
        <div className="event-form-grid">
          <label className="field field-full">
            <span>Причина</span>
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={500}
              rows={3}
              placeholder={editing ? "Что и почему изменено" : "Цель создания черновика"}
            />
          </label>
        </div>
      </section>

      {error ? <p className="form-error event-form-error">{error}</p> : null}
      <div className="event-form-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={submitting}
          onClick={() => router.back()}
        >
          Отмена
        </button>
        <button className="primary-button" type="submit" disabled={submitting}>
          <Save size={16} />
          {submitting
            ? "Сохранение..."
            : editing
              ? "Сохранить изменения"
              : "Создать черновик"}
        </button>
      </div>
    </form>
  );
}

function DateField({
  name,
  label,
  value,
  required = false
}: {
  readonly name: string;
  readonly label: string;
  readonly value?: string | null | undefined;
  readonly required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        required={required}
        placeholder="2026-08-20T11:00:00+03:00"
        defaultValue={value ?? ""}
      />
    </label>
  );
}

function readGeneralInput(data: FormData): AdminEventGeneralInput {
  return {
    slug: requiredValue(data, "slug"),
    title: requiredValue(data, "title"),
    description: stringValue(data, "description"),
    timezone: requiredValue(data, "timezone"),
    startsAt: requiredValue(data, "startsAt"),
    endsAt: nullableValue(data, "endsAt"),
    salesStartsAt: nullableValue(data, "salesStartsAt"),
    salesEndsAt: nullableValue(data, "salesEndsAt"),
    locationName: nullableValue(data, "locationName"),
    locationAddress: nullableValue(data, "locationAddress"),
    supportContact: nullableValue(data, "supportContact"),
    capacity: numberValue(data, "capacity"),
    reservationTtlMinutes: numberValue(data, "reservationTtlMinutes"),
    phoneRequiredForPurchase: data.get("phoneRequiredForPurchase") === "on",
    offerRequired: data.get("offerRequired") === "on"
  };
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

function numberValue(data: FormData, name: string): number {
  const value = Number(requiredValue(data, name));
  if (!Number.isSafeInteger(value)) {
    throw new Error("number");
  }
  return value;
}

function eventMutationMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "ADMIN_EVENT_VERSION_CONFLICT") {
      return "Черновик уже изменен другим администратором. Обновите страницу.";
    }
    if (error.code === "ADMIN_EVENT_SLUG_CONFLICT") {
      return "Этот slug уже используется другим мероприятием.";
    }
    if (error.code === "ADMIN_EVENT_NOT_DRAFT") {
      return "Редактировать общие настройки можно только у черновика.";
    }
    if (error.status === 403) {
      return "У учетной записи нет разрешения events.write.";
    }
    return error.message;
  }
  return "Проверьте обязательные поля и формат дат.";
}
