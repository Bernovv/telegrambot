import type { MessengerChannel } from "@ticket-platform/domain";
import type {
  AdvanceTelegramScenarioCommand,
  AdvanceTelegramScenarioResult,
  CreateOrderCommand,
  CreateOrderResult,
  ResumeTelegramScenarioAfterOfferCommand,
  ResumeTelegramScenarioAfterOfferResult,
  ResumeTelegramScenarioAfterPaymentCommand,
  ResumeTelegramScenarioAfterPaymentResult,
  ScenarioPresentationModel,
  StartTelegramScenarioCommand,
  StartTelegramScenarioResult,
  SubmitTelegramScenarioInputCommand,
  SubmitTelegramScenarioInputResult
} from "@ticket-platform/contracts";
import {
  executeScenarioGraph,
  scenarioOrderStartRequest,
  submitScenarioInput,
  type ScenarioExecutionResult,
  type ScenarioGraph,
  type ScenarioOrderStartItemRequest
} from "@ticket-platform/scenario-engine";
import type {
  IdGenerator,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";

export interface ScenarioRuntimeSession {
  readonly id: string;
  readonly userId: string;
  readonly eventId: string;
  readonly scenarioVersionId: string;
  readonly currentNodeId: string;
  readonly lockVersion: number;
  readonly newlyCreated: boolean;
  readonly graph: ScenarioGraph;
  readonly context: Readonly<Record<string, unknown>>;
}

export type OpenTelegramScenarioResult =
  | {
      readonly status:
        | "event_not_found"
        | "event_selection_required"
        | "scenario_not_published"
        | "scenario_invalid";
    }
  | {
      readonly status: "ready";
      readonly session: ScenarioRuntimeSession;
    };

export type LockTelegramScenarioResult =
  | {
      readonly status: "session_not_found" | "session_not_waiting";
    }
  | {
      readonly status: "ready";
      readonly session: ScenarioRuntimeSession;
    };

export type LockTelegramScenarioInputResult =
  | {
      readonly status: "input_not_expected" | "input_ambiguous";
    }
  | {
      readonly status: "ready";
      readonly session: ScenarioRuntimeSession;
    };

export type LockTelegramScenarioActionResult =
  | {
      readonly status: "action_not_expected" | "action_ambiguous";
    }
  | {
      readonly status: "ready";
      readonly session: ScenarioRuntimeSession;
    };

export interface ScenarioOrderCreator {
  execute(command: CreateOrderCommand): Promise<CreateOrderResult>;
}

export interface SaveScenarioExecutionInput {
  readonly session: ScenarioRuntimeSession;
  readonly commandIdempotencyKey: string;
  readonly commandKind: "start" | "transition" | "input" | "offer" | "payment";
  readonly callbackQueryId: string | null;
  readonly selectedEdgeId: string | null;
  readonly contextPatch: Readonly<Record<string, unknown>>;
  readonly execution: ScenarioExecutionResult;
  readonly occurredAt: Date;
}

export interface ScenarioRuntimeRepository {
  findProcessedSession(commandIdempotencyKey: string): Promise<string | null>;
  lockOrCreateForTelegramStart(input: {
    readonly channel: MessengerChannel;
    readonly userId: string;
    readonly messengerIdentityId: string;
    readonly eventSlug: string | null;
    readonly proposedSessionId: string;
    readonly occurredAt: Date;
    readonly expiresAt: Date;
  }): Promise<OpenTelegramScenarioResult>;
  lockForTelegramTransition(input: {
    readonly channel: MessengerChannel;
    readonly sessionId: string;
    readonly senderExternalUserId: string;
    readonly occurredAt: Date;
  }): Promise<LockTelegramScenarioResult>;
  lockForTelegramInput(input: {
    readonly channel: MessengerChannel;
    readonly senderExternalUserId: string;
    readonly occurredAt: Date;
  }): Promise<LockTelegramScenarioInputResult>;
  lockForTelegramOrderAction(input: {
    readonly channel: MessengerChannel;
    readonly orderId: string;
    readonly senderExternalUserId: string;
    readonly nodeType: "offer_acceptance";
    readonly occurredAt: Date;
  }): Promise<LockTelegramScenarioActionResult>;
  lockForTelegramPaymentCompletion(input: {
    readonly orderId: string;
    readonly occurredAt: Date;
  }): Promise<LockTelegramScenarioActionResult>;
  recordInputRejection(input: {
    readonly sessionId: string;
    readonly currentNodeId: string;
    readonly commandIdempotencyKey: string;
    readonly reason: "input_not_expected" | "invalid_input";
    readonly occurredAt: Date;
  }): Promise<void>;
  saveExecution(input: SaveScenarioExecutionInput): Promise<void>;
}

export class StartTelegramScenarioService {
  constructor(
    private readonly repository: ScenarioRuntimeRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly sessionTtlMs = 24 * 60 * 60 * 1_000,
    private readonly orderCreator?: ScenarioOrderCreator
  ) {}

  execute(command: StartTelegramScenarioCommand): Promise<StartTelegramScenarioResult> {
    const idempotencyKey = scenarioCommandKey(command.updateId, "start");

    return this.unitOfWork.transact(async () => {
      const processedSessionId = await this.repository.findProcessedSession(
        idempotencyKey
      );
      if (processedSessionId) {
        return duplicateStartResult(processedSessionId);
      }

      const opened = await this.repository.lockOrCreateForTelegramStart({
        channel: command.channel,
        userId: command.userId,
        messengerIdentityId: command.messengerIdentityId,
        eventSlug: command.eventSlug,
        proposedSessionId: this.idGenerator.newId(),
        occurredAt: command.occurredAt,
        expiresAt: new Date(command.occurredAt.getTime() + this.sessionTtlMs)
      });
      if (opened.status !== "ready") {
        return { handled: false, reason: opened.status };
      }
      const concurrentlyProcessedSessionId =
        await this.repository.findProcessedSession(idempotencyKey);
      if (concurrentlyProcessedSessionId) {
        return duplicateStartResult(concurrentlyProcessedSessionId);
      }

      const resolved = await resolveScenarioActions({
        session: opened.session,
        execution: executeScenarioGraph({
          graph: opened.session.graph,
          currentNodeId: opened.session.currentNodeId
        }),
        contextPatch: {},
        orderCreator: this.orderCreator,
        occurredAt: command.occurredAt
      });
      await this.repository.saveExecution({
        session: opened.session,
        commandIdempotencyKey: idempotencyKey,
        commandKind: "start",
        callbackQueryId: null,
        selectedEdgeId: null,
        contextPatch: resolved.contextPatch,
        execution: resolved.execution,
        occurredAt: command.occurredAt
      });
      return startResult(
        opened.session.id,
        resolved.execution,
        resolved.presentations
      );
    });
  }
}

export class AdvanceTelegramScenarioService {
  constructor(
    private readonly repository: ScenarioRuntimeRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly orderCreator?: ScenarioOrderCreator
  ) {}

  execute(
    command: AdvanceTelegramScenarioCommand
  ): Promise<AdvanceTelegramScenarioResult> {
    const idempotencyKey = scenarioCommandKey(command.updateId, "transition");

    return this.unitOfWork.transact(async () => {
      const processedSessionId = await this.repository.findProcessedSession(
        idempotencyKey
      );
      if (processedSessionId) {
        return duplicateAdvanceResult(processedSessionId);
      }

      const locked = await this.repository.lockForTelegramTransition({
        sessionId: command.sessionId,
        channel: command.channel,
        senderExternalUserId: command.senderExternalUserId,
        occurredAt: command.occurredAt
      });
      if (locked.status !== "ready") {
        return { accepted: false, reason: locked.status };
      }
      const concurrentlyProcessedSessionId =
        await this.repository.findProcessedSession(idempotencyKey);
      if (concurrentlyProcessedSessionId) {
        return duplicateAdvanceResult(concurrentlyProcessedSessionId);
      }

      const execution = executeScenarioGraph({
        graph: locked.session.graph,
        currentNodeId: locked.session.currentNodeId,
        selectedEdgeId: command.edgeId
      });
      if (
        execution.status === "blocked"
        && execution.blockReason === "invalid_transition"
      ) {
        return { accepted: false, reason: "invalid_transition" };
      }

      const resolved = await resolveScenarioActions({
        session: locked.session,
        execution,
        contextPatch: {},
        orderCreator: this.orderCreator,
        occurredAt: command.occurredAt
      });
      await this.repository.saveExecution({
        session: locked.session,
        commandIdempotencyKey: idempotencyKey,
        commandKind: "transition",
        callbackQueryId: command.callbackQueryId,
        selectedEdgeId: command.edgeId,
        contextPatch: resolved.contextPatch,
        execution: resolved.execution,
        occurredAt: command.occurredAt
      });
      return advanceResult(
        locked.session.id,
        resolved.execution,
        resolved.presentations
      );
    });
  }
}

export class SubmitTelegramScenarioInputService {
  constructor(
    private readonly repository: ScenarioRuntimeRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly orderCreator?: ScenarioOrderCreator
  ) {}

  execute(
    command: SubmitTelegramScenarioInputCommand
  ): Promise<SubmitTelegramScenarioInputResult> {
    const idempotencyKey = scenarioCommandKey(command.updateId, "input");

    return this.unitOfWork.transact(async () => {
      const processedSessionId = await this.repository.findProcessedSession(
        idempotencyKey
      );
      if (processedSessionId) {
        return duplicateInputResult(processedSessionId);
      }
      const locked = await this.repository.lockForTelegramInput({
        channel: command.channel,
        senderExternalUserId: command.senderExternalUserId,
        occurredAt: command.occurredAt
      });
      if (locked.status !== "ready") {
        return { handled: false, reason: locked.status };
      }
      const concurrentlyProcessedSessionId =
        await this.repository.findProcessedSession(idempotencyKey);
      if (concurrentlyProcessedSessionId) {
        return duplicateInputResult(concurrentlyProcessedSessionId);
      }

      const submission = submitScenarioInput({
        graph: locked.session.graph,
        currentNodeId: locked.session.currentNodeId,
        rawValue: command.text
      });
      if (!submission.accepted) {
        await this.repository.recordInputRejection({
          sessionId: locked.session.id,
          currentNodeId: locked.session.currentNodeId,
          commandIdempotencyKey: idempotencyKey,
          reason: submission.reason,
          occurredAt: command.occurredAt
        });
        return {
          handled: true,
          accepted: false,
          duplicate: false,
          sessionId: locked.session.id,
          status: "waiting_input",
          presentations: [{ text: submission.message, buttons: [] }]
        };
      }

      const inputPatch = { [submission.contextKey]: submission.value };
      const resolved = await resolveScenarioActions({
        session: locked.session,
        execution: submission.execution,
        contextPatch: inputPatch,
        orderCreator: this.orderCreator,
        occurredAt: command.occurredAt
      });
      await this.repository.saveExecution({
        session: locked.session,
        commandIdempotencyKey: idempotencyKey,
        commandKind: "input",
        callbackQueryId: null,
        selectedEdgeId: null,
        contextPatch: resolved.contextPatch,
        execution: resolved.execution,
        occurredAt: command.occurredAt
      });
      return {
        handled: true,
        accepted: true,
        duplicate: false,
        sessionId: locked.session.id,
        status: resolved.execution.status,
        presentations: resolved.presentations
      };
    });
  }
}

export class ResumeTelegramScenarioAfterOfferService {
  constructor(
    private readonly repository: ScenarioRuntimeRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly orderCreator?: ScenarioOrderCreator
  ) {}

  execute(
    command: ResumeTelegramScenarioAfterOfferCommand
  ): Promise<ResumeTelegramScenarioAfterOfferResult> {
    const idempotencyKey = scenarioCommandKey(command.updateId, "offer");

    return this.unitOfWork.transact(async () => {
      const processedSessionId = await this.repository.findProcessedSession(
        idempotencyKey
      );
      if (processedSessionId) {
        return duplicateOfferResult(processedSessionId);
      }
      const locked = await this.repository.lockForTelegramOrderAction({
        orderId: command.orderId,
        channel: command.channel,
        senderExternalUserId: command.senderExternalUserId,
        nodeType: "offer_acceptance",
        occurredAt: command.occurredAt
      });
      if (locked.status !== "ready") {
        return { handled: false, reason: locked.status };
      }
      const order = readScenarioOrderContext(locked.session.context.order);
      if (!order || order.orderId !== command.orderId) {
        return { handled: false, reason: "action_not_expected" };
      }
      const edge = singleAutomaticEdge(
        locked.session.graph,
        locked.session.currentNodeId
      );
      if (!edge) {
        return { handled: false, reason: "action_not_expected" };
      }
      const resolved = await resolveScenarioActions({
        session: locked.session,
        execution: executeScenarioGraph({
          graph: locked.session.graph,
          currentNodeId: locked.session.currentNodeId,
          selectedEdgeId: edge.id
        }),
        contextPatch: {
          order: { ...order, status: "awaiting_payment" }
        },
        orderCreator: this.orderCreator,
        occurredAt: command.occurredAt
      });
      await this.repository.saveExecution({
        session: locked.session,
        commandIdempotencyKey: idempotencyKey,
        commandKind: "offer",
        callbackQueryId: null,
        selectedEdgeId: edge.id,
        contextPatch: resolved.contextPatch,
        execution: resolved.execution,
        occurredAt: command.occurredAt
      });
      return {
        handled: true,
        duplicate: false,
        sessionId: locked.session.id,
        status: resolved.execution.status,
        presentations: resolved.presentations
      };
    });
  }
}

export class ResumeTelegramScenarioAfterPaymentService {
  constructor(
    private readonly repository: ScenarioRuntimeRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly outboxWriter: OutboxWriter,
    private readonly idGenerator: IdGenerator,
    private readonly orderCreator?: ScenarioOrderCreator
  ) {}

  execute(
    command: ResumeTelegramScenarioAfterPaymentCommand
  ): Promise<ResumeTelegramScenarioAfterPaymentResult> {
    const idempotencyKey =
      `domain_event:${command.sourceEventId}:scenario_payment`;

    return this.unitOfWork.transact(async () => {
      const processedSessionId = await this.repository.findProcessedSession(
        idempotencyKey
      );
      if (processedSessionId) {
        return duplicatePaymentResult(processedSessionId);
      }
      const locked = await this.repository.lockForTelegramPaymentCompletion({
        orderId: command.orderId,
        occurredAt: command.occurredAt
      });
      if (locked.status !== "ready") {
        return { handled: false, reason: locked.status };
      }
      const order = readScenarioOrderContext(locked.session.context.order);
      if (!order || order.orderId !== command.orderId) {
        return { handled: false, reason: "action_not_expected" };
      }
      const edge = singleAutomaticEdge(
        locked.session.graph,
        locked.session.currentNodeId
      );
      if (!edge) {
        return { handled: false, reason: "action_not_expected" };
      }
      const resolved = await resolveScenarioActions({
        session: locked.session,
        execution: executeScenarioGraph({
          graph: locked.session.graph,
          currentNodeId: locked.session.currentNodeId,
          selectedEdgeId: edge.id
        }),
        contextPatch: {
          order: { ...order, status: "paid" }
        },
        orderCreator: this.orderCreator,
        occurredAt: command.occurredAt
      });
      await this.repository.saveExecution({
        session: locked.session,
        commandIdempotencyKey: idempotencyKey,
        commandKind: "payment",
        callbackQueryId: null,
        selectedEdgeId: edge.id,
        contextPatch: resolved.contextPatch,
        execution: resolved.execution,
        occurredAt: command.occurredAt
      });
      if (resolved.presentations.length > 0) {
        await this.outboxWriter.append({
          eventId: this.idGenerator.newId(),
          aggregateType: "scenario_session",
          aggregateId: locked.session.id,
          eventType: "ScenarioPresentationRequested",
          schemaVersion: 1,
          payload: {
            sessionId: locked.session.id,
            userId: locked.session.userId,
            presentations: resolved.presentations
          },
          occurredAt: command.occurredAt
        });
      }
      return {
        handled: true,
        duplicate: false,
        sessionId: locked.session.id,
        status: resolved.execution.status,
        presentations: resolved.presentations
      };
    });
  }
}

function scenarioCommandKey(
  updateId: string,
  kind: "start" | "transition" | "input" | "offer"
): string {
  return `telegram_update:${updateId}:scenario_${kind}`;
}

function duplicateInputResult(
  sessionId: string
): SubmitTelegramScenarioInputResult {
  return {
    handled: true,
    accepted: true,
    duplicate: true,
    sessionId,
    status: "waiting_input",
    presentations: []
  };
}

function duplicateOfferResult(
  sessionId: string
): ResumeTelegramScenarioAfterOfferResult {
  return {
    handled: true,
    duplicate: true,
    sessionId,
    status: "waiting_input",
    presentations: []
  };
}

function duplicatePaymentResult(
  sessionId: string
): ResumeTelegramScenarioAfterPaymentResult {
  return {
    handled: true,
    duplicate: true,
    sessionId,
    status: "waiting_input",
    presentations: []
  };
}

function startResult(
  sessionId: string,
  execution: ScenarioExecutionResult,
  resolvedPresentations: readonly ScenarioPresentationModel[]
): StartTelegramScenarioResult {
  return {
    handled: true,
    duplicate: false,
    sessionId,
    status: execution.status,
    presentations: resolvedPresentations
  };
}

function advanceResult(
  sessionId: string,
  execution: ScenarioExecutionResult,
  resolvedPresentations: readonly ScenarioPresentationModel[]
): AdvanceTelegramScenarioResult {
  return {
    accepted: true,
    duplicate: false,
    sessionId,
    status: execution.status,
    presentations: resolvedPresentations
  };
}

function duplicateStartResult(sessionId: string): StartTelegramScenarioResult {
  return {
    handled: true,
    duplicate: true,
    sessionId,
    status: "waiting_input",
    presentations: []
  };
}

function duplicateAdvanceResult(
  sessionId: string
): AdvanceTelegramScenarioResult {
  return {
    accepted: true,
    duplicate: true,
    sessionId,
    status: "waiting_input",
    presentations: []
  };
}

function presentations(
  execution: ScenarioExecutionResult
): readonly ScenarioPresentationModel[] {
  return execution.presentations.map((presentation) => ({
    text: presentation.text,
    buttons: presentation.buttons.map((button) => ({
      text: button.text,
      edgeId: button.edgeId
    }))
  }));
}

interface ResolvedScenarioExecution {
  readonly execution: ScenarioExecutionResult;
  readonly contextPatch: Readonly<Record<string, unknown>>;
  readonly presentations: readonly ScenarioPresentationModel[];
}

async function resolveScenarioActions(input: {
  readonly session: ScenarioRuntimeSession;
  readonly execution: ScenarioExecutionResult;
  readonly contextPatch: Readonly<Record<string, unknown>>;
  readonly orderCreator: ScenarioOrderCreator | undefined;
  readonly occurredAt: Date;
}): Promise<ResolvedScenarioExecution> {
  let execution = input.execution;
  let contextPatch: Record<string, unknown> = { ...input.contextPatch };
  const context: Record<string, unknown> = {
    ...input.session.context,
    ...contextPatch
  };

  for (let actionCount = 0; actionCount < 10; actionCount += 1) {
    if (
      execution.status !== "blocked"
      || execution.blockReason !== "unsupported_node"
    ) {
      return {
        execution,
        contextPatch,
        presentations: presentations(execution)
      };
    }
    const node = input.session.graph.nodes.find(
      (candidate) => candidate.id === execution.currentNodeId
    );
    if (!node) {
      return {
        execution,
        contextPatch,
        presentations: presentations(execution)
      };
    }

    if (node.type === "order_start" && input.orderCreator) {
      const request = scenarioOrderStartRequest(node);
      const edge = singleAutomaticEdge(input.session.graph, node.id);
      const items = request ? scenarioOrderItems(request.items, context) : null;
      if (!request || !edge || !items || items.length === 0) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Не удалось собрать состав заказа. Начните покупку заново."
        );
      }
      const order = await input.orderCreator.execute({
        idempotencyKey:
          `scenario_order:${input.session.id}:${node.id}:${input.session.lockVersion}`,
        userId: input.session.userId,
        eventId: input.session.eventId,
        currency: request.currency,
        items,
        wallet: { mode: "none" },
        source: "telegram_scenario",
        createdAt: input.occurredAt
      });
      const storedOrder = scenarioOrderContext(order);
      context.order = storedOrder;
      contextPatch = { ...contextPatch, order: storedOrder };
      execution = continueFromAction(input.session.graph, execution, edge.id);
      continue;
    }

    if (node.type === "offer_acceptance") {
      const order = readScenarioOrderContext(context.order);
      const edge = singleAutomaticEdge(input.session.graph, node.id);
      if (!order || !edge) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Данные заказа недоступны. Начните покупку заново."
        );
      }
      if (order.status !== "awaiting_offer") {
        execution = continueFromAction(input.session.graph, execution, edge.id);
        continue;
      }
      if (!order.offerPublicUrl) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Оферта временно недоступна. Попробуйте снова позже."
        );
      }
      return waitingAtAction(
        execution,
        contextPatch,
        orderSummaryText(order),
        [
          { text: "Читать оферту", url: order.offerPublicUrl },
          {
            text: "Я принимаю оферту",
            callbackData: `offer_accept:${order.publicToken}`
          }
        ]
      );
    }

    if (node.type === "payment_start") {
      const order = readScenarioOrderContext(context.order);
      if (!order) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Данные заказа недоступны. Начните покупку заново."
        );
      }
      const edge = singleAutomaticEdge(input.session.graph, node.id);
      if (order.status === "paid" && edge) {
        execution = continueFromAction(input.session.graph, execution, edge.id);
        continue;
      }
      return waitingAtAction(
        execution,
        contextPatch,
        orderSummaryText(order),
        [{
          text: "Оплатить",
          callbackData: `payment_init:${order.publicToken}`
        }]
      );
    }

    return {
      execution,
      contextPatch,
      presentations: presentations(execution)
    };
  }

  return {
    execution: {
      ...execution,
      status: "blocked",
      blockReason: "step_limit_exceeded",
      inputRequest: null
    },
    contextPatch,
    presentations: presentations(execution)
  };
}

