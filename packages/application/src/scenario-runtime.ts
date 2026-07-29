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
  SelectTelegramEventCommand,
  SelectTelegramEventResult,
  StartTelegramScenarioCommand,
  StartTelegramScenarioResult,
  SubmitTelegramScenarioInputCommand,
  SubmitTelegramScenarioInputResult,
  TelegramEventChoice
} from "@ticket-platform/contracts";
import {
  executeScenarioGraph,
  scenarioAddCategoryRequest,
  scenarioOrderAddItemRequest,
  scenarioOrderDraftStartRequest,
  scenarioOrderStartRequest,
  scenarioOrderSummaryRequest,
  scenarioSetStatusRequest,
  scenarioWalletCreditRequest,
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
import type {
  CompleteInternalOrderCommand,
  ConfirmPaymentResult
} from "./payment-confirmation.js";
import type {
  CreditScenarioWalletCommand,
  CreditScenarioWalletResult
} from "./scenario-wallet-credit.js";
import type {
  AddUserCategoryCommand,
  SetUserStatusCommand,
  UserClassificationResult
} from "./user-classification.js";

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
        | "participant_not_found"
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

export interface ScenarioInternalOrderCompleter {
  execute(command: CompleteInternalOrderCommand): Promise<ConfirmPaymentResult>;
}

export interface ScenarioWalletCreditor {
  execute(command: CreditScenarioWalletCommand): Promise<CreditScenarioWalletResult>;
}

export interface ScenarioUserClassifier {
  setStatus(command: SetUserStatusCommand): Promise<UserClassificationResult>;
  addCategory(command: AddUserCategoryCommand): Promise<UserClassificationResult>;
}

export interface SaveScenarioExecutionInput {
  readonly session: ScenarioRuntimeSession;
  readonly commandIdempotencyKey: string;
  readonly commandKind:
    | "start"
    | "event_selection"
    | "transition"
    | "input"
    | "offer"
    | "payment";
  readonly callbackQueryId: string | null;
  readonly selectedEdgeId: string | null;
  readonly contextPatch: Readonly<Record<string, unknown>>;
  readonly execution: ScenarioExecutionResult;
  readonly occurredAt: Date;
}

export interface ScenarioRuntimeRepository {
  findProcessedSession(commandIdempotencyKey: string): Promise<string | null>;
  listTelegramEventChoices(input: {
    readonly occurredAt: Date;
    readonly limit: number;
  }): Promise<{
    readonly events: readonly TelegramEventChoice[];
    readonly hasMoreEvents: boolean;
  }>;
  lockOrCreateForTelegramStart(input: {
    readonly userId: string;
    readonly messengerIdentityId: string;
    readonly eventSlug: string | null;
    readonly proposedSessionId: string;
    readonly occurredAt: Date;
    readonly expiresAt: Date;
  }): Promise<OpenTelegramScenarioResult>;
  lockOrCreateForTelegramEventSelection(input: {
    readonly eventId: string;
    readonly senderExternalUserId: string;
    readonly proposedSessionId: string;
    readonly occurredAt: Date;
    readonly expiresAt: Date;
  }): Promise<OpenTelegramScenarioResult>;
  lockForTelegramTransition(input: {
    readonly sessionId: string;
    readonly senderExternalUserId: string;
    readonly occurredAt: Date;
  }): Promise<LockTelegramScenarioResult>;
  lockForTelegramInput(input: {
    readonly senderExternalUserId: string;
    readonly occurredAt: Date;
  }): Promise<LockTelegramScenarioInputResult>;
  lockForTelegramOrderAction(input: {
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
    private readonly orderCreator?: ScenarioOrderCreator,
    private readonly internalOrderCompleter?: ScenarioInternalOrderCompleter,
    private readonly walletCreditor?: ScenarioWalletCreditor,
    private readonly userClassifier?: ScenarioUserClassifier
  ) {}

  execute(command: StartTelegramScenarioCommand): Promise<StartTelegramScenarioResult> {
    const idempotencyKey = scenarioCommandKey(command.updateId, "start");

    return executeTelegramScenarioOpening({
      repository: this.repository,
      unitOfWork: this.unitOfWork,
      idGenerator: this.idGenerator,
      idempotencyKey,
      commandKind: "start",
      callbackQueryId: null,
      occurredAt: command.occurredAt,
      sessionTtlMs: this.sessionTtlMs,
      orderCreator: this.orderCreator,
      internalOrderCompleter: this.internalOrderCompleter,
      walletCreditor: this.walletCreditor,
      userClassifier: this.userClassifier,
      open: (proposedSessionId, expiresAt) =>
        this.repository.lockOrCreateForTelegramStart({
          userId: command.userId,
          messengerIdentityId: command.messengerIdentityId,
          eventSlug: command.eventSlug,
          proposedSessionId,
          occurredAt: command.occurredAt,
          expiresAt
        })
    });
  }
}

export class SelectTelegramEventService {
  constructor(
    private readonly repository: ScenarioRuntimeRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly sessionTtlMs = 24 * 60 * 60 * 1_000,
    private readonly orderCreator?: ScenarioOrderCreator,
    private readonly internalOrderCompleter?: ScenarioInternalOrderCompleter,
    private readonly walletCreditor?: ScenarioWalletCreditor,
    private readonly userClassifier?: ScenarioUserClassifier
  ) {}

  execute(command: SelectTelegramEventCommand): Promise<SelectTelegramEventResult> {
    if (!UUID_PATTERN.test(command.eventId)) {
      return Promise.resolve({ handled: false, reason: "event_not_found" });
    }

    return executeTelegramScenarioOpening({
      repository: this.repository,
      unitOfWork: this.unitOfWork,
      idGenerator: this.idGenerator,
      idempotencyKey: scenarioCommandKey(command.updateId, "event_selection"),
      commandKind: "event_selection",
      callbackQueryId: command.callbackQueryId,
      occurredAt: command.occurredAt,
      sessionTtlMs: this.sessionTtlMs,
      orderCreator: this.orderCreator,
      internalOrderCompleter: this.internalOrderCompleter,
      walletCreditor: this.walletCreditor,
      userClassifier: this.userClassifier,
      open: (proposedSessionId, expiresAt) =>
        this.repository.lockOrCreateForTelegramEventSelection({
          eventId: command.eventId,
          senderExternalUserId: command.senderExternalUserId,
          proposedSessionId,
          occurredAt: command.occurredAt,
          expiresAt
        })
    });
  }
}

interface TelegramScenarioOpeningInput {
  readonly repository: ScenarioRuntimeRepository;
  readonly unitOfWork: UnitOfWork;
  readonly idGenerator: IdGenerator;
  readonly idempotencyKey: string;
  readonly commandKind: "start" | "event_selection";
  readonly callbackQueryId: string | null;
  readonly occurredAt: Date;
  readonly sessionTtlMs: number;
  readonly orderCreator: ScenarioOrderCreator | undefined;
  readonly internalOrderCompleter: ScenarioInternalOrderCompleter | undefined;
  readonly walletCreditor: ScenarioWalletCreditor | undefined;
  readonly userClassifier: ScenarioUserClassifier | undefined;
  readonly open: (
    proposedSessionId: string,
    expiresAt: Date
  ) => Promise<OpenTelegramScenarioResult>;
}

function executeTelegramScenarioOpening(
  input: TelegramScenarioOpeningInput
): Promise<StartTelegramScenarioResult> {
  return input.unitOfWork.transact(async () => {
    const processedSessionId = await input.repository.findProcessedSession(
      input.idempotencyKey
    );
    if (processedSessionId) {
      return duplicateStartResult(processedSessionId);
    }

    const opened = await input.open(
      input.idGenerator.newId(),
      new Date(input.occurredAt.getTime() + input.sessionTtlMs)
    );
    if (opened.status === "event_selection_required") {
      const choices = await input.repository.listTelegramEventChoices({
        occurredAt: input.occurredAt,
        limit: TELEGRAM_EVENT_CHOICE_LIMIT
      });
      return {
        handled: false,
        reason: "event_selection_required",
        ...choices
      };
    }
    if (opened.status !== "ready") {
      return { handled: false, reason: opened.status };
    }

    const concurrentlyProcessedSessionId =
      await input.repository.findProcessedSession(input.idempotencyKey);
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
      orderCreator: input.orderCreator,
      internalOrderCompleter: input.internalOrderCompleter,
      walletCreditor: input.walletCreditor,
      userClassifier: input.userClassifier,
      occurredAt: input.occurredAt
    });
    await input.repository.saveExecution({
      session: opened.session,
      commandIdempotencyKey: input.idempotencyKey,
      commandKind: input.commandKind,
      callbackQueryId: input.callbackQueryId,
      selectedEdgeId: null,
      contextPatch: resolved.contextPatch,
      execution: resolved.execution,
      occurredAt: input.occurredAt
    });
    return startResult(
      opened.session.id,
      resolved.execution,
      resolved.presentations
    );
  });
}

