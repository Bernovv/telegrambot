export const SCENARIO_NODE_TYPES = [
  "start",
  "message",
  "media",
  "menu",
  "choice",
  "text_input",
  "number_input",
  "phone_request",
  "condition",
  "set_status",
  "add_category",
  "wallet_credit",
  "event_selector",
  "order_start",
  "order_add_item",
  "order_summary",
  "offer_acceptance",
  "payment_start",
  "survey_start",
  "support_request",
  "notification",
  "delay",
  "subflow",
  "end"
] as const;

export type ScenarioNodeType = typeof SCENARIO_NODE_TYPES[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ScenarioNode {
  readonly id: string;
  readonly type: ScenarioNodeType;
  readonly schemaVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ScenarioEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly label: string | null;
  readonly priority: number;
  readonly condition: Readonly<Record<string, unknown>>;
}

export interface ScenarioGraph {
  readonly schemaVersion: number;
  readonly nodes: readonly ScenarioNode[];
  readonly edges: readonly ScenarioEdge[];
}

export const SCENARIO_VALIDATION_CODES = [
  "START_COUNT",
  "END_MISSING",
  "DUPLICATE_NODE_ID",
  "DUPLICATE_EDGE_ID",
  "BROKEN_EDGE",
  "UNREACHABLE_NODE",
  "DEAD_END",
  "START_HAS_INCOMING_EDGE",
  "END_HAS_OUTGOING_EDGE",
  "PRESENTATION_INVALID",
  "TRANSITION_MODE_INVALID",
  "INPUT_CONFIGURATION_INVALID",
  "ORDER_CONFIGURATION_INVALID",
  "UNBOUNDED_CYCLE",
  "ORDER_REQUIRED",
  "PAYMENT_BEFORE_OFFER",
  "WALLET_IDEMPOTENCY_MISSING"
] as const;

export type ScenarioValidationCode =
  typeof SCENARIO_VALIDATION_CODES[number];

export interface ScenarioValidationIssue {
  readonly code: ScenarioValidationCode;
  readonly message: string;
  readonly nodeId: string | null;
  readonly edgeId: string | null;
}

export interface ScenarioValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ScenarioValidationIssue[];
}

