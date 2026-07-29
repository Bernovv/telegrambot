"use client";

import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  createUserCategory,
  createUserStatus,
  getUserClassificationCatalog,
  updateUserCategory,
  updateUserStatus
} from "@/lib/admin-api";
import type {
  AdminUserCategoryDefinition,
  AdminUserClassificationCatalog,
  AdminUserStatusDefinition
} from "@ticket-platform/contracts/admin-user-classification";
import { Check, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

export function UserClassificationEditor() {
  const [catalog, setCatalog] =
    useState<AdminUserClassificationCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusForm, setStatusForm] =
    useState<AdminUserStatusDefinition | "new" | null>(null);
  const [categoryForm, setCategoryForm] =
    useState<AdminUserCategoryDefinition | "new" | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await getUserClassificationCatalog(signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(message(caught));
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && !catalog) {
    return <PageLoading label="Загружаем справочники" />;
  }
  if (error || !catalog) {
    return (
      <PageError
        message={error ?? "Справочники недоступны."}
        retry={() => void load()}
      />
    );
  }

  return (
    <div className="classification-grid">
      <ClassificationSection
        title="Статусы"
        count={catalog.statuses.length}
        createLabel="Создать статус"
        creating={statusForm === "new"}
        onCreate={() => setStatusForm("new")}
      >
        {statusForm === "new" ? (
          <StatusForm
            status={null}
            catalog={catalog.statuses}
            onCancel={() => setStatusForm(null)}
            onSaved={async () => {
              setStatusForm(null);
              await load();
            }}
          />
        ) : null}
        <div className="classification-list">
          {catalog.statuses.map((status) => (
            <ClassificationItem
              key={status.id}
              code={status.code}
              title={status.displayName}
              color={status.color}
              description={status.description}
              meta={[
                status.exclusivityGroup
                  ? `Группа: ${status.exclusivityGroup}`
                  : "Без группы",
                status.isSystem ? "Системный" : "Пользовательский",
                status.isActive ? "Активен" : "Отключён"
              ]}
              editing={statusForm !== "new" && statusForm?.id === status.id}
              onEdit={() => setStatusForm(status)}
            >
              {statusForm !== "new" && statusForm?.id === status.id ? (
                <StatusForm
                  status={status}
                  catalog={catalog.statuses}
                  onCancel={() => setStatusForm(null)}
                  onSaved={async () => {
                    setStatusForm(null);
                    await load();
                  }}
                />
              ) : null}
            </ClassificationItem>
          ))}
        </div>
      </ClassificationSection>

      <ClassificationSection
        title="Категории"
        count={catalog.categories.length}
        createLabel="Создать категорию"
        creating={categoryForm === "new"}
        onCreate={() => setCategoryForm("new")}
      >
        {categoryForm === "new" ? (
          <CategoryForm
            category={null}
            onCancel={() => setCategoryForm(null)}
            onSaved={async () => {
              setCategoryForm(null);
              await load();
            }}
          />
        ) : null}
        <div className="classification-list">
          {catalog.categories.length === 0 ? (
            <p className="section-empty">Категории ещё не созданы.</p>
          ) : catalog.categories.map((category) => (
            <ClassificationItem
              key={category.id}
              code={category.code}
              title={category.displayName}
              color={category.color}
              description={category.description}
              meta={[
                category.isSystem ? "Системная" : "Пользовательская",
                category.isActive ? "Активна" : "Отключена"
              ]}
              editing={
                categoryForm !== "new" && categoryForm?.id === category.id
              }
              onEdit={() => setCategoryForm(category)}
            >
              {categoryForm !== "new" && categoryForm?.id === category.id ? (
                <CategoryForm
                  category={category}
                  onCancel={() => setCategoryForm(null)}
                  onSaved={async () => {
                    setCategoryForm(null);
                    await load();
                  }}
                />
              ) : null}
            </ClassificationItem>
          ))}
        </div>
      </ClassificationSection>
    </div>
  );
}

function ClassificationSection({
  title,
  count,
  createLabel,
  creating,
  onCreate,
  children
}: Readonly<{
  title: string;
  count: number;
  createLabel: string;
  creating: boolean;
  onCreate: () => void;
  children: ReactNode;
}>) {
  return (
    <section className="data-section classification-section">
      <div className="section-title-row">
        <div>
          <h2>{title}</h2>
          <span>{count} записей</span>
        </div>
        <button
          className="secondary-button compact-button"
          type="button"
          disabled={creating}
          onClick={onCreate}
        >
          <Plus size={16} />
          {createLabel}
        </button>
      </div>
      {children}
    </section>
  );
}

function ClassificationItem({
  code,
  title,
  color,
  description,
  meta,
  editing,
  onEdit,
  children
}: Readonly<{
  code: string;
  title: string;
  color: string;
  description: string | null;
  meta: readonly string[];
  editing: boolean;
  onEdit: () => void;
  children: ReactNode;
}>) {
  return (
    <article className="classification-item">
      <div className="classification-heading">
        <span
          className="classification-swatch"
          style={{ backgroundColor: color }}
          aria-label={`Цвет ${color}`}
        />
        <div>
          <h3>{title}</h3>
          <code>{code}</code>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={`Редактировать ${title}`}
          title={`Редактировать ${title}`}
          disabled={editing}
          onClick={onEdit}
        >
          <Pencil size={17} />
        </button>
      </div>
      {description ? <p>{description}</p> : null}
      <div className="classification-meta">
        {meta.map((value) => <span key={value}>{value}</span>)}
      </div>
      {children}
    </article>
  );
}