export class AdvanceTelegramScenarioService {
  constructor(
    private readonly repository: ScenarioRuntimeRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly orderCreator?: ScenarioOrderCreator,
    private readonly internalOrderCompleter?: ScenarioInternalOrderCompleter,
    private readonly walletCreditor?: ScenarioWalletCreditor,
    private readonly userClassifier?: ScenarioUserClassifier
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
        internalOrderCompleter: this.internalOrderCompleter,
        walletCreditor: this.walletCreditor,
        userClassifier: this.userClassifier,
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
    private readonly orderCreator?: ScenarioOrderCreator,
    private readonly internalOrderCompleter?: ScenarioInternalOrderCompleter,
    private readonly walletCreditor?: ScenarioWalletCreditor,
    private readonly userClassifier?: ScenarioUserClassifier
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
        internalOrderCompleter: this.internalOrderCompleter,
        walletCreditor: this.walletCreditor,
        userClassifier: this.userClassifier,
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
    private readonly orderCreator?: ScenarioOrderCreator,
    private readonly internalOrderCompleter?: ScenarioInternalOrderCompleter,
    private readonly walletCreditor?: ScenarioWalletCreditor,
    private readonly userClassifier?: ScenarioUserClassifier
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
        internalOrderCompleter: this.internalOrderCompleter,
        walletCreditor: this.walletCreditor,
        userClassifier: this.userClassifier,
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
    private readonly orderCreator?: ScenarioOrderCreator,
    private readonly internalOrderCompleter?: ScenarioInternalOrderCompleter,
    private readonly walletCreditor?: ScenarioWalletCreditor,
    private readonly userClassifier?: ScenarioUserClassifier
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
        internalOrderCompleter: this.internalOrderCompleter,
        walletCreditor: this.walletCreditor,
        userClassifier: this.userClassifier,
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
  kind: "start" | "event_selection" | "transition" | "input" | "offer"
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
  readonly internalOrderCompleter: ScenarioInternalOrderCompleter | undefined;
  readonly walletCreditor: ScenarioWalletCreditor | undefined;
  readonly userClassifier: ScenarioUserClassifier | undefined;
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

    if (node.type === "wallet_credit") {
      const request = scenarioWalletCreditRequest(node);
      const edge = singleAutomaticEdge(input.session.graph, node.id);
      if (!request || !edge || !input.walletCreditor) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Начисление внутреннего баланса временно недоступно."
        );
      }
      const credit = await input.walletCreditor.execute({
        userId: input.session.userId,
        eventId: input.session.eventId,
        scenarioSessionId: input.session.id,
        scenarioVersionId: input.session.scenarioVersionId,
        nodeId: node.id,
        amountKopecks: request.amountKopecks,
        currency: request.currency,
        idempotencyKey: [
          "scenario_credit",
          request.idempotencyKeyTemplate,
          input.session.userId,
          input.session.eventId
        ].join(":"),
        reason: request.reason,
        creditedAt: input.occurredAt
      });
      const wallet = {
        schemaVersion: 1,
        currency: credit.currency,
        availableBalanceKopecks: credit.availableBalanceKopecks,
        lastCreditNodeId: node.id
      };
      context.wallet = wallet;
      contextPatch = { ...contextPatch, wallet };
      execution = continueFromAction(input.session.graph, execution, edge.id);
      continue;
    }

    if (node.type === "set_status") {
      const request = scenarioSetStatusRequest(node);
      const edge = singleAutomaticEdge(input.session.graph, node.id);
      if (!request || !edge || !input.userClassifier) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Назначение статуса временно недоступно."
        );
      }
      const classification = await input.userClassifier.setStatus({
        userId: input.session.userId,
        statusCode: request.statusCode,
        source: "scenario",
        sourceReference:
          `scenario_status:${input.session.id}:${node.id}`,
        actorAdminId: null,
        reason: request.reason,
        assignedAt: input.occurredAt
      });
      const userClassification = classificationContext(
        context.userClassification,
        classification,
        { statusCode: request.statusCode }
      );
      context.userClassification = userClassification;
      contextPatch = { ...contextPatch, userClassification };
      execution = continueFromAction(input.session.graph, execution, edge.id);
      continue;
    }

    if (node.type === "add_category") {
      const request = scenarioAddCategoryRequest(node);
      const edge = singleAutomaticEdge(input.session.graph, node.id);
      if (!request || !edge || !input.userClassifier) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Добавление категории временно недоступно."
        );
      }
      const classification = await input.userClassifier.addCategory({
        userId: input.session.userId,
        categoryCode: request.categoryCode,
        source: "scenario",
        sourceReference:
          `scenario_category:${input.session.id}:${node.id}`,
        actorAdminId: null,
        reason: request.reason,
        assignedAt: input.occurredAt
      });
      const userClassification = classificationContext(
        context.userClassification,
        classification,
        { categoryCode: request.categoryCode }
      );
      context.userClassification = userClassification;
      contextPatch = { ...contextPatch, userClassification };
      execution = continueFromAction(input.session.graph, execution, edge.id);
      continue;
    }

    if (node.type === "order_start") {
      const request = scenarioOrderStartRequest(node);
      const draftRequest = scenarioOrderDraftStartRequest(node);
      const edge = singleAutomaticEdge(input.session.graph, node.id);
      if (draftRequest && edge) {
        const orderDraft: StoredScenarioOrderDraft = {
          schemaVersion: 1,
          currency: draftRequest.currency,
          walletMode: draftRequest.walletMode,
          items: []
        };
        context.orderDraft = orderDraft;
        context.order = null;
        contextPatch = {
          ...contextPatch,
          orderDraft,
          order: null
        };
        execution = continueFromAction(input.session.graph, execution, edge.id);
        continue;
      }
      const items = request ? scenarioOrderItems(request.items, context) : null;
      if (
        !request
        || !edge
        || !items
        || items.length === 0
        || !input.orderCreator
      ) {
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
        wallet: { mode: request.walletMode },
        source: "telegram_scenario",
        createdAt: input.occurredAt
      });
      const storedOrder = scenarioOrderContext(order);
      context.order = storedOrder;
      contextPatch = { ...contextPatch, order: storedOrder };
      execution = continueFromAction(input.session.graph, execution, edge.id);
      continue;
    }

    if (node.type === "order_add_item") {
      const request = scenarioOrderAddItemRequest(node);
      const edge = singleAutomaticEdge(input.session.graph, node.id);
      const draft = readScenarioOrderDraftContext(context.orderDraft);
      if (!request || !edge || !draft) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Не удалось обновить состав заказа. Начните покупку заново."
        );
      }
      const quantity = context[request.quantityContextKey];
      const remainingItems = draft.items.filter(
        (item) => item.productId !== request.productId
      );
      let items: StoredScenarioOrderDraft["items"];
      if (request.optional && (quantity === undefined || quantity === 0)) {
        items = remainingItems;
      } else if (!Number.isSafeInteger(quantity) || Number(quantity) < 1) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Не удалось определить количество товара. Начните покупку заново."
        );
      } else {
        items = [
          ...remainingItems,
          { productId: request.productId, quantity: Number(quantity) }
        ];
      }
      if (items.length > 20) {
        return waitingAtAction(
          execution,
          contextPatch,
          "В одном заказе может быть не больше 20 разных товаров."
        );
      }
      const orderDraft: StoredScenarioOrderDraft = { ...draft, items };
      context.orderDraft = orderDraft;
      contextPatch = { ...contextPatch, orderDraft };
      execution = continueFromAction(input.session.graph, execution, edge.id);
      continue;
    }

    if (node.type === "order_summary") {
      const request = scenarioOrderSummaryRequest(node);
      const edge = singleAutomaticEdge(input.session.graph, node.id);
      const draft = readScenarioOrderDraftContext(context.orderDraft);
      if (
        !request
        || !edge
        || !draft
        || draft.items.length === 0
        || !input.orderCreator
      ) {
        return waitingAtAction(
          execution,
          contextPatch,
          "Состав заказа пуст или недоступен. Начните покупку заново."
        );
      }
      const order = await input.orderCreator.execute({
        idempotencyKey:
          `scenario_order:${input.session.id}:${node.id}:${input.session.lockVersion}`,
        userId: input.session.userId,
        eventId: input.session.eventId,
        currency: draft.currency,
        items: draft.items,
        wallet: { mode: draft.walletMode },
        source: "telegram_scenario",
        createdAt: input.occurredAt
      });
      const storedOrder = scenarioOrderContext(order);
      context.order = storedOrder;
      context.orderDraft = null;
      contextPatch = {
        ...contextPatch,
        order: storedOrder,
        orderDraft: null
      };
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
      if (
        order.status === "awaiting_payment"
        && order.externalDueKopecks === "0"
      ) {
        if (!edge || !input.internalOrderCompleter) {
          return waitingAtAction(
            execution,
            contextPatch,
            "Заказ ожидает внутреннего подтверждения. Попробуйте снова позже."
          );
        }
        await input.internalOrderCompleter.execute({
          orderId: order.orderId,
          userId: input.session.userId,
          eventId: input.session.eventId,
          currency: order.currency,
          idempotencyKey: `internal_order:${order.orderId}`,
          completedAt: input.occurredAt
        });
        const paidOrder: StoredScenarioOrder = { ...order, status: "paid" };
        context.order = paidOrder;
        contextPatch = { ...contextPatch, order: paidOrder };
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

interface StoredScenarioOrderDraftItem {
  readonly productId: string;
  readonly quantity: number;
}

interface StoredScenarioOrderDraft {
  readonly schemaVersion: 1;
  readonly currency: string;
  readonly walletMode: "none" | "all";
  readonly items: readonly StoredScenarioOrderDraftItem[];
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

function readScenarioOrderDraftContext(
  value: unknown
): StoredScenarioOrderDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const draft = value as Readonly<Record<string, unknown>>;
  if (
    draft.schemaVersion !== 1
    || typeof draft.currency !== "string"
    || !/^[A-Z]{3}$/.test(draft.currency)
    || (draft.walletMode !== "none" && draft.walletMode !== "all")
    || !Array.isArray(draft.items)
    || draft.items.length > 20
    || Object.keys(draft).some(
      (key) => !["schemaVersion", "currency", "walletMode", "items"].includes(key)
    )
  ) {
    return null;
  }
  const productIds = new Set<string>();
  const items: StoredScenarioOrderDraftItem[] = [];
  for (const value of draft.items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const item = value as Readonly<Record<string, unknown>>;
    if (
      typeof item.productId !== "string"
      || !SCENARIO_UUID_PATTERN.test(item.productId)
      || productIds.has(item.productId)
      || !Number.isSafeInteger(item.quantity)
      || Number(item.quantity) < 1
      || Object.keys(item).some(
        (key) => !["productId", "quantity"].includes(key)
      )
    ) {
      return null;
    }
    productIds.add(item.productId);
    items.push({
      productId: item.productId,
      quantity: Number(item.quantity)
    });
  }
  return {
    schemaVersion: 1,
    currency: draft.currency,
    walletMode: draft.walletMode,
    items
  };
}

const SCENARIO_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function classificationContext(
  current: unknown,
  snapshot: UserClassificationResult,
  changed: {
    readonly statusCode?: string;
    readonly categoryCode?: string;
  }
) {
  const previous = current && typeof current === "object" && !Array.isArray(current)
    ? current as Readonly<Record<string, unknown>>
    : {};
  return {
    schemaVersion: 1,
    statusCodes: snapshot.statusCodes,
    categoryCodes: snapshot.categoryCodes,
    lastStatusCode:
      changed.statusCode
      ?? (typeof previous.lastStatusCode === "string"
        ? previous.lastStatusCode
        : null),
    lastCategoryCode:
      changed.categoryCode
      ?? (typeof previous.lastCategoryCode === "string"
        ? previous.lastCategoryCode
        : null)
  };
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

const TELEGRAM_EVENT_CHOICE_LIMIT = 10;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
