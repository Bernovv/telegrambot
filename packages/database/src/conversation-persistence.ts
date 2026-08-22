import type {
  ConversationRepository,
  RecordIncomingMessageInput,
  RecordOutgoingMessageInput,
  RecordedConversationMessage
} from "@ticket-platform/application";
import {
  CONVERSATION_CONTACT_SOURCE,
  conversationContactIdentifier
} from "@ticket-platform/application";
import type { SqlConnection, SqlConnectionPool, SqlExecutor } from "./postgres.js";

/**
 * Куда ложится переписка.
 *
 * Учётная запись, от имени которой заводится карточка по входящему сообщению. Своё имя у
 * каждого автоматического источника: в карточке видно, откуда взялся человек, а «система»
 * без имени через полгода не объясняет ничего.
 */
const MESSENGER_SYSTEM_ADMIN_ID = "00000000-0000-4000-8000-000000000004";

interface IdRow {
  readonly id: string;
}

interface ConversationRow {
  readonly id: string;
  readonly contact_id: string | null;
  readonly messenger_identity_id: string | null;
}

/**
 * Запись реплики.
 *
 * Всё в одной транзакции, и это не про красоту: диалог, сообщение и вложения — одна и та же
 * реплика, разложенная по трём таблицам. Сообщение без диалога и вложение без сообщения не
 * значат ничего, а половина записи хуже, чем её отсутствие: по ней потом чинят руками.
 *
 * Повтор обрабатывается молча. Мессенджеры повторяют вебхук при любой сетевой заминке, и
 * второй заход обязан упереться в уникальный индекс и вернуть `stored: false`, а не завести
 * вторую реплику и не сорвать разговор ошибкой.
 */
