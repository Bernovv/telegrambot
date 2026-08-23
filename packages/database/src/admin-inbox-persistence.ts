import type {
  AdminInboxCounts,
  AdminInboxItem,
  AdminInboxPage,
  AdminMessageDirection,
  AdminPersonConversations,
  ConversationLinkResult
} from "@ticket-platform/contracts";
import type {
  AdminInboxRepository,
  ConversationLinkRepository,
  ConversationMessagesQuery,
  InboxQuery,
  LinkConversationInput,
  MarkConversationReadInput
} from "@ticket-platform/application";
import {
  loadAttachments,
  mapMessage,
  mapThread,
  nullableIso,
  type MessageRow,
  type ThreadRow
} from "./admin-conversation-persistence.js";
import type { SqlConnection, SqlConnectionPool, SqlExecutor } from "./postgres.js";

/**
 * Список диалогов и всё, что вокруг него.
 *
 * Живёт отдельно от переписки в карточке, хотя таблицы те же. Причина в том, что вопросы
 * разные: карточке нужна вся история одного человека, списку — последняя реплика каждого
 * диалога и число непрочитанных. Один запрос на оба вопроса был бы вдвое дороже нужного в
 * обоих случаях.
 *
 * **Непрочитанное считается запросом, а не счётчиком.** Счётчик пришлось бы трогать на
 * каждое входящее и держать в согласии с лентой; отметка о прочтении меняется только когда
 * человек открыл диалог. Индекс `(conversation_id, occurred_at desc, id desc)` у ленты уже
 * есть, и счёт по нему стоит дёшево, пока диалогов сотни, — а их сотни.
 *
 * **Числа у отборов считаются по всей переписке, а не по странице.** «Непрочитанные 7» на
 * странице из пятидесяти строк обязаны означать семь, иначе цифра врёт при первой же
 * прокрутке.
 */

interface InboxRow {
  readonly id: string;
  readonly channel: AdminInboxItem["channel"];
  readonly transport: AdminInboxItem["transport"];
  readonly status: AdminInboxItem["status"];
  readonly contact_id: string | null;
  readonly external_chat_id: string;
  readonly display_name: string | null;
  readonly phone_e164: string | null;
  readonly telegram_username: string | null;
  readonly max_identifier: string | null;
  readonly assigned_admin_id: string | null;
  readonly assigned_admin_name: string | null;
  readonly last_message_at: Date | string | null;
  readonly last_body: string | null;
  readonly last_direction: AdminMessageDirection | null;
  readonly last_has_attachment: boolean | null;
  readonly unread_count: string;
}

interface CountsRow {
  readonly all_count: string;
  readonly mine_count: string;
  readonly unread_count: string;
  readonly unlinked_count: string;
}

/**
 * Непрочитанное для конкретного менеджера.
 *
 * Условие одно и то же в трёх местах — в счётчике строки, в отборе и в числе у отбора, —
 * поэтому оно написано один раз. Разъехавшись, эти три места дали бы кружок у диалога,
 * которого нет в отборе «непрочитанные», и объяснить это было бы нечем.
 */
const UNREAD_PREDICATE = `exists (
  select 1
    from public.conversation_messages unread
   where unread.conversation_id = conversation.id
     and unread.direction = 'inbound'
     and (reads.last_read_at is null or unread.occurred_at > reads.last_read_at)
)`;

