import type {
  AdminBroadcastAudienceRepository,
  AdminBroadcastRepository,
  CreateAdminBroadcastInput
} from "@ticket-platform/application";
import { BROADCAST_AUDIENCE_SELECT } from "./notification-delivery-persistence.js";
import { PostgresOutboxWriter } from "./telegram-start-persistence.js";
import { PostgresUnitOfWork, TransactionSession, type SqlConnectionPool } from "./postgres.js";

export class PostgresAdminBroadcastRepository implements AdminBroadcastRepository {
  constructor(private readonly session: TransactionSession) {}

  async createBroadcast(
    input: CreateAdminBroadcastInput & { readonly id: string }
  ): Promise<void> {
    await this.session.query(
      `insert into public.admin_broadcasts (
         id, created_by_admin_id, message_text, target_event_id, target_order_status, is_test
       ) values ($1, $2, $3, $4, $5, $6)`,
      [
        input.id,
        input.createdByAdminId,
        input.messageText,
        input.targetEventId,
        input.targetOrderStatus,
        input.isTest
      ]
    );
  }
}

export class PostgresAdminBroadcastAudienceRepository
implements AdminBroadcastAudienceRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async countAudience(input: {
    readonly targetEventId: string | null;
    readonly targetOrderStatus: string | null;
  }): Promise<number> {
    const connection = await this.pool.connect();

    try {
      const result = await connection.query<{ readonly recipient_count: string }>(
        `select count(*)::text as recipient_count
         from (${BROADCAST_AUDIENCE_SELECT} order by o.user_id) audience`,
        [input.targetEventId, input.targetOrderStatus]
      );
      return Number(result.rows[0]?.recipient_count ?? "0");
    } finally {
      connection.release();
    }
  }
}

export function createAdminBroadcastPersistence(pool: SqlConnectionPool) {
  const session = new TransactionSession();
  return {
    adminBroadcastRepository: new PostgresAdminBroadcastRepository(session),
    adminBroadcastAudienceRepository: new PostgresAdminBroadcastAudienceRepository(pool),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}
