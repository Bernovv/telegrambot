import type {
  BroadcastDeliveryCompletion,
  BroadcastDeliveryRepository,
  ClaimedBroadcastDelivery,
  BroadcastPersonalizationContext
} from "@ticket-platform/application";
import type { AdminBroadcastContent } from "@ticket-platform/contracts";
import type {
  SqlConnection,
  SqlConnectionPool
} from "./postgres.js";

interface BroadcastClaimRow {
  readonly id: string;
  readonly rate_per_second: number;
  readonly next_delivery_at: Date | string | null;
  readonly schema_version: number;
  readonly content: unknown;
}

interface DeliveryClaimRow {
  readonly id: string;
  readonly user_id: string;
  readonly telegram_identity_id: string;
  readonly recipient_external_user_id: string;
  readonly personalization_context: unknown;
  readonly attempt_count: number;
}

interface CampaignProgressRow {
  readonly attempted_recipient_count: string;
  readonly failed_recipient_count: string;
}

export class PostgresBroadcastDeliveryRepository
implements BroadcastDeliveryRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async claimNext(input: {
    readonly workerId: string;
    readonly claimedAt: Date;
    readonly leaseSeconds: number;
    readonly lifecycleEventId: string;
  }): Promise<ClaimedBroadcastDelivery | null> {
    return this.transaction(async (connection) => {
      const gate = await connection.query<{ readonly next_delivery_at: Date | string | null }>(
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
        && asDate(globalNext.next_delivery_at).getTime() > input.claimedAt.getTime()
      ) {
        return null;
      }
      const campaign = (await connection.query<BroadcastClaimRow>(
        `select broadcasts.id,
                broadcasts.rate_per_second,
                broadcasts.next_delivery_at,
                versions.schema_version,
                versions.content
         from public.broadcasts broadcasts
         join public.broadcast_versions versions
           on versions.id = broadcasts.scheduled_version_id
         where broadcasts.lifecycle_status in ('preparing', 'sending')
           and broadcasts.prepared_at is not null
           and coalesce(
             broadcasts.next_delivery_at,
             broadcasts.scheduled_at
           ) <= $1
         order by coalesce(
           broadcasts.next_delivery_at,
           broadcasts.scheduled_at
         ), broadcasts.id
         for update of broadcasts skip locked
         limit 1`,
        [input.claimedAt]
      )).rows[0];
      if (!campaign) {
        return null;
      }

      const delivery = (await connection.query<DeliveryClaimRow>(
        `select id, user_id, telegram_identity_id,
                recipient_external_user_id, personalization_context,
                attempt_count
         from public.broadcast_deliveries
         where broadcast_id = $1
           and (
             status = 'pending'
             or (status = 'retry' and retry_at <= $2)
             or (
               status = 'sending'
               and lease_expires_at <= $2
             )
           )
         order by coalesce(retry_at, scheduled_at), id
         for update skip locked
         limit 1`,
        [campaign.id, input.claimedAt]
      )).rows[0];

      if (!delivery) {
        const completed = await completeIfFinished(
          connection,
          campaign.id,
          input.claimedAt,
          input.lifecycleEventId
        );
        if (!completed) {
          await moveCampaignWakeUp(
            connection,
            campaign.id,
            input.claimedAt
          );
        }
        return null;
      }

      const claimed = (await connection.query<DeliveryClaimRow>(
        `update public.broadcast_deliveries
         set status = 'sending',
             attempt_count = attempt_count + 1,
             first_attempt_at = coalesce(first_attempt_at, $3),
             retry_at = null,
             lease_owner = $2,
             lease_expires_at = $3 + ($4 * interval '1 second'),
             updated_at = $3
         where id = $1
         returning id, user_id, telegram_identity_id,
                   recipient_external_user_id, personalization_context,
                   attempt_count`,
        [
          delivery.id,
          input.workerId,
          input.claimedAt,
          input.leaseSeconds
        ]
      )).rows[0];
      if (!claimed) {
        throw new Error("Broadcast delivery claim was lost");
      }

      const intervalMs = Math.ceil(1_000 / campaign.rate_per_second);
      const nextDeliveryAt = new Date(input.claimedAt.getTime() + intervalMs);
      const globalNextDeliveryAt = new Date(input.claimedAt.getTime() + 40);
      await connection.query(
        `update public.broadcast_delivery_rate_gate
         set next_delivery_at = $1,
             updated_at = $2
         where singleton = true`,
        [globalNextDeliveryAt, input.claimedAt]
      );
      const updated = await connection.query(
        `update public.broadcasts
         set lifecycle_status = 'sending',
             send_started_at = coalesce(send_started_at, $2),
             next_delivery_at = $3,
             attempted_recipient_count = attempted_recipient_count
               + case when $4 = 0 then 1 else 0 end,
             updated_at = $2
         where id = $1
           and lifecycle_status in ('preparing', 'sending')`,
        [
          campaign.id,
          input.claimedAt,
          nextDeliveryAt,
          delivery.attempt_count
        ]
      );
      if (updated.rowCount !== 1) {
        throw new Error("Broadcast campaign claim was lost");
      }

      return {
        deliveryId: claimed.id,
        broadcastId: campaign.id,
        userId: claimed.user_id,
        telegramIdentityId: claimed.telegram_identity_id,
        recipientId: claimed.recipient_external_user_id,
        schemaVersion: readSchemaVersion(campaign.schema_version),
        content: readContent(campaign.content),
        personalizationContext: readPersonalizationContext(
          delivery.personalization_context
        ),
        attemptCount: claimed.attempt_count
      };
    });
  }

  async markSent(input: {
    readonly delivery: ClaimedBroadcastDelivery;
    readonly workerId: string;
    readonly providerMessageId: string;
    readonly sentAt: Date;
    readonly lifecycleEventId: string;
  }): Promise<BroadcastDeliveryCompletion> {
    return this.transaction(async (connection) => {
      const campaignStatus = await lockCampaignForResult(
        connection,
        input.delivery.broadcastId
      );
      const result = await connection.query(
        `update public.broadcast_deliveries
         set status = 'sent',
             provider_message_id = $3,
             last_error_code = null,
             sent_at = $4,
             retry_at = null,
             lease_owner = null,
             lease_expires_at = null,
             updated_at = $4
         where id = $1
           and broadcast_id = $5
           and status = 'sending'
           and lease_owner = $2`,
        [
          input.delivery.deliveryId,
          input.workerId,
          input.providerMessageId,
          input.sentAt,
          input.delivery.broadcastId
        ]
      );
      if (result.rowCount !== 1) {
        throw new Error("Broadcast delivery sent lease was lost");
      }
      await connection.query(
        `update public.broadcasts
         set sent_recipient_count = sent_recipient_count + 1,
             updated_at = $2
         where id = $1`,
        [input.delivery.broadcastId, input.sentAt]
      );
      const completed = await completeIfFinished(
        connection,
        input.delivery.broadcastId,
        input.sentAt,
        input.lifecycleEventId
      );
      return {
        broadcastStatus: completed ? "completed" : campaignStatus
      };
    });
  }

  async markFailed(input: {
    readonly delivery: ClaimedBroadcastDelivery;
    readonly workerId: string;
    readonly failedAt: Date;
    readonly errorCode: string;
    readonly retryAt: Date | null;
    readonly blocked: boolean;
    readonly autoPauseMinimumAttempts: number;
    readonly autoPauseFailurePercent: number;
    readonly lifecycleEventId: string;
  }): Promise<BroadcastDeliveryCompletion> {
    return this.transaction(async (connection) => {
      const campaignStatus = await lockCampaignForResult(
        connection,
        input.delivery.broadcastId
      );
      const retryAt = campaignStatus === "cancelled" ? null : input.retryAt;
      const result = await connection.query(
        `update public.broadcast_deliveries
         set status = case when $4::timestamptz is null
                       then 'failed' else 'retry' end,
             last_error_code = $3,
             retry_at = $4,
             lease_owner = null,
             lease_expires_at = null,
             updated_at = $5
         where id = $1
           and broadcast_id = $6
           and status = 'sending'
           and lease_owner = $2`,
        [
          input.delivery.deliveryId,
          input.workerId,
          input.errorCode,
          retryAt,
          input.failedAt,
          input.delivery.broadcastId
        ]
      );
      if (result.rowCount !== 1) {
        throw new Error("Broadcast delivery failed lease was lost");
      }

      if (input.blocked) {
        await connection.query(
          `update public.messenger_identities
           set is_bot_blocked = true,
               updated_at = $2
           where id = $1
             and user_id = $3
             and channel = 'telegram'`,
          [
            input.delivery.telegramIdentityId,
            input.failedAt,
            input.delivery.userId
          ]
        );
      }

      if (retryAt) {
        await connection.query(
          `update public.broadcasts
           set next_delivery_at = least(
                 coalesce(next_delivery_at, $2),
                 $2
               ),
               updated_at = $3
           where id = $1`,
          [
            input.delivery.broadcastId,
            retryAt,
            input.failedAt
          ]
        );
        return { broadcastStatus: campaignStatus };
      }

      const progress = (await connection.query<CampaignProgressRow>(
        `update public.broadcasts
         set failed_recipient_count = failed_recipient_count + 1,
             updated_at = $2
         where id = $1
         returning attempted_recipient_count::text,
                   failed_recipient_count::text`,
        [input.delivery.broadcastId, input.failedAt]
      )).rows[0];
      if (!progress) {
        throw new Error("Broadcast failure progress was not updated");
      }

      if (
        campaignStatus === "sending"
        &&
        BigInt(progress.attempted_recipient_count)
          >= BigInt(input.autoPauseMinimumAttempts)
        && BigInt(progress.failed_recipient_count) * 100n
          >= BigInt(progress.attempted_recipient_count)
            * BigInt(input.autoPauseFailurePercent)
      ) {
        const paused = await connection.query(
          `update public.broadcasts
           set lifecycle_status = 'paused',
               paused_at = $2,
               auto_pause_reason = 'automatic_failure_rate',
               updated_at = $2
           where id = $1
             and lifecycle_status = 'sending'`,
          [input.delivery.broadcastId, input.failedAt]
        );
        if (paused.rowCount !== 1) {
          throw new Error("Broadcast automatic pause transition was lost");
        }
        await appendLifecycleEvent(
          connection,
          input.lifecycleEventId,
          input.delivery.broadcastId,
          "BroadcastAutoPaused",
          {
            broadcastId: input.delivery.broadcastId,
            reason: "automatic_failure_rate"
          },
          input.failedAt
        );
        return { broadcastStatus: "paused" };
      }

      const completed = await completeIfFinished(
        connection,
        input.delivery.broadcastId,
        input.failedAt,
        input.lifecycleEventId
      );
      return {
        broadcastStatus: completed ? "completed" : campaignStatus
      };
    });
  }

  private async transaction<T>(
    work: (connection: SqlConnection) => Promise<T>
  ): Promise<T> {
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

export function createBroadcastDeliveryPersistence(
  pool: SqlConnectionPool
): BroadcastDeliveryRepository {
  return new PostgresBroadcastDeliveryRepository(pool);
}

async function lockCampaignForResult(
  connection: SqlConnection,
  broadcastId: string
): Promise<"sending" | "paused" | "cancelled"> {
  const result = await connection.query<{
    readonly lifecycle_status: "sending" | "paused" | "cancelled";
  }>(
    `select lifecycle_status
     from public.broadcasts
     where id = $1
       and lifecycle_status in ('sending', 'paused', 'cancelled')
     for update`,
    [broadcastId]
  );
  if (result.rowCount !== 1) {
    throw new Error("Broadcast campaign no longer accepts delivery results");
  }
  const status = result.rows[0]?.lifecycle_status;
  if (!status) {
    throw new Error("Broadcast campaign lifecycle status is missing");
  }
  return status;
}

async function completeIfFinished(
  connection: SqlConnection,
  broadcastId: string,
  at: Date,
  eventId: string
): Promise<boolean> {
  const active = await connection.query(
    `select id
     from public.broadcast_deliveries
     where broadcast_id = $1
       and status in ('pending', 'sending', 'retry')
     limit 1`,
    [broadcastId]
  );
  if (active.rowCount > 0) {
    return false;
  }
  const completed = await connection.query(
    `update public.broadcasts
     set lifecycle_status = 'completed',
         completed_at = $2,
         next_delivery_at = null,
         updated_at = $2
     where id = $1
       and lifecycle_status in ('preparing', 'sending')`,
    [broadcastId, at]
  );
  if (completed.rowCount === 1) {
    await appendLifecycleEvent(
      connection,
      eventId,
      broadcastId,
      "BroadcastCompleted",
      { broadcastId },
      at
    );
    return true;
  }
  return false;
}

async function moveCampaignWakeUp(
  connection: SqlConnection,
  broadcastId: string,
  at: Date
): Promise<void> {
  await connection.query(
    `update public.broadcasts
     set next_delivery_at = coalesce(
           (
             select min(wake_at)
             from (
               select retry_at as wake_at
               from public.broadcast_deliveries
               where broadcast_id = $1 and status = 'retry'
               union all
               select lease_expires_at
               from public.broadcast_deliveries
               where broadcast_id = $1 and status = 'sending'
             ) wake_ups
           ),
           $2 + interval '1 second'
         ),
         updated_at = $2
     where id = $1`,
    [broadcastId, at]
  );
}

function readContent(value: unknown): AdminBroadcastContent {
  const content = record(value);
  if (
    typeof content.text !== "string"
    || content.text.length < 1
    || content.text.length > 4_096
    || typeof content.disableLinkPreview !== "boolean"
    || !Array.isArray(content.buttons)
    || content.buttons.length > 20
  ) {
    throw new Error("Scheduled broadcast content is invalid");
  }
  const buttons = content.buttons.map((value) => {
    const button = record(value);
    if (
      typeof button.label !== "string"
      || button.label.length < 1
      || button.label.length > 64
      || typeof button.url !== "string"
      || !button.url.startsWith("https://")
      || button.url.length > 2_048
    ) {
      throw new Error("Scheduled broadcast button is invalid");
    }
    return { label: button.label, url: button.url };
  });
  return {
    text: content.text,
    disableLinkPreview: content.disableLinkPreview,
    buttons
  };
}

function readSchemaVersion(value: number): 1 | 2 | 3 {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new Error("Broadcast content schema version is invalid");
  }
  return value;
}

function readPersonalizationContext(
  value: unknown
): BroadcastPersonalizationContext {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Broadcast personalization context is invalid");
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
    throw new Error("Broadcast personalization value is invalid");
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scheduled broadcast content must be an object");
  }
  return value as Record<string, unknown>;
}

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Broadcast delivery timestamp is invalid");
  }
  return date;
}

async function appendLifecycleEvent(
  connection: SqlConnection,
  eventId: string,
  broadcastId: string,
  eventType: "BroadcastCompleted" | "BroadcastAutoPaused",
  payload: Readonly<Record<string, string>>,
  occurredAt: Date
): Promise<void> {
  await connection.query(
    `insert into public.outbox_events (
       event_id, aggregate_type, aggregate_id, event_type,
       schema_version, payload, occurred_at
     ) values ($1, 'broadcast', $2, $3, 1, $4::jsonb, $5)`,
    [
      eventId,
      broadcastId,
      eventType,
      JSON.stringify(payload),
      occurredAt
    ]
  );
}
