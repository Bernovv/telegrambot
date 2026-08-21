"use client";

import { AdminApiError, updateOutreachTaskRule } from "@/lib/admin-api";
import type {
  OutreachTaskRule,
  OutreachTaskTrigger,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";
import { type FormEvent, useState } from "react";

/**
 * Что означает повод и от чего считается сдвиг.
 *
 * Подпись здесь важнее обычного: «за день до» и «на следующий день» — это разные знаки у
 * одного числа, и без объяснения, от чего именно день, менеджер поставит его наугад.
 */
const TRIGGERS: Record<
  OutreachTaskTrigger,
  { readonly label: string; readonly anchor: string }
> = {
  site_registration: {
    label: "Заявка с сайта",
    anchor: "сразу после заявки, в ближайшее окно обзвона"
  },
  no_answer: {
    label: "Не дозвонились",
    anchor: "считается от звонка, на котором не ответили"
  },
  event_upcoming: {
    label: "Скоро мероприятие",
    anchor: "считается от начала мероприятия"
  },
  attended: {
    label: "Дошёл до мероприятия",
    anchor: "считается от окончания мероприятия"
  },
  no_show: {
    label: "Не дошёл",
    anchor: "считается от окончания мероприятия"
  },
  meeting_upcoming: {
    label: "Назначена личная встреча",
    anchor: "считается от времени встречи"
  }
};

/**
 * Правила автозадач воронки.
 *
 * Заводит их миграция, а кабинет включает, выключает и переписывает: набор поводов — это
 * то, что умеет автоматика, а не то, что придумывает менеджер. Заявку с сайта время не
 * настраивает: задача по ней встаёт в той же транзакции, что и сама заявка, и её срок —
 * это ближайшее окно обзвона, а не сдвиг в днях.
 */
export function OutreachTaskRules({
  rules,
  busy,
  onSaved,
  onError
}: {
  readonly rules: readonly OutreachTaskRule[];
  readonly busy: boolean;
  readonly onSaved: (rule: OutreachTaskRule) => void;
  readonly onError: (message: string) => void;
}) {
  if (rules.length === 0) {
    return (
      <p className="muted person-empty">
        Правил у этой воронки нет. Их заводят миграцией — здесь их включают и правят.
      </p>
    );
  }
  return (
    <div className="outreach-rules">
      {rules.map((rule) => (
        <TaskRuleRow
          key={rule.id}
          rule={rule}
          busy={busy}
          onSaved={onSaved}
          onError={onError}
        />
      ))}
    </div>
  );
}

function formValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function TaskRuleRow({
  rule,
  busy,
  onSaved,
  onError
}: {
  readonly rule: OutreachTaskRule;
  readonly busy: boolean;
  readonly onSaved: (rule: OutreachTaskRule) => void;
  readonly onError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const trigger = TRIGGERS[rule.trigger];
  const timed = rule.trigger !== "site_registration";

  async function save(changes: Parameters<typeof updateOutreachTaskRule>[1]) {
    setSaving(true);
    try {
      onSaved(await updateOutreachTaskRule(rule.id, changes));
    } catch (caught) {
      onError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось сохранить правило.");
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = formValue(data, "taskText").trim();
    if (!text) {
      return;
    }
    void save({
      taskText: text,
      taskType: (formValue(data, "taskType") || "call") as OutreachTaskType,
      ...(timed ? { offsetDays: Number(formValue(data, "offsetDays")) } : {})
    });
  }

  return (
    <form className="outreach-rule" onSubmit={submit}>
      <div className="outreach-rule-head">
        <label className="outreach-rule-toggle">
          <input
            type="checkbox"
            checked={rule.isEnabled}
            disabled={busy || saving}
            onChange={(event) => void save({ isEnabled: event.target.checked })}
          />
          <strong>{trigger.label}</strong>
        </label>
        <span className="muted">{trigger.anchor}</span>
      </div>
      <div className="outreach-rule-fields">
        {timed ? (
          <label>
            <span>Сдвиг, дней</span>
            <input
              name="offsetDays"
              type="number"
              min={-30}
              max={30}
              defaultValue={rule.offsetDays}
              disabled={!rule.isEnabled}
            />
          </label>
        ) : null}
        <label>
          <span>Тип</span>
          <select
            name="taskType"
            defaultValue={rule.taskType}
            disabled={!rule.isEnabled}
          >
            <option value="call">Позвонить</option>
            <option value="message">Написать</option>
            <option value="other">Другое</option>
          </select>
        </label>
        <label className="outreach-rule-text">
          <span>Что сделать</span>
          <input
            name="taskText"
            maxLength={500}
            defaultValue={rule.taskText}
            disabled={!rule.isEnabled}
            required
          />
        </label>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || saving || !rule.isEnabled}
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}
