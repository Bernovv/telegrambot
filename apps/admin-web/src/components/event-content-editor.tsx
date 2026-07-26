"use client";

import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  createEventContentBlock,
  updateEventContentBlock
} from "@/lib/admin-api";
import {
  ADMIN_EVENT_CONTENT_BLOCK_TYPES,
  type AdminEventContentBlock,
  type AdminEventContentBlockInput,
  type AdminEventContentBlockType,
  type AdminEventDetail
} from "@ticket-platform/contracts/admin-events";
import { Pencil, Plus, Save, X } from "lucide-react";
import { type FormEvent, useState } from "react";

const CONTENT_BLOCK_LABELS: Record<AdminEventContentBlockType, string> = {
  hero: "Первый экран",
  description: "Описание",
  program: "Программа",
  faq: "Вопросы и ответы",
  contacts: "Контакты",
  media: "Медиа",
  custom: "Произвольный"
};

export function EventContentEditor({
  event,
  reload
}: {
  readonly event: AdminEventDetail;
  readonly reload: () => Promise<void>;
}) {
  const [editor, setEditor] = useState<AdminEventContentBlock | "new" | null>(
    null
  );

  async function saved() {
    await reload();
    setEditor(null);
  }

  return (
    <>
      {editor ? (
        <ContentBlockForm
          event={event}
          block={editor === "new" ? null : editor}
          cancel={() => setEditor(null)}
          saved={saved}
        />
      ) : null}

      <section className="detail-section content-editor-section">
        <div className="section-title-row">
          <div>
            <h2>Контентные блоки</h2>
            <span>{event.contentBlocks.length} в черновике</span>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditor("new")}
          >
            <Plus size={16} />
            Добавить блок
          </button>
        </div>

        {event.contentBlocks.length === 0 ? (
          <p className="section-empty">Контентные блоки пока не добавлены.</p>
        ) : (
          <div className="content-editor-list">
            {event.contentBlocks.map((block) => (
              <article className="content-editor-item" key={block.id}>
                <div className="content-editor-heading">
                  <div>
                    <div className="title-with-status">
                      <h3>
                        {block.title ?? CONTENT_BLOCK_LABELS[block.blockType]}
                      </h3>
                      <StatusPill tone={block.isVisible ? "positive" : "neutral"}>
                        {block.isVisible ? "Показывается" : "Скрыт"}
                      </StatusPill>
                    </div>
                    <span>
                      Позиция {block.sortOrder} ·{" "}
                      {CONTENT_BLOCK_LABELS[block.blockType]} · схема{" "}
                      {block.contentSchemaVersion}
                    </span>
                  </div>
                  <button
                    className="icon-button bordered"
                    type="button"
                    title="Редактировать блок"
                    aria-label={`Редактировать блок ${block.title ?? CONTENT_BLOCK_LABELS[block.blockType]}`}
                    onClick={() => setEditor(block)}
                  >
                    <Pencil size={16} />
                  </button>
                </div>
                <pre className="content-json-preview">
                  {JSON.stringify(block.content, null, 2)}
                </pre>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ContentBlockForm({
  event,
  block,
  cancel,
  saved
}: {
  readonly event: AdminEventDetail;
  readonly block: AdminEventContentBlock | null;
  readonly cancel: () => void;
  readonly saved: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = new FormData(formEvent.currentTarget);
      const request = {
        expectedLockVersion: event.lockVersion,
        reason: requiredValue(data, "reason"),
        contentBlock: readContentBlock(data)
      };
      if (block) {
        await updateEventContentBlock(event.id, block.id, request);
      } else {
        await createEventContentBlock(event.id, request);
      }
      await saved();
    } catch (caught) {
      setError(contentMutationMessage(caught));
      setSubmitting(false);
    }
  }

  const nextSortOrder = event.contentBlocks.reduce(
    (maximum, item) => Math.max(maximum, item.sortOrder + 1),
    0
  );

  return (
    <form
      className="event-form-section catalog-form"
      onSubmit={(formEvent) => void submit(formEvent)}
    >
      <div className="section-title-row">
        <div>
          <h2>{block ? "Редактирование блока" : "Новый контентный блок"}</h2>
          <span>Версия мероприятия {event.lockVersion}</span>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Закрыть"
          aria-label="Закрыть"
          onClick={cancel}
        >
          <X size={18} />
        </button>
      </div>
      <div className="event-form-grid">
        <label className="field">
          <span>Тип блока</span>
          <select
            name="blockType"
            defaultValue={block?.blockType ?? "description"}
          >
            {ADMIN_EVENT_CONTENT_BLOCK_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONTENT_BLOCK_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Позиция</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            required
            defaultValue={block?.sortOrder ?? nextSortOrder}
          />
        </label>
        <label className="field field-full">
          <span>Заголовок</span>
          <input
            name="title"
            maxLength={250}
            defaultValue={block?.title ?? ""}
          />
        </label>
        <label className="field field-full">
          <span>Содержимое, JSON-объект</span>
          <textarea
            className="json-textarea"
            name="content"
            rows={12}
            required
            spellCheck={false}
            defaultValue={JSON.stringify(block?.content ?? {}, null, 2)}
          />
        </label>
        <label className="check-field">
          <input
            name="isVisible"
            type="checkbox"
            defaultChecked={block?.isVisible ?? true}
          />
          <span>Блок виден посетителям</span>
        </label>
        <label className="field field-full">
          <span>Причина изменения</span>
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={2}
          />
        </label>
      </div>
      {error ? <p className="form-error catalog-form-error">{error}</p> : null}
      <div className="catalog-form-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={submitting}
          onClick={cancel}
        >
          Отмена
        </button>
        <button className="primary-button" type="submit" disabled={submitting}>
          <Save size={16} />
          {submitting ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </form>
  );
}

function readContentBlock(data: FormData): AdminEventContentBlockInput {
  return {
    blockType: requiredValue(
      data,
      "blockType"
    ) as AdminEventContentBlockType,
    title: stringValue(data, "title") || null,
    content: parseContent(requiredValue(data, "content")),
    sortOrder: integerValue(data, "sortOrder"),
    isVisible: data.get("isVisible") === "on"
  };
}

function parseContent(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("content");
  }
  return parsed as Readonly<Record<string, unknown>>;
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

function integerValue(data: FormData, name: string): number {
  const value = Number(requiredValue(data, name));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("integer");
  }
  return value;
}

function contentMutationMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "ADMIN_EVENT_VERSION_CONFLICT") {
      return "Черновик уже изменен другим администратором. Обновите страницу.";
    }
    if (error.code === "ADMIN_EVENT_CONTENT_SORT_ORDER_CONFLICT") {
      return "Эта позиция уже занята другим контентным блоком.";
    }
    if (error.code === "ADMIN_EVENT_CONTENT_BLOCK_NOT_FOUND") {
      return "Контентный блок больше не существует. Обновите страницу.";
    }
    if (error.status === 403) {
      return "У учетной записи нет разрешения events.write.";
    }
    return error.message;
  }
  return "Проверьте обязательные поля, позицию и формат JSON-объекта.";
}
