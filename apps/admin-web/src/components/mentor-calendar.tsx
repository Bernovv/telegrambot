"use client";

import {
  AdminApiError,
  cancelMentorSlot,
  createMentorSlots,
  listMentorSlots,
  releaseMentorSlot
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import type { MentorSlot, StaffMember } from "@ticket-platform/contracts/admin-staff";
import { CalendarPlus, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

/**
 * Календарь наставника.
 *
 * Окошко — это час, в который наставник готов провести личную встречу. Смысл его в том,
 * что менеджер выбирает время не «на глаз», а из того, что действительно свободно: до
 * этого встречи назначали в карточке любым временем, и совпадения выяснялись у наставника.
 *
 * Заводятся окошки пачкой — расписание на месяц руками это тридцать одинаковых форм.
 */
const WEEKDAYS = [
  { value: 1, label: "Пн" },
  { value: 2, label: "Вт" },
  { value: 3, label: "Ср" },
  { value: 4, label: "Чт" },
  { value: 5, label: "Пт" },
  { value: 6, label: "Сб" },
  { value: 7, label: "Вс" }
] as const;

/** FormData отдаёт `File | string | null`: к строке приводим явно, а не через шаблон. */
function formValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

export function MentorCalendar({
  mentors,
  canManageSlots,
  canBookSlots,
  viewerAdminId,
  onNotice,
  onError
}: {
  readonly mentors: readonly StaffMember[];
  readonly canManageSlots: boolean;
  readonly canBookSlots: boolean;
  readonly viewerAdminId: string;
  readonly onNotice: (message: string) => void;
  readonly onError: (message: string) => void;
}) {
  // Свой календарь наставник открывает первым: девять раз из десяти он пришёл сюда
  // именно за ним.
  const own = mentors.some((mentor) => mentor.adminId === viewerAdminId)
    ? viewerAdminId
    : mentors[0]?.adminId ?? "";
  const [mentorId, setMentorId] = useState(own);
  const [slots, setSlots] = useState<readonly MentorSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!mentorId) {
      setSlots([]);
      return;
    }
    setLoading(true);
    try {
      setSlots(await listMentorSlots({ mentorAdminId: mentorId }, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        onError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить окошки.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [mentorId, onError]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    setMentorId((current) => (current === "" ? own : current));
  }, [own]);

  async function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const hours = formValue(data, "hours")
      .split(/[,\s]+/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23);
    const weekdays = WEEKDAYS
      .map((day) => day.value)
      .filter((value) => data.get(`weekday-${value}`) === "on");
    if (hours.length === 0 || weekdays.length === 0) {
      onError("Укажите дни недели и часы — иначе заводить нечего.");
      return;
    }
    setBusy(true);
    try {
      const result = await createMentorSlots({
        mentorAdminId: mentorId,
        fromDate: formValue(data, "fromDate"),
        toDate: formValue(data, "toDate"),
        weekdays,
        hours,
        durationMinutes: Number(data.get("durationMinutes") ?? 60)
      });
      onNotice(result.skipped > 0
        ? `Окошек заведено: ${result.created}. Уже были: ${result.skipped}.`
        : `Окошек заведено: ${result.created}.`);
      setFormOpen(false);
      await load();
    } catch (caught) {
      onError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось завести окошки.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSlot(slot: MentorSlot) {
    setBusy(true);
    try {
      await cancelMentorSlot(slot.id);
      onNotice("Окошко убрано.");
      await load();
    } catch (caught) {
      onError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось убрать окошко.");
    } finally {
      setBusy(false);
    }
  }

  async function freeSlot(slot: MentorSlot) {
    setBusy(true);
    try {
      await releaseMentorSlot(slot.id);
      onNotice("Запись снята, окошко снова свободно.");
      await load();
    } catch (caught) {
      onError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось освободить окошко.");
    } finally {
      setBusy(false);
    }
  }

  if (mentors.length === 0) {
    return (
      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Окошки наставников</h2>
            <span>Расписание личных встреч.</span>
          </div>
        </div>
        <p className="muted person-empty">
          Наставников пока нет. Отметьте роль «наставник» — и здесь появится его календарь.
        </p>
      </section>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="data-section mentor-calendar">
      <div className="section-title-row">
        <div>
          <h2>Окошки наставников</h2>
          <span>
            Свободные окошки менеджер выбирает в карточке клиента — назначать время мимо
            календаря больше не нужно.
          </span>
        </div>
        <label className="select-field">
          <span>Наставник</span>
          <select
            value={mentorId}
            disabled={busy}
            onChange={(event) => setMentorId(event.target.value)}
          >
            {mentors.map((mentor) => (
              <option key={mentor.adminId} value={mentor.adminId}>
                {mentor.displayName}
              </option>
            ))}
          </select>
        </label>
        {canManageSlots ? (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => setFormOpen((current) => !current)}
          >
            <CalendarPlus size={16} />
            {formOpen ? "Не заводить" : "Завести окошки"}
          </button>
        ) : null}
      </div>

      {formOpen && canManageSlots ? (
        <form className="mentor-slot-form" onSubmit={(event) => void submitSchedule(event)}>
          <label>
            <span>С какого дня</span>
            <input name="fromDate" type="date" defaultValue={today} required />
          </label>
          <label>
            <span>По какой</span>
            <input name="toDate" type="date" defaultValue={today} required />
          </label>
          <fieldset className="mentor-weekdays">
            <legend>Дни недели</legend>
            {WEEKDAYS.map((day) => (
              <label key={day.value}>
                <input type="checkbox" name={`weekday-${day.value}`} />
                <span>{day.label}</span>
              </label>
            ))}
          </fieldset>
          <label>
            <span>Часы начала, через запятую</span>
            <input name="hours" placeholder="12, 15, 18" required />
          </label>
          <label>
            <span>Длительность, минут</span>
            <input
              name="durationMinutes"
              type="number"
              min={15}
              max={480}
              step={15}
              defaultValue={60}
            />
          </label>
          <p className="muted">
            Время московское. Окошко, которое уже заведено на этот час, не задваивается.
          </p>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Заводим…" : "Завести окошки"}
          </button>
        </form>
      ) : null}

      {loading && slots.length === 0 ? (
        <p className="muted person-empty">Загружаем расписание…</p>
      ) : null}
      {!loading && slots.length === 0 ? (
        <p className="muted person-empty">
          Впереди свободных окошек нет. Пока их не заведут, менеджер не сможет назначить
          встречу с этим наставником.
        </p>
      ) : null}

      {slots.length > 0 ? (
        <ul className="person-list mentor-slot-list">
          {slots.map((slot) => (
            <li key={slot.id}>
              <div className="person-list-main">
                <strong>{formatDateTime(slot.startsAt)}</strong>
                <span className="person-list-sub">
                  {slot.durationMinutes} мин
                  {slot.contactId ? " · занято" : " · свободно"}
                  {slot.contactId ? (
                    <>
                      {" · "}
                      <Link href={`/base/${slot.contactId}`}>
                        {slot.contactName ?? "клиент"}
                      </Link>
                      {slot.bookedByName ? ` · записал ${slot.bookedByName}` : ""}
                    </>
                  ) : null}
                  {slot.note ? ` · ${slot.note}` : ""}
                </span>
              </div>
              <div className="person-list-side">
                {slot.contactId && canBookSlots ? (
                  <button
                    className="icon-button"
                    type="button"
                    title="Снять запись"
                    aria-label={`Снять запись на ${formatDateTime(slot.startsAt)}`}
                    disabled={busy}
                    onClick={() => void freeSlot(slot)}
                  >
                    <Undo2 size={16} />
                  </button>
                ) : null}
                {!slot.contactId && canManageSlots ? (
                  <button
                    className="icon-button"
                    type="button"
                    title="Убрать окошко"
                    aria-label={`Убрать окошко ${formatDateTime(slot.startsAt)}`}
                    disabled={busy}
                    onClick={() => void removeSlot(slot)}
                  >
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