export function validateScenarioGraph(
  graph: ScenarioGraph
): ScenarioValidationResult {
  const issues: ScenarioValidationIssue[] = [];
  const nodes = uniqueNodes(graph.nodes, issues);
  const edges = uniqueEdges(graph.edges, issues);
  const starts = [...nodes.values()].filter((node) => node.type === "start");

  if (starts.length !== 1) {
    issues.push(issue(
      "START_COUNT",
      "Сценарий должен содержать ровно один стартовый узел."
    ));
  }
  if (![...nodes.values()].some((node) => node.type === "end")) {
    issues.push(issue(
      "END_MISSING",
      "Сценарий должен содержать хотя бы один конечный узел."
    ));
  }

  const outgoing = new Map<string, ScenarioEdge[]>();
  const incoming = new Map<string, ScenarioEdge[]>();
  for (const edge of edges.values()) {
    const from = nodes.get(edge.fromNodeId);
    const to = nodes.get(edge.toNodeId);
    if (!from || !to) {
      issues.push(issue(
        "BROKEN_EDGE",
        "Переход ссылается на отсутствующий узел.",
        null,
        edge.id
      ));
      continue;
    }
    pushEdge(outgoing, edge.fromNodeId, edge);
    pushEdge(incoming, edge.toNodeId, edge);
  }

  for (const start of starts) {
    if ((incoming.get(start.id)?.length ?? 0) > 0) {
      issues.push(issue(
        "START_HAS_INCOMING_EDGE",
        "Стартовый узел не может иметь входящих переходов.",
        start.id
      ));
    }
  }

  for (const node of nodes.values()) {
    const nodeOutgoing = outgoing.get(node.id) ?? [];
    const outgoingCount = nodeOutgoing.length;
    if (node.type === "end" && outgoingCount > 0) {
      issues.push(issue(
        "END_HAS_OUTGOING_EDGE",
        "Конечный узел не может иметь исходящих переходов.",
        node.id
      ));
    } else if (node.type !== "end" && outgoingCount === 0) {
      issues.push(issue(
        "DEAD_END",
        "Узел обрывает сценарий без конечного перехода.",
        node.id
      ));
    }
    if (
      node.type === "wallet_credit"
      && !hasNonEmptyString(node.payload, "idempotencyKeyTemplate")
    ) {
      issues.push(issue(
        "WALLET_IDEMPOTENCY_MISSING",
        "Начисление кошелька требует шаблон idempotency key.",
        node.id
      ));
    }
    if (
      (node.type === "message"
        || node.type === "menu"
        || node.type === "choice"
        || node.type === "text_input"
        || node.type === "number_input")
      && !isValidPresentationText(node.payload.text)
    ) {
      issues.push(issue(
        "PRESENTATION_INVALID",
        "Текст сообщения должен содержать от 1 до 4096 символов.",
        node.id
      ));
    }
    if (
      node.type === "end"
      && node.payload.text !== undefined
      && !isValidPresentationText(node.payload.text)
    ) {
      issues.push(issue(
        "PRESENTATION_INVALID",
        "Текст конечного узла должен содержать от 1 до 4096 символов.",
        node.id
      ));
    }
    if (
      node.type === "start"
      && !isSingleAutomaticTransition(nodeOutgoing)
    ) {
      issues.push(issue(
        "TRANSITION_MODE_INVALID",
        "Стартовый узел должен иметь один автоматический переход без подписи.",
        node.id
      ));
    }
    if (
      node.type === "message"
      && outgoingCount > 0
      && !isSingleAutomaticTransition(nodeOutgoing)
      && !hasValidButtonTransitions(nodeOutgoing)
    ) {
      issues.push(issue(
        "TRANSITION_MODE_INVALID",
        "Сообщение должно иметь один автоматический переход или только подписанные кнопки.",
        node.id
      ));
    }
    if (
      (node.type === "menu" || node.type === "choice")
      && outgoingCount > 0
      && !hasValidButtonTransitions(nodeOutgoing)
    ) {
      issues.push(issue(
        "TRANSITION_MODE_INVALID",
        "Меню и выбор должны иметь только подписанные кнопки до 64 символов.",
        node.id
      ));
    }
    if (
      (node.type === "text_input" || node.type === "number_input")
      && (
        !isSingleAutomaticTransition(nodeOutgoing)
        || !scenarioInputRequest(node)
      )
    ) {
      issues.push(issue(
        "INPUT_CONFIGURATION_INVALID",
        "Узел ввода требует безопасный ключ контекста, явные границы и один автоматический переход.",
        node.id
      ));
    }
    if (
      node.type === "order_start"
      && (
        !isSingleAutomaticTransition(nodeOutgoing)
        || !scenarioOrderStartRequest(node)
      )
    ) {
      issues.push(issue(
        "ORDER_CONFIGURATION_INVALID",
        "Создание заказа требует валюту, позиции из контекста и один автоматический переход.",
        node.id
      ));
    }
    if (
      (node.type === "offer_acceptance" || node.type === "payment_start")
      && !isSingleAutomaticTransition(nodeOutgoing)
    ) {
      issues.push(issue(
        "TRANSITION_MODE_INVALID",
        "Узел оферты или оплаты должен иметь один автоматический переход.",
        node.id
      ));
    }
  }

  const start = starts.length === 1 ? starts[0] : undefined;
  if (start) {
    for (const node of findUnreachable(start.id, nodes, outgoing)) {
      issues.push(issue(
        "UNREACHABLE_NODE",
        "Узел недостижим из стартового узла.",
        node.id
      ));
    }
    for (const nodeId of findUnboundedCycleNodes(start.id, nodes, outgoing)) {
      issues.push(issue(
        "UNBOUNDED_CYCLE",
        "Цикл должен содержать узел с положительным maxIterations.",
        nodeId
      ));
    }
    for (const nodeId of findActionsBeforeOrder(start.id, nodes, outgoing)) {
      issues.push(issue(
        "ORDER_REQUIRED",
        "До оферты или оплаты на каждом пути требуется создать заказ.",
        nodeId
      ));
    }
    for (const nodeId of findPaymentsBeforeOffer(start.id, nodes, outgoing)) {
      issues.push(issue(
        "PAYMENT_BEFORE_OFFER",
        "До запуска оплаты на каждом пути требуется принятие оферты.",
        nodeId
      ));
    }
  }

  return {
    valid: issues.length === 0,
    issues: issues.sort(compareIssues)
  };
}

