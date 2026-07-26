import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateOrderCommand } from "@ticket-platform/contracts";
import type { DomainEvent } from "@ticket-platform/domain";
import type { ScenarioGraph } from "@ticket-platform/scenario-engine";
import {
  AdvanceTelegramScenarioService,
  ResumeTelegramScenarioAfterOfferService,
  ResumeTelegramScenarioAfterPaymentService,
  StartTelegramScenarioService,
  SubmitTelegramScenarioInputService,
  type SaveScenarioExecutionInput,
  type ScenarioOrderCreator,
  type ScenarioRuntimeRepository,
  type ScenarioRuntimeSession
} from "./scenario-runtime.js";

describe("scenario runtime services", () => {
  it("starts a pinned session and returns channel-neutral presentation", async () => {
    const fixture = createFixture();

    const result = await fixture.start.execute({
      userId: "user-1",
      messengerIdentityId: "identity-1",
      eventSlug: "business-breakthrough",
      updateId: "100",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "waiting_input");
      assert.equal(result.presentations[0]?.text, "Выберите действие");
      const button = result.presentations[0]?.buttons[0];
      assert.equal(button && "edgeId" in button ? button.edgeId : null, edgeId);
    }
    assert.equal(fixture.saved[0]?.session.scenarioVersionId, "version-1");
    assert.equal(fixture.saved[0]?.commandKind, "start");
  });

  it("continues through an owner-bound selected edge", async () => {
    const fixture = createFixture();

    const result = await fixture.advance.execute({
      sessionId: "session-1",
      edgeId,
      senderExternalUserId: "777",
      updateId: "101",
      callbackQueryId: "callback-1",
      occurredAt: now
    });

    assert.equal(result.accepted, true);
    if (result.accepted) {
      assert.equal(result.status, "completed");
      assert.deepEqual(result.presentations, [{
        text: "Готово",
        buttons: []
      }]);
    }
    assert.equal(fixture.saved[0]?.selectedEdgeId, edgeId);
  });

  it("does not mutate a session for a stale or foreign transition", async () => {
    const stale = createFixture();
    const foreign = createFixture({ transitionStatus: "session_not_found" });

    const staleResult = await stale.advance.execute({
      sessionId: "session-1",
      edgeId: "00000000-0000-4000-8000-000000000099",
      senderExternalUserId: "777",
      updateId: "102",
      callbackQueryId: "callback-2",
      occurredAt: now
    });
    const foreignResult = await foreign.advance.execute({
      sessionId: "session-1",
      edgeId,
      senderExternalUserId: "888",
      updateId: "103",
      callbackQueryId: "callback-3",
      occurredAt: now
    });

    assert.deepEqual(staleResult, {
      accepted: false,
      reason: "invalid_transition"
    });
    assert.deepEqual(foreignResult, {
      accepted: false,
      reason: "session_not_found"
    });
    assert.equal(stale.saved.length, 0);
    assert.equal(foreign.saved.length, 0);
  });

  it("suppresses duplicate Telegram updates", async () => {
    const fixture = createFixture({ processedSessionId: "session-previous" });

    const result = await fixture.start.execute({
      userId: "user-1",
      messengerIdentityId: "identity-1",
      eventSlug: null,
      updateId: "104",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.duplicate, true);
      assert.deepEqual(result.presentations, []);
    }
    assert.equal(fixture.saved.length, 0);
  });

  it("stores only a validated typed input in the session context", async () => {
    const fixture = createFixture({ inputGraph: true });

    const invalid = await fixture.submitInput.execute({
      senderExternalUserId: "777",
      updateId: "105",
      text: "9",
      occurredAt: now
    });
    const valid = await fixture.submitInput.execute({
      senderExternalUserId: "777",
      updateId: "106",
      text: "3",
      occurredAt: now
    });

    assert.equal(invalid.handled, true);
    if (invalid.handled) {
      assert.equal(invalid.accepted, false);
      assert.equal(
        invalid.presentations[0]?.text,
        "Введите целое число от 1 до 5."
      );
    }
    assert.equal(valid.handled, true);
    if (valid.handled) {
      assert.equal(valid.accepted, true);
      assert.equal(valid.status, "completed");
    }
    assert.equal(fixture.rejections.length, 1);
    assert.deepEqual(fixture.saved[0]?.contextPatch, { adultQuantity: 3 });
  });

  it("refuses to guess between multiple input sessions", async () => {
    const fixture = createFixture({ inputStatus: "input_ambiguous" });

    const result = await fixture.submitInput.execute({
      senderExternalUserId: "777",
      updateId: "107",
      text: "3",
      occurredAt: now
    });

    assert.deepEqual(result, {
      handled: false,
      reason: "input_ambiguous"
    });
    assert.equal(fixture.saved.length, 0);
  });

  it("creates one order from validated context and waits for the pinned offer", async () => {
    const commands: CreateOrderCommand[] = [];
    const fixture = createFixture({
      scenarioGraph: orderGraph,
      currentNodeId: inputId,
      orderCreator: fakeOrderCreator(commands)
    });

    const result = await fixture.submitInput.execute({
      senderExternalUserId: "777",
      updateId: "108",
      text: "3",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "waiting_input");
      assert.equal(result.presentations.at(-1)?.text.includes("BP-000001"), true);
      assert.deepEqual(result.presentations.at(-1)?.buttons, [
        {
          text: "Читать оферту",
          url: "https://example.test/offers/offer-version-1"
        },
        {
          text: "Я принимаю оферту",
          callbackData: `offer_accept:${"a".repeat(43)}`
        }
      ]);
    }
    assert.deepEqual(commands[0]?.items, [{
      productId,
      quantity: 3
    }]);
    assert.equal(commands[0]?.wallet.mode, "none");
    assert.match(
      commands[0]?.idempotencyKey ?? "",
      /^scenario_order:session-1:/
    );
    assert.equal(fixture.saved[0]?.execution.currentNodeId, offerId);
    assert.equal(fixture.saved[0]?.contextPatch.adultQuantity, 3);
    assert.equal(
      (fixture.saved[0]?.contextPatch.order as { orderId?: string }).orderId,
      orderId
    );
  });

  it("resumes an owner-bound offer session at payment initialization", async () => {
    const fixture = createFixture({
      scenarioGraph: orderGraph,
      currentNodeId: offerId,
      context: { order: storedOrder },
      actionStatus: "ready"
    });

    const result = await fixture.resumeOffer.execute({
      orderId,
      senderExternalUserId: "777",
      updateId: "109",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "waiting_input");
      assert.deepEqual(result.presentations.at(-1)?.buttons, [{
        text: "Оплатить",
        callbackData: `payment_init:${"a".repeat(43)}`
      }]);
    }
    assert.equal(fixture.saved[0]?.execution.currentNodeId, paymentId);
    assert.equal(fixture.saved[0]?.commandKind, "offer");
    assert.equal(
      (fixture.saved[0]?.contextPatch.order as { status?: string }).status,
      "awaiting_payment"
    );
  });

  it("continues a paid order and requests the next Telegram presentation once", async () => {
    const fixture = createFixture({
      scenarioGraph: orderGraph,
      currentNodeId: paymentId,
      context: {
        order: { ...storedOrder, status: "awaiting_payment" }
      },
      paymentActionStatus: "ready"
    });

    const result = await fixture.resumePayment.execute({
      orderId,
      sourceEventId: "00000000-0000-4000-8000-000000000109",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "completed");
      assert.deepEqual(result.presentations, [{
        text: "Готово",
        buttons: []
      }]);
    }
    assert.equal(fixture.saved[0]?.commandKind, "payment");
    assert.equal(fixture.saved[0]?.execution.currentNodeId, endId);
    assert.equal(
      (fixture.saved[0]?.contextPatch.order as { status?: string }).status,
      "paid"
    );
    assert.equal(fixture.outbox.length, 1);
    assert.equal(fixture.outbox[0]?.eventType, "ScenarioPresentationRequested");
    assert.deepEqual(fixture.outbox[0]?.payload.presentations, [{
      text: "Готово",
      buttons: []
    }]);
  });

  it("does not repeat payment continuation or its outbox event", async () => {
    const fixture = createFixture({
      processedSessionId: "session-1",
      scenarioGraph: orderGraph,
      currentNodeId: paymentId,
      context: {
        order: { ...storedOrder, status: "awaiting_payment" }
      }
    });

    const result = await fixture.resumePayment.execute({
      orderId,
      sourceEventId: "00000000-0000-4000-8000-000000000109",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.duplicate, true);
      assert.deepEqual(result.presentations, []);
    }
    assert.equal(fixture.saved.length, 0);
    assert.equal(fixture.outbox.length, 0);
  });
});