export class PostgresAdminInboxRepository implements AdminInboxRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async listInbox(query: InboxQuery): Promise<AdminInboxPage> {
    const connection = await this.pool.connect();
    try {
      // Просим на строку больше, чем нужно панели: лишняя строка и есть ответ на вопрос,
      // есть ли что показать дальше. Отдельный count(*) по всей переписке стоил бы дороже
      // самой страницы и устаревал бы к следующему сообщению.
      const rows = await connection.query<InboxRow>(
        `select conversation.id,
                conversation.channel,
                conversation.transport,
                conversation.status,
                conversation.contact_id,
                conversation.external_chat_id,
                contact.display_name,
                contact.phone_e164,
                contact.telegram_username,
                contact.max_identifier,
                conversation.assigned_admin_id,
                coalesce(assignee.display_name, assignee.email_normalized)
                  as assigned_admin_name,
                conversation.last_message_at,
                last_message.body as last_body,
                last_message.direction as last_direction,
                last_message.has_attachment as last_has_attachment,
                (select count(*)
                   from public.conversation_messages unread
                  where unread.conversation_id = conversation.id
                    and unread.direction = 'inbound'
                    and (reads.last_read_at is null
                         or unread.occurred_at > reads.last_read_at))::text as unread_count
           from public.conversations conversation
           left join public.outreach_contacts contact
             on contact.id = conversation.contact_id
           left join public.admin_accounts assignee
             on assignee.id = conversation.assigned_admin_id
           left join public.conversation_reads reads
             on reads.conversation_id = conversation.id
            and reads.admin_id = $1::uuid
           left join lateral (
             select message.body,
                    message.direction,
                    exists (
                      select 1
                        from public.conversation_attachments attachment
                       where attachment.message_id = message.id
                    ) as has_attachment
               from public.conversation_messages message
              where message.conversation_id = conversation.id
              order by message.occurred_at desc, message.id desc
              limit 1
           ) last_message on true
          where ($2::timestamptz is null
                 or conversation.last_message_at < $2::timestamptz)
            and ($3::text is null or (
                 coalesce(contact.display_name, '') ilike '%' || $3::text || '%'
              or coalesce(contact.phone_e164, '') ilike '%' || $3::text || '%'
              or coalesce(contact.telegram_username, '') ilike '%' || $3::text || '%'
              or coalesce(contact.max_identifier, '') ilike '%' || $3::text || '%'
              or conversation.external_chat_id ilike '%' || $3::text || '%'))
            and ($4::text <> 'mine' or conversation.assigned_admin_id = $1::uuid)
            and ($4::text <> 'unlinked' or conversation.contact_id is null)
            and ($4::text <> 'unread' or ${UNREAD_PREDICATE})
          order by conversation.last_message_at desc nulls last, conversation.id desc
          limit $5::int`,
        [query.adminId, query.before, query.search, query.filter, query.limit + 1]
      );

      const counts = await connection.query<CountsRow>(
        `select count(*)::text as all_count,
                count(*) filter (
                  where conversation.assigned_admin_id = $1::uuid
                )::text as mine_count,
                count(*) filter (where ${UNREAD_PREDICATE})::text as unread_count,
                count(*) filter (
                  where conversation.contact_id is null
                )::text as unlinked_count
           from public.conversations conversation
           left join public.conversation_reads reads
             on reads.conversation_id = conversation.id
            and reads.admin_id = $1::uuid`,
        [query.adminId]
      );

      return {
        items: rows.rows.slice(0, query.limit).map(mapInboxRow),
        hasMore: rows.rows.length > query.limit,
        counts: mapCounts(counts.rows[0])
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Лента одного диалога.
   *
   * Нужна там, где карточки нет: спросить переписку не за кого, а показать её надо. Форма
   * ответа та же, что у карточки человека, — панель рисует ленту одним и тем же кодом,
   * откуда бы та ни пришла.
   */
  async getConversation(
    query: ConversationMessagesQuery
  ): Promise<AdminPersonConversations | null> {
    const connection = await this.pool.connect();
    try {
      const threads = await connection.query<ThreadRow>(
        `select conversation.id,
                conversation.channel,
                conversation.transport,
                conversation.status,
                conversation.assigned_admin_id,
                coalesce(assignee.display_name, assignee.email_normalized)
                  as assigned_admin_name,
                conversation.last_message_at,
                conversation.last_inbound_at,
                (select count(*)
                   from public.conversation_messages message
                  where message.conversation_id = conversation.id)::text as message_count
           from public.conversations conversation
           left join public.admin_accounts assignee
             on assignee.id = conversation.assigned_admin_id
          where conversation.id = $1::uuid`,
        [query.conversationId]
      );
      if (threads.rows.length === 0) {
        return null;
      }

      const messages = await connection.query<MessageRow>(
        `select message.id,
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
           left join public.admin_accounts author on author.id = message.author_admin_id
          where message.conversation_id = $1::uuid
            and ($2::timestamptz is null or message.occurred_at < $2::timestamptz)
            and ($3::text is null or message.body ilike '%' || $3::text || '%')
          order by message.occurred_at desc, message.id desc
          limit $4::int`,
        [query.conversationId, query.before, query.search, query.limit + 1]
      );

      const page = messages.rows.slice(0, query.limit);
      const attachments = await loadAttachments(connection, page.map((row) => row.id));
      return {
        threads: threads.rows.map(mapThread),
        messages: page.map((row) => mapMessage(row, attachments.get(row.id) ?? [])),
        hasMore: messages.rows.length > query.limit
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Отметка «прочитано».
   *
   * `greatest` вместо простой записи: два открытых окна отдают отметки в том порядке, в
   * каком доехали их запросы, и без него более поздняя отметка иногда затиралась бы более
   * ранней, а кружок возвращался бы сам собой.
   */
  async markRead(input: MarkConversationReadInput): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      const updated = await connection.query<{ readonly conversation_id: string }>(
        `insert into public.conversation_reads (conversation_id, admin_id, last_read_at)
         select conversation.id, $2::uuid, $3::timestamptz
           from public.conversations conversation
          where conversation.id = $1::uuid
         on conflict (conversation_id, admin_id) do update
            set last_read_at = greatest(
                  public.conversation_reads.last_read_at,
                  excluded.last_read_at
                ),
                updated_at = now()
         returning conversation_id`,
        [input.conversationId, input.adminId, input.readAt]
      );
      return updated.rows.length > 0;
    } finally {
      connection.release();
    }
  }
}

/**
 * Привязка диалога к человеку.
 *
 * Всё одной транзакцией и с блокировкой строки диалога: двое менеджеров, разобравшие один и
 * тот же безымянный диалог одновременно, иначе завели бы две карточки одному человеку.
 *
 * Уже привязанный диалог не перепривязывается. Это не осторожность, а правило: перенос
 * диалога в другую карточку — это потеря истории у первой, и делается он слиянием карточек,
 * где история сохраняется у обеих.
 */
export class PostgresConversationLinkRepository implements ConversationLinkRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async linkConversation(input: LinkConversationInput): Promise<ConversationLinkResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      const result = await this.link(connection, input);
      await connection.query("commit");
      return result;
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  private async link(
    connection: SqlConnection,
    input: LinkConversationInput
  ): Promise<ConversationLinkResult> {
    const conversation = await connection.query<{ readonly contact_id: string | null }>(
      `select contact_id
         from public.conversations
        where id = $1::uuid
        for update`,
      [input.conversationId]
    );
    const found = conversation.rows[0];
    if (!found) {
      return { status: "not_found" };
    }
    if (found.contact_id !== null) {
      return { status: "already_linked", contactId: found.contact_id };
    }

    if (input.contactId !== null) {
      const exists = await connection.query<{ readonly id: string }>(
        `select id from public.outreach_contacts where id = $1::uuid`,
        [input.contactId]
      );
      if (exists.rows.length === 0) {
        return { status: "not_found" };
      }
      await attach(connection, input.conversationId, input.contactId);
      return { status: "linked", contactId: input.contactId };
    }

    // Телефон. Карточка с этим номером уже может быть — тогда диалог уезжает в неё, а не
    // заводит человеку второй профиль. Именно ради этого случая в ответе есть отдельное
    // состояние: менеджеру важно знать, что он попал в существующую карточку.
    const existing = await connection.query<{ readonly id: string }>(
      `select id
         from public.outreach_contacts
        where phone_e164 = $1::text
          and merged_into_contact_id is null
        limit 1`,
      [input.phoneE164]
    );
    const already = existing.rows[0];
    if (already) {
      await attach(connection, input.conversationId, already.id);
      return { status: "merged_into_existing", contactId: already.id };
    }

    await connection.query(
      `insert into public.outreach_contacts (
         id, display_name, phone_e164, source, created_by_admin_id
       ) values ($1::uuid, $2::text, $3::text, $4::text, $5::uuid)`,
      [
        input.newContactId,
        input.displayName,
        input.phoneE164,
        CONVERSATION_LINK_SOURCE,
        input.adminId
      ]
    );
    await attach(connection, input.conversationId, input.newContactId);
    return { status: "linked", contactId: input.newContactId };
  }
}

/** Откуда взялся человек. Через полгода это единственный ответ на вопрос «кто его завёл». */
const CONVERSATION_LINK_SOURCE = "Разобран из переписки";

async function attach(
  connection: SqlExecutor,
  conversationId: string,
  contactId: string
): Promise<void> {
  await connection.query(
    `update public.conversations
        set contact_id = $2::uuid, updated_at = now()
      where id = $1::uuid and contact_id is null`,
    [conversationId, contactId]
  );
}

function mapInboxRow(row: InboxRow): AdminInboxItem {
  return {
    conversationId: row.id,
    channel: row.channel,
    transport: row.transport,
    status: row.status,
    contactId: row.contact_id,
    title: inboxTitle(row),
    phone: row.phone_e164,
    telegramUsername: row.telegram_username,
    lastMessagePreview: preview(row),
    lastMessageDirection: row.last_direction,
    lastMessageAt: nullableIso(row.last_message_at),
    unreadCount: Number(row.unread_count),
    assignedAdminId: row.assigned_admin_id,
    assignedAdminName: row.assigned_admin_name
  };
}

/**
 * Чем подписать строку.
 *
 * По убыванию узнаваемости: имя, телефон, ник, идентификатор в мессенджере. Последний —
 * это число, и человеку оно не говорит ничего, но строка без подписи не открывается
 * осознанно вовсе, а такой диалог как раз и надо открыть и разобрать.
 */
function inboxTitle(row: InboxRow): string {
  const name = (row.display_name ?? "").trim();
  if (name !== "") {
    return name;
  }
  if (row.phone_e164 !== null) {
    return row.phone_e164;
  }
  const username = (row.telegram_username ?? row.max_identifier ?? "").trim();
  if (username !== "") {
    return `@${username.replace(/^@/, "")}`;
  }
  return row.external_chat_id;
}

/**
 * Начало последней реплики.
 *
 * Вложение без текста подписывается словом, а не пустотой: пустая строка в списке читается
 * как поломка, хотя человек просто прислал фотографию.
 */
function preview(row: InboxRow): string | null {
  const body = (row.last_body ?? "").trim();
  if (body !== "") {
    return body.length > 160 ? `${body.slice(0, 160)}…` : body;
  }
  return row.last_has_attachment === true ? "Вложение" : null;
}

function mapCounts(row: CountsRow | undefined): AdminInboxCounts {
  return {
    all: Number(row?.all_count ?? 0),
    mine: Number(row?.mine_count ?? 0),
    unread: Number(row?.unread_count ?? 0),
    unlinked: Number(row?.unlinked_count ?? 0)
  };
}

export function createAdminInboxPersistence(pool: SqlConnectionPool) {
  return {
    repository: new PostgresAdminInboxRepository(pool),
    linkRepository: new PostgresConversationLinkRepository(pool)
  } as const;
}