function uniqueNodes(
  input: readonly ScenarioNode[],
  issues: ScenarioValidationIssue[]
): Map<string, ScenarioNode> {
  const nodes = new Map<string, ScenarioNode>();
  for (const node of input) {
    if (nodes.has(node.id)) {
      issues.push(issue(
        "DUPLICATE_NODE_ID",
        "Идентификатор узла должен быть уникальным.",
        node.id
      ));
    } else {
      nodes.set(node.id, node);
    }
  }
  return nodes;
}

function uniqueEdges(
  input: readonly ScenarioEdge[],
  issues: ScenarioValidationIssue[]
): Map<string, ScenarioEdge> {
  const edges = new Map<string, ScenarioEdge>();
  for (const edge of input) {
    if (edges.has(edge.id)) {
      issues.push(issue(
        "DUPLICATE_EDGE_ID",
        "Идентификатор перехода должен быть уникальным.",
        null,
        edge.id
      ));
    } else {
      edges.set(edge.id, edge);
    }
  }
  return edges;
}

function pushEdge(
  map: Map<string, ScenarioEdge[]>,
  nodeId: string,
  edge: ScenarioEdge
): void {
  const current = map.get(nodeId);
  if (current) {
    current.push(edge);
  } else {
    map.set(nodeId, [edge]);
  }
}

function isValidPresentationText(value: unknown): boolean {
  return typeof value === "string"
    && value.trim().length >= 1
    && value.trim().length <= 4_096;
}

function isSingleAutomaticTransition(
  edges: readonly ScenarioEdge[]
): boolean {
  return edges.length === 1 && edges[0]?.label === null;
}

function hasValidButtonTransitions(
  edges: readonly ScenarioEdge[]
): boolean {
  return edges.length > 0 && edges.every((edge) => {
    const label = edge.label?.trim();
    return Boolean(label && label.length <= 64);
  });
}

function findUnreachable(
  startId: string,
  nodes: ReadonlyMap<string, ScenarioNode>,
  outgoing: ReadonlyMap<string, readonly ScenarioEdge[]>
): readonly ScenarioNode[] {
  const reached = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || reached.has(nodeId)) {
      continue;
    }
    reached.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (nodes.has(edge.toNodeId)) {
        queue.push(edge.toNodeId);
      }
    }
  }
  return [...nodes.values()].filter((node) => !reached.has(node.id));
}

function findUnboundedCycleNodes(
  startId: string,
  nodes: ReadonlyMap<string, ScenarioNode>,
  outgoing: ReadonlyMap<string, readonly ScenarioEdge[]>
): readonly string[] {
  const indexByNode = new Map<string, number>();
  const lowByNode = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const unbounded = new Set<string>();
  let nextIndex = 0;

  function visit(nodeId: string): void {
    indexByNode.set(nodeId, nextIndex);
    lowByNode.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const edge of outgoing.get(nodeId) ?? []) {
      if (!nodes.has(edge.toNodeId)) {
        continue;
      }
      if (!indexByNode.has(edge.toNodeId)) {
        visit(edge.toNodeId);
        lowByNode.set(
          nodeId,
          Math.min(
            lowByNode.get(nodeId) ?? 0,
            lowByNode.get(edge.toNodeId) ?? 0
          )
        );
      } else if (onStack.has(edge.toNodeId)) {
        lowByNode.set(
          nodeId,
          Math.min(
            lowByNode.get(nodeId) ?? 0,
            indexByNode.get(edge.toNodeId) ?? 0
          )
        );
      }
    }

    if (lowByNode.get(nodeId) !== indexByNode.get(nodeId)) {
      return;
    }
    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (current) {
        onStack.delete(current);
        component.push(current);
      }
    } while (current !== nodeId);

    const selfLoop = component.length === 1
      && (outgoing.get(component[0] ?? "") ?? [])
        .some((edge) => edge.toNodeId === component[0]);
    if (
      (component.length > 1 || selfLoop)
      && !component.some((id) => hasPositiveIterationLimit(nodes.get(id)))
    ) {
      for (const id of component) {
        unbounded.add(id);
      }
    }
  }

  visit(startId);
  return [...unbounded].sort();
}

