import type {
  BeginIdempotentOperationInput,
  IdGenerator,
  IdempotencyRepository,
  IdentityRepository,
  OutboxWriter,
  RecordTouchpointInput,
  UpsertTelegramIdentityInput,
  UpsertTelegramIdentityResult
} from "@ticket-platform/application";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";

interface IdentityRow {
  readonly messenger_identity_id: string;
  readonly user_id: string;
  readonly phone_status: "unknown" | "imported" | "verified" | "rejected";
  readonly username: string | null;
  readonly username_normalized: string | null;
}

interface ReturningKeyRow {
  readonly key: string;
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly idGenerator: IdGenerator
  ) {}

  async upsertTelegramIdentity(input: UpsertTelegramIdentityInput): Promise<UpsertTelegramIdentityResult> {
    await this.lock(`telegram-identity:${input.externalUserId}`);

    const existing = await this.session.query<IdentityRow>(
      `select
         mi.id as messenger_identity_id,
         mi.user_id,
         u.phone_status,
         mi.username,
         mi.username_normalized
       from public.messenger_identities mi
       join public.users u on u.id = mi.user_id
       where mi.channel = 'telegram' and mi.external_user_id = $1`,
      [input.externalUserId]
    );

    const current = existing.rows[0];
    if (current) {
      await this.updateExistingIdentity(current, input);
      return mapIdentity(current, false);
    }

    return this.createIdentity(input);
  }

  async recordTouchpoint(input: RecordTouchpointInput): Promise<void> {
    await this.lock(`user-touchpoint:${input.userId}`);
    await this.session.query(
      `update public.user_touchpoints
       set is_last_touch = false
       where user_id = $1 and is_last_touch = true`,
      [input.userId]
    );
    await this.session.query(
      `insert into public.user_touchpoints (
         id, user_id, channel, raw_payload, source, campaign, partner_code, event_slug,
         occurred_at, is_first_touch, is_last_touch
       )
       select $1, $2, $3, $4, $5, $6, $7, $8, $9,
         not exists (select 1 from public.user_touchpoints where user_id = $2),
         true`,
      [
        this.idGenerator.newId(),
        input.userId,
        input.channel,
        input.payload.rawPayload,
        input.payload.source,
        input.payload.campaign,
        input.payload.partnerCode,
        input.payload.eventSlug,
        input.occurredAt
      ]
    );
  }

  private async createIdentity(input: UpsertTelegramIdentityInput): Promise<UpsertTelegramIdentityResult> {
    const userId = this.idGenerator.newId();
    const messengerIdentityId = this.idGenerator.newId();

    await this.session.query(
      `insert into public.users (
         id, first_name, last_name, preferred_language, registered_at, last_seen_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $5, $5, $5)`,
      [userId, input.firstName, input.lastName, input.languageCode, input.seenAt]
    );
    await this.session.query(
      `insert into public.messenger_identities (
         id, user_id, channel, external_user_id, username, username_normalized, first_seen_at, last_seen_at
       ) values ($1, $2, 'telegram', $3, $4, $5, $6, $6)`,
      [
        messengerIdentityId,
        userId,
        input.externalUserId,
        input.username,
        input.usernameNormalized,
        input.seenAt
      ]
    );
    await this.session.query(
      `insert into public.messenger_username_history (
         id, messenger_identity_id, username, username_normalized, valid_from
       ) values ($1, $2, $3, $4, $5)`,
      [this.idGenerator.newId(), messengerIdentityId, input.username, input.usernameNormalized, input.seenAt]
    );

    return {
      user: { id: userId, phoneStatus: "unknown" },
      messengerIdentity: { id: messengerIdentityId, userId },
      isNewUser: true
    };
  }

  private async updateExistingIdentity(
    current: IdentityRow,
    input: UpsertTelegramIdentityInput
  ): Promise<void> {
    await this.session.query(
      `update public.users
       set first_name = coalesce($2, first_name),
           last_name = coalesce($3, last_name),
           preferred_language = coalesce($4, preferred_language),
           last_seen_at = greatest(coalesce(last_seen_at, $5), $5),
           updated_at = greatest(updated_at, $5)
       where id = $1`,
      [current.user_id, input.firstName, input.lastName, input.languageCode, input.seenAt]
    );
    await this.session.query(
      `update public.messenger_identities
       set username = $2,
           username_normalized = $3,
           last_seen_at = greatest(last_seen_at, $4)
       where id = $1`,
      [current.messenger_identity_id, input.username, input.usernameNormalized, input.seenAt]
    );

    if (current.username !== input.username || current.username_normalized !== input.usernameNormalized) {
      const closed = await this.session.query<{ readonly valid_to: Date }>(
        `update public.messenger_username_history
         set valid_to = greatest($2, valid_from + interval '1 microsecond')
         where messenger_identity_id = $1 and valid_to is null
         returning valid_to`,
        [current.messenger_identity_id, input.seenAt]
      );
      await this.session.query(
        `insert into public.messenger_username_history (
           id, messenger_identity_id, username, username_normalized, valid_from
         ) values ($1, $2, $3, $4, $5)`,
        [
          this.idGenerator.newId(),
          current.messenger_identity_id,
          input.username,
          input.usernameNormalized,
          closed.rows[0]?.valid_to ?? input.seenAt
        ]
      );
    }
  }

  private async lock(key: string): Promise<void> {
    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [key]
    );
  }
}

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly session: TransactionSession) {}

  async tryBegin(input: BeginIdempotentOperationInput): Promise<boolean> {
    const result = await this.session.query<ReturningKeyRow>(
      `insert into public.idempotency_keys (
         key, scope, status, first_seen_at, last_seen_at
       ) values ($1, $2, 'processing', $3, $3)
       on conflict (key) do update
         set status = 'processing', last_seen_at = excluded.last_seen_at
         where public.idempotency_keys.status = 'failed'
       returning key`,
      [input.key, input.scope, input.occurredAt]
    );

    return result.rowCount === 1;
  }

  async markProcessed(key: string, processedAt: Date): Promise<void> {
    const result = await this.session.query(
      `update public.idempotency_keys
       set status = 'processed', last_seen_at = $2
       where key = $1 and status = 'processing'`,
      [key, processedAt]
    );

    expectAffectedRow(result, `Idempotency key was not processing: ${key}`);
  }
}

export class PostgresOutboxWriter implements OutboxWriter {
  constructor(private readonly session: TransactionSession) {}

  async append(event: DomainEvent): Promise<void> {
    await this.session.query(
      `insert into public.outbox_events (
         event_id, aggregate_type, aggregate_id, event_type, schema_version, payload, occurred_at
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        event.eventId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        event.schemaVersion,
        JSON.stringify(event.payload),
        event.occurredAt
      ]
    );
  }
}

export function createTelegramStartPersistence(pool: SqlConnectionPool, idGenerator: IdGenerator) {
  const session = new TransactionSession();

  return {
    identityRepository: new PostgresIdentityRepository(session, idGenerator),
    idempotencyRepository: new PostgresIdempotencyRepository(session),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}

function mapIdentity(row: IdentityRow, isNewUser: boolean): UpsertTelegramIdentityResult {
  return {
    user: { id: row.user_id, phoneStatus: row.phone_status },
    messengerIdentity: { id: row.messenger_identity_id, userId: row.user_id },
    isNewUser
  };
}

function expectAffectedRow(result: SqlQueryResult<unknown>, message: string): void {
  if (result.rowCount !== 1) {
    throw new Error(message);
  }
}
