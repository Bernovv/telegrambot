import type {
  AdminBroadcastRepository,
  CreateAdminBroadcastInput
} from "@ticket-platform/application";
import { PostgresOutboxWriter } from "./telegram-start-persistence.js";
import { PostgresUnitOfWork, TransactionSession, type SqlConnectionPool } from "./postgres.js";

export class PostgresAdminBroadcastRepository implements AdminBroadcastRepository {
  constructor(private readonly session: TransactionSession) {}

  async createBroadcast(
    input: CreateAdminBroadcastInput & { readonly id: string }
  ): Promise<void> {
    await this.session.query(
      `insert into public.admin_broadcasts (
         id, created_by_admin_id, message_text, target_event_id, target_order_status
       ) values ($1, $2, $3, $4, $5)`,
      [
        input.id,
        input.createdByAdminId,
        input.messageText,
        input.targetEventId,
        input.targetOrderStatus
      ]
    );
  }
}

export function createAdminBroadcastPersistence(pool: SqlConnectionPool) {
  const session = new TransactionSession();
  return {
    adminBroadcastRepository: new PostgresAdminBroadcastRepository(session),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}
