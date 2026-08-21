"use client";

import type {
  OutreachManager,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";
import { X } from "lucide-react";
import { type FormEvent, useState } from "react";

export interface OutreachNextStepValue {
  readonly type: OutreachTaskType;
  readonly text: string;
  readonly dueAt: string;
  readonly assignedAdminId?: string;
}

/**
 * Следующий шаг, без которого воронка не отпускает карточку.
 *
 * Диалог, а не форма на месте: спрашивают его в момент, когда менеджер уже сделал другое
 * действие — двинул карточку или записал разговор, — и это действие ждёт ответа. Оно и
 * задача сохраняются вместе: иначе между ними карточка успевала бы побывать в состоянии,
 * которое воронка запрещает, и запрет обходился бы закрытой вкладкой.
 */
export function OutreachNextStepDialog({
  title,
  hint,
  managers,
  defaultAssignedAdminId,
  busy,
  onClose,
  onSubmit
}: {
  readonly title: string;
  readonly hint: string;
  readonly managers: readonly OutreachManager[];
  readonly defaultAssignedAdminId: string | null;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (value: OutreachNextStepValue) => void;
}) {
  const [type, setType] = useState<OutreachTaskType>("call");
  const [text, setText] = useState("Связаться с клиентом");
  const [dueAt, setDueAt] = useState(defaultDueAt);
  const [assignedAdminId, setAssignedAdminId] = useState(
    defaultAssignedAdminId ?? ""
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim() || !dueAt) {
      return;
    }
    onSubmit({
      type,
      text: text.trim(),
      dueAt: new Date(dueAt).toISOString(),
      ...(assignedAdminId ? { assignedAdminId } : {})
    });
  }

  return (
    <div className="outreach-modal-backdrop" role="presentation">
      <section
        className="outreach-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="next-step-title"
      >
        <div className="section-title-row">
          <div>
            <h2 id="next-step-title">{title}</h2>
            <span>{hint}</span>
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
        <form className="outreach-action-form" onSubmit={submit}>
          <label>
            <span>Тип</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as OutreachTaskType)}
            >
              <option value="call">Позвонить</option>
              <option value="message">Написать</option>
              <option value="other">Другое</option>
            </select>
          </label>
          <label>
            <span>Срок</span>
            <input
              type="datetime-local"
              value={dueAt}
              required
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
          <label className="outreach-task-text">
            <span>Что сделать</span>
            <input
              value={text}
              maxLength={500}
              required
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="outreach-task-text">
            <span>Ответственный</span>
            <select
              value={assignedAdminId}
              onChange={(event) => setAssignedAdminId(event.target.value)}
            >
              <option value="">Текущий менеджер</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.displayName}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить и продолжить"}
          </button>
        </form>
      </section>
    </div>
  );
}

/** Завтра в десять утра — так срок ставят чаще всего. */
function defaultDueAt(): string {
  const due = new Date();
  due.setDate(due.getDate() + 1);
  due.setHours(10, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`
    + `T${pad(due.getHours())}:${pad(due.getMinutes())}`;
}