function StatusForm({
  status,
  catalog,
  onCancel,
  onSaved
}: Readonly<{
  status: AdminUserStatusDefinition | null;
  catalog: readonly AdminUserStatusDefinition[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}>) {
  const [code, setCode] = useState(status?.code ?? "");
  const [displayName, setDisplayName] = useState(status?.displayName ?? "");
  const [color, setColor] = useState(status?.color ?? "#2563EB");
  const [description, setDescription] = useState(status?.description ?? "");
  const [group, setGroup] = useState(status?.exclusivityGroup ?? "");
  const [transitions, setTransitions] = useState(
    status?.allowedTransitionCodes?.join(", ") ?? ""
  );
  const [active, setActive] = useState(status?.isActive ?? true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const allowedTransitionCodes = parseCodes(transitions);
      if (status) {
        await updateUserStatus(status.id, {
          expectedLockVersion: status.lockVersion,
          displayName,
          color: color.toUpperCase(),
          description: nullable(description),
          exclusivityGroup: nullable(group),
          allowedTransitionCodes,
          isActive: active,
          reason
        });
      } else {
        await createUserStatus({
          code,
          displayName,
          color: color.toUpperCase(),
          description: nullable(description),
          exclusivityGroup: nullable(group),
          allowedTransitionCodes,
          reason
        });
      }
      await onSaved();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="classification-form">
      <div className="event-form-grid">
        <label className="field">
          <span>Код</span>
          <input
            value={code}
            disabled={status !== null}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Название</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Цвет</span>
          <input
            className="color-input"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Группа эксклюзивности</span>
          <input
            value={group}
            placeholder="lifecycle"
            onChange={(event) => setGroup(event.target.value)}
          />
        </label>
        <label className="field field-full">
          <span>Разрешённые следующие статусы</span>
          <input
            value={transitions}
            placeholder={catalog
              .filter((item) => item.code !== status?.code)
              .slice(0, 3)
              .map((item) => item.code)
              .join(", ")}
            onChange={(event) => setTransitions(event.target.value)}
          />
        </label>
        <label className="field field-full">
          <span>Описание</span>
          <textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {status ? (
          <label className="check-field">
            <input
              type="checkbox"
              checked={active}
              disabled={status.isSystem}
              onChange={(event) => setActive(event.target.checked)}
            />
            Активен
          </label>
        ) : null}
        <label className="field field-full">
          <span>Причина изменения</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>
      <FormActions
        saving={saving}
        error={error}
        onCancel={onCancel}
        onSubmit={() => void submit()}
      />
    </div>
  );
}

function CategoryForm({
  category,
  onCancel,
  onSaved
}: Readonly<{
  category: AdminUserCategoryDefinition | null;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}>) {
  const [code, setCode] = useState(category?.code ?? "");
  const [displayName, setDisplayName] = useState(category?.displayName ?? "");
  const [color, setColor] = useState(category?.color ?? "#16A34A");
  const [description, setDescription] = useState(category?.description ?? "");
  const [active, setActive] = useState(category?.isActive ?? true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (category) {
        await updateUserCategory(category.id, {
          expectedLockVersion: category.lockVersion,
          displayName,
          color: color.toUpperCase(),
          description: nullable(description),
          isActive: active,
          reason
        });
      } else {
        await createUserCategory({
          code,
          displayName,
          color: color.toUpperCase(),
          description: nullable(description),
          reason
        });
      }
      await onSaved();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="classification-form">
      <div className="event-form-grid">
        <label className="field">
          <span>Код</span>
          <input
            value={code}
            disabled={category !== null}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Название</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Цвет</span>
          <input
            className="color-input"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        {category ? (
          <label className="check-field">
            <input
              type="checkbox"
              checked={active}
              disabled={category.isSystem}
              onChange={(event) => setActive(event.target.checked)}
            />
            Активна
          </label>
        ) : null}
        <label className="field field-full">
          <span>Описание</span>
          <textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="field field-full">
          <span>Причина изменения</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </div>
      <FormActions
        saving={saving}
        error={error}
        onCancel={onCancel}
        onSubmit={() => void submit()}
      />
    </div>
  );
}

function FormActions({
  saving,
  error,
  onCancel,
  onSubmit
}: Readonly<{
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}>) {
  return (
    <div className="classification-form-footer">
      <p className={error ? "form-error" : "muted"}>
        {error ?? "Код нельзя изменить после создания."}
      </p>
      <div>
        <button
          className="secondary-button"
          type="button"
          disabled={saving}
          onClick={onCancel}
        >
          <X size={16} />
          Отмена
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={saving}
          onClick={onSubmit}
        >
          {saving
            ? <RotateCcw className="spin" size={16} />
            : <Check size={16} />}
          Сохранить
        </button>
      </div>
    </div>
  );
}

function parseCodes(value: string): readonly string[] | null {
  const codes = value.split(",").map((item) => item.trim()).filter(Boolean);
  return codes.length === 0 ? null : codes;
}

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function message(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "ADMIN_USER_CLASSIFICATION_VERSION_CONFLICT") {
      return "Запись уже изменена другим администратором. Обновите страницу.";
    }
    if (error.code === "ADMIN_USER_CLASSIFICATION_CODE_CONFLICT") {
      return "Такой код уже используется.";
    }
    if (error.code === "ADMIN_USER_STATUS_TRANSITION_NOT_FOUND") {
      return "Один из разрешённых переходов не найден или отключён.";
    }
    if (error.code === "ADMIN_SYSTEM_USER_CLASSIFICATION_PROTECTED") {
      return "Системную запись нельзя отключить.";
    }
    return error.message;
  }
  return "Не удалось сохранить изменения.";
}