function findPaymentsBeforeOffer(
  startId: string,
  nodes: ReadonlyMap<string, ScenarioNode>,
  outgoing: ReadonlyMap<string, readonly ScenarioEdge[]>
): readonly string[] {
  const invalidPayments = new Set<string>();
  const visited = new Set<string>();
  const queue: Array<{ readonly nodeId: string; readonly offerAccepted: boolean }> = [
    { nodeId: startId, offerAccepted: false }
  ];
  while (queue.length > 0) {
    const state = queue.shift();
    if (!state) {
      continue;
    }
    const key = `${state.nodeId}:${state.offerAccepted ? "1" : "0"}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    const node = nodes.get(state.nodeId);
    if (!node) {
      continue;
    }
    const offerAccepted = state.offerAccepted || node.type === "offer_acceptance";
    if (node.type === "payment_start" && !offerAccepted) {
      invalidPayments.add(node.id);
    }
    for (const edge of outgoing.get(node.id) ?? []) {
      queue.push({ nodeId: edge.toNodeId, offerAccepted });
    }
  }
  return [...invalidPayments].sort();
}

function findActionsBeforeOrder(
  startId: string,
  nodes: ReadonlyMap<string, ScenarioNode>,
  outgoing: ReadonlyMap<string, readonly ScenarioEdge[]>
): readonly string[] {
  const invalidActions = new Set<string>();
  const visited = new Set<string>();
  const queue: Array<{ readonly nodeId: string; readonly orderCreated: boolean }> = [
    { nodeId: startId, orderCreated: false }
  ];
  while (queue.length > 0) {
    const state = queue.shift();
    if (!state) {
      continue;
    }
    const key = `${state.nodeId}:${state.orderCreated ? "1" : "0"}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    const node = nodes.get(state.nodeId);
    if (!node) {
      continue;
    }
    if (
      (node.type === "offer_acceptance" || node.type === "payment_start")
      && !state.orderCreated
    ) {
      invalidActions.add(node.id);
    }
    const orderCreated = state.orderCreated || node.type === "order_start";
    for (const edge of outgoing.get(node.id) ?? []) {
      queue.push({ nodeId: edge.toNodeId, orderCreated });
    }
  }
  return [...invalidActions].sort();
}

