"use client";

import {
  AdminApiError,
  completeOutreachTask,
  createOutreachPersonTask,
  createOutreachTask
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import type {
  OutreachTaskType,
  OutreachTaskUrgency
} from "@ticket-platform/contracts/admin-outreach";
import { CalendarClock, Check, X } from "lucide-react";
import { type FormEvent, useState } from "react";

/**
 * Задача, которой двигают срок.
 *
 * Здесь ровно то, что нужно, чтобы поставить её заново: отдельного «перенести срок» в API
 * нет, и перенос делается тем же способом, что и замена задачи из шторки контакта, — новая
 * задача встаёт на ту же линию работы, прежняя уходит в историю отменённой. Об этом диалог
 * и предупреждает: молча подменять запись в журнале нельзя.
 */
export interface ReschedulableTask {
  readonly id: string;
  readonly type: OutreachTaskType;
  readonly text: string;
  readonly dueAt: string;
  readonly assignedAdminId: string | null;
  /** Задача по кампании. Пусто — задача про человека вообще. */
  readonly campaignContactId: string | null;
  readonly contactId: string;
  readonly contactName: string | null;
}

const DAY_OFFSETS: Record<
  Exclude<OutreachTaskUrgency, "overdue" | "completed">,
  number
> = {
  today: 0,
  tomorrow: 1,
  this_week: 3,
  later: 10
};

/**
 * Куда встанет задача, если её бросили в колонку срочности.
 *
 * Время дня сохраняем: «перезвонить в 10:00» остаётся звонком на десять утра, просто в
 * другой день. Если так получается прошлое — берём ближайший целый час, иначе карточка
 * вернулась бы в «Просрочено» тем же движением, которым её оттуда унесли.
 */
export function suggestDueAt(
  urgency: Exclude<OutreachTaskUrgency, "overdue" | "completed">,
  currentDueAt: Date,
  now: Date = new Date()
): Date {
  const next = new Date(now);
  next.setDate(next.getDate() + DAY_OFFSETS[urgency]);
  next.setHours(currentDueAt.getHours(), currentDueAt.getMinutes(), 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setTime(now.getTime());
    next.setHours(next.getHours() + 1, 0, 0, 0);
  }
  return next;
}

export function OutreachTaskRescheduleDialog({
  task,
  suggestedDueAt,
  onClose,
  onDone
}: {
  readonly task: ReschedulableTask;
  /** Подставленный срок. Пусто — предложим завтра в то же время. */
  readonly suggestedDueAt: Date | null;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const dueAt = formText(data, "dueAt");
    const text = formText(data, "text").trim();
    const parsed = new Date(dueAt);
    if (Number.isNaN(parsed.getTime())) {
      setError("Срок не разобрать. Выберите дату и время.");
      return;
    }
    if (!text) {
      setError("Оставьте, что нужно сделать: по этой строке задачу и узнают в списке.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        type: task.type,
        text,
        dueAt: parsed.toISOString(),
        ...(task.assignedAdminId ? { assignedAdminId: task.assignedAdminId } : {})
      };
      await (task.campaignContactId
        ? createOutreachTask(task.campaignContactId, payload)
        : createOutreachPersonTask(task.contactId, payload));
      await onDone(`Срок перенесён на ${formatDateTime(parsed.toISOString())}.`);
    } catch (caught) {
      setError(messageFor(caught, "Не удалось перенести задачу."));
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await completeOutreachTask(task.id);
      await onDone("Задача отмечена выполненной.");
    } catch (caught) {
      setError(messageFor(caught, "Не удалось отметить задачу выполненной."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="outreach-modal-backdrop" role="presentation">
      <section
        className="outreach-modal outreach-small-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reschedule-title"
      >
        <div className="section-title-row">
          <div>
            <h2 id="reschedule-title">Перенести задачу</h2>
            <span>{task.contactName ?? "Без имени"}</span>
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

        {error ? <div className="page-warning">{error}</div> : null}

        <div className="outreach-task-create reschedule-form">
          <p className="muted">
            Сейчас срок — {formatDateTime(task.dueAt)}. Прежняя задача уйдёт в историю
            отменённой, а новая встанет на её место: открытая задача на линии работы одна.
          </p>
          <form onSubmit={(event) => void reschedule(event)}>
            <label>
              <span>Новый срок</span>
              <input
                name="dueAt"
                type="datetime-local"
                required
                autoFocus
                defaultValue={toDateTimeInput(
                  suggestedDueAt ?? suggestDueAt("tomorrow", new Date(task.dueAt))
                )}
              />
            </label>
            <label className="outreach-task-text">
              <span>Что сделать</span>
              <input name="text" maxLength={500} required defaultValue={task.text} />
            </label>
            <div className="reschedule-actions">
              <button className="primary-button" type="submit" disabled={busy}>
                <CalendarClock size={16} />
                {busy ? "Переносим…" : "Перенести"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => void complete()}
              >
                <Check size={16} />
                Уже сделано
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function toDateTimeInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function messageFor(caught: unknown, fallback: string): string {
  return caught instanceof AdminApiError ? caught.message : fallback;
}
