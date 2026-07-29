import type {
  IdGenerator,
  LockTelegramScenarioResult,
  OpenTelegramScenarioResult,
  SaveScenarioExecutionInput,
  ScenarioRuntimeRepository,
  ScenarioRuntimeSession
} from "@ticket-platform/application";
import type {
  ScenarioEdge,
  ScenarioGraph,
  ScenarioNode,
  ScenarioNodeType
} from "@ticket-platform/scenario-engine";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";
import { PostgresOrderSalesRepository } from "./order-sales-persistence.js";
import { PostgresPaymentConfirmationRepository } from "./payment-confirmation-persistence.js";
import { PostgresScenarioWalletCreditRepository } from "./scenario-wallet-credit-persistence.js";
import { PostgresOutboxWriter } from "./telegram-start-persistence.js";
import {
  PostgresUserClassificationAuditWriter,
  PostgresUserClassificationRepository
} from "./user-classification-persistence.js";

interface EventRow {
  readonly id: string;
  readonly published_scenario_version_id: string | null;
}

interface EventChoiceRow {
  readonly id: string;
  readonly title: string;
  readonly starts_at: Date | string;
  readonly timezone: string;
  readonly location_name: string | null;
  readonly status: "published" | "sales_paused" | "sold_out";
  readonly minimum_price_kopecks: string | null;
  readonly currency: string | null;
}

interface TelegramParticipantRow {
  readonly user_id: string;
  readonly messenger_identity_id: string;
}

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly event_id: string;
  readonly scenario_version_id: string;
  readonly current_node_id: string;
  readonly lock_version: number;
  readonly context: unknown;
}

interface VersionRow {
  readonly id: string;
  readonly schema_version: number;
}

interface NodeRow {
  readonly id: string;
  readonly node_type: ScenarioNodeType;
  readonly schema_version: number;
  readonly payload: unknown;
}

interface EdgeRow {
  readonly id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly label: string | null;
  readonly priority: number;
  readonly condition: unknown;
}

