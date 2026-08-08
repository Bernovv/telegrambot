"use client";

import { useEventWorkspace } from "@/components/event-workspace";
import { PageError, PageLoading } from "@/components/page-state";
import { QuestionnaireEntry } from "@/components/questionnaire-entry";
import {
  AdminApiError,
  addEventParticipantField,
  getEventParticipants,
  removeEventParticipantField
} from "@/lib/admin-api";
import type { EventParticipantFieldType } from "@ticket-platform/contracts/admin-accommodation";
import type { EventParticipantsView } from "@ticket-platform/contracts/admin-participants";
import { ClipboardList, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function EventQuestionnairePage() {
  const { event } = useEventWorkspace();
  const [view, setView] = useState<EventParticipantsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [fieldType, setFieldType] = useState<EventParticipantFieldType>("text");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setView(await getEventParticipants(event.id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить анкеты.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [event.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function run(work: () => Promise<unknown>) {
    setMutating(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось сохранить изменение.");
    } finally {
      setMutating(false);
    }
  }

  async function addField(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    // FormData отдаёт string | File; поля здесь всегда текстовые, но тип этого не знает.
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const label = text("label").trim();
    const scope = text("scope") === "global" ? "global" : "event";
    const options = text("options")
      .split(",")
      .map((option) => option.trim())
      .filter((option) => option !== "");

    await run(() => addEventParticipantField(event.id, {
      label,
      type: fieldType,
      scope,
      ...(fieldType === "select" ? { options } : {})
    }));
    form.reset();
    setFieldType("text");
    setAddOpen(false);
  }

  if (loading && !view) {
    return <PageLoading label="Открываем анкеты" />;
  }
  if (error && !view) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!view) {
    return <PageError message="Анкеты недоступны." retry={() => void load()} />;
  }

  const { answered, people } = view.questionnaire;
  const missing = view.rows.filter(
    (row) => !row.customFields.some((f) => f.value !== null && f.value !== "")
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Анкеты</p>
          <h1>Что ответили участники</h1>
          <p>
            Анкеты раздаются на мероприятии на бумаге, сюда переносятся руками.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button bordered"
            type="button"
            title="Обновить"
            aria-label="Обновить"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {error ? <PageError message={error} retry={() => void load()} /> : null}

      <div className="metrics-strip">
        <div>
          <span>Внесено анкет</span>
          <strong>{answered} / {people}</strong>
          <div
            className="capacity-track"
            role="progressbar"
            aria-label="Доля внесённых анкет"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={people > 0 ? Math.round((answered / people) * 100) : 0}
          >
            <span
              style={{ width: `${people > 0 ? Math.round((answered / people) * 100) : 0}%` }}
            />
          </div>
        </div>
        <div>
          <span>Вопросов в анкете</span>
          <strong>{view.fields.length}</strong>
          <small className="muted">общий набор на всех участников</small>
        </div>
        <div>
          <span>Ещё не внесены</span>
          <strong>{missing.length}</strong>
          <small className="muted">
            {missing.length === 0 ? "все на месте" : "видно в списке ниже"}
          </small>
        </div>
      </div>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Вопросы</h2>
            <span>
              {view.fields.length === 0
                ? "ни одного вопроса не задано"
                : `${view.fields.length} в анкете`}
            </span>
          </div>
          {view.canManageParticipants ? (
            <div className="outreach-toolbar-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={mutating}
                onClick={() => setAddOpen((current) => !current)}
              >
                {addOpen ? <X size={16} /> : <Plus size={16} />}
                {addOpen ? "Отменить" : "Добавить вопрос"}
              </button>
            </div>
          ) : null}
        </div>

        {addOpen ? (
          <form className="participant-form" onSubmit={(e) => void addField(e)}>
            <label className="field field-full">
              <span>Вопрос</span>
              <input name="label" required maxLength={80} autoFocus placeholder="Из какого вы города?" />
            </label>
            <label className="field">
              <span>Тип ответа</span>
              <select
                name="type"
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value as EventParticipantFieldType)}
              >
                <option value="text">Текст</option>
                <option value="number">Число</option>
                <option value="date">Дата</option>
                <option value="select">Выбор из списка</option>
              </select>
            </label>
            <label className="field">
              <span>Где спрашиваем</span>
              <select name="scope" defaultValue="event">
                <option value="event">Только на этом мероприятии</option>
                <option value="global">На всех мероприятиях</option>
              </select>
            </label>
            {fieldType === "select" ? (
              <label className="field field-full">
                <span>Варианты через запятую</span>
                <input name="options" required placeholder="Да, Нет, Пока думаю" />
              </label>
            ) : null}
            <button className="primary-button" type="submit" disabled={mutating}>
              Добавить
            </button>
          </form>
        ) : null}

        {view.fields.length === 0 ? (
          <div className="outreach-empty">
            <strong>Вопросов пока нет</strong>
            <span>
              Заведите те же вопросы, что напечатаны на бумажной анкете — тогда ответы
              будет куда переносить.
            </span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Вопрос</th>
                  <th>Тип ответа</th>
                  <th>Где спрашиваем</th>
                  <th>{view.canManageParticipants ? "Действия" : ""}</th>
                </tr>
              </thead>
              <tbody>
                {view.fields.map((field) => (
                  <tr key={field.id}>
                    <td><strong>{field.label}</strong></td>
                    <td>
                      {typeLabel(field.type)}
                      {field.options ? (
                        <span className="muted"> · {field.options.join(", ")}</span>
                      ) : null}
                    </td>
                    <td>{field.global ? "На всех" : "Только здесь"}</td>
                    <td>
                      {view.canManageParticipants ? (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={mutating}
                          onClick={() => {
                            const sure = window.confirm(
                              `Убрать вопрос «${field.label}»? Ответы на него тоже пропадут.`
                            );
                            if (sure) {
                              void run(() => removeEventParticipantField({
                                eventId: event.id,
                                fieldId: field.id
                              }));
                            }
                          }}
                        >
                          <Trash2 size={15} />
                          Убрать
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {view.fields.length > 0 && view.canManageParticipants ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Внести анкеты</h2>
              <span>по одному человеку, стопкой</span>
            </div>
          </div>
          <QuestionnaireEntry
            eventId={event.id}
            rows={view.rows}
            fields={view.fields}
            onSaved={() => load()}
          />
        </section>
      ) : null}

      {missing.length > 0 && view.fields.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Ещё не внесены</h2>
              <span>{missing.length} человек</span>
            </div>
          </div>
          <div className="questionnaire-missing">
            {missing.map((row) => (
              <span key={row.key}>
                <ClipboardList size={13} aria-hidden="true" />
                {row.displayName}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function typeLabel(type: EventParticipantFieldType): string {
  switch (type) {
    case "number":
      return "Число";
    case "date":
      return "Дата";
    case "select":
      return "Выбор";
    default:
      return "Текст";
  }
}
