import assert from "node:assert/strict";
import test from "node:test";
import {
  executeScenarioGraph,
  submitScenarioInput,
  validateScenarioGraph,
  type ScenarioEdge,
  type ScenarioGraph,
  type ScenarioNode,
  type ScenarioNodeType
} from "./index.js";

const ids = {
  start: "00000000-0000-4000-8000-000000000001",
  offer: "00000000-0000-4000-8000-000000000002",
  payment: "00000000-0000-4000-8000-000000000003",
  end: "00000000-0000-4000-8000-000000000004",
  order: "00000000-0000-4000-8000-000000000014",
  product: "00000000-0000-4000-8000-000000000015"
};

test("accepts a connected purchase flow with offer before payment", () => {
  const result = validateScenarioGraph(graph(
    [
      node(ids.start, "start"),
      node(ids.order, "order_start", {
        currency: "RUB",
        items: [{
          productId: ids.product,
          quantityContextKey: "quantity"
        }]
      }),
      node(ids.offer, "offer_acceptance"),
      node(ids.payment, "payment_start"),
      node(ids.end, "end")
    ],
    [
      edge("101", ids.start, ids.order),
      edge("102", ids.order, ids.offer),
      edge("103", ids.offer, ids.payment),
      edge("104", ids.payment, ids.end)
    ]
  ));

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test("reports broken and unreachable graph structure", () => {
  const missing = "00000000-0000-4000-8000-000000000099";
  const result = validateScenarioGraph(graph(
    [node(ids.start, "start"), node(ids.end, "end")],
    [edge("101", ids.start, missing)]
  ));

  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      "BROKEN_EDGE",
      "DEAD_END",
      "TRANSITION_MODE_INVALID",
      "UNREACHABLE_NODE"
    ])
  );
});

test("blocks payment reachable without an accepted offer", () => {
  const result = validateScenarioGraph(graph(
    [
      node(ids.start, "start"),
      node(ids.payment, "payment_start"),
      node(ids.end, "end")
    ],
    [
      edge("101", ids.start, ids.payment),
      edge("102", ids.payment, ids.end)
    ]
  ));

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) =>
    issue.code === "PAYMENT_BEFORE_OFFER" && issue.nodeId === ids.payment
  ));
});

test("blocks offer and payment paths that do not create an order", () => {
  const result = validateScenarioGraph(graph(
    [
      node(ids.start, "start"),
      node(ids.offer, "offer_acceptance"),
      node(ids.payment, "payment_start"),
      node(ids.end, "end")
    ],
    [
      edge("105", ids.start, ids.offer),
      edge("106", ids.offer, ids.payment),
      edge("107", ids.payment, ids.end)
    ]
  ));

  assert.deepEqual(
    result.issues
      .filter((issue) => issue.code === "ORDER_REQUIRED")
      .map((issue) => issue.nodeId),
    [ids.offer, ids.payment]
  );
});

test("requires an explicit iteration limit inside a cycle", () => {
  const loop = "00000000-0000-4000-8000-000000000005";
  const unbounded = validateScenarioGraph(graph(
    [node(ids.start, "start"), node(loop, "message"), node(ids.end, "end")],
    [
      edge("101", ids.start, loop),
      edge("102", loop, loop),
      edge("103", loop, ids.end)
    ]
  ));
  const bounded = validateScenarioGraph(graph(
    [
      node(ids.start, "start"),
      node(loop, "message", { maxIterations: 3 }),
      node(ids.end, "end")
    ],
    [
      edge("101", ids.start, loop),
      edge("102", loop, loop),
      edge("103", loop, ids.end)
    ]
  ));

  assert.ok(unbounded.issues.some((issue) => issue.code === "UNBOUNDED_CYCLE"));
  assert.ok(!bounded.issues.some((issue) => issue.code === "UNBOUNDED_CYCLE"));
});

