"use client";

import {
  AdminApiError,
  createEvent,
  updateEventGeneral
} from "@/lib/admin-api";
import {
  DEFAULT_CITY_DURATION_HOURS,
  addHoursIso,
  durationHours,
  isoToZoned,
  suggestSlug,
  zonedToIso
} from "@/lib/event-schedule";
import type {
  AdminEventDetail,
  AdminEventFormat,
  AdminEventGeneralInput
} from "@ticket-platform/contracts/admin-events";
import { Building2, ChevronDown, Save, Tent } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

interface EventGeneralFormProps {
  readonly event?: AdminEventDetail;
}

/**
 * Заведение и правка мероприятия.
 *
 * Форма писалась под Бизнес-Пикник и спрашивала восемнадцать полей подряд, включая четыре
 * строки с датами в формате RFC 3339 и часовым смещением руками. Городская встреча на три
 * часа вечером — это название, день, час и площадка; всё остальное либо выводится, либо
 * нужно раз в год выездному мероприятию и живёт под «Дополнительно».
 *
 * Умолчания подобраны под то, что мы проводим чаще: городское, бесплатное, три часа.
 */
export function EventGeneralForm({ event }: EventGeneralFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const editing = event !== undefined;

  const timezone = event?.timezone ?? "Europe/Moscow";
  const start = isoToZoned(event?.startsAt, timezone);
  const [format, setFormat] = useState<AdminEventFormat>(event?.format ?? "city");
  const [isFree, setIsFree] = useState(event?.isFree ?? true);
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(start.date);
  // Слаг заполняется сам из названия и даты, пока его не тронули руками. У опубликованного
  // мероприятия слаг менять нельзя — на него уже могли ссылаться.
  const [slug, setSlug] = useState(event?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing);
  const effectiveSlug = slugTouched ? slug : suggestSlug(title, date);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    const data = new FormData(formEvent.currentTarget);
    try {
      const general = readGeneralInput(data, {
        format,
        isFree,
        slug: effectiveSlug,
        timezone
      });
      const reason = auditReason(data, editing);
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
            <h2>Что за мероприятие</h2>
            <span>От формата зависит, какие разделы появятся в кабинете</span>
          </div>
        </div>
        <div className="event-format-choice">
          <FormatCard
            value="city"
            current={format}
            icon={Building2}
            label="Городская встреча"
            hint="Несколько часов вечером в городе. Без ночёвки и инвентаря."
            onChoose={setFormat}
          />
          <FormatCard
            value="offsite"
            current={format}
            icon={Tent}
            label="Выездное"
            hint="С ночёвкой: расселение, инвентарь, что везём."
            onChoose={setFormat}
          />
        </div>
        <div className="event-form-grid">
          <label className="field field-wide">
            <span>Название</span>
            <input
              name="title"
              required
              maxLength={250}
              value={title}
              onChange={(input) => setTitle(input.target.value)}
            />
          </label>
          <label className="check-field field-wide">
            <input
              name="isFree"
              type="checkbox"
              checked={isFree}
              onChange={(input) => setIsFree(input.target.checked)}
            />
            <span>
              Участие бесплатное
              <small>
                Тарифы, оферта и сценарий покупки не понадобятся — мероприятие
                публикуется без них.
              </small>
            </span>
          </label>
        </div>
      </section>

      <section className="event-form-section">
        <div className="section-title-row">
          <div>
            <h2>Когда и где</h2>
            <span>Время местное, по часовому поясу мероприятия</span>
          </div>
        </div>
        <div className="event-form-grid">
          <label className="field">
            <span>Дата</span>
            <input
              name="date"
              type="date"
              required
              value={date}
              onChange={(input) => setDate(input.target.value)}
            />
          </label>
          <label className="field">
            <span>Начало</span>
            <input
              name="time"
              type="time"
              required
              defaultValue={start.time || "19:00"}
            />
          </label>
          <label className="field">
            <span>Длительность, часов</span>
            <input
              name="durationHours"
              type="number"
              min={0.5}
              max={240}
              step={0.5}
              required
              defaultValue={
                durationHours(event?.startsAt ?? "", event?.endsAt)
                  ?? DEFAULT_CITY_DURATION_HOURS
              }
            />
          </label>
          <label className="field field-wide">
            <span>Площадка</span>
            <input
              name="locationName"
              maxLength={250}
              placeholder="Например: коворкинг «Ясная поляна»"
              defaultValue={event?.locationName ?? ""}
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
            <span>Сколько ждём человек</span>
            <input
              name="capacity"
              type="number"
              required
              min={1}
              max={10_000_000}
              step={1}
              defaultValue={event?.capacity ?? 40}
            />
          </label>
          <label className="field field-wide">
            <span>Описание</span>
            <textarea
              name="description"
              maxLength={10_000}
              rows={3}
              defaultValue={event?.description ?? ""}
            />
          </label>
        </div>
      </section>

      <section className="event-form-section">
        <button
          className="event-form-disclosure"
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          <ChevronDown
            size={17}
            className={advancedOpen ? "disclosure-open" : undefined}
            aria-hidden="true"
          />
          <span>
            <strong>Дополнительно</strong>
            <small>
              Адрес страницы, часовой пояс, окно продаж, резерв, поддержка
            </small>
          </span>
        </button>

        {advancedOpen ? (
          <div className="event-form-grid">
            <label className="field">
              <span>Адрес страницы (slug)</span>
              <input
                name="slug"
                required
                minLength={2}
                maxLength={100}
                pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
                value={effectiveSlug}
                onChange={(input) => {
                  setSlugTouched(true);
                  setSlug(input.target.value);
                }}
              />
              <small className="field-hint">
                Заполняется из названия и даты. Заявки с сайта ищут встречу по началу
                слага — у еженедельных он начинается на <code>sreda</code>.
              </small>
            </label>
            <label className="field">
              <span>Часовой пояс</span>
              <input
                name="timezone"
                required
                maxLength={100}
                placeholder="Europe/Moscow"
                defaultValue={timezone}
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
            {isFree ? null : (
              <>
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
                <label className="field">
                  <span>Резерв, минут</span>
                  <input
                    name="reservationTtlMinutes"
                    type="number"
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
              </>
            )}
            <label className="field field-full">
              <span>Причина изменения</span>
              <textarea
                name="reason"
                maxLength={500}
                rows={2}
                placeholder={
                  editing ? "Что и почему изменено" : "Зачем заводим мероприятие"
                }
              />
              <small className="field-hint">
                Попадёт в журнал изменений. Не заполнено — запишем
                «{editing ? DEFAULT_UPDATE_REASON : DEFAULT_CREATE_REASON}».
              </small>
            </label>
          </div>
        ) : null}
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

function FormatCard({
  value,
  current,
  icon: Icon,
  label,
  hint,
  onChoose
}: {
  readonly value: AdminEventFormat;
  readonly current: AdminEventFormat;
  readonly icon: typeof Tent;
  readonly label: string;
  readonly hint: string;
  readonly onChoose: (value: AdminEventFormat) => void;
}) {
  const active = current === value;
  return (
    <button
      className={active ? "format-card format-card-active" : "format-card"}
      type="button"
      aria-pressed={active}
      onClick={() => onChoose(value)}
    >
      <Icon size={18} aria-hidden="true" />
      <strong>{label}</strong>
      <small>{hint}</small>
    </button>
  );
}

function DateField({
  name,
  label,
  value
}: {
  readonly name: string;
  readonly label: string;
  readonly value?: string | null | undefined;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        placeholder="2026-08-20T11:00:00+03:00"
        defaultValue={value ?? ""}
      />
    </label>
  );
}

const DEFAULT_CREATE_REASON = "Заведено новое мероприятие";
const DEFAULT_UPDATE_REASON = "Правка карточки мероприятия";

/**
 * Причина изменения обязательна для журнала, но спрашивать её при каждом заведении
 * еженедельной встречи — это поле, которое заполняют точкой. Пустое подставляем сами.
 */
function auditReason(data: FormData, editing: boolean): string {
  const written = stringValue(data, "reason");
  if (written.length >= 3) {
    return written;
  }
  return editing ? DEFAULT_UPDATE_REASON : DEFAULT_CREATE_REASON;
}

function readGeneralInput(
  data: FormData,
  context: {
    readonly format: AdminEventFormat;
    readonly isFree: boolean;
    readonly slug: string;
    readonly timezone: string;
  }
): AdminEventGeneralInput {
  const timezone = stringValue(data, "timezone") || context.timezone;
  const startsAt = zonedToIso(
    { date: requiredValue(data, "date"), time: requiredValue(data, "time") },
    timezone
  );
  if (startsAt === null) {
    throw new InvalidScheduleError();
  }
  const hours = Number(requiredValue(data, "durationHours"));
  const endsAt = addHoursIso(startsAt, hours, timezone);
  if (endsAt === null) {
    throw new InvalidScheduleError();
  }
  return {
    slug: context.slug.trim().toLowerCase(),
    title: requiredValue(data, "title"),
    description: stringValue(data, "description"),
    format: context.format,
    isFree: context.isFree,
    timezone,
    startsAt,
    endsAt,
    // У бесплатного мероприятия продаж нет: окно и резерв к нему не относятся, а оферта
    // гасится на сервере — здесь достаточно не присылать чужих значений.
    salesStartsAt: context.isFree ? null : nullableValue(data, "salesStartsAt"),
    salesEndsAt: context.isFree ? null : nullableValue(data, "salesEndsAt"),
    locationName: nullableValue(data, "locationName"),
    locationAddress: nullableValue(data, "locationAddress"),
    supportContact: nullableValue(data, "supportContact"),
    capacity: numberValue(data, "capacity"),
    reservationTtlMinutes: optionalNumberValue(data, "reservationTtlMinutes", 30),
    phoneRequiredForPurchase: context.isFree
      ? false
      : data.get("phoneRequiredForPurchase") === "on",
    offerRequired: context.isFree ? false : data.get("offerRequired") === "on"
  };
}

class InvalidScheduleError extends Error {
  constructor() {
    super("schedule");
    this.name = "InvalidScheduleError";
  }
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

/** Поле спрятано под «Дополнительно» и может не прийти вовсе — тогда берём умолчание. */
function optionalNumberValue(
  data: FormData,
  name: string,
  fallback: number
): number {
  const raw = stringValue(data, name);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : fallback;
}

function eventMutationMessage(error: unknown): string {
  if (error instanceof InvalidScheduleError) {
    return "Проверьте дату, время начала и длительность.";
  }
  if (error instanceof AdminApiError) {
    if (error.code === "ADMIN_EVENT_VERSION_CONFLICT") {
      return "Черновик уже изменен другим администратором. Обновите страницу.";
    }
    if (error.code === "ADMIN_EVENT_SLUG_CONFLICT") {
      return "Этот slug уже используется другим мероприятием. Измените его в разделе «Дополнительно».";
    }
    if (error.code === "ADMIN_EVENT_NOT_DRAFT") {
      return "Редактировать общие настройки можно только у черновика.";
    }
    if (error.status === 403) {
      return "У учетной записи нет разрешения events.write.";
    }
    return error.message;
  }
  return "Проверьте обязательные поля.";
}