const now = new Date("2026-07-26T12:00:00.000Z");
const startId = "00000000-0000-4000-8000-000000000001";
const menuId = "00000000-0000-4000-8000-000000000002";
const endId = "00000000-0000-4000-8000-000000000003";
const edgeId = "00000000-0000-4000-8000-000000000011";
const inputId = "00000000-0000-4000-8000-000000000012";
const orderStartId = "00000000-0000-4000-8000-000000000013";
const offerId = "00000000-0000-4000-8000-000000000014";
const paymentId = "00000000-0000-4000-8000-000000000015";
const productId = "00000000-0000-4000-8000-000000000020";
const orderId = "00000000-0000-4000-8000-000000000021";

const graph: ScenarioGraph = {
  schemaVersion: 1,
  nodes: [
    { id: startId, type: "start", schemaVersion: 1, payload: {} },
    {
      id: menuId,
      type: "menu",
      schemaVersion: 1,
      payload: { text: "Выберите действие" }
    },
    {
      id: endId,
      type: "end",
      schemaVersion: 1,
      payload: { text: "Готово" }
    }
  ],
  edges: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      fromNodeId: startId,
      toNodeId: menuId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: edgeId,
      fromNodeId: menuId,
      toNodeId: endId,
      label: "Завершить",
      priority: 0,
      condition: {}
    }
  ]
};

