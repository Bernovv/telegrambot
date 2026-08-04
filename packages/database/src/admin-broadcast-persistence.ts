import type {
  AdminBroadcastAudienceRepository,
  AdminBroadcastAudienceSelector,
  AdminBroadcastHistoryRepository,
  AdminBroadcastImageRepository,
  AdminBroadcastOrderStatus,
  AdminBroadcastRepository,
  AdminBroadcastSummary,
  CreateAdminBroadcastInput,
  StoreAdminBroadcastImageInput
} from "@ticket-platform/application";
import { broadcastAudienceSelect } from "./notification-delivery-persistence.js";
import { PostgresOutboxWriter } from "./telegram-start-persistence.js";
import { PostgresUnitOfWork, TransactionSession, type SqlConnectionPool } from "./postgres.js";

interface BroadcastSummaryRow {
  readonly id: string;
  readonly status: AdminBroadcastSummary["status"];
  readonly is_test: boolean;
  readonly message_text: string;
  readonly target_audience: string;
  readonly target_event_title: string | null;
  readonly target_order_status: string | null;
  readonly has_image: boolean;
  readonly button_text: string | null;
  readonly created_by_admin_name: string | null;
  readonly recipient_count: number | null;
  readonly sent_count: number;
  readonly failed_count: number;
  readonly created_at: Date;
  readonly completed_at: Date | null;
}

export class PostgresAdminBroadcastRepository implements AdminBroadcastRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly pool: SqlConnectionPool
  ) {}

  async createBroadcast(
    input: CreateAdminBroadcastInput & { readonly id: string }
  ): Promise<void> {
    await this.session.query(
      `insert into public.admin_broadcasts (
         id, created_by_admin_id, message_text, target_audience,
         target_event_id, target_order_status, button_text, button_url, image_id, is_test
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.id,
        input.createdByAdminId,
        input.messageText,
        input.targetAudience,
        input.targetEventId,
        input.targetOrderStatus,
        input.button?.text ?? null,
        input.button?.url ?? null,
        input.imageId,
        input.isTest
      ]
    );
  }

  async imageExists(imageId: string): Promise<boolean> {
    const connection = await this.pool.connect();

    try {
      const result = await connection.query<{ readonly exists: boolean }>(
        `select true as exists from public.admin_broadcast_images where id = $1`,
        [imageId]
      );
      return result.rows.length > 0;
    } finally {
      connection.release();
    }
  }
}

export class PostgresAdminBroadcastImageRepository
implements AdminBroadcastImageRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async storeImage(input: StoreAdminBroadcastImageInput): Promise<void> {
    const connection = await this.pool.connect();

    try {
      await connection.query(
        `insert into public.admin_broadcast_images (
           id, uploaded_by_admin_id, mime_type, byte_size, width, height, bytes
         ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.id,
          input.uploadedByAdminId,
          input.mimeType,
          input.byteSize,
          input.width,
          input.height,
          Buffer.from(input.bytes)
        ]
      );
    } finally {
      connection.release();
    }
  }
}

export class PostgresAdminBroadcastAudienceRepository
implements AdminBroadcastAudienceRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async countAudience(input: AdminBroadcastAudienceSelector): Promise<number> {
    const connection = await this.pool.connect();

    try {
      const result = await connection.query<{ readonly recipient_count: string }>(
        `select count(*)::text as recipient_count
         from (${broadcastAudienceSelect(input.targetAudience)}) audience`,
        [input.targetEventId, input.targetOrderStatus]
      );
      return Number(result.rows[0]?.recipient_count ?? "0");
    } finally {
      connection.release();
    }
  }
}

export class PostgresAdminBroadcastHistoryRepository
implements AdminBroadcastHistoryRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async listBroadcasts(limit: number): Promise<readonly AdminBroadcastSummary[]> {
    const connection = await this.pool.connect();

    try {
      // Название мероприятия и имя автора берём наружу сразу: без них строка истории
      // состоит из одних идентификаторов и ничего не рассказывает.
      const result = await connection.query<BroadcastSummaryRow>(
        `select
           b.id,
           b.status,
           b.is_test,
           b.message_text,
           b.target_audience,
           events.title as target_event_title,
           b.target_order_status,
           b.image_id is not null as has_image,
           b.button_text,
           coalesce(admins.display_name, admins.email_normalized) as created_by_admin_name,
           b.recipient_count,
           b.sent_count,
           b.failed_count,
           b.created_at,
           b.completed_at
         from public.admin_broadcasts b
         left join public.events events on events.id = b.target_event_id
         left join public.admin_accounts admins on admins.id = b.created_by_admin_id
         order by b.created_at desc
         limit $1`,
        [limit]
      );

      return result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        isTest: row.is_test,
        messageText: row.message_text,
        targetAudience: row.target_audience === "bot_users" ? "bot_users" : "orders",
        targetEventTitle: row.target_event_title,
        targetOrderStatus: row.target_order_status as AdminBroadcastOrderStatus | null,
        hasImage: row.has_image,
        buttonText: row.button_text,
        createdByAdminName: row.created_by_admin_name,
        recipientCount: row.recipient_count,
        sentCount: row.sent_count,
        failedCount: row.failed_count,
        createdAt: row.created_at.toISOString(),
        completedAt: row.completed_at?.toISOString() ?? null
      }));
    } finally {
      connection.release();
    }
  }
}

export function createAdminBroadcastPersistence(pool: SqlConnectionPool) {
  const session = new TransactionSession();
  return {
    adminBroadcastRepository: new PostgresAdminBroadcastRepository(session, pool),
    adminBroadcastAudienceRepository: new PostgresAdminBroadcastAudienceRepository(pool),
    adminBroadcastImageRepository: new PostgresAdminBroadcastImageRepository(pool),
    adminBroadcastHistoryRepository: new PostgresAdminBroadcastHistoryRepository(pool),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}
