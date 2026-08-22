import type {
  AdminConversationAttachment,
  AdminConversationMessage,
  AdminConversationThread,
  AdminPersonConversations
} from "@ticket-platform/contracts";
import type {
  AdminConversationsRepository,
  AttachmentFileRepository,
  StoredAttachmentFile,
  ConversationReplyQueueRepository,
  ConversationReplyRepository,
  PersonConversationsQuery,
  QueueReplyInput,
  QueueReplyResult,
  QueuedReply
} from "@ticket-platform/application";
import { recordTouchpoint } from "./conversation-touchpoint.js";
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

/**
 * Постановка ответа в очередь.
 *
 * Всё одной транзакцией: реплика, время диалога, ответственный и касание в ленте — это одно
 * действие менеджера, и половина его хуже, чем ничего.
 *
 * Ответ забирает диалог себе. Не из вежливости: пока за диалогом никто не закреплён, двое
 * менеджеров отвечают одному человеку одновременно, и он получает два разных ответа на один
 * вопрос. Чужой диалог отвечающему не отдаётся — только с явным перехватом.
 */
export class PostgresConversationReplyRepository implements ConversationReplyRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async queueReply(input: QueueReplyInput): Promise<QueueReplyResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      try {
        const found = await connection.query<{
          readonly id: string;
          readonly contact_id: string | null;
          readonly channel: "telegram" | "max";
          readonly assigned_admin_id: string | null;
          readonly assigned_admin_name: string | null;
        }>(
          `select conversation.id, conversation.contact_id, conversation.channel,
                  conversation.assigned_admin_id,
                  coalesce(assignee.display_name, assignee.email_normalized, 'Менеджер')
                    as assigned_admin_name
             from public.conversations conversation
             left join public.admin_accounts assignee
               on assignee.id = conversation.assigned_admin_id
            where conversation.id = $1::uuid
            for update of conversation`,
          [input.conversationId]
        );
        const conversation = found.rows[0];
        if (!conversation) {
          await connection.query("rollback");
          return { status: "not_found" };
        }
        if (
          conversation.assigned_admin_id !== null
          && conversation.assigned_admin_id !== input.authorAdminId
          && !input.takeOver
        ) {
          await connection.query("rollback");
          return {
            status: "assigned_to_other",
            assignedAdminName: conversation.assigned_admin_name ?? "Менеджер"
          };
        }

        await connection.query(
          `insert into public.conversation_messages (
             id, conversation_id, direction, author_kind, author_admin_id, body,
             delivery_status, occurred_at
           ) values (
             $1::uuid, $2::uuid, 'outbound', 'manager', $3::uuid, $4::text,
             'queued', $5::timestamptz
           )`,
          [
            input.messageId,
            conversation.id,
            input.authorAdminId,
            input.body,
            input.occurredAt
          ]
        );

        await connection.query(
          `update public.conversations
              set last_message_at = greatest(coalesce(last_message_at, $2::timestamptz), $2::timestamptz),
                  status = 'open',
                  assigned_admin_id = $3::uuid,
                  assigned_at = coalesce(
                    case when assigned_admin_id = $3::uuid then assigned_at end,
                    $2::timestamptz
                  ),
                  updated_at = now()
            where id = $1::uuid`,
          [conversation.id, input.occurredAt, input.authorAdminId]
        );

        await recordTouchpoint(connection, {
          contactId: conversation.contact_id,
          channel: conversation.channel,
          actorAdminId: input.authorAdminId,
          result: "sent",
          note: input.body,
          occurredAt: input.occurredAt,
          activityId: input.messageId
        });

        await connection.query("commit");
        return { status: "queued", messageId: input.messageId };
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}

/**
 * Очередь отправки.
 *
 * Аренда та же, что у вложений: взятая строка отодвигается по времени следующей попытки,
 * поэтому второй проход её не тронет, а воркер, умерший с репликой на руках, вернёт её в
 * очередь сам.
 *
 * Порядок — по времени написания. Разговор, отправленный вразнобой, читается задом наперёд.
 */
const REPLY_LEASE_SECONDS = 120;