export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async recordIncoming(
    input: RecordIncomingMessageInput
  ): Promise<RecordedConversationMessage> {
    return this.transact(async (connection) => {
      const conversation = await ensureConversation(connection, {
        conversationId: input.conversationId,
        contactId: input.contactId,
        channel: input.channel,
        transport: input.transport,
        externalChatId: input.externalChatId,
        participant: input.sender,
        linkContact: true
      });

      // Правка ищет исходную реплику по идентификатору у мессенджера. Не нашлась — значит
      // человек правит то, что мы записать не успели (канал включили позже, чем начался
      // разговор). Пишем как обычное сообщение: правка без оригинала всё равно остаётся
      // тем, что человек сказал.
      const editsMessageId = input.editsExternalMessageId === null
        ? null
        : await findMessageByExternalId(
          connection,
          conversation.id,
          input.editsExternalMessageId
        );

      const inserted = await connection.query<IdRow>(
        `insert into public.conversation_messages (
           id, conversation_id, direction, author_kind, body,
           external_message_id, edits_message_id, payload, occurred_at
         ) values (
           $1::uuid, $2::uuid, 'inbound', 'client', $3::text,
           $4::text, $5::uuid, $6::jsonb, $7::timestamptz
         )
         on conflict do nothing
         returning id`,
        [
          input.messageId,
          conversation.id,
          input.body,
          input.externalMessageId,
          editsMessageId,
          JSON.stringify(input.payload ?? {}),
          input.occurredAt
        ]
      );
      const messageId = inserted.rows[0]?.id ?? null;
      if (messageId === null) {
        // Повтор. Возвращаем идентификатор той строки, что уже лежит: выдать за неё наш
        // неиспользованный — значит отдать наружу ссылку в никуда.
        return {
          conversationId: conversation.id,
          messageId: await existingMessageId(connection, conversation.id, input),
          stored: false
        };
      }

      for (const [index, attachment] of input.attachments.entries()) {
        await connection.query(
          `insert into public.conversation_attachments (
             id, message_id, kind, file_name, mime_type, size_bytes, external_file_id
           ) values (
             $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::text
           )
           on conflict do nothing`,
          [
            input.attachmentIds[index] ?? null,
            messageId,
            attachment.kind,
            attachment.fileName,
            attachment.mimeType,
            attachment.sizeBytes,
            attachment.externalFileId
          ]
        );
      }

      // Входящее открывает диалог заново. Человек, написавший после закрытия, начал
      // разговор, а не воскресил старый, — и ждать ответа он будет так же.
      await connection.query(
        `update public.conversations
            set last_message_at = greatest(coalesce(last_message_at, $2::timestamptz), $2::timestamptz),
                last_inbound_at = greatest(coalesce(last_inbound_at, $2::timestamptz), $2::timestamptz),
                status = 'open',
                updated_at = now()
          where id = $1::uuid`,
        [conversation.id, input.occurredAt]
      );

      return { conversationId: conversation.id, messageId, stored: true };
    });
  }

  async recordOutgoing(
    input: RecordOutgoingMessageInput
  ): Promise<RecordedConversationMessage> {
    return this.transact(async (connection) => {
      const conversation = await ensureConversation(connection, {
        conversationId: input.conversationId,
        contactId: input.contactId,
        channel: input.channel,
        transport: input.transport,
        externalChatId: input.externalChatId,
        participant: input.recipient,
        // Ответ бота карточку не заводит. Человек, которому бот сказал «здравствуйте», —
        // ещё не заявка, и насыпать в базу карточки на каждого, кто нажал «Старт»,
        // означало бы утопить в них тех, кому правда пора звонить.
        linkContact: input.authorKind === "manager"
      });

      const inserted = await connection.query<IdRow>(
        `insert into public.conversation_messages (
           id, conversation_id, direction, author_kind, author_admin_id, body,
           external_message_id, delivery_status, failure_reason, occurred_at
         ) values (
           $1::uuid, $2::uuid, 'outbound', $3::text, $4::uuid, $5::text,
           $6::text, $7::text, $8::text, $9::timestamptz
         )
         on conflict do nothing
         returning id`,
        [
          input.messageId,
          conversation.id,
          input.authorKind,
          input.authorAdminId,
          input.body,
          input.externalMessageId,
          input.deliveryStatus,
          input.failureReason,
          input.occurredAt
        ]
      );
      const messageId = inserted.rows[0]?.id ?? null;
      if (messageId === null) {
        return {
          conversationId: conversation.id,
          messageId: await existingMessageId(connection, conversation.id, {
            externalMessageId: input.externalMessageId,
            editsExternalMessageId: null,
            occurredAt: input.occurredAt,
            messageId: input.messageId
          }),
          stored: false
        };
      }

      // Исходящее не открывает закрытый диалог: закрыл его менеджер, и вернуть его в работу
      // должен человек, а не автоответ.
      await connection.query(
        `update public.conversations
            set last_message_at = greatest(coalesce(last_message_at, $2::timestamptz), $2::timestamptz),
                updated_at = now()
          where id = $1::uuid`,
        [conversation.id, input.occurredAt]
      );

      return { conversationId: conversation.id, messageId, stored: true };
    });
  }

  private async transact<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T> {
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

interface EnsureConversationInput {
  readonly conversationId: string;
  readonly contactId: string;
  readonly channel: "telegram" | "max";
  readonly transport: "bot" | "account";
  readonly externalChatId: string;
  readonly participant: {
    readonly externalUserId: string;
    readonly username: string | null;
    readonly displayName: string | null;
  };
  readonly linkContact: boolean;
}

/**
 * Диалог: находим или заводим.
 *
 * Привязка к человеку — отдельный вопрос от самого диалога, и решается она не всегда. У
 * человека в Telegram может не быть ни ника, ни телефона, а карточка без единого
 * опознавателя не заводится. Такой диалог живёт без карточки и пишется как все: терять
 * сообщения оттого, что неизвестно, чьи они, нельзя. Появится ник или телефон — привяжем,
 * и вся история придёт вместе с ним.
 */
async function ensureConversation(
  connection: SqlExecutor,
  input: EnsureConversationInput
): Promise<{ readonly id: string; readonly contactId: string | null }> {
  const identity = await connection.query<{
    readonly id: string;
    readonly user_id: string;
  }>(
    `select id, user_id
       from public.messenger_identities
      where channel = $1::text and external_user_id = $2::text
      limit 1`,
    [input.channel, input.participant.externalUserId]
  );
  const messengerIdentityId = identity.rows[0]?.id ?? null;
  const botUserId = identity.rows[0]?.user_id ?? null;

  const existing = await connection.query<ConversationRow>(
    `select id, contact_id, messenger_identity_id
       from public.conversations
      where channel = $1::text and transport = $2::text and external_chat_id = $3::text
      limit 1`,
    [input.channel, input.transport, input.externalChatId]
  );

  const found = existing.rows[0];
  if (found) {
    // Личность в боте могла появиться позже диалога: человек написал через аккаунт
    // компании, а потом сам открыл бота. Дописываем, когда её не было.
    if (found.messenger_identity_id === null && messengerIdentityId !== null) {
      await connection.query(
        `update public.conversations
            set messenger_identity_id = $2::uuid, updated_at = now()
          where id = $1::uuid and messenger_identity_id is null`,
        [found.id, messengerIdentityId]
      );
    }
    if (found.contact_id !== null || !input.linkContact) {
      return { id: found.id, contactId: found.contact_id };
    }
    const contactId = await resolveConversationContact(connection, input, botUserId);
    if (contactId !== null) {
      await connection.query(
        `update public.conversations
            set contact_id = $2::uuid, updated_at = now()
          where id = $1::uuid and contact_id is null`,
        [found.id, contactId]
      );
    }
    return { id: found.id, contactId };
  }

  const contactId = input.linkContact
    ? await resolveConversationContact(connection, input, botUserId)
    : null;

  const created = await connection.query<IdRow>(
    `insert into public.conversations (
       id, contact_id, messenger_identity_id, channel, transport, external_chat_id
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
     )
     on conflict (channel, transport, external_chat_id) do nothing
     returning id`,
    [
      input.conversationId,
      contactId,
      messengerIdentityId,
      input.channel,
      input.transport,
      input.externalChatId
    ]
  );
  const insertedId = created.rows[0]?.id;
  if (insertedId) {
    return { id: insertedId, contactId };
  }

  // Сюда попадаем, когда диалог завёл параллельный запрос между поиском и вставкой. Два
  // сообщения подряд — обычное дело, и терять второе из-за гонки нельзя.
  const race = await connection.query<ConversationRow>(
    `select id, contact_id, messenger_identity_id
       from public.conversations
      where channel = $1::text and transport = $2::text and external_chat_id = $3::text
      limit 1`,
    [input.channel, input.transport, input.externalChatId]
  );
  const row = race.rows[0];
  if (!row) {
    throw new Error("Conversation disappeared between insert and lookup");
  }
  return { id: row.id, contactId: row.contact_id };
}

/**
 * Кто это написал.
 *
 * Порядок поиска идёт от надёжного к слабому. Личность в боте — самый твёрдый признак: она
 * заводится по идентификатору мессенджера и уже связана с человеком, у которого есть
 * телефон. Дальше ник, и только потом заведение новой карточки.
 *
 * Указатель на главного (`merged_into_contact_id`) обязателен во всех запросах: после
 * объединения дубль остаётся со своими признаками, и без него диалог привязался бы к
 * надгробию вместо человека.
 */
async function resolveConversationContact(
  connection: SqlExecutor,
  input: EnsureConversationInput,
  botUserId: string | null
): Promise<string | null> {
  if (botUserId !== null) {
    const byUser = await connection.query<IdRow>(
      `select coalesce(merged_into_contact_id, id) as id
         from public.outreach_contacts
        where linked_user_id = $1::uuid
        order by created_at
        limit 1`,
      [botUserId]
    );
    const found = byUser.rows[0]?.id;
    if (found) {
      return found;
    }
  }

  const identifier = conversationContactIdentifier(input.channel, {
    externalUserId: input.participant.externalUserId,
    username: input.participant.username,
    displayName: input.participant.displayName
  });
  const telegramNormalized = identifier.telegramUsername?.toLowerCase() ?? null;
  const maxNormalized = identifier.maxIdentifier?.toLowerCase() ?? null;
  if (telegramNormalized === null && maxNormalized === null) {
    return null;
  }

  const byHandle = await connection.query<IdRow>(
    `select coalesce(merged_into_contact_id, id) as id
       from public.outreach_contacts
      where ($1::text is not null and telegram_username_normalized = $1::text)
         or ($2::text is not null and max_identifier_normalized = $2::text)
      order by created_at
      limit 1`,
    [telegramNormalized, maxNormalized]
  );
  const existing = byHandle.rows[0]?.id;
  if (existing) {
    return existing;
  }

  const displayName = (input.participant.displayName ?? "").trim();
  const created = await connection.query<IdRow>(
    `insert into public.outreach_contacts (
       id, linked_user_id, display_name,
       telegram_username, telegram_username_normalized,
       max_identifier, max_identifier_normalized,
       source, created_by_admin_id
     ) values (
       $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::uuid
     )
     on conflict do nothing
     returning id`,
    [
      input.contactId,
      botUserId,
      displayName === "" ? null : displayName.slice(0, 200),
      identifier.telegramUsername,
      telegramNormalized,
      identifier.maxIdentifier,
      maxNormalized,
      CONVERSATION_CONTACT_SOURCE,
      MESSENGER_SYSTEM_ADMIN_ID
    ]
  );
  const insertedId = created.rows[0]?.id;
  if (insertedId) {
    return insertedId;
  }

  const race = await connection.query<IdRow>(
    `select coalesce(merged_into_contact_id, id) as id
       from public.outreach_contacts
      where ($1::text is not null and telegram_username_normalized = $1::text)
         or ($2::text is not null and max_identifier_normalized = $2::text)
      order by created_at
      limit 1`,
    [telegramNormalized, maxNormalized]
  );
  return race.rows[0]?.id ?? null;
}

/**
 * Идентификатор реплики, которая уже лежит.
 *
 * Нужен только на пути повтора. Если идентификатора у мессенджера нет, повториться могло
 * лишь совпадение первичного ключа — а его выдаём мы сами, и такое совпадение означает, что
 * ту же строку записали мы же.
 */
async function existingMessageId(
  connection: SqlExecutor,
  conversationId: string,
  input: {
    readonly externalMessageId: string | null;
    readonly editsExternalMessageId: string | null;
    readonly occurredAt: Date;
    readonly messageId: string;
  }
): Promise<string> {
  if (input.externalMessageId === null) {
    return input.messageId;
  }
  const result = await connection.query<IdRow>(
    `select id
       from public.conversation_messages
      where conversation_id = $1::uuid
        and external_message_id = $2::text
        and (($3::boolean and edits_message_id is not null and occurred_at = $4::timestamptz)
             or (not $3::boolean and edits_message_id is null))
      limit 1`,
    [
      conversationId,
      input.externalMessageId,
      input.editsExternalMessageId !== null,
      input.occurredAt
    ]
  );
  return result.rows[0]?.id ?? input.messageId;
}

async function findMessageByExternalId(
  connection: SqlExecutor,
  conversationId: string,
  externalMessageId: string
): Promise<string | null> {
  const result = await connection.query<IdRow>(
    `select id
       from public.conversation_messages
      where conversation_id = $1::uuid
        and external_message_id = $2::text
        and edits_message_id is null
      limit 1`,
    [conversationId, externalMessageId]
  );
  return result.rows[0]?.id ?? null;
}

export function createConversationPersistence(pool: SqlConnectionPool) {
  return { repository: new PostgresConversationRepository(pool) } as const;
}
