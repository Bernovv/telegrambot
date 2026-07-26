"use client";

import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  publishEventScenarioVersion,
  saveEventScenarioDraft
} from "@/lib/admin-api";
import { formatEventDateTime } from "@/lib/format";
import {
  ADMIN_SCENARIO_NODE_TYPES,
  type AdminEventDetail,
  type AdminEventProduct,
  type AdminEventScenarioVersion,
  type AdminScenarioEdge,
  type AdminScenarioNode,
  type AdminScenarioNodeType,
  type AdminScenarioValidationIssue
} from "@ticket-platform/contracts/admin-events";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Plus,
  Save,
  Send,
  Trash2
} from "lucide-react";
import { useMemo, useState } from "react";

interface EditableNode extends Omit<AdminScenarioNode, "payload"> {
  readonly payloadText: string;
}

export function EventScenarioEditor({
  event,
  reload
}: {
  readonly event: AdminEventDetail;
  readonly reload: () => Promise<void>;
}) {
  const draft = event.scenarioVersions.find((version) => version.status === "draft");
  const basis = draft ?? event.scenarioVersions[0];
  const initial = useMemo(
    () => editableGraph(basis, event.products),
    [basis, event.products]
  );
  const [title, setTitle] = useState(basis?.scenarioTitle ?? "Продажа билетов");
  const [nodes, setNodes] = useState<readonly EditableNode[]>(initial.nodes);
  const [edges, setEdges] = useState<readonly AdminScenarioEdge[]>(initial.edges);
  const [newNodeType, setNewNodeType] =
    useState<AdminScenarioNodeType>("message");
  const [issues, setIssues] = useState<readonly AdminScenarioValidationIssue[]>(
    draft?.validationIssues ?? []
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addNode() {
    const id = crypto.randomUUID();
    setNodes((current) => [
      ...current,
      {
        id,
        type: newNodeType,
        schemaVersion: 1,
        payloadText: defaultPayload(newNodeType, event.products)
      }
    ]);
    setDirty(true);
  }

  function removeNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter(
      (edge) => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId
    ));
    setDirty(true);
  }

  function addEdge() {
    const from = nodes[0];
    const to = nodes[1] ?? nodes[0];
    if (!from || !to) {
      setError("Для перехода нужны хотя бы два узла.");
      return;
    }
    setEdges((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        fromNodeId: from.id,
        toNodeId: to.id,
        label: null,
        priority: 0,
        condition: {}
      }
    ]);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const parsedNodes = nodes.map((node) => ({
        id: node.id,
        type: node.type,
        schemaVersion: node.schemaVersion,
        payload: parseObject(node.payloadText)
      }));
      const result = await saveEventScenarioDraft(event.id, {
        expectedLockVersion: event.lockVersion,
        reason: requiredReason(reason),
        scenario: {
          title: title.trim(),
          schemaVersion: 1,
          nodes: parsedNodes,
          edges
        }
      });
      setIssues(result.validationIssues);
      setDirty(false);
      setReason("");
      await reload();
    } catch (caught) {
      setError(scenarioMutationMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!draft) {
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      await publishEventScenarioVersion(event.id, draft.id, {
        expectedLockVersion: event.lockVersion,
        reason: requiredReason(reason)
      });
      setIssues([]);
      setReason("");
      await reload();
    } catch (caught) {
      setError(scenarioMutationMessage(caught));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <section className="detail-section scenario-toolbar">
        <div className="section-title-row">
          <div>
            <h2>Редактор графа</h2>
            <span>{nodes.length} узлов · {edges.length} переходов</span>
          </div>
          <StatusPill tone={issues.length === 0 ? "positive" : "warning"}>
            {issues.length === 0 ? "Проверка пройдена" : `${issues.length} ошибок`}
          </StatusPill>
        </div>
        <div className="scenario-title-row">
          <label className="field">
            <span>Название сценария</span>
            <input
              value={title}
              maxLength={250}
              onChange={(change) => {
                setTitle(change.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label className="field">
            <span>Новый узел</span>
            <select
              value={newNodeType}
              onChange={(change) =>
                setNewNodeType(change.target.value as AdminScenarioNodeType)
              }
            >
              {ADMIN_SCENARIO_NODE_TYPES.map((type) => (
                <option key={type} value={type}>{nodeTypeLabel(type)}</option>
              ))}
            </select>
          </label>
          <button className="secondary-button" type="button" onClick={addNode}>
            <Plus size={16} />
            Добавить узел
          </button>
        </div>
      </section>

      {issues.length > 0 ? (
        <section className="scenario-issues" aria-label="Ошибки сценария">
          {issues.map((issue, index) => (
            <div key={`${issue.code}:${issue.nodeId}:${issue.edgeId}:${index}`}>
              <AlertTriangle size={17} />
              <div>
                <strong>{issue.code}</strong>
                <span>{issue.message}</span>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="detail-section">
        <div className="section-title-row">
          <div>
            <h2>Узлы</h2>
            <span>Схема payload версии 1</span>
          </div>
        </div>
        {nodes.length === 0 ? (
          <p className="section-empty">Узлы не добавлены.</p>
        ) : (
          <div className="scenario-node-grid">
            {nodes.map((node, index) => (
              <article className="scenario-node" key={node.id}>
                <div className="scenario-node-heading">
                  <span>{index + 1}</span>
                  <select
                    aria-label={`Тип узла ${index + 1}`}
                    value={node.type}
                    onChange={(change) =>
                      {
                        const nextType =
                          change.target.value as AdminScenarioNodeType;
                        setNodes((current) => current.map((item) =>
                          item.id === node.id
                            ? {
                                ...item,
                                type: nextType,
                                payloadText: defaultPayload(nextType, event.products)
                              }
                            : item
                        ));
                        setDirty(true);
                      }
                    }
                  >
                    {ADMIN_SCENARIO_NODE_TYPES.map((type) => (
                      <option key={type} value={type}>{nodeTypeLabel(type)}</option>
                    ))}
                  </select>
                  <button
                    className="icon-button"
                    type="button"
                    title="Удалить узел"
                    aria-label={`Удалить узел ${index + 1}`}
                    onClick={() => removeNode(node.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <code>{node.id}</code>
                <label className="field">
                  <span>Payload</span>
                  <textarea
                    rows={5}
                    value={node.payloadText}
                    spellCheck={false}
                    onChange={(change) =>
                      {
                        setNodes((current) => current.map((item) =>
                          item.id === node.id
                            ? { ...item, payloadText: change.target.value }
                            : item
                        ));
                        setDirty(true);
                      }
                    }
                  />
                </label>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="detail-section">
        <div className="section-title-row">
          <div>
            <h2>Переходы</h2>
            <span>{edges.length} связей</span>
          </div>
          <button className="secondary-button" type="button" onClick={addEdge}>
            <GitBranch size={16} />
            Добавить переход
          </button>
        </div>
        {edges.length === 0 ? (
          <p className="section-empty">Переходы не добавлены.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table scenario-edge-table">
              <thead>
                <tr>
                  <th>Из узла</th>
                  <th>В узел</th>
                  <th>Метка</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {edges.map((edge) => (
                  <tr key={edge.id}>
                    <td>
                      <NodeSelect
                        value={edge.fromNodeId}
                        nodes={nodes}
                        onChange={(value) => updateEdge(
                          edge.id,
                          { fromNodeId: value },
                          setEdges,
                          setDirty
                        )}
                      />
                    </td>
                    <td>
                      <NodeSelect
                        value={edge.toNodeId}
                        nodes={nodes}
                        onChange={(value) => updateEdge(
                          edge.id,
                          { toNodeId: value },
                          setEdges,
                          setDirty
                        )}
                      />
                    </td>
                    <td>
                      <input
                        aria-label="Метка перехода"
                        maxLength={250}
                        value={edge.label ?? ""}
                        onChange={(change) => updateEdge(
                          edge.id,
                          { label: change.target.value || null },
                          setEdges,
                          setDirty
                        )}
                      />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        type="button"
                        title="Удалить переход"
                        aria-label="Удалить переход"
                        onClick={() => {
                          setEdges((current) =>
                            current.filter((item) => item.id !== edge.id)
                          );
                          setDirty(true);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="detail-section scenario-actions">
        <label className="field">
          <span>Причина изменения</span>
          <textarea
            rows={2}
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(change) => setReason(change.target.value)}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="heading-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={saving || publishing}
            onClick={() => void save()}
          >
            <Save size={16} />
            {saving ? "Сохранение..." : "Сохранить черновик"}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={
              !draft || dirty || issues.length > 0 || saving || publishing
            }
            onClick={() => void publish()}
          >
            <Send size={16} />
            {publishing ? "Публикация..." : "Опубликовать версию"}
          </button>
        </div>
      </section>

      <ScenarioHistory event={event} />
    </>
  );
}

function NodeSelect({
  value,
  nodes,
  onChange
}: {
  readonly value: string;
  readonly nodes: readonly EditableNode[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      aria-label="Узел перехода"
      onChange={(change) => onChange(change.target.value)}
    >
      {!nodes.some((node) => node.id === value) ? (
        <option value={value}>Отсутствует · {shortId(value)}</option>
      ) : null}
      {nodes.map((node, index) => (
        <option key={node.id} value={node.id}>
          {index + 1}. {nodeTypeLabel(node.type)}
        </option>
      ))}
    </select>
  );
}

function ScenarioHistory({ event }: { readonly event: AdminEventDetail }) {
  const published = event.scenarioVersions.filter(
    (version) => version.status === "published" || version.status === "retired"
  );
  return (
    <section className="detail-section">
      <div className="section-title-row">
        <div>
          <h2>История публикаций</h2>
          <span>{published.length} версий</span>
        </div>
      </div>
      {published.length === 0 ? (
        <p className="section-empty">Опубликованных версий пока нет.</p>
      ) : (
        <div className="scenario-history">
          {published.map((version) => (
            <div key={version.id}>
              <CheckCircle2 size={17} />
              <div>
                <strong>Версия {version.versionNumber}</strong>
                <span>
                  {version.nodes.length} узлов · {version.edges.length} переходов
                </span>
              </div>
              <time>
                {version.publishedAt
                  ? formatEventDateTime(version.publishedAt, event.timezone)
                  : "—"}
              </time>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function editableGraph(
  version: AdminEventScenarioVersion | undefined,
  products: readonly AdminEventProduct[]
): {
  readonly nodes: readonly EditableNode[];
  readonly edges: readonly AdminScenarioEdge[];
} {
  if (version) {
    return {
      nodes: version.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        schemaVersion: node.schemaVersion,
        payloadText: JSON.stringify(node.payload, null, 2)
      })),
      edges: version.edges.map((edge) => ({ ...edge }))
    };
  }
  const [start, message, quantity, order, offer, payment, end] = STARTER_NODE_IDS;
  const activeProduct = products.find((product) => product.isActive);
  if (!activeProduct) {
    const starter: Array<[string, AdminScenarioNodeType, string]> = [
      [start, "start", "{}"],
      [message, "message", defaultPayload("message", products)],
      [end, "end", "{}"]
    ];
    return {
      nodes: starter.map(([id, type, payloadText]) => ({
        id,
        type,
        schemaVersion: 1,
        payloadText
      })),
      edges: [
        createEdge("00000000-0000-4000-8000-000000000821", start, message),
        createEdge("00000000-0000-4000-8000-000000000822", message, end)
      ]
    };
  }
  const starter: Array<[string, AdminScenarioNodeType, string]> = [
    [start, "start", "{}"],
    [message, "message", defaultPayload("message", products)],
    [quantity, "number_input", defaultPayload("number_input", products)],
    [order, "order_start", defaultPayload("order_start", products)],
    [offer, "offer_acceptance", "{}"],
    [payment, "payment_start", "{}"],
    [end, "end", "{}"]
  ];
  return {
    nodes: starter.map(([id, type, payloadText]) => ({
      id,
      type,
      schemaVersion: 1,
      payloadText
    })),
    edges: [
      createEdge("00000000-0000-4000-8000-000000000821", start, message),
      createEdge("00000000-0000-4000-8000-000000000822", message, quantity),
      createEdge("00000000-0000-4000-8000-000000000823", quantity, order),
      createEdge("00000000-0000-4000-8000-000000000824", order, offer),
      createEdge("00000000-0000-4000-8000-000000000825", offer, payment),
      createEdge("00000000-0000-4000-8000-000000000826", payment, end)
    ]
  };
}

function createEdge(
  id: string,
  fromNodeId: string,
  toNodeId: string
): AdminScenarioEdge {
  return {
    id,
    fromNodeId,
    toNodeId,
    label: null,
    priority: 0,
    condition: {}
  };
}

function updateEdge(
  edgeId: string,
  patch: Partial<AdminScenarioEdge>,
  setEdges: (
    update: (current: readonly AdminScenarioEdge[]) => readonly AdminScenarioEdge[]
  ) => void,
  setDirty: (value: boolean) => void
) {
  setEdges((current) => current.map((edge) =>
    edge.id === edgeId ? { ...edge, ...patch } : edge
  ));
  setDirty(true);
}

function parseObject(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("payload");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function requiredReason(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 3) {
    throw new Error("reason");
  }
  return normalized;
}

function defaultPayload(
  type: AdminScenarioNodeType,
  products: readonly AdminEventProduct[]
): string {
  if (type === "message" || type === "notification") {
    return '{\n  "text": ""\n}';
  }
  if (type === "text_input") {
    return [
      "{",
      '  "text": "Введите ответ",',
      '  "contextKey": "answer",',
      '  "minimumLength": 1,',
      '  "maximumLength": 500',
      "}"
    ].join("\n");
  }
  if (type === "number_input") {
    const activeProduct = products.find((product) => product.isActive);
    return JSON.stringify({
      text: "Введите количество",
      contextKey: "quantity",
      minimum: 1,
      maximum: activeProduct?.maximumQuantityPerOrder ?? 100
    }, null, 2);
  }
  if (type === "order_start") {
    const activeProduct = products.find((product) => product.isActive);
    return JSON.stringify({
      currency: activeProduct?.currency ?? "RUB",
      items: [{
        productId: activeProduct?.id ?? "",
        quantityContextKey: "quantity"
      }]
    }, null, 2);
  }
  if (type === "wallet_credit") {
    return '{\n  "idempotencyKeyTemplate": ""\n}';
  }
  return "{}";
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function nodeTypeLabel(type: AdminScenarioNodeType): string {
  return NODE_TYPE_LABELS[type];
}

function scenarioMutationMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "ADMIN_EVENT_VERSION_CONFLICT") {
      return "Черновик уже изменен другим администратором. Обновите страницу.";
    }
    if (error.code === "ADMIN_SCENARIO_VALIDATION_FAILED") {
      return "Сценарий не прошел серверную проверку публикации.";
    }
    if (error.code === "ADMIN_SCENARIO_VERSION_NOT_DRAFT") {
      return "Эта версия уже опубликована и недоступна для изменения.";
    }
    if (error.status === 403) {
      return "Для публикации требуется разрешение scenarios.publish.";
    }
    return error.message;
  }
  return "Проверьте payload узлов и заполните причину изменения.";
}

const NODE_TYPE_LABELS: Record<AdminScenarioNodeType, string> = {
  start: "Старт",
  message: "Сообщение",
  media: "Медиа",
  menu: "Меню",
  choice: "Выбор",
  text_input: "Текстовый ввод",
  number_input: "Числовой ввод",
  phone_request: "Запрос телефона",
  condition: "Условие",
  set_status: "Назначить статус",
  add_category: "Добавить категорию",
  wallet_credit: "Начислить баланс",
  event_selector: "Выбор мероприятия",
  order_start: "Начать заказ",
  order_add_item: "Добавить товар",
  order_summary: "Состав заказа",
  offer_acceptance: "Принятие оферты",
  payment_start: "Начать оплату",
  survey_start: "Начать опрос",
  support_request: "Обращение в поддержку",
  notification: "Уведомление",
  delay: "Задержка",
  subflow: "Подсценарий",
  end: "Завершение"
};

const STARTER_NODE_IDS = [
  "00000000-0000-4000-8000-000000000811",
  "00000000-0000-4000-8000-000000000812",
  "00000000-0000-4000-8000-000000000813",
  "00000000-0000-4000-8000-000000000814",
  "00000000-0000-4000-8000-000000000815",
  "00000000-0000-4000-8000-000000000816",
  "00000000-0000-4000-8000-000000000817"
] as const;