function hasPositiveIterationLimit(node: ScenarioNode | undefined): boolean {
  const value = node?.payload.maxIterations;
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function hasNonEmptyString(
  record: Readonly<Record<string, unknown>>,
  key: string
): boolean {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0;
}

function issue(
  code: ScenarioValidationCode,
  message: string,
  nodeId: string | null = null,
  edgeId: string | null = null
): ScenarioValidationIssue {
  return { code, message, nodeId, edgeId };
}

function compareIssues(
  left: ScenarioValidationIssue,
  right: ScenarioValidationIssue
): number {
  return [
    left.code.localeCompare(right.code),
    (left.nodeId ?? "").localeCompare(right.nodeId ?? ""),
    (left.edgeId ?? "").localeCompare(right.edgeId ?? "")
  ].find((value) => value !== 0) ?? 0;
}

export interface ScenarioPresentationButton {
  readonly text: string;
  readonly edgeId: string;
}

export interface ScenarioPresentation {
  readonly text: string;
  readonly buttons: readonly ScenarioPresentationButton[];
}

export type ScenarioInputRequest =
  | {
      readonly kind: "text";
      readonly contextKey: string;
      readonly minimumLength: number;
      readonly maximumLength: number;
    }
  | {
      readonly kind: "number";
      readonly contextKey: string;
      readonly minimum: number;
      readonly maximum: number;
    };

export type ScenarioInputValue = string | number;

export interface ScenarioOrderStartItemRequest {
  readonly productId: string;
  readonly quantityContextKey: string;
  readonly optional: boolean;
}

export interface ScenarioOrderStartRequest {
  readonly currency: string;
  readonly items: readonly ScenarioOrderStartItemRequest[];
}

export type ScenarioInputSubmissionResult =
  | {
      readonly accepted: false;
      readonly reason: "input_not_expected" | "invalid_input";
      readonly message: string;
    }
  | {
      readonly accepted: true;
      readonly contextKey: string;
      readonly value: ScenarioInputValue;
      readonly execution: ScenarioExecutionResult;
    };

export interface ScenarioExecutionVisit {
  readonly nodeId: string;
  readonly viaEdgeId: string | null;
}

export type ScenarioExecutionBlockReason =
  | "current_node_missing"
  | "invalid_transition"
  | "ambiguous_automatic_transition"
  | "invalid_presentation"
  | "unsupported_node"
  | "step_limit_exceeded";

export type ScenarioExecutionResult =
  | {
      readonly status: "waiting_input" | "completed";
      readonly currentNodeId: string;
      readonly presentations: readonly ScenarioPresentation[];
      readonly visits: readonly ScenarioExecutionVisit[];
      readonly blockReason: null;
      readonly inputRequest: ScenarioInputRequest | null;
    }
  | {
      readonly status: "blocked";
      readonly currentNodeId: string;
      readonly presentations: readonly ScenarioPresentation[];
      readonly visits: readonly ScenarioExecutionVisit[];
      readonly blockReason: ScenarioExecutionBlockReason;
      readonly inputRequest: null;
    };

export function executeScenarioGraph(input: {
  readonly graph: ScenarioGraph;
  readonly currentNodeId: string;
  readonly selectedEdgeId?: string;
  readonly maximumSteps?: number;
}): ScenarioExecutionResult {
  const maximumSteps = input.maximumSteps ?? 100;
  if (
    !Number.isSafeInteger(maximumSteps)
    || maximumSteps < 1
    || maximumSteps > 1_000
  ) {
    return blocked(
      input.currentNodeId,
      [],
      [],
      "step_limit_exceeded"
    );
  }
  const nodes = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, ScenarioEdge[]>();
  for (const edge of input.graph.edges) {
    pushEdge(outgoing, edge.fromNodeId, edge);
  }

  let currentNodeId = input.currentNodeId;
  let viaEdgeId: string | null = null;
  const presentations: ScenarioPresentation[] = [];
  const visits: ScenarioExecutionVisit[] = [];

  if (input.selectedEdgeId) {
    const selected = (outgoing.get(currentNodeId) ?? [])
      .find((edge) => edge.id === input.selectedEdgeId);
    if (!selected) {
      return blocked(
        currentNodeId,
        presentations,
        visits,
        "invalid_transition"
      );
    }
    currentNodeId = selected.toNodeId;
    viaEdgeId = selected.id;
  }

  for (let step = 0; step < maximumSteps; step += 1) {
    const node = nodes.get(currentNodeId);
    if (!node) {
      return blocked(
        currentNodeId,
        presentations,
        visits,
        "current_node_missing"
      );
    }
    visits.push({ nodeId: node.id, viaEdgeId });
    viaEdgeId = null;

    if (node.type === "end") {
      const text = optionalPresentationText(node.payload);
      if (text === undefined) {
        return blocked(
          node.id,
          presentations,
          visits,
          "invalid_presentation"
        );
      }
      if (text) {
        presentations.push({ text, buttons: [] });
      }
      return {
        status: "completed",
        currentNodeId: node.id,
        presentations,
        visits,
        blockReason: null,
        inputRequest: null
      };
    }

    if (node.type === "start") {
      const automatic = automaticTransition(outgoing.get(node.id) ?? []);
      if (!automatic) {
        return blocked(
          node.id,
          presentations,
          visits,
          "ambiguous_automatic_transition"
        );
      }
      currentNodeId = automatic.toNodeId;
      viaEdgeId = automatic.id;
      continue;
    }

    if (node.type === "message") {
      const text = requiredPresentationText(node.payload);
      if (!text) {
        return blocked(
          node.id,
          presentations,
          visits,
          "invalid_presentation"
        );
      }
      const transitions = outgoing.get(node.id) ?? [];
      const automatic = automaticTransition(transitions);
      if (automatic) {
        presentations.push({ text, buttons: [] });
        currentNodeId = automatic.toNodeId;
        viaEdgeId = automatic.id;
        continue;
      }
      const buttons = transitionButtons(transitions);
      if (!buttons) {
        return blocked(
          node.id,
          presentations,
          visits,
          "invalid_presentation"
        );
      }
      presentations.push({ text, buttons });
      return {
        status: "waiting_input",
        currentNodeId: node.id,
        presentations,
        visits,
        blockReason: null,
        inputRequest: null
      };
    }

    if (node.type === "menu" || node.type === "choice") {
      const text = requiredPresentationText(node.payload);
      const buttons = transitionButtons(outgoing.get(node.id) ?? []);
      if (!text || !buttons || buttons.length === 0) {
        return blocked(
          node.id,
          presentations,
          visits,
          "invalid_presentation"
        );
      }
      presentations.push({ text, buttons });
      return {
        status: "waiting_input",
        currentNodeId: node.id,
        presentations,
        visits,
        blockReason: null,
        inputRequest: null
      };
    }

    if (node.type === "text_input" || node.type === "number_input") {
      const text = requiredPresentationText(node.payload);
      const inputRequest = scenarioInputRequest(node);
      if (
        !text
        || !inputRequest
        || !automaticTransition(outgoing.get(node.id) ?? [])
      ) {
        return blocked(
          node.id,
          presentations,
          visits,
          "invalid_presentation"
        );
      }
      presentations.push({ text, buttons: [] });
      return {
        status: "waiting_input",
        currentNodeId: node.id,
        presentations,
        visits,
        blockReason: null,
        inputRequest
      };
    }

    return blocked(
      node.id,
      presentations,
      visits,
      "unsupported_node"
    );
  }

  return blocked(
    currentNodeId,
    presentations,
    visits,
    "step_limit_exceeded"
  );
}

export function submitScenarioInput(input: {
  readonly graph: ScenarioGraph;
  readonly currentNodeId: string;
  readonly rawValue: string;
  readonly maximumSteps?: number;
}): ScenarioInputSubmissionResult {
  const node = input.graph.nodes.find(
    (candidate) => candidate.id === input.currentNodeId
  );
  if (!node || (node.type !== "text_input" && node.type !== "number_input")) {
    return {
      accepted: false,
      reason: "input_not_expected",
      message: "Сейчас сценарий не ожидает текстовый ввод."
    };
  }
  const request = scenarioInputRequest(node);
  if (!request) {
    return {
      accepted: false,
      reason: "input_not_expected",
      message: "Настройка ввода временно недоступна."
    };
  }
  const value = parseScenarioInputValue(request, input.rawValue);
  if (value === null) {
    return {
      accepted: false,
      reason: "invalid_input",
      message: inputValidationMessage(request)
    };
  }
  const transition = automaticTransition(
    input.graph.edges.filter((edge) => edge.fromNodeId === node.id)
  );
  if (!transition) {
    return {
      accepted: false,
      reason: "input_not_expected",
      message: "Продолжение сценария временно недоступно."
    };
  }
  return {
    accepted: true,
    contextKey: request.contextKey,
    value,
    execution: executeScenarioGraph({
      graph: input.graph,
      currentNodeId: node.id,
      selectedEdgeId: transition.id,
      ...(input.maximumSteps === undefined
        ? {}
        : { maximumSteps: input.maximumSteps })
    })
  };
}

function automaticTransition(
  edges: readonly ScenarioEdge[]
): ScenarioEdge | null {
  if (edges.length !== 1 || edges[0]?.label !== null) {
    return null;
  }
  return edges[0];
}

function transitionButtons(
  edges: readonly ScenarioEdge[]
): readonly ScenarioPresentationButton[] | null {
  if (edges.length === 0) {
    return null;
  }
  const sorted = [...edges].sort((left, right) =>
    right.priority - left.priority || left.id.localeCompare(right.id)
  );
  const buttons: ScenarioPresentationButton[] = [];
  for (const edge of sorted) {
    const text = edge.label?.trim();
    if (!text || text.length > 64) {
      return null;
    }
    buttons.push({ text, edgeId: edge.id });
  }
  return buttons;
}

function requiredPresentationText(
  payload: Readonly<Record<string, unknown>>
): string | null {
  const value = payload.text;
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length >= 1 && text.length <= 4_096 ? text : null;
}

function optionalPresentationText(
  payload: Readonly<Record<string, unknown>>
): string | null | undefined {
  if (payload.text === undefined) {
    return null;
  }
  return requiredPresentationText(payload) ?? undefined;
}

function scenarioInputRequest(
  node: ScenarioNode
): ScenarioInputRequest | null {
  const contextKey = node.payload.contextKey;
  if (
    typeof contextKey !== "string"
    || !isSafeContextKey(contextKey)
  ) {
    return null;
  }
  if (node.type === "text_input") {
    const minimumLength = node.payload.minimumLength;
    const maximumLength = node.payload.maximumLength;
    if (
      !Number.isSafeInteger(minimumLength)
      || !Number.isSafeInteger(maximumLength)
      || (minimumLength as number) < 1
      || (maximumLength as number) > 4_096
      || (minimumLength as number) > (maximumLength as number)
    ) {
      return null;
    }
    return {
      kind: "text",
      contextKey,
      minimumLength: minimumLength as number,
      maximumLength: maximumLength as number
    };
  }
  if (node.type === "number_input") {
    const minimum = node.payload.minimum;
    const maximum = node.payload.maximum;
    if (
      !Number.isSafeInteger(minimum)
      || !Number.isSafeInteger(maximum)
      || (minimum as number) > (maximum as number)
    ) {
      return null;
    }
    return {
      kind: "number",
      contextKey,
      minimum: minimum as number,
      maximum: maximum as number
    };
  }
  return null;
}

export function scenarioOrderStartRequest(
  node: ScenarioNode
): ScenarioOrderStartRequest | null {
  if (node.type !== "order_start") {
    return null;
  }
  const currency = node.payload.currency;
  const items = node.payload.items;
  if (
    typeof currency !== "string"
    || !/^[A-Z]{3}$/.test(currency)
    || !Array.isArray(items)
    || items.length < 1
    || items.length > 20
  ) {
    return null;
  }
  const productIds = new Set<string>();
  const parsedItems: ScenarioOrderStartItemRequest[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const record = item as Readonly<Record<string, unknown>>;
    const productId = record.productId;
    const quantityContextKey = record.quantityContextKey;
    const optional = record.optional ?? false;
    if (
      typeof productId !== "string"
      || !UUID_PATTERN.test(productId)
      || productIds.has(productId)
      || typeof quantityContextKey !== "string"
      || !isSafeContextKey(quantityContextKey)
      || typeof optional !== "boolean"
      || Object.keys(record).some(
        (key) => !["productId", "quantityContextKey", "optional"].includes(key)
      )
    ) {
      return null;
    }
    productIds.add(productId);
    parsedItems.push({ productId, quantityContextKey, optional });
  }
  return { currency, items: parsedItems };
}

function isSafeContextKey(value: string): boolean {
  return /^[a-z][a-zA-Z0-9_]{0,63}$/.test(value)
    && value !== "constructor"
    && value !== "prototype";
}

function parseScenarioInputValue(
  request: ScenarioInputRequest,
  rawValue: string
): ScenarioInputValue | null {
  const value = rawValue.trim();
  if (request.kind === "text") {
    return value.length >= request.minimumLength
      && value.length <= request.maximumLength
      ? value
      : null;
  }
  if (!/^(0|-?[1-9]\d*)$/.test(value)) {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number)
    && number >= request.minimum
    && number <= request.maximum
    ? number
    : null;
}

function inputValidationMessage(request: ScenarioInputRequest): string {
  return request.kind === "text"
    ? `Введите текст длиной от ${request.minimumLength} до ${request.maximumLength} символов.`
    : `Введите целое число от ${request.minimum} до ${request.maximum}.`;
}

function blocked(
  currentNodeId: string,
  presentations: readonly ScenarioPresentation[],
  visits: readonly ScenarioExecutionVisit[],
  blockReason: ScenarioExecutionBlockReason
): ScenarioExecutionResult {
  return {
    status: "blocked",
    currentNodeId,
    presentations,
    visits,
    blockReason,
    inputRequest: null
  };
}
