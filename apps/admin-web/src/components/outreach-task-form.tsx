"use client";

import {
  AdminApiError,
  createOutreachPersonTask,
  createOutreachTask
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import type {
  OutreachManager,
  OutreachTask,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";
import { type FormEvent, useState } from "react";

/**
 * К чему привязать задачу.
 *
 * Внутри кампании она встаёт в её воронку и наследует ответственного из строки участия.
 * Без кампании — относится к человеку целиком: так её можно поставить и тому, кто ни в
 * одной кампании не состоит.
 */
export type OutreachTaskTarget =
  | { readonly kind: "campaign"; readonly campaignContactId: string }
  | { readonly kind: "person"; readonly contactId: string };

/**
 * Постановка следующего шага по контакту.
 *
 * Форма, а не диалог: в кампании она раскрывается прямо в шторке контакта, на доске задач и
 * в карточке клиента её оборачивают в модалку. Общее у всех мест одно — открытая задача на
 * этой линии работы может быть только одна, и новая молча отменяет прежнюю. Об этом здесь и
 * предупреждаем.
 */
export function OutreachTaskForm({
  target,
  openTask,
  managers,
  defaultAssignedAdminId,
  onSaved
}: {
  readonly target: OutreachTaskTarget;
  readonly openTask: OutreachTask | null;
  readonly managers: readonly OutreachManager[];
  readonly defaultAssignedAdminId: string | null;
  readonly onSaved: () => void | Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const dueAt = text(data, "dueAt");
    const assignedAdminId = text(data, "assignedAdminId");
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        type: text(data, "type") as OutreachTaskType,
        text: text(data, "text"),
        dueAt: new Date(dueAt).toISOString(),
        ...(assignedAdminId ? { assignedAdminId } : {})
      };
      await (target.kind === "campaign"
        ? createOutreachTask(target.campaignContactId, payload)
        : createOutreachPersonTask(target.contactId, payload));
      form.reset();
      await onSaved();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось поставить задачу.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      {openTask ? (
        <p className="page-warning">
          {target.kind === "campaign"
            ? "Открытая задача по этой кампании уже есть"
            : "Открытая задача по человеку уже есть"}
          : «{openTask.text}» на {formatDateTime(openTask.dueAt)}.
          Новая её заменит — прежняя уйдёт в историю как отменённая.
        </p>
      ) : null}
      {error ? <p className="page-warning">{error}</p> : null}
      <label>
        <span>Тип</span>
        <select name="type" defaultValue="call">
          <option value="call">Позвонить</option>
          <option value="message">Написать</option>
          <option value="other">Другое</option>
        </select>
      </label>
      <label>
        <span>Срок</span>
        <input
          name="dueAt"
          type="datetime-local"
          required
          defaultValue={defaultDueAt()}
        />
      </label>
      <label className="outreach-task-text">
        <span>Что сделать</span>
        <input
          name="text"
          maxLength={500}
          required
          defaultValue="Связаться с клиентом"
        />
      </label>
      <label className="outreach-task-text">
        <span>Ответственный</span>
        <select name="assignedAdminId" defaultValue={defaultAssignedAdminId ?? ""}>
          <option value="">Текущий менеджер</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>{manager.displayName}</option>
          ))}
        </select>
      </label>
      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? "Сохраняем…" : "Сохранить задачу"}
      </button>
    </form>
  );
}

/**
 * Завтра в десять утра. Пустое поле означало, что срок набивают руками при каждой задаче, а
 * набивают его чаще всего именно так.
 */
function defaultDueAt(): string {
  const due = new Date();
  due.setDate(due.getDate() + 1);
  due.setHours(10, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`
    + `T${pad(due.getHours())}:${pad(due.getMinutes())}`;
}

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
