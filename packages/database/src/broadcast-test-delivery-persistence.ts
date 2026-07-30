import type {
  AdminEventAuditContext,
  BroadcastPersonalizationContext,
  BroadcastTestDeliveryRepository,
  ClaimedBroadcastTestDelivery
} from "@ticket-platform/application";
import type {
  AdminBroadcastContent,
  AdminBroadcastTestDelivery,
  AdminBroadcastTestDeliveryStatus
} from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface BroadcastLockRow {
  readonly id: string;
  readonly lock_version: number;
  readonly published_version_id: string | null;
}

interface TestVersionRow {
  readonly id: string;
  readonly version_number: number;
  readonly schema_version: number;
  readonly content: unknown;
}

interface RecipientRow {
  readonly id: string;
  readonly external_user_id: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly display_name: string | null;
  readonly username: string | null;
}

export interface BroadcastTestDeliveryRow {
  readonly id: string;
  readonly broadcast_id: string;
  readonly broadcast_version_id: string;
  readonly version_number: number;
  readonly schema_version: number;
  readonly recipient_external_user_id: string;
  readonly content: unknown;
  readonly personalization_context: unknown;
  readonly status: string;
  readonly provider_message_id: string | null;
  readonly error_code: string | null;
  readonly requested_at: Date | string;
  readonly started_at: Date | string | null;
  readonly finished_at: Date | string | null;
}

