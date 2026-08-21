"use client";

import type { PersonTouchHandler } from "@/components/person-card";
import type {
  OutreachManager,
  OutreachPersonCard,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";
import { CalendarClock, PhoneCall, StickyNote } from "lucide-react";
import { type FormEvent, useState } from "react";

/**
 * Одно поле внизу ленты вместо трёх разных мест.
 *
 * Раньше заметку писали в одной карточке, задачу ставили модалкой из шапки, а касание —
 * другой модалкой, и менеджеру приходилось сначала решить, каким из трёх способов записать
 * то, что только что произошло. Здесь он просто пишет, а потом говорит, чем это было.
 *
 * Касание — единственный режим, который открывает разбор отдельным окном: у него есть канал,
 * результат и стадия воронки, и повторять эту логику здесь значило бы завести ей второе
 * место жизни. Написанный текст при этом не теряется — он уезжает в окно заметкой.
 */
export function PersonComposer({
  person,
  managers,
  busy,
  onSaveNote,
  onCreateTask,
  onTouch
}: {
  readonly person: OutreachPersonCard;
  readonly managers: readonly OutreachManager[];
  readonly busy: boolean;
  readonly onSaveNote: (body: string) => Promise<boolean>;
  readonly onCreateTask: (input: {
    readonly type: string;
    readonly text: string;
    readonly dueAt: Date;
    readonly assignedAdminId: string | null;
  }) => Promise<boolean>;
  readonly onTouch: PersonTouchHandler | null;
}) {
  const active = person.campaigns.filter((item) => !item.removedAt);
  const [mode, setMode] = useState<"note" | "task" | "touch">("note");
  const [draft, setDraft] = useState("");
  const [type, setType] = useState<OutreachTaskType>("call");
  const [dueAt, setDueAt] = useState(defaultDueAt);
  const [assignedAdminId, setAssignedAdminId] = useState("");
  const [campaignId, setCampaignId] = useState(active[0]?.campaignContactId ?? "");

  const canTouch = onTouch !== null && active.length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (mode === "note") {
      if (body && await onSaveNote(body)) {
        setDraft("");
      }
      return;
    }
    if (mode === "task") {
      const when = new Date(dueAt);
      if (!body || Number.isNaN(when.getTime())) {
        return;
      }
      if (await onCreateTask({
        type,
        text: body,
        dueAt: when,
        assignedAdminId: assignedAdminId || null
      })) {
        setDraft("");
        setDueAt(defaultDueAt());
      }
      return;
    }
    const campaign = active.find(
      (item) => item.campaignContactId === campaignId
    ) ?? active[0];
    if (campaign && onTouch) {
      onTouch(campaign, body, null);
      setDraft("");
    }
  }

  return (
    <form className="person-composer" onSubmit={(event) => void submit(event)}>
      <div className="person-composer-modes" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "note"}
          className={mode === "note" ? "person-mode person-mode-active" : "person-mode"}
          onClick={() => setMode("note")}
        >
          <StickyNote size={15} />
          Заметка
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "task"}
          className={mode === "task" ? "person-mode person-mode-active" : "person-mode"}
          onClick={() => setMode("task")}
        >
          <CalendarClock size={15} />
          Задача
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "touch"}
          className={mode === "touch" ? "person-mode person-mode-active" : "person-mode"}
          disabled={!canTouch}
          title={canTouch
            ? undefined
            : "Касание записывается по воронке, а человек сейчас ни в одной не состоит"}
          onClick={() => setMode("touch")}
        >
          <PhoneCall size={15} />
          Касание
        </button>
      </div>

      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={2}
        maxLength={4000}
        placeholder={mode === "task"
          ? "Что сделать. Например: позвонить, уточнить, идёт ли с женой"
          : mode === "touch"
            ? "О чём говорили — уедет в разбор касания"
            : "Например: просил не звонить до сентября, едет с женой"}
      />

      {mode === "task" ? (
        <div className="person-composer-row">
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
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
          <label>
            <span>Ответственный</span>
            <select
              value={assignedAdminId}
              onChange={(event) => setAssignedAdminId(event.target.value)}
            >
              <option value="">Ответственный за человека</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.displayName}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {mode === "touch" && active.length > 1 ? (
        <div className="person-composer-row">
          <label>
            <span>По какой воронке</span>
            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
            >
              {active.map((membership) => (
                <option
                  key={membership.campaignContactId}
                  value={membership.campaignContactId}
                >
                  {membership.campaignName}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="person-composer-actions">
        {mode === "task" ? (
          <span className="muted">
            Новая задача заменит открытую по этой линии работы — прежняя уйдёт в историю.
          </span>
        ) : <span />}
        <button
          className="primary-button"
          type="submit"
          disabled={busy || (mode !== "touch" && draft.trim().length === 0)}
        >
          {mode === "note" ? "Записать" : mode === "task" ? "Поставить задачу" : "Разобрать касание"}
        </button>
      </div>
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
