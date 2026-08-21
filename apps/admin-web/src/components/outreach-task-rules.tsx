"use client";

import {
  AdminApiError,
  createOutreachTaskRule,
  deleteOutreachTaskRule,
  updateOutreachTaskRule
} from "@/lib/admin-api";
import type {
  OutreachPipelineColumn,
  OutreachTaskRule,
  OutreachTaskTrigger,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";
import { Plus, Trash2 } from "lucide-react";
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
  },
  stage_entered: {
    label: "Карточка перешла в стадию",
    anchor: "считается от самого перехода"
  }
};

/** Поводы в том порядке, в каком их выбирают: сначала воронка, потом всё остальное. */
const TRIGGER_ORDER: readonly OutreachTaskTrigger[] = [
  "stage_entered",
  "site_registration",
  "no_answer",
  "event_upcoming",
  "attended",
  "no_show",
  "meeting_upcoming"
];

/**
 * Правила автозадач воронки.
 *
 * Повод берётся из списка того, что умеет автоматика: за каждым стоит свой запрос, и
 * придумать восьмой из кабинета нельзя. А вот сколько правил завести и на какие стадии —
 * решает менеджер: стадии он придумывает сам, значит и правила по ним тоже.
 *
 * Заявку с сайта время не настраивает: задача по ней встаёт в той же транзакции, что и
 * сама заявка, и её срок — ближайшее окно обзвона, а не сдвиг в днях.
 */
export function OutreachTaskRules({
  campaignId,
  rules,
  columns,
  busy,
  onSaved,
  onChanged,
  onError
}: {
  readonly campaignId: string;
  readonly rules: readonly OutreachTaskRule[];
  /** Стадии воронки: из них выбирают ту, переход в которую ставит задачу. */
  readonly columns: readonly OutreachPipelineColumn[];
  readonly busy: boolean;
  readonly onSaved: (rule: OutreachTaskRule) => void;
  /** Правил стало больше или меньше — список надо перечитать целиком. */
  readonly onChanged: (message: string) => Promise<void>;
  readonly onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="outreach-rules">
      {rules.length === 0 ? (
        <p className="muted person-empty">
          Правил у этой воронки нет: следующий шаг придётся ставить руками каждый раз.
        </p>
      ) : null}
      {rules.map((rule) => (
        <TaskRuleRow
          key={rule.id}
          rule={rule}
          busy={busy}
          onSaved={onSaved}
          onChanged={onChanged}
          onError={onError}
        />
      ))}
      {adding ? (
        <NewTaskRuleForm
          campaignId={campaignId}
          columns={columns}
          taken={rules}
          busy={busy}
          onClose={() => setAdding(false)}
          onCreated={async (message) => {
            setAdding(false);
            await onChanged(message);
          }}
          onError={onError}
        />
      ) : (
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          <Plus size={16} /> Добавить правило
        </button>
      )}
    </div>
  );
}

function formValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

/** Заголовок правила: у перехода по стадии он включает саму стадию. */
function ruleTitle(rule: OutreachTaskRule): string {
  const trigger = TRIGGERS[rule.trigger];
  if (rule.trigger !== "stage_entered") {
    return trigger.label;
  }
  return `${trigger.label}: ${rule.stageLabel ?? "стадия удалена"}`;
}