export class PostgresBroadcastTestDeliveryRepository
implements BroadcastTestDeliveryRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  request(
    input: Parameters<BroadcastTestDeliveryRepository["request"]>[0]
  ) {
    return this.write(async (connection) => {
      await connection.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`broadcast:${input.broadcastId}`]
      );
      const aggregate = await connection.query<BroadcastLockRow>(
        `select id, lock_version, published_version_id
         from public.broadcasts
         where id = $1
         for update`,
        [input.broadcastId]
      );
      const broadcast = aggregate.rows[0];
      if (!broadcast) {
        return { status: "not_found" as const };
      }
      if (broadcast.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      const versionResult = await connection.query<TestVersionRow>(
        `select id, version_number, schema_version, content
         from public.broadcast_versions
         where broadcast_id = $1
           and (
             status = 'draft'
             or id = $2
           )
         order by case when status = 'draft' then 0 else 1 end,
                  version_number desc
         limit 1
         for share`,
        [input.broadcastId, broadcast.published_version_id]
      );
      const version = versionResult.rows[0];
      if (!version) {
        return { status: "not_found" as const };
      }
      const recipientResult = await connection.query<RecipientRow>(
        `select identity.id, identity.external_user_id,
                users.first_name, users.last_name, users.display_name,
                identity.username
         from public.messenger_identities identity
         join public.users users on users.id = identity.user_id
         where identity.channel = 'telegram'
           and identity.external_user_id = $1
           and identity.is_bot_blocked = false
           and users.is_blocked = false
           and users.is_deleted = false
         limit 1
         for share of identity, users`,
        [input.recipientTelegramUserId]
      );
      const recipient = recipientResult.rows[0];
      if (!recipient) {
        return { status: "recipient_unavailable" as const };
      }
      const inserted = await connection.query<BroadcastTestDeliveryRow>(
        `insert into public.broadcast_test_deliveries (
           id, broadcast_id, broadcast_version_id, version_number,
           requested_by_admin_id, recipient_messenger_identity_id,
           recipient_external_user_id, content, schema_version,
           personalization_context, status, requested_at
         ) values (
           $1, $2, $3, $4,
           $5, $6,
           $7, $8::jsonb, $9,
           $10::jsonb, 'queued', $11
         )
         returning ${TEST_DELIVERY_COLUMNS}`,
        [
          input.deliveryId,
          input.broadcastId,
          version.id,
          version.version_number,
          input.audit.actorAdminId,
          recipient.id,
          recipient.external_user_id,
          JSON.stringify(readContent(version.content)),
          version.schema_version,
          JSON.stringify(personalizationContext(recipient)),
          input.audit.occurredAt
        ]
      );
      const delivery = inserted.rows[0];
      if (!delivery) {
        throw new Error("Broadcast test delivery insert returned no row");
      }
      await appendRequestAudit(connection, input.audit, {
        broadcastId: input.broadcastId,
        deliveryId: input.deliveryId,
        broadcastVersionId: version.id,
        versionNumber: version.version_number,
        recipientIdentityId: recipient.id
      });
      await appendEvent(connection, {
        eventId: input.requestedEventId,
        eventType: "BroadcastTestSendRequested",
        broadcastId: input.broadcastId,
        deliveryId: input.deliveryId,
        occurredAt: input.audit.occurredAt,
        payload: {
          broadcastId: input.broadcastId,
          testDeliveryId: input.deliveryId,
          broadcastVersionId: version.id,
          versionNumber: version.version_number,
          recipientIdentityId: recipient.id
        }
      });
      return {
        status: "queued" as const,
        value: mapTestDelivery(delivery)
      };
    });
  }

  claimNext(
    input: Parameters<BroadcastTestDeliveryRepository["claimNext"]>[0]
  ) {
    return this.write(async (connection) => {
      const expiredResult = await connection.query<BroadcastTestDeliveryRow>(
        `select ${TEST_DELIVERY_COLUMNS}
         from public.broadcast_test_deliveries
         where status = 'sending'
           and lease_expires_at <= $1
         order by lease_expires_at, id
         limit 1
         for update skip locked`,
        [input.claimedAt]
      );
      const expired = expiredResult.rows[0];
      if (expired) {
        await connection.query(
          `update public.broadcast_test_deliveries
           set status = 'uncertain',
               lease_owner = null,
               lease_expires_at = null,
               error_code = 'WorkerLeaseExpired',
               finished_at = $2
           where id = $1 and status = 'sending'`,
          [expired.id, input.claimedAt]
        );
        await appendEvent(connection, {
          eventId: input.uncertainEventId,
          eventType: "BroadcastTestSendUncertain",
          broadcastId: expired.broadcast_id,
          deliveryId: expired.id,
          occurredAt: input.claimedAt,
          payload: {
            broadcastId: expired.broadcast_id,
            testDeliveryId: expired.id,
            errorCode: "WorkerLeaseExpired"
          }
        });
      }
      const queuedResult = await connection.query<BroadcastTestDeliveryRow>(
        `select ${TEST_DELIVERY_COLUMNS}
         from public.broadcast_test_deliveries
         where status = 'queued'
         order by requested_at, id
         limit 1
         for update skip locked`
      );
      const queued = queuedResult.rows[0];
      if (!queued) {
        return null;
      }
      const gate = await connection.query<{
        readonly next_delivery_at: Date | string | null;
      }>(
        `select next_delivery_at
         from public.broadcast_delivery_rate_gate
         where singleton = true
         for update`
      );
      const globalNext = gate.rows[0];
      if (!globalNext) {
        throw new Error("Broadcast delivery rate gate is missing");
      }
      if (
        globalNext.next_delivery_at
        && asDate(globalNext.next_delivery_at).getTime()
          > input.claimedAt.getTime()
      ) {
        return null;
      }
      const claimed = await connection.query<BroadcastTestDeliveryRow>(
        `update public.broadcast_test_deliveries
         set status = 'sending',
             attempt_count = 1,
             lease_owner = $2,
             lease_expires_at = $3 + ($4 * interval '1 second'),
             started_at = $3
         where id = $1 and status = 'queued'
         returning ${TEST_DELIVERY_COLUMNS}`,
        [
          queued.id,
          input.workerId,
          input.claimedAt,
          input.leaseSeconds
        ]
      );
      const row = claimed.rows[0];
      if (!row) {
        return null;
      }
      await connection.query(
        `update public.broadcast_delivery_rate_gate
         set next_delivery_at = $1,
             updated_at = $2
         where singleton = true`,
        [
          new Date(input.claimedAt.getTime() + 40),
          input.claimedAt
        ]
      );
      return mapClaimed(row);
    });
  }

  markSent(
    input: Parameters<BroadcastTestDeliveryRepository["markSent"]>[0]
  ): Promise<void> {
    return this.finish(input, "sent", null);
  }

  markFailed(
    input: Parameters<BroadcastTestDeliveryRepository["markFailed"]>[0]
  ): Promise<void> {
    return this.finish(input, "failed", input.errorCode);
  }

  private async finish(
    input:
      | Parameters<BroadcastTestDeliveryRepository["markSent"]>[0]
      | Parameters<BroadcastTestDeliveryRepository["markFailed"]>[0],
    status: "sent" | "failed",
    errorCode: string | null
  ): Promise<void> {
    await this.write(async (connection) => {
      const providerMessageId = status === "sent"
        ? (input as Parameters<
            BroadcastTestDeliveryRepository["markSent"]
          >[0]).providerMessageId
        : null;
      const occurredAt = status === "sent"
        ? (input as Parameters<
            BroadcastTestDeliveryRepository["markSent"]
          >[0]).sentAt
        : (input as Parameters<
            BroadcastTestDeliveryRepository["markFailed"]
          >[0]).failedAt;
      const updated = await connection.query(
        `update public.broadcast_test_deliveries
         set status = $3,
             lease_owner = null,
             lease_expires_at = null,
             provider_message_id = $4,
             error_code = $5,
             finished_at = $6
         where id = $1
           and status = 'sending'
           and lease_owner = $2`,
        [
          input.delivery.deliveryId,
          input.workerId,
          status,
          providerMessageId,
          errorCode,
          occurredAt
        ]
      );
      if (updated.rowCount !== 1) {
        throw new Error("Broadcast test delivery lease was lost");
      }
      await appendEvent(connection, {
        eventId: input.lifecycleEventId,
        eventType: status === "sent"
          ? "BroadcastTestSendSent"
          : "BroadcastTestSendFailed",
        broadcastId: input.delivery.broadcastId,
        deliveryId: input.delivery.deliveryId,
        occurredAt,
        payload: {
          broadcastId: input.delivery.broadcastId,
          testDeliveryId: input.delivery.deliveryId,
          ...(providerMessageId ? { providerMessageId } : {}),
          ...(errorCode ? { errorCode } : {})
        }
      });
    });
  }

  private async write<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      try {
        const result = await work(connection);
        await connection.query("commit");
        return result;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}