export class PostgresConversationReplyQueueRepository
implements ConversationReplyQueueRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async claimQueued(input: {
    readonly batchSize: number;
    readonly at: Date;
  }): Promise<readonly QueuedReply[]> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{
        readonly id: string;
        readonly channel: QueuedReply["channel"];
        readonly external_chat_id: string;
        readonly body: string | null;
        readonly send_attempts: number;
      }>(
        `with claimed as (
           select message.id
             from public.conversation_messages message
            where message.delivery_status = 'queued'
              and (message.next_attempt_at is null
                   or message.next_attempt_at <= $2::timestamptz)
            order by message.next_attempt_at nulls first, message.occurred_at
            limit $1::int
            for update of message skip locked
         ),
         leased as (
           update public.conversation_messages message
              set next_attempt_at = $2::timestamptz + make_interval(secs => $3::int)
             from claimed
            where message.id = claimed.id
            returning message.id, message.conversation_id, message.body,
                      message.send_attempts
         )
         select leased.id, conversation.channel, conversation.external_chat_id,
                leased.body, leased.send_attempts
           from leased
           join public.conversations conversation
             on conversation.id = leased.conversation_id`,
        [input.batchSize, input.at, REPLY_LEASE_SECONDS]
      );

      return result.rows.map((row) => ({
        messageId: row.id,
        channel: row.channel,
        externalChatId: row.external_chat_id,
        body: row.body ?? "",
        attempts: row.send_attempts
      }));
    } finally {
      connection.release();
    }
  }

  async markSent(input: {
    readonly messageId: string;
    readonly providerMessageId: string | null;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      // Идентификатор у мессенджера защищён триггером неизменяемости, а до отправки его
      // взять неоткуда. Поэтому он проставляется ровно один раз — здесь, и только когда
      // был пуст: второй проход по той же строке не подменит его чужим.
      await connection.query(
        `update public.conversation_messages
            set delivery_status = 'sent',
                external_message_id = coalesce(external_message_id, $2::text),
                send_attempts = send_attempts + 1,
                next_attempt_at = null,
                failure_reason = null
          where id = $1::uuid and delivery_status = 'queued'`,
        [input.messageId, input.providerMessageId]
      );
    } finally {
      connection.release();
    }
  }

  async markAttemptFailed(input: {
    readonly messageId: string;
    readonly reason: string;
    readonly at: Date;
    readonly retryAt: Date | null;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.conversation_messages
            set send_attempts = send_attempts + 1,
                delivery_status = case when $3::timestamptz is null then 'failed' else 'queued' end,
                failure_reason = case when $3::timestamptz is null then $2::text else null end,
                next_attempt_at = $3::timestamptz
          where id = $1::uuid and delivery_status = 'queued'`,
        [input.messageId, input.reason, input.retryAt]
      );
    } finally {
      connection.release();
    }
  }
}

export function createConversationReplyPersistence(pool: SqlConnectionPool) {
  return {
    repository: new PostgresConversationReplyRepository(pool),
    queue: new PostgresConversationReplyQueueRepository(pool)
  } as const;
}

/**
 * Файл вложения: где он лежит и чем его открывать.
 *
 * Отдаём только `stored`. Скачивающееся вложение отдавать нечем, а `failed` — тем более:
 * пустой ответ панели честнее, чем обрезанный файл, который браузер покажет как сломанную
 * картинку.
 */
export class PostgresAttachmentFileRepository implements AttachmentFileRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async findStored(attachmentId: string): Promise<StoredAttachmentFile | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{
        readonly id: string;
        readonly storage_path: string;
        readonly file_name: string | null;
        readonly mime_type: string | null;
        readonly size_bytes: string | null;
      }>(
        `select id, storage_path, file_name, mime_type, size_bytes::text
           from public.conversation_attachments
          where id = $1::uuid and download_status = 'stored' and storage_path is not null
          limit 1`,
        [attachmentId]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        attachmentId: row.id,
        storagePath: row.storage_path,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes)
      };
    } finally {
      connection.release();
    }
  }
}

export function createAttachmentFilePersistence(pool: SqlConnectionPool) {
  return { repository: new PostgresAttachmentFileRepository(pool) } as const;
}
