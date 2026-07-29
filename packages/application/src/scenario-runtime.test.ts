import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateOrderCommand } from "@ticket-platform/contracts";
import type { DomainEvent } from "@ticket-platform/domain";
import type { ScenarioGraph } from "@ticket-platform/scenario-engine";
import {
  AdvanceTelegramScenarioService,
  ResumeTelegramScenarioAfterOfferService,
  ResumeTelegramScenarioAfterPaymentService,
  SelectTelegramEventService,
  StartTelegramScenarioService,
  SubmitTelegramScenarioInputService,
  type SaveScenarioExecutionInput,
  type ScenarioInternalOrderCompleter,
  type ScenarioOrderCreator,
  type ScenarioRuntimeRepository,
  type ScenarioRuntimeSession,
  type ScenarioUserClassifier,
  type ScenarioWalletCreditor
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

  it("returns event choices and starts the selected owner event", async () => {
    const fixture = createFixture({
      startStatus: "event_selection_required"
    });

    const choices = await fixture.start.execute({
      userId: "user-1",
      messengerIdentityId: "identity-1",
      eventSlug: null,
      updateId: "100-selection",
      occurredAt: now
    });
    const selected = await fixture.selectEvent.execute({
      eventId,
      senderExternalUserId: "777",
      updateId: "101-selection",
      callbackQueryId: "callback-selection",
      occurredAt: now
    });

    assert.equal(choices.handled, false);
    if (!choices.handled && choices.reason === "event_selection_required") {
      assert.equal(choices.events[0]?.eventId, eventId);
      assert.equal(choices.hasMoreEvents, false);
    }
    assert.equal(selected.handled, true);
    assert.equal(fixture.saved[0]?.commandKind, "event_selection");
    assert.equal(fixture.saved[0]?.callbackQueryId, "callback-selection");
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

  it("credits a scenario wallet node once and stores only a safe balance snapshot", async () => {
    const credits: Parameters<ScenarioWalletCreditor["execute"]>[0][] = [];
    const fixture = createFixture({
      scenarioGraph: walletCreditGraph,
      walletCreditor: fakeWalletCreditor(credits)
    });

    const result = await fixture.start.execute({
      userId: "user-1",
      messengerIdentityId: "identity-1",
      eventSlug: "business-breakthrough",
      updateId: "104-wallet",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "completed");
      assert.equal(result.presentations.at(-1)?.text, "Баланс начислен");
    }
    assert.deepEqual(credits, [{
      userId: "user-1",
      eventId: "event-1",
      scenarioSessionId: "session-1",
      scenarioVersionId: "version-1",
      nodeId: walletNodeId,
      amountKopecks: "10000",
      currency: "RUB",
      idempotencyKey: "scenario_credit:welcome_bonus:user-1:event-1",
      reason: "Приветственный бонус",
      creditedAt: now
    }]);
    assert.deepEqual(fixture.saved[0]?.contextPatch.wallet, {
      schemaVersion: 1,
      currency: "RUB",
      availableBalanceKopecks: "10000",
      lastCreditNodeId: walletNodeId
    });
  });

  it("applies status and category actions and stores a bounded classification snapshot", async () => {
    const statuses: Parameters<ScenarioUserClassifier["setStatus"]>[0][] = [];
    const categories:
      Parameters<ScenarioUserClassifier["addCategory"]>[0][] = [];
    const fixture = createFixture({
      scenarioGraph: classificationGraph,
      userClassifier: fakeUserClassifier(statuses, categories)
    });

    const result = await fixture.start.execute({
      userId: "user-1",
      messengerIdentityId: "identity-1",
      eventSlug: "business-breakthrough",
      updateId: "100-classification",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    assert.equal(statuses[0]?.statusCode, "interested");
    assert.equal(categories[0]?.categoryCode, "event_interest");
    assert.equal(statuses[0]?.source, "scenario");
    assert.deepEqual(fixture.saved[0]?.contextPatch.userClassification, {
      schemaVersion: 1,
      statusCodes: ["interested"],
      categoryCodes: ["event_interest"],
      lastStatusCode: "interested",
      lastCategoryCode: "event_interest"
    });
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

  it("composes an order draft and creates the immutable order at summary", async () => {
    const commands: CreateOrderCommand[] = [];
    const fixture = createFixture({
      scenarioGraph: composedOrderGraph,
      currentNodeId: inputId,
      orderCreator: fakeOrderCreator(commands)
    });

    const result = await fixture.submitInput.execute({
      senderExternalUserId: "777",
      updateId: "108-compose",
      text: "2",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "waiting_input");
      assert.equal(result.presentations.at(-1)?.text.includes("BP-000001"), true);
    }
    assert.equal(commands.length, 1);
    assert.deepEqual(commands[0]?.items, [{
      productId,
      quantity: 2
    }]);
    assert.equal(commands[0]?.wallet.mode, "all");
    assert.match(
      commands[0]?.idempotencyKey ?? "",
      new RegExp(`^scenario_order:session-1:${orderSummaryId}:`)
    );
    assert.equal(fixture.saved[0]?.execution.currentNodeId, offerId);
    assert.equal(fixture.saved[0]?.contextPatch.orderDraft, null);
    assert.equal(
      (fixture.saved[0]?.contextPatch.order as { orderId?: string }).orderId,
      orderId
    );
  });

  it("does not create an order when optional items leave the draft empty", async () => {
    const commands: CreateOrderCommand[] = [];
    const fixture = createFixture({
      scenarioGraph: optionalOnlyComposedOrderGraph,
      currentNodeId: inputId,
      orderCreator: fakeOrderCreator(commands)
    });

    const result = await fixture.submitInput.execute({
      senderExternalUserId: "777",
      updateId: "108-empty-compose",
      text: "0",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "waiting_input");
      assert.match(result.presentations.at(-1)?.text ?? "", /Состав заказа пуст/);
    }
    assert.equal(commands.length, 0);
    assert.equal(fixture.saved[0]?.execution.currentNodeId, orderSummaryId);
    assert.deepEqual(
      (fixture.saved[0]?.contextPatch.orderDraft as { items?: unknown }).items,
      []
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

  it("completes a zero-due order internally after offer acceptance", async () => {
    const completions: Parameters<ScenarioInternalOrderCompleter["execute"]>[0][] = [];
    const fixture = createFixture({
      scenarioGraph: orderGraph,
      currentNodeId: offerId,
      context: { order: zeroDueStoredOrder },
      actionStatus: "ready",
      internalOrderCompleter: fakeInternalOrderCompleter(completions)
    });

    const result = await fixture.resumeOffer.execute({
      orderId,
      senderExternalUserId: "777",
      updateId: "109-internal",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "completed");
      assert.equal(result.presentations.at(-1)?.text, "Готово");
    }
    assert.deepEqual(completions, [{
      orderId,
      userId: "user-1",
      eventId: "event-1",
      currency: "RUB",
      idempotencyKey: `internal_order:${orderId}`,
      completedAt: now
    }]);
    assert.equal(
      (fixture.saved[0]?.contextPatch.order as { status?: string }).status,
      "paid"
    );
  });

  it("never exposes T-Bank initialization for a zero-due order", async () => {
    const fixture = createFixture({
      scenarioGraph: orderGraph,
      currentNodeId: offerId,
      context: { order: zeroDueStoredOrder },
      actionStatus: "ready"
    });

    const result = await fixture.resumeOffer.execute({
      orderId,
      senderExternalUserId: "777",
      updateId: "109-internal-unavailable",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "waiting_input");
      assert.match(
        result.presentations.at(-1)?.text ?? "",
        /ожидает внутреннего подтверждения/
      );
      assert.deepEqual(result.presentations.at(-1)?.buttons, []);
    }
    assert.equal(fixture.saved[0]?.execution.currentNodeId, paymentId);
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

  it("credits a post-payment wallet action before requesting the next presentation", async () => {
    const credits: Parameters<ScenarioWalletCreditor["execute"]>[0][] = [];
    const fixture = createFixture({
      scenarioGraph: postPaymentWalletGraph,
      currentNodeId: paymentId,
      context: {
        order: { ...storedOrder, status: "awaiting_payment" }
      },
      paymentActionStatus: "ready",
      walletCreditor: fakeWalletCreditor(credits)
    });

    const result = await fixture.resumePayment.execute({
      orderId,
      sourceEventId: "00000000-0000-4000-8000-000000000025",
      occurredAt: now
    });

    assert.equal(result.handled, true);
    if (result.handled) {
      assert.equal(result.status, "completed");
      assert.equal(result.presentations.at(-1)?.text, "Готово");
    }
    assert.equal(credits.length, 1);
    assert.equal(
      credits[0]?.idempotencyKey,
      "scenario_credit:welcome_bonus:user-1:event-1"
    );
    assert.equal(fixture.outbox[0]?.eventType, "ScenarioPresentationRequested");
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
const orderItemId = "00000000-0000-4000-8000-000000000016";
const orderSummaryId = "00000000-0000-4000-8000-000000000017";
const walletNodeId = "00000000-0000-4000-8000-000000000018";
const statusNodeId = "00000000-0000-4000-8000-000000000019";
const productId = "00000000-0000-4000-8000-000000000020";
const orderId = "00000000-0000-4000-8000-000000000021";
const eventId = "00000000-0000-4000-8000-000000000022";
const categoryNodeId = "00000000-0000-4000-8000-000000000023";

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

const walletCreditGraph: ScenarioGraph = {
  schemaVersion: 1,
  nodes: [
    { id: startId, type: "start", schemaVersion: 1, payload: {} },
    {
      id: walletNodeId,
      type: "wallet_credit",
      schemaVersion: 1,
      payload: {
        amountKopecks: "10000",
        currency: "RUB",
        idempotencyKeyTemplate: "welcome_bonus",
        reason: "Приветственный бонус"
      }
    },
    {
      id: endId,
      type: "end",
      schemaVersion: 1,
      payload: { text: "Баланс начислен" }
    }
  ],
  edges: [
    {
      id: "00000000-0000-4000-8000-000000000019",
      fromNodeId: startId,
      toNodeId: walletNodeId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000023",
      fromNodeId: walletNodeId,
      toNodeId: endId,
      label: null,
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

const postPaymentWalletGraph: ScenarioGraph = {
  ...orderGraph,
  nodes: [
    ...orderGraph.nodes,
    {
      id: walletNodeId,
      type: "wallet_credit",
      schemaVersion: 1,
      payload: {
        amountKopecks: "10000",
        currency: "RUB",
        idempotencyKeyTemplate: "welcome_bonus",
        reason: "Приветственный бонус"
      }
    }
  ],
  edges: [
    ...orderGraph.edges.filter((edge) => edge.fromNodeId !== paymentId),
    {
      id: "00000000-0000-4000-8000-000000000026",
      fromNodeId: paymentId,
      toNodeId: walletNodeId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000027",
      fromNodeId: walletNodeId,
      toNodeId: endId,
      label: null,
      priority: 0,
      condition: {}
    }
  ]
};

const classificationGraph: ScenarioGraph = {
  schemaVersion: 1,
  nodes: [
    { id: startId, type: "start", schemaVersion: 1, payload: {} },
    {
      id: statusNodeId,
      type: "set_status",
      schemaVersion: 1,
      payload: {
        statusCode: "interested",
        reason: "Интерес подтвержден сценарием"
      }
    },
    {
      id: categoryNodeId,
      type: "add_category",
      schemaVersion: 1,
      payload: {
        categoryCode: "event_interest",
        reason: "Категория добавлена сценарием"
      }
    },
    {
      id: endId,
      type: "end",
      schemaVersion: 1,
      payload: { text: "Классификация сохранена" }
    }
  ],
  edges: [
    {
      id: "00000000-0000-4000-8000-000000000061",
      fromNodeId: startId,
      toNodeId: statusNodeId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000062",
      fromNodeId: statusNodeId,
      toNodeId: categoryNodeId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000063",
      fromNodeId: categoryNodeId,
      toNodeId: endId,
      label: null,
      priority: 0,
      condition: {}
    }
  ]
};

const composedOrderGraph: ScenarioGraph = {
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
        mode: "compose",
        walletMode: "all"
      }
    },
    {
      id: orderItemId,
      type: "order_add_item",
      schemaVersion: 1,
      payload: {
        productId,
        quantityContextKey: "adultQuantity"
      }
    },
    {
      id: orderSummaryId,
      type: "order_summary",
      schemaVersion: 1,
      payload: {}
    },
    { id: offerId, type: "offer_acceptance", schemaVersion: 1, payload: {} },
    { id: paymentId, type: "payment_start", schemaVersion: 1, payload: {} },
    { id: endId, type: "end", schemaVersion: 1, payload: { text: "Готово" } }
  ],
  edges: [
    {
      id: "00000000-0000-4000-8000-000000000040",
      fromNodeId: inputId,
      toNodeId: orderStartId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000041",
      fromNodeId: orderStartId,
      toNodeId: orderItemId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000042",
      fromNodeId: orderItemId,
      toNodeId: orderSummaryId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000043",
      fromNodeId: orderSummaryId,
      toNodeId: offerId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000044",
      fromNodeId: offerId,
      toNodeId: paymentId,
      label: null,
      priority: 0,
      condition: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000045",
      fromNodeId: paymentId,
      toNodeId: endId,
      label: null,
      priority: 0,
      condition: {}
    }
  ]
};

const optionalOnlyComposedOrderGraph: ScenarioGraph = {
  ...composedOrderGraph,
  nodes: composedOrderGraph.nodes.map((node) => {
    if (node.id === inputId) {
      return {
        ...node,
        payload: { ...node.payload, minimum: 0 }
      };
    }
    if (node.id === orderItemId) {
      return {
        ...node,
        payload: { ...node.payload, optional: true }
      };
    }
    return node;
  })
};

function createFixture(options: {
  readonly processedSessionId?: string | null;
  readonly startStatus?:
    | "ready"
    | "event_not_found"
    | "event_selection_required"
    | "scenario_not_published"
    | "scenario_invalid";
  readonly selectionStatus?:
    | "ready"
    | "event_not_found"
    | "participant_not_found"
    | "scenario_not_published"
    | "scenario_invalid";
  readonly transitionStatus?: "ready" | "session_not_found" | "session_not_waiting";
  readonly inputStatus?: "ready" | "input_not_expected" | "input_ambiguous";
  readonly inputGraph?: boolean;
  readonly scenarioGraph?: ScenarioGraph;
  readonly currentNodeId?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly actionStatus?: "ready" | "action_not_expected" | "action_ambiguous";
  readonly paymentActionStatus?: "ready" | "action_not_expected" | "action_ambiguous";
  readonly orderCreator?: ScenarioOrderCreator;
  readonly internalOrderCompleter?: ScenarioInternalOrderCompleter;
  readonly walletCreditor?: ScenarioWalletCreditor;
  readonly userClassifier?: ScenarioUserClassifier;
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
    async listTelegramEventChoices() {
      return {
        events: [{
          eventId,
          title: "Business Picnic",
          startsAt: "2026-08-01T09:00:00.000Z",
          timezone: "Europe/Moscow",
          locationName: "Москва",
          minimumPriceKopecks: "249000",
          currency: "RUB",
          salesStatus: "published"
        }],
        hasMoreEvents: false
      };
    },
    async lockOrCreateForTelegramStart() {
      if (options.startStatus && options.startStatus !== "ready") {
        return { status: options.startStatus };
      }
      return {
        status: "ready",
        session: {
          ...session,
          currentNodeId: startId,
          newlyCreated: true
        }
      };
    },
    async lockOrCreateForTelegramEventSelection() {
      if (options.selectionStatus && options.selectionStatus !== "ready") {
        return { status: options.selectionStatus };
      }
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
      options.orderCreator,
      options.internalOrderCompleter,
      options.walletCreditor,
      options.userClassifier
    ),
    selectEvent: new SelectTelegramEventService(
      repository,
      { async transact(work) { return work(); } },
      { newId() { id += 1; return `generated-${id}`; } },
      undefined,
      options.orderCreator,
      options.internalOrderCompleter,
      options.walletCreditor,
      options.userClassifier
    ),
    advance: new AdvanceTelegramScenarioService(
      repository,
      { async transact(work) { return work(); } },
      options.orderCreator,
      options.internalOrderCompleter,
      options.walletCreditor,
      options.userClassifier
    ),
    submitInput: new SubmitTelegramScenarioInputService(
      repository,
      { async transact(work) { return work(); } },
      options.orderCreator,
      options.internalOrderCompleter,
      options.walletCreditor,
      options.userClassifier
    ),
    resumeOffer: new ResumeTelegramScenarioAfterOfferService(
      repository,
      { async transact(work) { return work(); } },
      options.orderCreator,
      options.internalOrderCompleter,
      options.walletCreditor,
      options.userClassifier
    ),
    resumePayment: new ResumeTelegramScenarioAfterPaymentService(
      repository,
      { async transact(work) { return work(); } },
      { async append(event) { outbox.push(event); } },
      { newId() { id += 1; return `generated-${id}`; } },
      options.orderCreator,
      options.internalOrderCompleter,
      options.walletCreditor,
      options.userClassifier
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

function fakeInternalOrderCompleter(
  commands: Parameters<ScenarioInternalOrderCompleter["execute"]>[0][]
): ScenarioInternalOrderCompleter {
  return {
    async execute(command) {
      commands.push(command);
      return {
        paymentAttemptId: "00000000-0000-4000-8000-000000000022",
        orderId: command.orderId,
        status: "paid",
        paidAt: command.completedAt.toISOString(),
        amountKopecks: "0",
        walletCapturedKopecks: "249000",
        ticketCount: 1,
        ticketNumbers: ["BP-000001-T001"],
        created: true
      };
    }
  };
}

function fakeWalletCreditor(
  commands: Parameters<ScenarioWalletCreditor["execute"]>[0][]
): ScenarioWalletCreditor {
  return {
    async execute(command) {
      commands.push(command);
      return {
        transactionId: "00000000-0000-4000-8000-000000000024",
        amountKopecks: command.amountKopecks,
        currency: command.currency,
        availableBalanceKopecks: "10000",
        credited: true
      };
    }
  };
}

function fakeUserClassifier(
  statuses: Parameters<ScenarioUserClassifier["setStatus"]>[0][],
  categories: Parameters<ScenarioUserClassifier["addCategory"]>[0][]
): ScenarioUserClassifier {
  return {
    async setStatus(command) {
      statuses.push(command);
      return {
        changed: true,
        assignmentId: "00000000-0000-4000-8000-000000000065",
        statusCodes: [command.statusCode],
        categoryCodes: []
      };
    },
    async addCategory(command) {
      categories.push(command);
      return {
        changed: true,
        assignmentId: "00000000-0000-4000-8000-000000000066",
        statusCodes: ["interested"],
        categoryCodes: [command.categoryCode]
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

const zeroDueStoredOrder = {
  ...storedOrder,
  walletAppliedKopecks: "597000",
  externalDueKopecks: "0"
} as const;