test("wallet credit requires an idempotency key template", () => {
  const wallet = "00000000-0000-4000-8000-000000000006";
  const result = validateScenarioGraph(graph(
    [node(ids.start, "start"), node(wallet, "wallet_credit"), node(ids.end, "end")],
    [edge("101", ids.start, wallet), edge("102", wallet, ids.end)]
  ));

  assert.ok(result.issues.some((issue) =>
    issue.code === "WALLET_IDEMPOTENCY_MISSING" && issue.nodeId === wallet
  ));
});

test("rejects presentation nodes that cannot be rendered in Telegram", () => {
  const menuId = "00000000-0000-4000-8000-000000000007";
  const result = validateScenarioGraph(graph(
    [
      node(ids.start, "start"),
      node(menuId, "menu", { text: " " }),
      node(ids.end, "end")
    ],
    [
      edge("107", ids.start, menuId),
      edge("108", menuId, ids.end)
    ]
  ));

  assert.ok(result.issues.some((issue) =>
    issue.code === "PRESENTATION_INVALID" && issue.nodeId === menuId
  ));
  assert.ok(result.issues.some((issue) =>
    issue.code === "TRANSITION_MODE_INVALID" && issue.nodeId === menuId
  ));
});

test("executes automatic messages until an interactive menu", () => {
  const messageId = "00000000-0000-4000-8000-000000000009";
  const menuId = "00000000-0000-4000-8000-000000000010";
  const graphValue = graph(
    [
      node(ids.start, "start"),
      node(messageId, "message", { text: "Добро пожаловать" }),
      node(menuId, "menu", { text: "Выберите раздел" }),
      node(ids.end, "end", { text: "Готово" })
    ],
    [
      edge("111", ids.start, messageId),
      edge("112", messageId, menuId),
      { ...edge("113", menuId, ids.end), label: "Завершить" }
    ]
  );

  const result = executeScenarioGraph({
    graph: graphValue,
    currentNodeId: ids.start
  });

  assert.equal(result.status, "waiting_input");
  assert.equal(result.currentNodeId, menuId);
  assert.deepEqual(
    result.presentations.map((presentation) => presentation.text),
    ["Добро пожаловать", "Выберите раздел"]
  );
  assert.equal(result.presentations[1]?.buttons[0]?.edgeId,
    "00000000-0000-4000-8000-000000000113");
});

test("continues only through an outgoing selected edge", () => {
  const menuId = "00000000-0000-4000-8000-000000000010";
  const selected = edge("113", menuId, ids.end);
  const graphValue = graph(
    [
      node(menuId, "menu", { text: "Выберите" }),
      node(ids.end, "end", { text: "Завершено" })
    ],
    [{ ...selected, label: "Завершить" }]
  );

  const completed = executeScenarioGraph({
    graph: graphValue,
    currentNodeId: menuId,
    selectedEdgeId: selected.id
  });
  const rejected = executeScenarioGraph({
    graph: graphValue,
    currentNodeId: menuId,
    selectedEdgeId: ids.payment
  });

  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.presentations, [
    { text: "Завершено", buttons: [] }
  ]);
  assert.equal(rejected.status, "blocked");
  assert.equal(rejected.blockReason, "invalid_transition");
});

test("fails closed on action nodes and automatic loops", () => {
  const actionId = "00000000-0000-4000-8000-000000000011";
  const actionGraph = graph(
    [node(actionId, "order_start"), node(ids.end, "end")],
    [edge("114", actionId, ids.end)]
  );
  const loopGraph = graph(
    [node(ids.start, "start")],
    [edge("115", ids.start, ids.start)]
  );

  assert.equal(executeScenarioGraph({
    graph: actionGraph,
    currentNodeId: actionId
  }).blockReason, "unsupported_node");
  assert.equal(executeScenarioGraph({
    graph: loopGraph,
    currentNodeId: ids.start,
    maximumSteps: 3
  }).blockReason, "step_limit_exceeded");
});