const inputGraph: ScenarioGraph = {
  schemaVersion: 1,
  nodes: [
    {
      id: inputId,
      type: "number_input",
      schemaVersion: 1,
      payload: {
        text: "Сколько билетов?",
        contextKey: "adultQuantity",
        minimum: 1,
        maximum: 5
      }
    },
    {
      id: endId,
      type: "end",
      schemaVersion: 1,
      payload: { text: "Количество сохранено" }
    }
  ],
  edges: [{
    id: edgeId,
    fromNodeId: inputId,
    toNodeId: endId,
    label: null,
    priority: 0,
    condition: {}
  }]
};

const orderGraph: ScenarioGraph = {
  schemaVersion: 1,
  nodes: [
    {
      id: inputId,
      type: "number_input",
      schemaVersion: 1,
      payload: {
        text: "Сколько билетов?",
        contextKey: "adultQuantity",
        minimum: 1,
        maximum: 5
      }
    },
    {
      id: orderStartId,
      type: "order_start",
      schemaVersion: 1,
      payload: {
        currency: "RUB",
        items: [{
          productId,
          quantityContextKey: "adultQuantity"
        }]
      }
    },
    { id: offerId, type: "offer_acceptance", schemaVersion: 1, payload: {} },
    { id: paymentId, type: "payment_start", schemaVersion: 1, payload: {} },
    { id: endId, type: "end", schemaVersion: 1, payload: { text: "Готово" } }
  ],
  edges: [
    {
      id: "00000000-0000-4000-8000-000000000030",
      fromNodeId: inputId,
      toNodeId: orderStartId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000031",
      fromNodeId: orderStartId,
      toNodeId: offerId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000032",
      fromNodeId: offerId,
      toNodeId: paymentId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000033",
      fromNodeId: paymentId,
      toNodeId: endId,
      label: null,
      priority: 0,
      condition: {}
    }
  ]
};

