import type {
  OfferAcceptanceOrder,
  OfferAcceptanceRepository,
  RecordTelegramOfferAcceptanceInput
} from "@ticket-platform/application";
import {
  PostgresOutboxWriter
} from "./telegram-start-persistence.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface OfferAcceptanceRow {
  readonly id: string;
  readonly number: string;
  readonly user_id: string;
  readonly messenger_identity_id: string;
  readonly event_id: string;
  readonly status: OfferAcceptanceOrder["status"];
  readonly currency: string;
  readonly total_kopecks: string;
  readonly wallet_applied_kopecks: string;
  readonly external_due_kopecks: string;
  readonly offer_version_id: string | null;
  readonly display_text_snapshot: string | null;
  readonly offer_accepted_at: Date | null;
  readonly expires_at: Date;
}

export class PostgresOfferAcceptanceRepository implements OfferAcceptanceRepository {
  constructor(private readonly session: TransactionSession) {}

  async lockForTelegramAcceptance(
    publicTokenHash: string,
    senderExternalUserId: string
  ): Promise<OfferAcceptanceOrder | null> {
    const result = await this.session.query<OfferAcceptanceRow>(
      `select
         o.id,
         o.number,
         o.user_id,
         mi.id as messenger_identity_id,
         o.event_id,
         o.status,
         o.currency,
         o.total_kopecks::text,
         o.wallet_applied_kopecks::text,
         o.external_due_kopecks::text,
         o.offer_version_id,
         ov.display_text_snapshot,
         o.offer_accepted_at,
         o.expires_at
       from public.orders o
       join public.messenger_identities mi
         on mi.user_id = o.user_id
        and mi.channel = 'telegram'
        and mi.external_user_id = $2
       left join public.offer_versions ov on ov.id = o.offer_version_id
       where o.public_token_hash = $1
       for update of o`,
      [publicTokenHash, senderExternalUserId]
    );
    const row = result.rows[0];

    return row ? toOfferAcceptanceOrder(row) : null;
  }

  async recordTelegramAcceptance(input: RecordTelegramOfferAcceptanceInput): Promise<void> {
    const offerVersionId = input.order.offerVersionId;
    const acceptanceText = input.order.offerDisplayTextSnapshot;
    if (!offerVersionId || !acceptanceText) {
      throw new Error("Pinned offer version is required to record acceptance");
    }

    const updated = await this.session.query(
      `update public.orders
       set status = 'awaiting_payment',
           offer_accepted_at = $2,
           lock_version = lock_version + 1,
           updated_at = $2
       where id = $1
         and status = 'awaiting_offer'
         and offer_accepted_at is null`,
      [input.order.id, input.acceptedAt]
    );
    if (updated.rowCount !== 1) {
      throw new Error("Offer acceptance lost the locked order transition");
    }

    await this.session.query(
      `insert into public.offer_acceptances (
         id, user_id, order_id, offer_version_id, accepted_at, channel,
         messenger_identity_id, telegram_update_id, telegram_message_id,
         callback_query_id, acceptance_text_snapshot,
         evidence_schema_version, evidence
       ) values (
         $1, $2, $3, $4, $5, 'telegram',
         $6, $7, $8,
         $9, $10,
         1, $11::jsonb
       )`,
      [
        input.acceptanceId,
        input.order.userId,
        input.order.id,
        offerVersionId,
        input.acceptedAt,
        input.order.messengerIdentityId,
        input.updateId,
        input.messageId,
        input.callbackQueryId,
        acceptanceText,
        JSON.stringify({
          schemaVersion: 1,
          updateId: input.updateId,
          callbackQueryId: input.callbackQueryId,
          messageId: input.messageId
        })
      ]
    );
    await this.session.query(
      `insert into public.order_status_history (
         id, order_id, from_status, to_status, reason, actor_type,
         actor_user_id, idempotency_key, occurred_at,
         metadata_schema_version, metadata
       ) values (
         $1, $2, 'awaiting_offer', 'awaiting_payment', 'offer_accepted', 'user',
         $3, $4, $5,
         1, $6::jsonb
       )`,
      [
        input.historyId,
        input.order.id,
        input.order.userId,
        `offer_acceptance:${input.order.id}:${offerVersionId}`,
        input.acceptedAt,
        JSON.stringify({
          schemaVersion: 1,
          offerVersionId,
          channel: "telegram"
        })
      ]
    );
  }
}

export function createOfferAcceptancePersistence(
  pool: SqlConnectionPool
) {
  const session = new TransactionSession();

  return {
    offerAcceptanceRepository: new PostgresOfferAcceptanceRepository(session),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}

function toOfferAcceptanceOrder(row: OfferAcceptanceRow): OfferAcceptanceOrder {
  return {
    id: row.id,
    number: row.number,
    userId: row.user_id,
    messengerIdentityId: row.messenger_identity_id,
    eventId: row.event_id,
    status: row.status,
    currency: row.currency,
    total: BigInt(row.total_kopecks),
    walletApplied: BigInt(row.wallet_applied_kopecks),
    externalDue: BigInt(row.external_due_kopecks),
    offerVersionId: row.offer_version_id,
    offerDisplayTextSnapshot: row.display_text_snapshot,
    offerAcceptedAt: row.offer_accepted_at,
    expiresAt: row.expires_at
  };
}