test("validates, requests, and submits a bounded number input", () => {
  const inputId = "00000000-0000-4000-8000-000000000012";
  const graphValue = graph(
    [
      node(ids.start, "start"),
      node(inputId, "number_input", {
        text: "Сколько билетов?",
        contextKey: "adultQuantity",
        minimum: 1,
        maximum: 5
      }),
      node(ids.end, "end", { text: "Количество сохранено" })
    ],
    [
      edge("116", ids.start, inputId),
      edge("117", inputId, ids.end)
    ]
  );

  const waiting = executeScenarioGraph({
    graph: graphValue,
    currentNodeId: ids.start
  });
  const invalid = submitScenarioInput({
    graph: graphValue,
    currentNodeId: inputId,
    rawValue: "6"
  });
  const nonCanonical = submitScenarioInput({
    graph: graphValue,
    currentNodeId: inputId,
    rawValue: "-0"
  });
  const accepted = submitScenarioInput({
    graph: graphValue,
    currentNodeId: inputId,
    rawValue: "3"
  });

  assert.equal(validateScenarioGraph(graphValue).valid, true);
  assert.equal(waiting.status, "waiting_input");
  assert.deepEqual(waiting.inputRequest, {
    kind: "number",
    contextKey: "adultQuantity",
    minimum: 1,
    maximum: 5
  });
  assert.deepEqual(invalid, {
    accepted: false,
    reason: "invalid_input",
    message: "Введите целое число от 1 до 5."
  });
  assert.equal(nonCanonical.accepted, false);
  assert.equal(accepted.accepted, true);
  if (accepted.accepted) {
    assert.equal(accepted.contextKey, "adultQuantity");
    assert.equal(accepted.value, 3);
    assert.equal(accepted.execution.status, "completed");
  }
});

test("blocks publication of an unbounded or unsafe input node", () => {
  const inputId = "00000000-0000-4000-8000-000000000013";
  const result = validateScenarioGraph(graph(
    [
      node(ids.start, "start"),
      node(inputId, "text_input", {
        text: "Введите значение",
        contextKey: "__proto__",
        minimumLength: 1,
        maximumLength: 50
      }),
      node(ids.end, "end")
    ],
    [
      edge("118", ids.start, inputId),
      edge("119", inputId, ids.end)
    ]
  ));

  assert.ok(result.issues.some((issue) =>
    issue.code === "INPUT_CONFIGURATION_INVALID"
    && issue.nodeId === inputId
  ));
});

test("requires bounded context mappings for order creation", () => {
  const valid = validateScenarioGraph(graph(
    [
      node(ids.start, "start"),
      node(ids.order, "order_start", {
        currency: "RUB",
        items: [{
          productId: ids.product,
          quantityContextKey: "adultQuantity"
        }]
      }),
      node(ids.offer, "offer_acceptance"),
      node(ids.payment, "payment_start"),
      node(ids.end, "end")
    ],
    [
      edge("120", ids.start, ids.order),
      edge("121", ids.order, ids.offer),
      edge("122", ids.offer, ids.payment),
      edge("123", ids.payment, ids.end)
    ]
  ));
  const invalid = validateScenarioGraph(graph(
    [
      node(ids.start, "start"),
      node(ids.order, "order_start", {
        currency: "rub",
        items: [{
          productId: "__proto__",
          quantityContextKey: "__proto__"
        }]
      }),
      node(ids.end, "end")
    ],
    [
      edge("124", ids.start, ids.order),
      edge("125", ids.order, ids.end)
    ]
  ));

  assert.equal(valid.valid, true);
  assert.ok(invalid.issues.some((issue) =>
    issue.code === "ORDER_CONFIGURATION_INVALID"
  ));
});

function graph(
  nodes: readonly ScenarioNode[],
  edges: readonly ScenarioEdge[]
): ScenarioGraph {
  return { schemaVersion: 1, nodes, edges };
}

function node(
  id: string,
  type: ScenarioNodeType,
  payload: Readonly<Record<string, unknown>> = {}
): ScenarioNode {
  return { id, type, schemaVersion: 1, payload };
}

function edge(suffix: string, fromNodeId: string, toNodeId: string): ScenarioEdge {
  return {
    id: `00000000-0000-4000-8000-000000000${suffix}`,
    fromNodeId,
    toNodeId,
    label: null,
    priority: 0,
    condition: {}
  };
}