interface StoredScenarioOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly publicToken: string;
  readonly offerPublicUrl: string | null;
  readonly status: "awaiting_offer" | "awaiting_payment" | "paid";
  readonly currency: string;
  readonly totalKopecks: string;
  readonly walletAppliedKopecks: string;
  readonly externalDueKopecks: string;
  readonly expiresAt: string;
}

function scenarioOrderContext(order: CreateOrderResult): StoredScenarioOrder {
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    publicToken: order.publicToken,
    offerPublicUrl: order.offerPublicUrl,
    status: order.status,
    currency: order.currency,
    totalKopecks: order.totalKopecks,
    walletAppliedKopecks: order.walletAppliedKopecks,
    externalDueKopecks: order.externalDueKopecks,
    expiresAt: order.expiresAt
  };
}

function readScenarioOrderContext(value: unknown): StoredScenarioOrder | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const order = value as Readonly<Record<string, unknown>>;
  if (
    typeof order.orderId !== "string"
    || typeof order.orderNumber !== "string"
    || typeof order.publicToken !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(order.publicToken)
    || (
      order.offerPublicUrl !== null
      && (
        typeof order.offerPublicUrl !== "string"
        || !order.offerPublicUrl.startsWith("https://")
      )
    )
    || (
      order.status !== "awaiting_offer"
      && order.status !== "awaiting_payment"
      && order.status !== "paid"
    )
    || typeof order.currency !== "string"
    || !/^[A-Z]{3}$/.test(order.currency)
    || !isKopeckString(order.totalKopecks)
    || !isKopeckString(order.walletAppliedKopecks)
    || !isKopeckString(order.externalDueKopecks)
    || typeof order.expiresAt !== "string"
    || !Number.isFinite(Date.parse(order.expiresAt))
  ) {
    return null;
  }
  return order as unknown as StoredScenarioOrder;
}

