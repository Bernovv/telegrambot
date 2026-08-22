import type {
  AdminConversationAttachment,
  AdminConversationMessage,
  AdminConversationThread,
  AdminPersonConversations
} from "@ticket-platform/contracts";
import type {
  AdminConversationsRepository,
  PersonConversationsQuery
} from "@ticket-platform/application";
import type { SqlConnectionPool, SqlExecutor } from "./postgres.js";

/**
 * Переписка человека для панели.
 *
 * Три особенности, каждая из которых заметна только на настоящих данных.
 *
 * **Дубли.** Диалоги ищутся по всей цепочке объединённых карточек, а не по одному
 * идентификатору. Человек, чью карточку слили с другой, иначе потерял бы половину истории —
 * ровно ту, что велась до объединения.
 *
 * **Одна лента.** Реплики всех каналов идут одним потоком по времени: писавший вчера в MAX,
 * а сегодня в Telegram ведёт с нами один разговор, а не два. Канал у реплики свой и виден.
 *
 * **Страница считается с запасом.** Запрашиваем на одну реплику больше, чем нужно панели, и
 * по наличию лишней отвечаем, есть ли что показать дальше. Отдельный `count(*)` по длинной
 * ленте стоил бы дороже самой страницы и всё равно устарел бы к следующему сообщению.
 */

interface ThreadRow {
  readonly id: string;
  readonly channel: AdminConversationThread["channel"];
  readonly transport: AdminConversationThread["transport"];
  readonly status: AdminConversationThread["status"];
  readonly assigned_admin_id: string | null;
  readonly assigned_admin_name: string | null;
  readonly last_message_at: Date | string | null;
  readonly last_inbound_at: Date | string | null;
  readonly message_count: string;
}

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly channel: AdminConversationMessage["channel"];
  readonly transport: AdminConversationMessage["transport"];
  readonly direction: AdminConversationMessage["direction"];
  readonly author_kind: AdminConversationMessage["authorKind"];
  readonly author_admin_id: string | null;
  readonly author_name: string;
  readonly body: string | null;
  readonly delivery_status: AdminConversationMessage["deliveryStatus"];
  readonly failure_reason: string | null;
  readonly is_edit: boolean;
  readonly occurred_at: Date | string;
}

interface AttachmentRow {
  readonly id: string;
  readonly message_id: string;
  readonly kind: AdminConversationAttachment["kind"];
  readonly file_name: string | null;
  readonly mime_type: string | null;
  readonly size_bytes: string | null;
  readonly download_status: string;
  readonly failure_reason: string | null;
}

export class PostgresAdminConversationsRepository implements AdminConversationsRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async getPersonConversations(
    query: PersonConversationsQuery
  ): Promise<AdminPersonConversations> {
    const connection = await this.pool.connect();
    try {
      const threads = await connection.query<ThreadRow>(
        `${CHAIN_CTE}
         select conversation.id,
                conversation.channel,
                conversation.transport,
                conversation.status,
                conversation.assigned_admin_id,
                coalesce(assignee.display_name, assignee.email_normalized) as assigned_admin_name,
                conversation.last_message_at,
                conversation.last_inbound_at,
                (select count(*)
                   from public.conversation_messages message
                  where message.conversation_id = conversation.id)::text as message_count
           from public.conversations conversation
           join chain on chain.id = conversation.contact_id
           left join public.admin_accounts assignee
             on assignee.id = conversation.assigned_admin_id
          order by conversation.last_message_at desc nulls last`,
        [query.contactId]
      );

      // Запрашиваем на одну больше: лишняя строка и есть ответ на «есть ли что дальше».
      const messages = await connection.query<MessageRow>(
        `${CHAIN_CTE}
         select message.id,
                message.conversation_id,
                conversation.channel,
                conversation.transport,
                message.direction,
                message.author_kind,
                message.author_admin_id,
                case
                  when message.author_kind = 'client' then 'Человек'
                  when message.author_kind = 'bot' then 'Бот'
                  else coalesce(author.display_name, author.email_normalized, 'Менеджер')
                end as author_name,
                message.body,
                message.delivery_status,
                message.failure_reason,
                message.edits_message_id is not null as is_edit,
                message.occurred_at
           from public.conversation_messages message
           join public.conversations conversation
             on conversation.id = message.conversation_id
           join chain on chain.id = conversation.contact_id
           left join public.admin_accounts author on author.id = message.author_admin_id
          where ($2::timestamptz is null or message.occurred_at < $2::timestamptz)
            and ($3::text is null or message.body ilike '%' || $3::text || '%')
          order by message.occurred_at desc, message.id desc
          limit $4::int`,
        [query.contactId, query.before, query.search, query.limit + 1]
      );

      const page = messages.rows.slice(0, query.limit);
      const attachments = await loadAttachments(
        connection,
        page.map((row) => row.id)
      );

      return {
        threads: threads.rows.map(mapThread),
        messages: page.map((row) => mapMessage(row, attachments.get(row.id) ?? [])),
        hasMore: messages.rows.length > query.limit
      };
    } finally {
      connection.release();
    }
  }
}

/**
 * Цепочка объединённых карточек — та же, что у карточки человека.
 *
 * После объединения дубль остаётся строкой со своими признаками, и диалоги, начатые до
 * слияния, по-прежнему указывают на него. Обход вниз по указателям собирает их обратно.
 */
const CHAIN_CTE = `with recursive chain as (
           select id from public.outreach_contacts where id = $1::uuid
           union all
           select child.id
             from public.outreach_contacts child
             join chain on child.merged_into_contact_id = chain.id
         )`;

async function loadAttachments(
  connection: SqlExecutor,
  messageIds: readonly string[]
): Promise<Map<string, AdminConversationAttachment[]>> {
  const byMessage = new Map<string, AdminConversationAttachment[]>();
  if (messageIds.length === 0) {
    return byMessage;
  }

  const result = await connection.query<AttachmentRow>(
    `select id, message_id, kind, file_name, mime_type, size_bytes::text,
            download_status, failure_reason
       from public.conversation_attachments
      where message_id = any($1::uuid[])
      order by created_at`,
    [messageIds]
  );

  for (const row of result.rows) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push({
      id: row.id,
      kind: row.kind,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      // Открыть можно только то, что доехало к нам. Остальное панель показывает подписью:
      // «качается» и «не удалось» — разные вещи, и вторая требует руки.
      isAvailable: row.download_status === "stored",
      failureReason: row.failure_reason
    });
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

function mapThread(row: ThreadRow): AdminConversationThread {
  return {
    conversationId: row.id,
    channel: row.channel,
    transport: row.transport,
    status: row.status,
    assignedAdminId: row.assigned_admin_id,
    assignedAdminName: row.assigned_admin_name,
    lastMessageAt: nullableIso(row.last_message_at),
    lastInboundAt: nullableIso(row.last_inbound_at),
    messageCount: Number(row.message_count)
  };
}

function mapMessage(
  row: MessageRow,
  attachments: readonly AdminConversationAttachment[]
): AdminConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    channel: row.channel,
    transport: row.transport,
    direction: row.direction,
    authorKind: row.author_kind,
    authorAdminId: row.author_admin_id,
    authorName: row.author_name,
    body: row.body,
    deliveryStatus: row.delivery_status,
    failureReason: row.failure_reason,
    isEdit: row.is_edit,
    occurredAt: new Date(row.occurred_at).toISOString(),
    attachments
  };
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function createAdminConversationsPersistence(pool: SqlConnectionPool) {
  return { repository: new PostgresAdminConversationsRepository(pool) } as const;
}