export class PostgresScenarioRuntimeRepository
implements ScenarioRuntimeRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly idGenerator: IdGenerator
  ) {}

  async findProcessedSession(
    commandIdempotencyKey: string
  ): Promise<string | null> {
    const result = await this.session.query<{
      readonly session_id: string;
    }>(
      `select session_id
       from public.scenario_events
       where idempotency_key = $1`,
      [commandIdempotencyKey]
    );
    return result.rows[0]?.session_id ?? null;
  }

  async listTelegramEventChoices(input: {
    readonly occurredAt: Date;
    readonly limit: number;
  }) {
    const result = await this.session.query<EventChoiceRow>(
      `select events.id, events.title, events.starts_at, events.timezone,
              events.location_name, events.status,
              minimum_price.unit_price_kopecks::text as minimum_price_kopecks,
              minimum_price.currency
       from public.events events
       left join lateral (
         select rules.unit_price_kopecks, rules.currency
         from public.ticket_products products
         join public.pricing_rules rules on rules.product_id = products.id
         where products.event_id = events.id
           and products.is_active
           and rules.is_active
           and (rules.valid_from is null or rules.valid_from <= $1)
           and (rules.valid_until is null or rules.valid_until > $1)
         order by rules.unit_price_kopecks, rules.currency, rules.id
         limit 1
       ) minimum_price on true
       where events.status in ('published', 'sales_paused', 'sold_out')
         and events.published_scenario_version_id is not null
         and (events.ends_at is null or events.ends_at > $1)
       order by events.starts_at, events.id
       limit $2`,
      [input.occurredAt, input.limit + 1]
    );
    return {
      events: result.rows.slice(0, input.limit).map((event) => ({
        eventId: event.id,
        title: event.title,
        startsAt: toIso(event.starts_at),
        timezone: event.timezone,
        locationName: event.location_name,
        minimumPriceKopecks: event.minimum_price_kopecks,
        currency: event.currency,
        salesStatus: event.status
      })),
      hasMoreEvents: result.rowCount > input.limit
    };
  }

  async lockOrCreateForTelegramStart(input: {
    readonly userId: string;
    readonly messengerIdentityId: string;
    readonly eventSlug: string | null;
    readonly proposedSessionId: string;
    readonly occurredAt: Date;
    readonly expiresAt: Date;
  }): Promise<OpenTelegramScenarioResult> {
    const events = await this.session.query<EventRow>(
      `select id, published_scenario_version_id
       from public.events
       where status in ('published', 'sales_paused', 'sold_out')
         and published_scenario_version_id is not null
         and (ends_at is null or ends_at > $2)
         and ($1::text is null or slug = $1)
       order by starts_at, id
       limit 2`,
      [input.eventSlug, input.occurredAt]
    );
    if (events.rowCount === 0) {
      return { status: "event_not_found" };
    }
    if (input.eventSlug === null && events.rowCount > 1) {
      return { status: "event_selection_required" };
    }
    const event = events.rows[0];
    if (!event) {
      return { status: "event_not_found" };
    }

    return this.lockOrCreateForEvent({
      userId: input.userId,
      messengerIdentityId: input.messengerIdentityId,
      event,
      proposedSessionId: input.proposedSessionId,
      occurredAt: input.occurredAt,
      expiresAt: input.expiresAt
    });
  }

  async lockOrCreateForTelegramEventSelection(input: {
    readonly eventId: string;
    readonly senderExternalUserId: string;
    readonly proposedSessionId: string;
    readonly occurredAt: Date;
    readonly expiresAt: Date;
  }): Promise<OpenTelegramScenarioResult> {
    const participants = await this.session.query<TelegramParticipantRow>(
      `select user_id, id as messenger_identity_id
       from public.messenger_identities
       where channel = 'telegram'
         and external_user_id = $1`,
      [input.senderExternalUserId]
    );
    const participant = participants.rows[0];
    if (!participant) {
      return { status: "participant_not_found" };
    }
    const events = await this.session.query<EventRow>(
      `select id, published_scenario_version_id
       from public.events
       where id = $1
         and status in ('published', 'sales_paused', 'sold_out')
         and published_scenario_version_id is not null
         and (ends_at is null or ends_at > $2)`,
      [input.eventId, input.occurredAt]
    );
    const event = events.rows[0];
    if (!event) {
      return { status: "event_not_found" };
    }

    return this.lockOrCreateForEvent({
      userId: participant.user_id,
      messengerIdentityId: participant.messenger_identity_id,
      event,
      proposedSessionId: input.proposedSessionId,
      occurredAt: input.occurredAt,
      expiresAt: input.expiresAt
    });
  }

  private async lockOrCreateForEvent(input: {
    readonly userId: string;
    readonly messengerIdentityId: string;
    readonly event: EventRow;
    readonly proposedSessionId: string;
    readonly occurredAt: Date;
    readonly expiresAt: Date;
  }): Promise<OpenTelegramScenarioResult> {
    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`scenario-session:${input.userId}:${input.event.id}:telegram`]
    );
    await this.session.query(
      `update public.scenario_sessions
       set status = 'expired', updated_at = $3, lock_version = lock_version + 1
       where user_id = $1
         and event_id = $2
         and channel = 'telegram'
         and status in ('active', 'waiting_input')
         and expires_at <= $3`,
      [input.userId, input.event.id, input.occurredAt]
    );

    const current = await this.session.query<SessionRow>(
      `select id, user_id, event_id, scenario_version_id,
              current_node_id, lock_version, context
       from public.scenario_sessions
       where user_id = $1
         and event_id = $2
         and channel = 'telegram'
         and status in ('active', 'waiting_input')
       for update`,
      [input.userId, input.event.id]
    );
    const existing = current.rows[0];
    if (existing) {
      return {
        status: "ready",
        session: await this.loadSession(existing, false)
      };
    }
    if (!input.event.published_scenario_version_id) {
      return { status: "scenario_not_published" };
    }

    const graph = await this.loadPublishedGraph(
      input.event.published_scenario_version_id
    );
    if (!graph) {
      return { status: "scenario_not_published" };
    }
    const startNode = graph.nodes.find((node) => node.type === "start");
    if (!startNode) {
      return { status: "scenario_invalid" };
    }
    await this.session.query(
      `insert into public.scenario_sessions (
         id, user_id, messenger_identity_id, event_id, scenario_version_id,
         current_node_id, channel, status, context_schema_version, context,
         expires_at, lock_version, started_at, updated_at
       ) values (
         $1, $2, $3, $4, $5,
         $6, 'telegram', 'active', 1, '{}'::jsonb,
         $7, 1, $8, $8
       )`,
      [
        input.proposedSessionId,
        input.userId,
        input.messengerIdentityId,
        input.event.id,
        input.event.published_scenario_version_id,
        startNode.id,
        input.expiresAt,
        input.occurredAt
      ]
    );
    return {
      status: "ready",
      session: {
        id: input.proposedSessionId,
        userId: input.userId,
        eventId: input.event.id,
        scenarioVersionId: input.event.published_scenario_version_id,
        currentNodeId: startNode.id,
        lockVersion: 1,
        newlyCreated: true,
        graph,
        context: {}
      }
    };
  }

  async lockForTelegramTransition(input: {
    readonly sessionId: string;
    readonly senderExternalUserId: string;
    readonly occurredAt: Date;
  }): Promise<LockTelegramScenarioResult> {
    const result = await this.session.query<
      SessionRow & { readonly status: string; readonly expires_at: Date }
    >(
      `select sessions.id, sessions.user_id, sessions.event_id,
              sessions.scenario_version_id,
              sessions.current_node_id, sessions.lock_version,
              sessions.status, sessions.expires_at, sessions.context
       from public.scenario_sessions sessions
       join public.messenger_identities identity
         on identity.id = sessions.messenger_identity_id
        and identity.channel = 'telegram'
       where sessions.id = $1
         and identity.external_user_id = $2
       for update of sessions`,
      [input.sessionId, input.senderExternalUserId]
    );
    const current = result.rows[0];
    if (!current) {
      return { status: "session_not_found" };
    }
    if (current.expires_at <= input.occurredAt) {
      if (current.status === "active" || current.status === "waiting_input") {
        await this.session.query(
          `update public.scenario_sessions
           set status = 'expired', updated_at = $2,
               lock_version = lock_version + 1
           where id = $1`,
          [current.id, input.occurredAt]
        );
      }
      return { status: "session_not_waiting" };
    }
    if (current.status !== "waiting_input") {
      return { status: "session_not_waiting" };
    }
    return {
      status: "ready",
      session: await this.loadSession(current, false)
    };
  }

  async lockForTelegramInput(input: {
    readonly senderExternalUserId: string;
    readonly occurredAt: Date;
  }) {
    const result = await this.session.query<SessionRow>(
      `select sessions.id, sessions.user_id, sessions.event_id,
              sessions.scenario_version_id,
              sessions.current_node_id, sessions.lock_version,
              sessions.context
       from public.scenario_sessions sessions
       join public.messenger_identities identity
         on identity.id = sessions.messenger_identity_id
        and identity.channel = 'telegram'
       join public.scenario_nodes node
         on node.scenario_version_id = sessions.scenario_version_id
        and node.id = sessions.current_node_id
       where identity.external_user_id = $1
         and sessions.channel = 'telegram'
         and sessions.status = 'waiting_input'
         and sessions.expires_at > $2
         and node.node_type in ('text_input', 'number_input')
       order by sessions.updated_at desc, sessions.id
       limit 2
       for update of sessions`,
      [input.senderExternalUserId, input.occurredAt]
    );
    if (result.rowCount === 0) {
      return { status: "input_not_expected" as const };
    }
    if (result.rowCount > 1) {
      return { status: "input_ambiguous" as const };
    }
    const current = result.rows[0];
    if (!current) {
      return { status: "input_not_expected" as const };
    }
    return {
      status: "ready" as const,
      session: await this.loadSession(current, false)
    };
  }

  async lockForTelegramOrderAction(input: {
    readonly orderId: string;
    readonly senderExternalUserId: string;
    readonly nodeType: "offer_acceptance";
    readonly occurredAt: Date;
  }) {
    const result = await this.session.query<SessionRow>(
      `select sessions.id, sessions.user_id, sessions.event_id,
              sessions.scenario_version_id, sessions.current_node_id,
              sessions.lock_version, sessions.context
       from public.scenario_sessions sessions
       join public.messenger_identities identity
         on identity.id = sessions.messenger_identity_id
        and identity.channel = 'telegram'
       join public.scenario_nodes node
         on node.scenario_version_id = sessions.scenario_version_id
        and node.id = sessions.current_node_id
       where sessions.context #>> '{order,orderId}' = $1
         and identity.external_user_id = $2
         and sessions.channel = 'telegram'
         and sessions.status = 'waiting_input'
         and node.node_type = $3
         and sessions.expires_at > $4
       order by sessions.updated_at desc, sessions.id
       limit 2
       for update of sessions`,
      [
        input.orderId,
        input.senderExternalUserId,
        input.nodeType,
        input.occurredAt
      ]
    );
    if (result.rowCount === 0) {
      return { status: "action_not_expected" as const };
    }
    if (result.rowCount > 1) {
      return { status: "action_ambiguous" as const };
    }
    const current = result.rows[0];
    return current
      ? {
          status: "ready" as const,
          session: await this.loadSession(current, false)
        }
      : { status: "action_not_expected" as const };
  }

  async lockForTelegramPaymentCompletion(input: {
    readonly orderId: string;
    readonly occurredAt: Date;
  }) {
    const result = await this.session.query<SessionRow>(
      `select sessions.id, sessions.user_id, sessions.event_id,
              sessions.scenario_version_id, sessions.current_node_id,
              sessions.lock_version, sessions.context
       from public.scenario_sessions sessions
       join public.orders orders
         on orders.id = $1
        and orders.user_id = sessions.user_id
        and orders.event_id = sessions.event_id
        and orders.status in ('paid', 'partially_refunded')
       join public.scenario_nodes node
         on node.scenario_version_id = sessions.scenario_version_id
        and node.id = sessions.current_node_id
       where sessions.context #>> '{order,orderId}' = $1
         and sessions.channel = 'telegram'
         and sessions.status = 'waiting_input'
         and node.node_type = 'payment_start'
         and sessions.expires_at > $2
       order by sessions.updated_at desc, sessions.id
       limit 2
       for update of sessions`,
      [input.orderId, input.occurredAt]
    );
    if (result.rowCount === 0) {
      return { status: "action_not_expected" as const };
    }
    if (result.rowCount > 1) {
      return { status: "action_ambiguous" as const };
    }
    const current = result.rows[0];
    return current
      ? {
          status: "ready" as const,
          session: await this.loadSession(current, false)
        }
      : { status: "action_not_expected" as const };
  }

  async recordInputRejection(
    input: Parameters<ScenarioRuntimeRepository["recordInputRejection"]>[0]
  ): Promise<void> {
    await this.appendEvent(input.sessionId, {
      eventType: "command_received",
      nodeId: input.currentNodeId,
      edgeId: null,
      idempotencyKey: input.commandIdempotencyKey,
      payload: {
        kind: "input",
        accepted: false,
        reason: input.reason
      },
      occurredAt: input.occurredAt
    });
  }

  async saveExecution(input: SaveScenarioExecutionInput): Promise<void> {
    const completedAt = input.execution.status === "completed"
      ? input.occurredAt
      : null;
    const blockedReason = input.execution.status === "blocked"
      ? input.execution.blockReason
      : null;
    const contextKeys = Object.keys(input.contextPatch).sort();
    const lastInput = contextKeys.length > 0
      ? JSON.stringify({
          type: input.commandKind === "input" ? "input" : "action",
          contextKeys
        })
      : input.selectedEdgeId
        ? JSON.stringify({
          type: "transition",
          edgeId: input.selectedEdgeId,
          callbackQueryId: input.callbackQueryId
        })
        : null;
    const updated = await this.session.query(
      `update public.scenario_sessions
       set current_node_id = $3,
           status = $4,
           last_input = $5::jsonb,
           blocked_reason = $6,
           updated_at = $7,
           completed_at = $8,
           context = context || $9::jsonb,
           lock_version = lock_version + 1
       where id = $1
         and lock_version = $2
         and status in ('active', 'waiting_input')`,
      [
        input.session.id,
        input.session.lockVersion,
        input.execution.currentNodeId,
        input.execution.status,
        lastInput,
        blockedReason,
        input.occurredAt,
        completedAt,
        JSON.stringify(input.contextPatch)
      ]
    );
    expectAffectedRow(updated, "Scenario session lock was lost");

    await this.appendEvent(input.session.id, {
      eventType: "command_received",
      nodeId: input.session.currentNodeId,
      edgeId: input.selectedEdgeId,
      idempotencyKey: input.commandIdempotencyKey,
      payload: {
        kind: input.commandKind,
        callbackQueryId: input.callbackQueryId
      },
      occurredAt: input.occurredAt
    });
    await this.appendEvent(input.session.id, {
      eventType: input.session.newlyCreated
        ? "session_started"
        : "session_resumed",
      nodeId: input.session.currentNodeId,
      edgeId: null,
      idempotencyKey: null,
      payload: { scenarioVersionId: input.session.scenarioVersionId },
      occurredAt: input.occurredAt
    });
    if (input.selectedEdgeId) {
      await this.appendEvent(input.session.id, {
        eventType: "transition_selected",
        nodeId: input.session.currentNodeId,
        edgeId: input.selectedEdgeId,
        idempotencyKey: null,
        payload: {},
        occurredAt: input.occurredAt
      });
    }
    for (const visit of input.execution.visits) {
      await this.appendEvent(input.session.id, {
        eventType: "node_entered",
        nodeId: visit.nodeId,
        edgeId: visit.viaEdgeId,
        idempotencyKey: null,
        payload: {},
        occurredAt: input.occurredAt
      });
    }
    await this.appendEvent(input.session.id, {
      eventType: terminalEventType(input.execution.status),
      nodeId: input.execution.currentNodeId,
      edgeId: null,
      idempotencyKey: null,
      payload: input.execution.status === "blocked"
        ? { reason: input.execution.blockReason }
        : {},
      occurredAt: input.occurredAt
    });
  }

  private async loadSession(
    row: SessionRow,
    newlyCreated: boolean
  ): Promise<ScenarioRuntimeSession> {
    const graph = await this.loadGraph(row.scenario_version_id);
    if (!graph) {
      throw new Error("Pinned scenario version is unavailable");
    }
    return {
      id: row.id,
      userId: row.user_id,
      eventId: row.event_id,
      scenarioVersionId: row.scenario_version_id,
      currentNodeId: row.current_node_id,
      lockVersion: row.lock_version,
      newlyCreated,
      graph,
      context: asObject(row.context, "scenario session context")
    };
  }

  private async loadPublishedGraph(
    scenarioVersionId: string
  ): Promise<ScenarioGraph | null> {
    const version = await this.session.query<VersionRow>(
      `select id, schema_version
       from public.scenario_versions
       where id = $1 and status = 'published'`,
      [scenarioVersionId]
    );
    if (!version.rows[0]) {
      return null;
    }
    return this.loadGraphRows(version.rows[0]);
  }

  private async loadGraph(
    scenarioVersionId: string
  ): Promise<ScenarioGraph | null> {
    const version = await this.session.query<VersionRow>(
      `select id, schema_version
       from public.scenario_versions
       where id = $1 and status in ('published', 'retired')`,
      [scenarioVersionId]
    );
    return version.rows[0] ? this.loadGraphRows(version.rows[0]) : null;
  }

  private async loadGraphRows(version: VersionRow): Promise<ScenarioGraph> {
    const nodes = await this.session.query<NodeRow>(
      `select id, node_type, schema_version, payload
       from public.scenario_nodes
       where scenario_version_id = $1
       order by sort_order, id`,
      [version.id]
    );
    const edges = await this.session.query<EdgeRow>(
      `select id, from_node_id, to_node_id, label, priority, condition
       from public.scenario_edges
       where scenario_version_id = $1
       order by priority desc, id`,
      [version.id]
    );
    return {
      schemaVersion: version.schema_version,
      nodes: nodes.rows.map(mapNode),
      edges: edges.rows.map(mapEdge)
    };
  }

  private async appendEvent(
    sessionId: string,
    event: {
      readonly eventType: string;
      readonly nodeId: string | null;
      readonly edgeId: string | null;
      readonly idempotencyKey: string | null;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly occurredAt: Date;
    }
  ): Promise<void> {
    await this.session.query(
      `insert into public.scenario_events (
         id, session_id, event_type, node_id, edge_id,
         idempotency_key, schema_version, payload, occurred_at
       ) values ($1, $2, $3, $4, $5, $6, 1, $7::jsonb, $8)`,
      [
        this.idGenerator.newId(),
        sessionId,
        event.eventType,
        event.nodeId,
        event.edgeId,
        event.idempotencyKey,
        JSON.stringify(event.payload),
        event.occurredAt
      ]
    );
  }
}