export function createBroadcastTestDeliveryPersistence(
  pool: SqlConnectionPool
): BroadcastTestDeliveryRepository {
  return new PostgresBroadcastTestDeliveryRepository(pool);
}

const TEST_DELIVERY_COLUMNS = `
  id, broadcast_id, broadcast_version_id, version_number, schema_version,
  recipient_external_user_id, content, personalization_context, status,
  provider_message_id, error_code, requested_at, started_at, finished_at`;

function mapClaimed(
  row: BroadcastTestDeliveryRow
): ClaimedBroadcastTestDelivery {
  return {
    deliveryId: row.id,
    broadcastId: row.broadcast_id,
    recipientId: row.recipient_external_user_id,
    schemaVersion: readSchemaVersion(row.schema_version),
    content: readContent(row.content),
    personalizationContext: readPersonalizationContext(
      row.personalization_context
    )
  };
}

export function mapBroadcastTestDelivery(
  row: BroadcastTestDeliveryRow
): AdminBroadcastTestDelivery {
  return mapTestDelivery(row);
}

function mapTestDelivery(
  row: BroadcastTestDeliveryRow
): AdminBroadcastTestDelivery {
  return {
    id: row.id,
    broadcastVersionId: row.broadcast_version_id,
    versionNumber: row.version_number,
    recipientTelegramUserId: row.recipient_external_user_id,
    status: readStatus(row.status),
    providerMessageId: row.provider_message_id,
    errorCode: row.error_code,
    requestedAt: asIso(row.requested_at),
    startedAt: row.started_at ? asIso(row.started_at) : null,
    finishedAt: row.finished_at ? asIso(row.finished_at) : null
  };
}

function readContent(value: unknown): AdminBroadcastContent {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Broadcast test content is invalid");
  }
  return parsed as AdminBroadcastContent;
}

function readSchemaVersion(value: number): 1 | 2 | 3 {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new Error("Broadcast test schema version is invalid");
  }
  return value;
}

function personalizationContext(
  recipient: RecipientRow
): BroadcastPersonalizationContext {
  return {
    firstName: recipient.first_name,
    lastName: recipient.last_name,
    displayName: recipient.display_name,
    telegramUsername: recipient.username
  };
}

function readPersonalizationContext(
  value: unknown
): BroadcastPersonalizationContext {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Broadcast test personalization context is invalid");
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  return {
    firstName: optionalString(record.firstName),
    lastName: optionalString(record.lastName),
    displayName: optionalString(record.displayName),
    telegramUsername: optionalString(record.telegramUsername)
  };
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length > 500) {
    throw new Error("Broadcast test personalization value is invalid");
  }
  return value;
}

function readStatus(value: string): AdminBroadcastTestDeliveryStatus {
  const statuses: readonly AdminBroadcastTestDeliveryStatus[] = [
    "queued",
    "sending",
    "sent",
    "failed",
    "uncertain"
  ];
  if (!statuses.includes(value as AdminBroadcastTestDeliveryStatus)) {
    throw new Error("Broadcast test delivery status is invalid");
  }
  return value as AdminBroadcastTestDeliveryStatus;
}

function asIso(value: Date | string): string {
  return asDate(value).toISOString();
}

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Broadcast test delivery timestamp is invalid");
  }
  return date;
}

function appendRequestAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  input: {
    readonly broadcastId: string;
    readonly deliveryId: string;
    readonly broadcastVersionId: string;
    readonly versionNumber: number;
    readonly recipientIdentityId: string;
  }
): Promise<unknown> {
  return connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, 'broadcast.test_send_requested', 'broadcast', $4,
       $5, null, $6::jsonb, $7,
       $8::inet, $9, $10
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      input.broadcastId,
      audit.reason,
      JSON.stringify({
        testDeliveryId: input.deliveryId,
        broadcastVersionId: input.broadcastVersionId,
        versionNumber: input.versionNumber,
        recipientIdentityId: input.recipientIdentityId
      }),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}

function appendEvent(
  connection: SqlConnection,
  input: {
    readonly eventId: string;
    readonly eventType:
      | "BroadcastTestSendRequested"
      | "BroadcastTestSendSent"
      | "BroadcastTestSendFailed"
      | "BroadcastTestSendUncertain";
    readonly broadcastId: string;
    readonly deliveryId: string;
    readonly occurredAt: Date;
    readonly payload: Readonly<Record<string, unknown>>;
  }
): Promise<unknown> {
  return connection.query(
    `insert into public.outbox_events (
       event_id, aggregate_type, aggregate_id, event_type,
       schema_version, payload, occurred_at
     ) values ($1, 'broadcast_test_delivery', $2, $3, 1, $4::jsonb, $5)`,
    [
      input.eventId,
      input.deliveryId,
      input.eventType,
      JSON.stringify(input.payload),
      input.occurredAt
    ]
  );
}