function TaskRuleRow({
  rule,
  busy,
  onSaved,
  onChanged,
  onError
}: {
  readonly rule: OutreachTaskRule;
  readonly busy: boolean;
  readonly onSaved: (rule: OutreachTaskRule) => void;
  readonly onChanged: (message: string) => Promise<void>;
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

  async function remove() {
    setSaving(true);
    try {
      await deleteOutreachTaskRule(rule.id);
      await onChanged("Правило снято.");
    } catch (caught) {
      onError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось снять правило.");
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
          <strong>{ruleTitle(rule)}</strong>
        </label>
        <span className="muted">{trigger.anchor}</span>
        <button
          className="icon-button"
          type="button"
          title="Снять правило"
          aria-label={`Снять правило «${ruleTitle(rule)}»`}
          disabled={busy || saving}
          onClick={() => void remove()}
        >
          <Trash2 size={16} />
        </button>
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

/**
 * Новое правило.
 *
 * Поводы, по которым правило уже есть, из списка убраны: два правила на один повод — это
 * две задачи на одно событие, и вторая отменяла бы первую. Для перехода по стадии повод
 * считается занятым только вместе со стадией: по каждой стадии своё правило.
 */
function NewTaskRuleForm({
  campaignId,
  columns,
  taken,
  busy,
  onClose,
  onCreated,
  onError
}: {
  readonly campaignId: string;
  readonly columns: readonly OutreachPipelineColumn[];
  readonly taken: readonly OutreachTaskRule[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCreated: (message: string) => Promise<void>;
  readonly onError: (message: string) => void;
}) {
  const freeStages = columns.filter((column) =>
    !taken.some((rule) =>
      rule.trigger === "stage_entered" && rule.stage === column.stage));
  const available = TRIGGER_ORDER.filter((trigger) =>
    trigger === "stage_entered"
      ? freeStages.length > 0
      : !taken.some((rule) => rule.trigger === trigger));
  const [trigger, setTrigger] = useState<OutreachTaskTrigger | "">(
    available[0] ?? ""
  );
  const [saving, setSaving] = useState(false);

  if (available.length === 0 || trigger === "") {
    return (
      <p className="muted person-empty">
        Правила заведены на все поводы, какие есть. Чтобы завести ещё одно по стадии,
        добавьте стадию в воронку.
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trigger === "") {
      return;
    }
    const data = new FormData(event.currentTarget);
    const text = formValue(data, "taskText").trim();
    const stage = formValue(data, "stage");
    if (!text) {
      return;
    }
    setSaving(true);
    try {
      const outcome = await createOutreachTaskRule(campaignId, {
        trigger,
        ...(trigger === "stage_entered" ? { stage } : {}),
        taskType: (formValue(data, "taskType") || "call") as OutreachTaskType,
        taskText: text,
        ...(trigger === "site_registration"
          ? {}
          : { offsetDays: Number(formValue(data, "offsetDays") || "0") })
      });
      if (outcome.status === "rejected") {
        onError(outcome.blocker === "duplicate"
          ? "Правило на этот повод уже есть."
          : "Выберите стадию воронки — без неё правило не сработает.");
        return;
      }
      await onCreated("Правило заведено.");
    } catch (caught) {
      onError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось завести правило.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="outreach-rule outreach-rule-new" onSubmit={(event) => void submit(event)}>
      <div className="outreach-rule-head">
        <strong>Новое правило</strong>
        <span className="muted">{TRIGGERS[trigger].anchor}</span>
      </div>
      <div className="outreach-rule-fields">
        <label>
          <span>Повод</span>
          <select
            value={trigger}
            onChange={(event) =>
              setTrigger(event.target.value as OutreachTaskTrigger)}
          >
            {available.map((value) => (
              <option key={value} value={value}>{TRIGGERS[value].label}</option>
            ))}
          </select>
        </label>
        {trigger === "stage_entered" ? (
          <label>
            <span>Стадия</span>
            <select name="stage" defaultValue={freeStages[0]?.stage ?? ""}>
              {freeStages.map((column) => (
                <option key={column.stage} value={column.stage}>{column.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        {trigger === "site_registration" ? null : (
          <label>
            <span>Сдвиг, дней</span>
            <input name="offsetDays" type="number" min={-30} max={30} defaultValue={0} />
          </label>
        )}
        <label>
          <span>Тип</span>
          <select name="taskType" defaultValue="call">
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
            placeholder="Например: позвонить и подтвердить участие"
            required
          />
        </label>
        <button className="primary-button" type="submit" disabled={busy || saving}>
          {saving ? "Заводим…" : "Завести"}
        </button>
        <button className="secondary-button" type="button" onClick={onClose}>
          Отмена
        </button>
      </div>
    </form>
  );
}