function createFixture(options: {
  readonly processedSessionId?: string | null;
  readonly transitionStatus?: "ready" | "session_not_found" | "session_not_waiting";
  readonly inputStatus?: "ready" | "input_not_expected" | "input_ambiguous";
  readonly inputGraph?: boolean;
  readonly scenarioGraph?: ScenarioGraph;
  readonly currentNodeId?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly actionStatus?: "ready" | "action_not_expected" | "action_ambiguous";
  readonly paymentActionStatus?: "ready" | "action_not_expected" | "action_ambiguous";
  readonly orderCreator?: ScenarioOrderCreator;
} = {}) {
  const saved: SaveScenarioExecutionInput[] = [];
  const outbox: DomainEvent[] = [];
  const rejections: string[] = [];
  const session: ScenarioRuntimeSession = {
    id: "session-1",
    userId: "user-1",
    eventId: "event-1",
    scenarioVersionId: "version-1",
    currentNodeId: options.currentNodeId ?? menuId,
    lockVersion: 1,
    newlyCreated: false,
    graph: options.scenarioGraph ?? (options.inputGraph ? inputGraph : graph),
    context: options.context ?? {},
    ...(options.inputGraph ? { currentNodeId: inputId } : {})
  };
  const repository: ScenarioRuntimeRepository = {
    async findProcessedSession() {
      return options.processedSessionId ?? null;
    },
    async lockOrCreateForTelegramStart() {
      return {
        status: "ready",
        session: {
          ...session,
          currentNodeId: startId,
          newlyCreated: true
        }
      };
    },
    async lockForTelegramTransition() {
      if (options.transitionStatus && options.transitionStatus !== "ready") {
        return { status: options.transitionStatus };
      }
      return { status: "ready", session };
    },
    async lockForTelegramInput() {
      if (options.inputStatus && options.inputStatus !== "ready") {
        return { status: options.inputStatus };
      }
      return { status: "ready", session };
    },
    async lockForTelegramOrderAction() {
      if (options.actionStatus === "ready") {
        return { status: "ready", session };
      }
      return { status: options.actionStatus ?? "action_not_expected" };
    },
    async lockForTelegramPaymentCompletion() {
      if (options.paymentActionStatus === "ready") {
        return { status: "ready", session };
      }
      return {
        status: options.paymentActionStatus ?? "action_not_expected"
      };
    },
    async recordInputRejection(input) {
      rejections.push(input.reason);
    },
    async saveExecution(input) {
      saved.push(input);
    }
  };
  let id = 0;
  return {
    start: new StartTelegramScenarioService(
      repository,
      { async transact(work) { return work(); } },
      { newId() { id += 1; return `generated-${id}`; } },
      undefined,
      options.orderCreator
    ),
    advance: new AdvanceTelegramScenarioService(
      repository,
      { async transact(work) { return work(); } },
      options.orderCreator
    ),
    submitInput: new SubmitTelegramScenarioInputService(
      repository,
      { async transact(work) { return work(); } },
      options.orderCreator
    ),
    resumeOffer: new ResumeTelegramScenarioAfterOfferService(
      repository,
      { async transact(work) { return work(); } },
      options.orderCreator
    ),
    resumePayment: new ResumeTelegramScenarioAfterPaymentService(
      repository,
      { async transact(work) { return work(); } },
      { async append(event) { outbox.push(event); } },
      { newId() { id += 1; return `generated-${id}`; } },
      options.orderCreator
    ),
    saved,
    outbox,
    rejections
  };
}

function fakeOrderCreator(
  commands: CreateOrderCommand[]
): ScenarioOrderCreator {
  return {
    async execute(command) {
      commands.push(command);
      return {
        orderId,
        orderNumber: "BP-000001",
        publicToken: "a".repeat(43),
        offerPublicUrl: "https://example.test/offers/offer-version-1",
        status: "awaiting_offer",
        currency: "RUB",
        totalKopecks: "597000",
        walletAppliedKopecks: "0",
        externalDueKopecks: "597000",
        expiresAt: "2026-07-26T12:30:00.000Z",
        created: true
      };
    }
  };
}

const storedOrder = {
  orderId,
  orderNumber: "BP-000001",
  publicToken: "a".repeat(43),
  offerPublicUrl: "https://example.test/offers/offer-version-1",
  status: "awaiting_offer",
  currency: "RUB",
  totalKopecks: "597000",
  walletAppliedKopecks: "0",
  externalDueKopecks: "597000",
  expiresAt: "2026-07-26T12:30:00.000Z"
} as const;