function scenarioOrderItems(
  requests: readonly ScenarioOrderStartItemRequest[],
  context: Readonly<Record<string, unknown>>
): CreateOrderCommand["items"] | null {
  const items: Array<{ readonly productId: string; readonly quantity: number }> = [];
  for (const request of requests) {
    const quantity = context[request.quantityContextKey];
    if (request.optional && (quantity === undefined || quantity === 0)) {
      continue;
    }
    if (!Number.isSafeInteger(quantity) || Number(quantity) < 1) {
      return null;
    }
    items.push({ productId: request.productId, quantity: Number(quantity) });
  }
  return items;
}

function singleAutomaticEdge(
  graph: ScenarioGraph,
  nodeId: string
) {
  const edges = graph.edges.filter((edge) => edge.fromNodeId === nodeId);
  return edges.length === 1 && edges[0]?.label === null ? edges[0] : null;
}

function continueFromAction(
  graph: ScenarioGraph,
  previous: ScenarioExecutionResult,
  edgeId: string
): ScenarioExecutionResult {
  const next = executeScenarioGraph({
    graph,
    currentNodeId: previous.currentNodeId,
    selectedEdgeId: edgeId
  });
  return {
    ...next,
    presentations: [...previous.presentations, ...next.presentations],
    visits: [...previous.visits, ...next.visits]
  };
}

function waitingAtAction(
  execution: ScenarioExecutionResult,
  contextPatch: Readonly<Record<string, unknown>>,
  text: string,
  buttons: ScenarioPresentationModel["buttons"] = []
): ResolvedScenarioExecution {
  return {
    execution: {
      status: "waiting_input",
      currentNodeId: execution.currentNodeId,
      presentations: execution.presentations,
      visits: execution.visits,
      blockReason: null,
      inputRequest: null
    },
    contextPatch,
    presentations: [
      ...presentations(execution),
      { text, buttons }
    ]
  };
}

function orderSummaryText(order: StoredScenarioOrder): string {
  return [
    `Заказ: ${order.orderNumber}`,
    `Итого: ${formatKopecks(order.totalKopecks)} ₽`,
    `К оплате: ${formatKopecks(order.externalDueKopecks)} ₽`,
    `Бронь до: ${order.expiresAt}`
  ].join("\n");
}

function formatKopecks(value: string): string {
  const kopecks = BigInt(value);
  const rubles = kopecks / 100n;
  const remainder = kopecks % 100n;
  return remainder === 0n
    ? rubles.toString()
    : `${rubles},${remainder.toString().padStart(2, "0")}`;
}

function isKopeckString(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}