export function createScenarioRuntimePersistence(
  pool: SqlConnectionPool,
  idGenerator: IdGenerator
) {
  const session = new TransactionSession();
  return {
    repository: new PostgresScenarioRuntimeRepository(session, idGenerator),
    orderSalesRepository: new PostgresOrderSalesRepository(session, idGenerator),
    paymentConfirmationRepository: new PostgresPaymentConfirmationRepository(
      session,
      idGenerator
    ),
    scenarioWalletCreditRepository: new PostgresScenarioWalletCreditRepository(
      session,
      idGenerator
    ),
    userClassificationRepository:
      new PostgresUserClassificationRepository(session),
    userClassificationAuditWriter:
      new PostgresUserClassificationAuditWriter(session),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}

function mapNode(row: NodeRow): ScenarioNode {
  return {
    id: row.id,
    type: row.node_type,
    schemaVersion: row.schema_version,
    payload: asObject(row.payload, "scenario node payload")
  };
}

function mapEdge(row: EdgeRow): ScenarioEdge {
  return {
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    label: row.label,
    priority: row.priority,
    condition: asObject(row.condition, "scenario edge condition")
  };
}

function asObject(
  value: unknown,
  label: string
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function terminalEventType(
  status: SaveScenarioExecutionInput["execution"]["status"]
): "session_waiting" | "session_completed" | "session_blocked" {
  switch (status) {
    case "waiting_input":
      return "session_waiting";
    case "completed":
      return "session_completed";
    case "blocked":
      return "session_blocked";
  }
}

function expectAffectedRow(
  result: SqlQueryResult<unknown>,
  message: string
): void {
  if (result.rowCount !== 1) {
    throw new Error(message);
  }
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid Telegram event timestamp");
  }
  return date.toISOString();
}
