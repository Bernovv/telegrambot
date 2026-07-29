"use client";

import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  createAdminSavedSegment,
  getAdminSavedSegment,
  getUserClassificationCatalog,
  listAdminSegmentAudienceSnapshots,
  listAdminSavedSegments,
  publishAdminSavedSegment,
  requestAdminSegmentAudienceSnapshot,
  updateAdminSavedSegmentDraft,
  previewAdminSegment
} from "@/lib/admin-api";
import { formatCompactDate } from "@/lib/format";
import type {
  AdminUserClassificationCatalog
} from "@ticket-platform/contracts/admin-user-classification";
import type {
  AdminSavedSegment,
  AdminSavedSegmentSummary,
  AdminSegmentAudienceSnapshotSummary,
  AdminSegmentExpression,
  AdminSegmentClassificationCondition,
  AdminSegmentConditionGroup,
  AdminSegmentPreview
} from "@ticket-platform/contracts/admin-segments";
import {
  FilePlus2,
  FolderOpen,
  Plus,
  Rocket,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UsersRound
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface DraftCondition extends AdminSegmentClassificationCondition {
  readonly id: string;
}

interface DraftGroup {
  readonly id: string;
  readonly operator: "and" | "or";
  readonly conditions: readonly DraftCondition[];
}

export function SegmentPreviewBuilder() {
  const sequence = useRef(2);
  const [catalog, setCatalog] =
    useState<AdminUserClassificationCatalog | null>(null);
  const [savedSegments, setSavedSegments] =
    useState<readonly AdminSavedSegmentSummary[]>([]);
  const [selectedSegment, setSelectedSegment] =
    useState<AdminSavedSegment | null>(null);
  const [snapshots, setSnapshots] =
    useState<readonly AdminSegmentAudienceSnapshotSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [rootOperator, setRootOperator] = useState<"and" | "or">("and");
  const [groups, setGroups] = useState<readonly DraftGroup[]>([{
    id: "group-1",
    operator: "and",
    conditions: [{
      id: "condition-1",
      kind: "status",
      mode: "any",
      codes: []
    }]
  }]);
  const [preview, setPreview] = useState<AdminSegmentPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getUserClassificationCatalog(controller.signal),
      listAdminSavedSegments(controller.signal)
    ])
      .then(([nextCatalog, segments]) => {
        setCatalog(nextCatalog);
        setSavedSegments(segments);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(message(caught));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  if (loading) {
    return <PageLoading label="Загружаем справочники сегмента" />;
  }
  if (!catalog) {
    return (
      <PageError
        message={error ?? "Справочники недоступны."}
        retry={() => window.location.reload()}
      />
    );
  }

  function updateGroup(
    groupId: string,
    update: (group: DraftGroup) => DraftGroup
  ) {
    setGroups((current) =>
      current.map((group) => group.id === groupId ? update(group) : group)
    );
    setPreview(null);
  }

  function addGroup() {
    const number = sequence.current++;
    setGroups((current) => [...current, {
      id: `group-${number}`,
      operator: "and",
      conditions: [{
        id: `condition-${number}`,
        kind: "status",
        mode: "any",
        codes: []
      }]
    }]);
    setPreview(null);
  }

  function addCondition(groupId: string) {
    const number = sequence.current++;
    updateGroup(groupId, (group) => ({
      ...group,
      conditions: [...group.conditions, {
        id: `condition-${number}`,
        kind: "status",
        mode: "any",
        codes: []
      }]
    }));
  }

  function updateCondition(
    groupId: string,
    conditionId: string,
    patch: Partial<AdminSegmentClassificationCondition>
  ) {
    updateGroup(groupId, (group) => ({
      ...group,
      conditions: group.conditions.map((condition) =>
        condition.id === conditionId
          ? { ...condition, ...patch }
          : condition
      )
    }));
  }

  function removeCondition(groupId: string, conditionId: string) {
    updateGroup(groupId, (group) => ({
      ...group,
      conditions: group.conditions.filter(
        (condition) => condition.id !== conditionId
      )
    }));
  }

  function currentExpression(): AdminSegmentExpression | null {
    const requestGroups: AdminSegmentConditionGroup[] = groups.map((group) => ({
      operator: group.operator,
      conditions: group.conditions.map(({ kind, mode, codes }) => ({
        kind,
        mode,
        codes
      }))
    }));
    if (
      requestGroups.some((group) =>
        group.conditions.length === 0
        || group.conditions.some((condition) => condition.codes.length === 0)
      )
    ) {
      setError("В каждом условии выберите хотя бы одно значение.");
      return null;
    }
    return { operator: rootOperator, groups: requestGroups };
  }

  function applyExpression(expression: AdminSegmentExpression) {
    setRootOperator(expression.operator);
    setGroups(expression.groups.map((group) => ({
      id: `group-${sequence.current++}`,
      operator: group.operator,
      conditions: group.conditions.map((condition) => ({
        ...condition,
        id: `condition-${sequence.current++}`
      }))
    })));
    setPreview(null);
  }

  async function refreshSavedSegments() {
    setSavedSegments(await listAdminSavedSegments());
  }

  async function openSavedSegment(segmentId: string) {
    setBusy(true);
    setError(null);
    try {
      const [segment, nextSnapshots] = await Promise.all([
        getAdminSavedSegment(segmentId),
        listAdminSegmentAudienceSnapshots(segmentId)
      ]);
      const version = segment.draft ?? segment.published;
      if (!version) {
        throw new Error("Segment has no readable version");
      }
      setSelectedSegment(segment);
      setName(version.name);
      setDescription(version.description ?? "");
      setSnapshots(nextSnapshots);
      applyExpression(version.expression);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  function startNewSegment() {
    setSelectedSegment(null);
    setSnapshots([]);
    setName("");
    setDescription("");
    setReason("");
    setRootOperator("and");
    setGroups([{
      id: `group-${sequence.current++}`,
      operator: "and",
      conditions: [{
        id: `condition-${sequence.current++}`,
        kind: "status",
        mode: "any",
        codes: []
      }]
    }]);
    setPreview(null);
    setError(null);
  }

  async function saveDraft() {
    const expression = currentExpression();
    if (!expression) {
      return;
    }
    if (!name.trim() || !reason.trim()) {
      setError("Укажите название сегмента и причину изменения.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const segment = selectedSegment
        ? await updateAdminSavedSegmentDraft(selectedSegment.id, {
            expectedLockVersion: selectedSegment.lockVersion,
            name,
            description: description.trim() || null,
            expression,
            reason
          })
        : await createAdminSavedSegment({
            name,
            description: description.trim() || null,
            expression,
            reason
          });
      setSelectedSegment(segment);
      setName(segment.name);
      setDescription(segment.description ?? "");
      setReason("");
      await refreshSavedSegments();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function publishDraft() {
    if (!selectedSegment?.draft || !reason.trim()) {
      setError("Сначала сохраните черновик и укажите причину публикации.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const segment = await publishAdminSavedSegment(selectedSegment.id, {
        expectedLockVersion: selectedSegment.lockVersion,
        reason
      });
      setSelectedSegment(segment);
      setReason("");
      setSnapshots(await listAdminSegmentAudienceSnapshots(segment.id));
      await refreshSavedSegments();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSnapshots() {
    if (!selectedSegment) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setSnapshots(
        await listAdminSegmentAudienceSnapshots(selectedSegment.id)
      );
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function requestSnapshot() {
    if (!selectedSegment?.published || !reason.trim()) {
      setError("Опубликуйте сегмент и укажите причину создания снимка.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestAdminSegmentAudienceSnapshot(selectedSegment.id, {
        segmentVersionId: selectedSegment.published.id,
        reason
      });
      setReason("");
      setSnapshots(
        await listAdminSegmentAudienceSnapshots(selectedSegment.id)
      );
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function calculate() {
    const requestGroups: AdminSegmentConditionGroup[] = groups.map((group) => ({
      operator: group.operator,
      conditions: group.conditions.map(({ kind, mode, codes }) => ({
        kind,
        mode,
        codes
      }))
    }));
    if (
      requestGroups.some((group) =>
        group.conditions.length === 0
        || group.conditions.some((condition) => condition.codes.length === 0)
      )
    ) {
      setError("В каждом условии выберите хотя бы одно значение.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewAdminSegment({
        operator: rootOperator,
        groups: requestGroups,
        sampleLimit: 20
      }));
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <div className="inline-alert">{error}</div> : null}
      <section className="data-section segment-saved-editor">
        <div className="section-title-row">
          <div>
            <h2>Сохранённый сегмент</h2>
            <span>
              {selectedSegment
                ? `Версия блокировки ${selectedSegment.lockVersion}`
                : "Новый черновик"}
            </span>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={startNewSegment}
          >
            <FilePlus2 size={17} />
            Новый
          </button>
        </div>

        <div className="segment-saved-grid">
          <label>
            <span>Сохранённые сегменты</span>
            <select
              value={selectedSegment?.id ?? ""}
              disabled={busy || savedSegments.length === 0}
              onChange={(event) => {
                if (event.target.value) {
                  void openSavedSegment(event.target.value);
                }
              }}
            >
              <option value="">Выберите сегмент</option>
              {savedSegments.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.name}
                  {segment.draftVersionNumber
                    ? ` · черновик v${segment.draftVersionNumber}`
                    : ""}
                  {segment.publishedVersionNumber
                    ? ` · опубликован v${segment.publishedVersionNumber}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Название</span>
            <input
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>Описание</span>
            <input
              value={description}
              maxLength={1000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            <span>Причина изменения</span>
            <input
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>

        <div className="segment-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void saveDraft()}
          >
            <Save size={17} />
            Сохранить черновик
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={busy || !selectedSegment?.draft}
            onClick={() => void publishDraft()}
          >
            <Rocket size={17} />
            Опубликовать
          </button>
        </div>
        {selectedSegment?.published ? (
          <div className="segment-version-note">
            <FolderOpen size={16} />
            Текущая опубликованная версия: v
            {selectedSegment.published.versionNumber}
          </div>
        ) : null}
        <div className="segment-snapshot-heading">
          <div>
            <strong>Снимки аудитории</strong>
            <span>{snapshots.length}</span>
          </div>
          <div className="segment-snapshot-actions">
            <button
              className="icon-button"
              type="button"
              title="Обновить снимки"
              disabled={busy || !selectedSegment}
              onClick={() => void refreshSnapshots()}
            >
              <RefreshCw size={16} />
              <span className="sr-only">Обновить снимки</span>
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy || !selectedSegment?.published}
              onClick={() => void requestSnapshot()}
            >
              <UsersRound size={17} />
              Зафиксировать аудиторию
            </button>
          </div>
        </div>
        {snapshots.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Версия</th>
                  <th>Состояние</th>
                  <th>Получатели</th>
                  <th>Запрошен</th>
                  <th>Готов</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.id}>
                    <td>v{snapshot.segmentVersionNumber}</td>
                    <td>
                      <span
                        className={`status-pill ${
                          snapshot.status === "ready"
                            ? "status-positive"
                            : "status-warning"
                        }`}
                      >
                        {snapshot.status === "ready" ? "Готов" : "В очереди"}
                      </span>
                    </td>
                    <td>{snapshot.totalCount ?? "—"}</td>
                    <td>{formatCompactDate(snapshot.requestedAt)}</td>
                    <td>
                      {snapshot.completedAt
                        ? formatCompactDate(snapshot.completedAt)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="section-empty">Нет зафиксированных аудиторий.</p>
        )}
      </section>
      <section className="data-section segment-builder">
        <div className="section-title-row">
          <div>
            <h2>Условия аудитории</h2>
            <span>Активные назначения на момент расчёта</span>
          </div>
          <div className="segment-operator" aria-label="Связь между группами">
            <button
              className={rootOperator === "and" ? "active" : ""}
              type="button"
              onClick={() => setRootOperator("and")}
            >
              И
            </button>
            <button
              className={rootOperator === "or" ? "active" : ""}
              type="button"
              onClick={() => setRootOperator("or")}
            >
              ИЛИ
            </button>
          </div>
        </div>

        <div className="segment-groups">
          {groups.map((group, groupIndex) => (
            <div className="segment-group" key={group.id}>
              <div className="segment-group-heading">
                <strong>Группа {groupIndex + 1}</strong>
                <div className="segment-operator" aria-label="Связь условий">
                  <button
                    className={group.operator === "and" ? "active" : ""}
                    type="button"
                    onClick={() => updateGroup(
                      group.id,
                      (current) => ({ ...current, operator: "and" })
                    )}
                  >
                    И
                  </button>
                  <button
                    className={group.operator === "or" ? "active" : ""}
                    type="button"
                    onClick={() => updateGroup(
                      group.id,
                      (current) => ({ ...current, operator: "or" })
                    )}
                  >
                    ИЛИ
                  </button>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  title="Удалить группу"
                  disabled={groups.length === 1}
                  onClick={() => {
                    setGroups((current) =>
                      current.filter((item) => item.id !== group.id)
                    );
                    setPreview(null);
                  }}
                >
                  <Trash2 size={16} />
                  <span className="sr-only">Удалить группу</span>
                </button>
              </div>

              {group.conditions.map((condition) => {
                const definitions = condition.kind === "status"
                  ? catalog.statuses
                  : catalog.categories;
                return (
                  <div className="segment-condition" key={condition.id}>
                    <select
                      aria-label="Тип условия"
                      value={condition.kind}
                      onChange={(event) => updateCondition(
                        group.id,
                        condition.id,
                        {
                          kind: event.target.value as "status" | "category",
                          codes: []
                        }
                      )}
                    >
                      <option value="status">Статус</option>
                      <option value="category">Категория</option>
                    </select>
                    <select
                      aria-label="Режим совпадения"
                      value={condition.mode}
                      onChange={(event) => updateCondition(
                        group.id,
                        condition.id,
                        { mode: event.target.value as "any" | "all" | "none" }
                      )}
                    >
                      <option value="any">Любой из</option>
                      <option value="all">Все выбранные</option>
                      <option value="none">Исключить</option>
                    </select>
                    <div className="segment-values">
                      {definitions.filter((item) => item.isActive).map((item) => (
                        <label key={item.id}>
                          <input
                            type="checkbox"
                            checked={condition.codes.includes(item.code)}
                            onChange={(event) => updateCondition(
                              group.id,
                              condition.id,
                              {
                                codes: event.target.checked
                                  ? [...condition.codes, item.code]
                                  : condition.codes.filter(
                                      (code) => code !== item.code
                                    )
                              }
                            )}
                          />
                          <span
                            className="classification-swatch"
                            style={{ backgroundColor: item.color }}
                            aria-hidden="true"
                          />
                          {item.displayName}
                        </label>
                      ))}
                    </div>
                    <button
                      className="icon-button"
                      type="button"
                      title="Удалить условие"
                      disabled={group.conditions.length === 1}
                      onClick={() => removeCondition(group.id, condition.id)}
                    >
                      <Trash2 size={16} />
                      <span className="sr-only">Удалить условие</span>
                    </button>
                  </div>
                );
              })}

              <button
                className="secondary-button compact-button"
                type="button"
                disabled={group.conditions.length >= 8}
                onClick={() => addCondition(group.id)}
              >
                <Plus size={16} />
                Условие
              </button>
            </div>
          ))}
        </div>

        <div className="segment-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={groups.length >= 8}
            onClick={addGroup}
          >
            <Plus size={17} />
            Группа
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void calculate()}
          >
            <Search size={17} />
            {busy ? "Считаем..." : "Рассчитать"}
          </button>
        </div>
      </section>

      {preview ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Предварительная выборка</h2>
              <span>Найдено пользователей: {preview.totalCount}</span>
            </div>
          </div>
          {preview.sampleUsers.length === 0 ? (
            <p className="section-empty">Ни один пользователь не совпал.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Статусы</th>
                    <th>Категории</th>
                    <th>Регистрация</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.displayName ?? "Без имени"}</strong>
                        <small>
                          {user.telegramUsername
                            ? `@${user.telegramUsername}`
                            : user.id}
                        </small>
                      </td>
                      <td>{user.statusCodes.join(", ") || "—"}</td>
                      <td>{user.categoryCodes.join(", ") || "—"}</td>
                      <td>{formatCompactDate(user.registeredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

function message(error: unknown): string {
  return error instanceof AdminApiError
    ? error.message
    : "Не удалось выполнить операцию с сегментом.";
}
