import type {
  AccountBroadcastAudienceCounts,
  AccountBroadcastQueue,
  AccountBroadcastTestRecipient,
  AccountSavedMessageRecord,
  AccountSavedMessagesRepository,
  AdminAccountBroadcastRepository,
  AttachmentKind,
  ClaimedBroadcastPart,
  ClaimedBroadcastRecipient,
  CreateAccountBroadcastOutcome,
  PendingSavedMessageFile,
  SavedMessageSnapshot
} from "@ticket-platform/application";
import type {
  AccountBroadcastStatus,
  AccountBroadcastSummary,
  AccountSavedMessageKind
} from "@ticket-platform/contracts";
import { recordTouchpoint } from "./conversation-touchpoint.js";
import type { SqlConnection, SqlConnectionPool, SqlExecutor } from "./postgres.js";

/**
 * Рассылка от рабочего аккаунта: «Избранное», получатели, очередь отправки.
 *
 * Три хранилища за одним файлом, потому что у них одни таблицы и одно правило отбора
 * аудитории. Панель читает и запускает, процесс аккаунта синхронизирует «Избранное» и
 * отправляет — и оба обязаны понимать «участник мероприятия, которому можно написать»
 * одинаково, иначе панель обещала бы одно число, а уходило бы другое.
 */

/**
 * Участники мероприятия и их ветки переписки с аккаунтом в Telegram.
 *
 * Параметры: `$1` — мероприятие, `$2` — сообщения «Избранного» для проверки «уже получал».
 *
 * Участник — это заявка с сайта или участник, заведённый руками (`event_participants`), и
 * покупатель бота (`orders`, оплачен, не исключён). Человек в базе один, даже если у него
 * и заявка, и билет: дубли схлопываются через `merged_into_contact_id`. Архивных не трогаем —
 * их убрали из работы руками.
 *
 * Ветка — самая свежая переписка аккаунта в Telegram у самого человека или у его дубля:
 * её заводит проверка номера или первое сообщение самого человека. Без ветки написать
 * нельзя — номер ещё не проверяли или Telegram его не знает.
 */
const AUDIENCE_CTE = `
  with people as (
    select coalesce(contact.merged_into_contact_id, contact.id) as person_id
      from public.event_participants participant
      join public.outreach_contacts contact on contact.id = participant.outreach_contact_id
     where participant.event_id = $1::uuid
       and participant.deleted_at is null
    union
    select coalesce(contact.merged_into_contact_id, contact.id)
      from public.orders paid_order
      join public.outreach_contacts contact on contact.linked_user_id = paid_order.user_id
     where paid_order.event_id = $1::uuid
       and paid_order.status = 'paid'
       and paid_order.excluded_at is null
    union
    select coalesce(contact.merged_into_contact_id, contact.id)
      from public.orders paid_order
      join public.user_contacts phone
        on phone.user_id = paid_order.user_id and phone.contact_type = 'phone'
      join public.outreach_contacts contact on contact.phone_e164 = phone.value_normalized
     where paid_order.event_id = $1::uuid
       and paid_order.status = 'paid'
       and paid_order.excluded_at is null
  ),
  live_people as (
    select people.person_id, person.display_name
      from people
      join public.outreach_contacts person on person.id = people.person_id
     where person.archived_at is null
  ),
  threads as (
    select distinct on (live_people.person_id)
           live_people.person_id,
           live_people.display_name,
           conversation.id as conversation_id,
           conversation.external_chat_id
      from live_people
      join public.outreach_contacts linked
        on linked.id = live_people.person_id
        or linked.merged_into_contact_id = live_people.person_id
      join public.conversations conversation on conversation.contact_id = linked.id
     where conversation.channel = 'telegram'
       and conversation.transport = 'account'
     order by live_people.person_id,
              conversation.last_message_at desc nulls last,
              conversation.created_at desc
  ),
  received as (
    select threads.person_id
      from threads
     where exists (
       select 1
         from public.account_broadcast_recipients earlier
         join public.account_broadcasts earlier_broadcast
           on earlier_broadcast.id = earlier.broadcast_id
         join public.account_broadcast_parts earlier_part
           on earlier_part.broadcast_id = earlier.broadcast_id
        where earlier.conversation_id = threads.conversation_id
          and earlier.status in ('pending', 'sending', 'sent')
          and not earlier_broadcast.is_test
          and earlier_part.saved_message_id = any($2::uuid[])
     )
  )`;

interface SavedMessageRow {
  readonly id: string;
  readonly kind: AccountSavedMessageKind;
  readonly body: string | null;
  readonly duration_seconds: number | null;
  readonly minithumbnail_base64: string | null;
  readonly has_file: boolean;
  readonly sent_at: Date | string;
}

interface BroadcastRow {
  readonly id: string;
  readonly status: AccountBroadcastStatus;
  readonly is_test: boolean;
  readonly target_event_id: string | null;
  readonly event_title: string | null;
  readonly test_recipient_name: string | null;
  readonly parts: readonly {
    readonly kind: AccountSavedMessageKind;
    readonly body: string | null;
    readonly durationSeconds: number | null;
  }[] | null;
  readonly created_by_admin_name: string | null;
  readonly created_at: Date | string;
  readonly completed_at: Date | string | null;
  readonly stop_reason: string | null;
  readonly paused_until: Date | string | null;
  readonly pause_reason: string | null;
  readonly recipient_count: number;
  readonly sent_count: number;
  readonly failed_count: number;
  readonly pending_count: number;
  readonly cancelled_count: number;
  readonly last_sent_at: Date | string | null;
  readonly failure_reasons: readonly { readonly reason: string; readonly count: number }[] | null;
}

export class PostgresAdminAccountBroadcastRepository
implements AdminAccountBroadcastRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async listSavedMessages(input: { readonly limit: number }): Promise<{
    readonly items: readonly AccountSavedMessageRecord[];
    readonly lastSyncedAt: Date | null;
  }> {
    return await this.withConnection(async (connection) => {
      const items = await connection.query<SavedMessageRow>(
        `select id, kind, body, duration_seconds, minithumbnail_base64,
                file_status = 'stored' as has_file, sent_at
           from public.account_saved_messages
          where channel = 'telegram' and deleted_at is null
          order by sent_at desc, external_message_id::numeric desc
          limit $1::int`,
        [input.limit]
      );
      const synced = await connection.query<{ readonly synced_at: Date | string | null }>(
        `select max(synced_at) as synced_at
           from public.account_saved_messages
          where channel = 'telegram'`
      );
      const lastSynced = synced.rows[0]?.synced_at ?? null;

      return {
        items: items.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          body: row.body,
          durationSeconds: row.duration_seconds,
          minithumbnailBase64: row.minithumbnail_base64,
          hasFile: row.has_file,
          sentAt: new Date(row.sent_at)
        })),
        lastSyncedAt: lastSynced === null ? null : new Date(lastSynced)
      };
    });
  }

  async findSavedMessageFile(savedMessageId: string): Promise<{
    readonly storagePath: string;
    readonly fileName: string | null;
    readonly mimeType: string | null;
  } | null> {
    return await this.withConnection(async (connection) => {
      const result = await connection.query<{
        readonly storage_path: string;
        readonly file_name: string | null;
        readonly mime_type: string | null;
      }>(
        `select storage_path, file_name, mime_type
           from public.account_saved_messages
          where id = $1::uuid and file_status = 'stored'`,
        [savedMessageId]
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : { storagePath: row.storage_path, fileName: row.file_name, mimeType: row.mime_type };
    });
  }

  async eventExists(eventId: string): Promise<boolean> {
    return await this.withConnection(async (connection) => {
      const result = await connection.query<{ readonly id: string }>(
        "select id from public.events where id = $1::uuid",
        [eventId]
      );
      return result.rows.length > 0;
    });
  }

  async countAudience(input: {
    readonly eventId: string;
    readonly savedMessageIds: readonly string[];
  }): Promise<AccountBroadcastAudienceCounts> {
    return await this.withConnection(async (connection) => {
      const result = await connection.query<{
        readonly participants: number;
        readonly reachable: number;
        readonly already_received: number;
        readonly not_in_telegram: number;
      }>(
        `${AUDIENCE_CTE}
         select (select count(*) from live_people)::int as participants,
                (select count(*) from threads)::int as reachable,
                (select count(*) from received)::int as already_received,
                (select count(*)
                   from live_people
                  where not exists (
                          select 1 from threads where threads.person_id = live_people.person_id
                        )
                    and exists (
                          select 1
                            from public.contact_channel_lookups lookup
                            join public.outreach_contacts linked on linked.id = lookup.contact_id
                           where (linked.id = live_people.person_id
                                  or linked.merged_into_contact_id = live_people.person_id)
                             and lookup.channel = 'telegram'
                             and lookup.status = 'not_found'
                        ))::int as not_in_telegram`,
        [input.eventId, [...input.savedMessageIds]]
      );
      const row = result.rows[0];
      return {
        participants: row?.participants ?? 0,
        reachable: row?.reachable ?? 0,
        alreadyReceived: row?.already_received ?? 0,
        notInTelegram: row?.not_in_telegram ?? 0
      };
    });
  }

  async findTestRecipient(input: {
    readonly username: string | null;
    readonly phoneE164: string | null;
  }): Promise<AccountBroadcastTestRecipient | null> {
    return await this.withConnection(async (connection) => {
      const result = await connection.query<{
        readonly contact_id: string;
        readonly conversation_id: string;
        readonly external_chat_id: string;
        readonly display_name: string | null;
      }>(
        `select contact.id as contact_id,
                conversation.id as conversation_id,
                conversation.external_chat_id,
                coalesce(contact.display_name, '@' || contact.telegram_username, contact.phone_e164)
                  as display_name
           from public.outreach_contacts contact
           join public.conversations conversation on conversation.contact_id = contact.id
          where (contact.telegram_username_normalized = $1::text or contact.phone_e164 = $2::text)
            and conversation.channel = 'telegram'
            and conversation.transport = 'account'
          order by conversation.last_message_at desc nulls last, conversation.created_at desc
          limit 1`,
        [input.username, input.phoneE164]
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : {
          contactId: row.contact_id,
          conversationId: row.conversation_id,
          externalChatId: row.external_chat_id,
          displayName: row.display_name
        };
    });
  }

  async createBroadcast(input: Parameters<AdminAccountBroadcastRepository["createBroadcast"]>[0]):
  Promise<CreateAccountBroadcastOutcome> {
    return await this.withConnection(async (connection) => {
      await connection.query("begin");
      try {
        const outcome = await this.createInTransaction(connection, input);
        await connection.query(outcome.kind === "created" ? "commit" : "rollback");
        return outcome;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    });
  }

  private async createInTransaction(
    connection: SqlExecutor,
    input: Parameters<AdminAccountBroadcastRepository["createBroadcast"]>[0]
  ): Promise<CreateAccountBroadcastOutcome> {
    const target = input.target;
    if (target.kind === "event") {
      // Две вкладки, нажавшие «Запустить» одновременно, иначе разослали бы одно и то же
      // дважды: проверка «уже идёт» ниже без замка видит пустоту в обеих.
      await connection.query(
        "select pg_advisory_xact_lock(hashtextextended($1::text, 20261119))",
        [target.eventId]
      );
      const running = await connection.query<{ readonly id: string }>(
        `select id from public.account_broadcasts
          where target_event_id = $1::uuid and status = 'sending' and not is_test
          limit 1`,
        [target.eventId]
      );
      if (running.rows.length > 0) {
        return { kind: "already_sending" };
      }
    }

    const available = await connection.query<{ readonly id: string }>(
      `select id from public.account_saved_messages
        where id = any($1::uuid[]) and deleted_at is null
        for share`,
      [[...input.savedMessageIds]]
    );
    if (available.rows.length !== input.savedMessageIds.length) {
      return { kind: "saved_message_unavailable" };
    }

    await connection.query(
      `insert into public.account_broadcasts (
         id, channel, target_event_id, is_test, status, created_by_admin_id, created_at, updated_at
       ) values (
         $1::uuid, 'telegram', $2::uuid, $3::boolean, 'sending', $4::uuid, $5::timestamptz, $5::timestamptz
       )`,
      [
        input.broadcastId,
        target.kind === "event" ? target.eventId : null,
        target.kind === "test",
        input.adminId,
        input.at
      ]
    );
    // Порядок частей — порядок в «Избранном»: Telegram копирует пачку только по
    // возрастанию номеров, а записанное раньше и читается первым.
    await connection.query(
      `insert into public.account_broadcast_parts (broadcast_id, position, saved_message_id)
       select $1::uuid,
              row_number() over (order by saved.external_message_id::numeric),
              saved.id
         from public.account_saved_messages saved
        where saved.id = any($2::uuid[])`,
      [input.broadcastId, [...input.savedMessageIds]]
    );

    if (target.kind === "test") {
      await connection.query(
        `insert into public.account_broadcast_recipients (
           id, broadcast_id, contact_id, conversation_id, external_chat_id, display_name,
           created_at, updated_at
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, $7::timestamptz, $7::timestamptz
         )`,
        [
          target.recipientId,
          input.broadcastId,
          target.recipient.contactId,
          target.recipient.conversationId,
          target.recipient.externalChatId,
          target.recipient.displayName?.slice(0, 200) ?? null,
          input.at
        ]
      );
      return { kind: "created", recipientCount: 1 };
    }

    const inserted = await connection.query<{ readonly id: string }>(
      `${AUDIENCE_CTE}
       insert into public.account_broadcast_recipients (
         id, broadcast_id, contact_id, conversation_id, external_chat_id, display_name,
         created_at, updated_at
       )
       select gen_random_uuid(), $3::uuid, threads.person_id, threads.conversation_id,
              threads.external_chat_id, left(threads.display_name, 200),
              $4::timestamptz, $4::timestamptz
         from threads
        where not exists (select 1 from received where received.person_id = threads.person_id)
       on conflict (broadcast_id, external_chat_id) do nothing
       returning id`,
      [target.eventId, [...input.savedMessageIds], input.broadcastId, input.at]
    );
    const count = inserted.rows.length;
    if (count === 0) {
      return { kind: "no_recipients" };
    }
    if (count > target.limit) {
      return { kind: "too_many_recipients", count };
    }
    return { kind: "created", recipientCount: count };
  }

  async listBroadcasts(limit: number): Promise<readonly AccountBroadcastSummary[]> {
    return await this.withConnection(async (connection) => {
      const result = await connection.query<BroadcastRow>(
        `select broadcast.id,
                broadcast.status,
                broadcast.is_test,
                broadcast.target_event_id,
                event.title as event_title,
                test_recipient.display_name as test_recipient_name,
                parts.items as parts,
                coalesce(admins.display_name, admins.email_normalized) as created_by_admin_name,
                broadcast.created_at,
                broadcast.completed_at,
                broadcast.stop_reason,
                case when broadcast.paused_until > now() then broadcast.paused_until end
                  as paused_until,
                case when broadcast.paused_until > now() then broadcast.pause_reason end
                  as pause_reason,
                counts.recipient_count,
                counts.sent_count,
                counts.failed_count,
                counts.pending_count,
                counts.cancelled_count,
                counts.last_sent_at,
                reasons.items as failure_reasons
           from public.account_broadcasts broadcast
           left join public.events event on event.id = broadcast.target_event_id
           left join public.admin_accounts admins on admins.id = broadcast.created_by_admin_id
           left join lateral (
             select count(*)::int as recipient_count,
                    count(*) filter (where recipient.status = 'sent')::int as sent_count,
                    count(*) filter (where recipient.status = 'failed')::int as failed_count,
                    count(*) filter (where recipient.status in ('pending', 'sending'))::int
                      as pending_count,
                    count(*) filter (where recipient.status = 'cancelled')::int as cancelled_count,
                    max(recipient.sent_at) as last_sent_at
               from public.account_broadcast_recipients recipient
              where recipient.broadcast_id = broadcast.id
           ) counts on true
           left join lateral (
             select json_agg(
                      json_build_object(
                        'kind', saved.kind,
                        'body', left(saved.body, 300),
                        'durationSeconds', saved.duration_seconds
                      )
                      order by part.position
                    ) as items
               from public.account_broadcast_parts part
               join public.account_saved_messages saved on saved.id = part.saved_message_id
              where part.broadcast_id = broadcast.id
           ) parts on true
           left join lateral (
             select recipient.display_name
               from public.account_broadcast_recipients recipient
              where recipient.broadcast_id = broadcast.id and broadcast.is_test
              limit 1
           ) test_recipient on true
           left join lateral (
             select json_agg(json_build_object('reason', top.reason, 'count', top.total)
                             order by top.total desc) as items
               from (
                 select recipient.failure_reason as reason, count(*)::int as total
                   from public.account_broadcast_recipients recipient
                  where recipient.broadcast_id = broadcast.id
                    -- Дошедшее частично — тоже повод знать: кружок кому-то не ушёл.
                    and (recipient.status = 'failed'
                         or (recipient.status = 'sent' and recipient.failure_reason is not null))
                  group by recipient.failure_reason
                  order by total desc
                  limit 3
               ) top
           ) reasons on true
          order by broadcast.created_at desc
          limit $1::int`,
        [limit]
      );

      return result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        isTest: row.is_test,
        eventId: row.target_event_id,
        eventTitle: row.event_title,
        testRecipientName: row.test_recipient_name,
        parts: row.parts ?? [],
        createdByAdminName: row.created_by_admin_name,
        createdAt: new Date(row.created_at).toISOString(),
        completedAt: iso(row.completed_at),
        stopReason: row.stop_reason,
        pausedUntil: iso(row.paused_until),
        pauseReason: row.pause_reason,
        recipientCount: row.recipient_count,
        sentCount: row.sent_count,
        failedCount: row.failed_count,
        pendingCount: row.pending_count,
        cancelledCount: row.cancelled_count,
        lastSentAt: iso(row.last_sent_at),
        failureReasons: row.failure_reasons ?? []
      }));
    });
  }

  async cancelBroadcast(input: {
    readonly broadcastId: string;
    readonly adminId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<boolean> {
    return await this.withConnection(async (connection) => {
      await connection.query("begin");
      try {
        const updated = await connection.query<{ readonly id: string }>(
          `update public.account_broadcasts
              set status = 'cancelled',
                  cancelled_at = $2::timestamptz,
                  cancelled_by_admin_id = $3::uuid,
                  stop_reason = $4::text,
                  updated_at = $2::timestamptz
            where id = $1::uuid and status = 'sending'
          returning id`,
          [input.broadcastId, input.at, input.adminId, input.reason]
        );
        if (updated.rows.length > 0) {
          // Тот, кого отправитель уже взял, остаётся за ним: сообщение могло уйти, и судьбу
          // этой копии запишет он, а не отмена.
          await connection.query(
            `update public.account_broadcast_recipients
                set status = 'cancelled', next_attempt_at = null, updated_at = $2::timestamptz
              where broadcast_id = $1::uuid and status = 'pending'`,
            [input.broadcastId, input.at]
          );
        }
        await connection.query("commit");
        return updated.rows.length > 0;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    });
  }

  private async withConnection<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    try {
      return await work(connection);
    } finally {
      connection.release();
    }
  }
}

interface PendingFileRow {
  readonly id: string;
  readonly external_file_id: string;
  readonly kind: AccountSavedMessageKind;
  readonly file_name: string | null;
  readonly mime_type: string | null;
  readonly file_attempts: number;
}

export class PostgresAccountSavedMessagesRepository implements AccountSavedMessagesRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async syncSeen(input: {
    readonly ids: readonly string[];
    readonly messages: readonly SavedMessageSnapshot[];
    readonly fileKinds: readonly AccountSavedMessageKind[];
    readonly maxFileBytes: number;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      try {
        for (const message of input.messages) {
          const wantsFile = message.externalFileId !== null
            && input.fileKinds.includes(message.kind)
            && (message.sizeBytes === null || message.sizeBytes <= input.maxFileBytes);
          await connection.query(
            `insert into public.account_saved_messages (
               id, channel, external_message_id, kind, body, duration_seconds,
               minithumbnail_base64, external_file_id, file_name, mime_type, size_bytes,
               file_status, sent_at, synced_at, created_at
             ) values (
               gen_random_uuid(), 'telegram', $1::text, $2::text, $3::text, $4::int,
               $5::text, $6::text, $7::text, $8::text, $9::bigint,
               $10::text, $11::timestamptz, $12::timestamptz, $12::timestamptz
             )
             on conflict (channel, external_message_id) do update
               set kind = excluded.kind,
                   body = excluded.body,
                   duration_seconds = excluded.duration_seconds,
                   minithumbnail_base64 = excluded.minithumbnail_base64,
                   external_file_id = excluded.external_file_id,
                   file_name = case when account_saved_messages.file_status = 'stored'
                                    then account_saved_messages.file_name
                                    else excluded.file_name end,
                   mime_type = case when account_saved_messages.file_status = 'stored'
                                    then account_saved_messages.mime_type
                                    else excluded.mime_type end,
                   size_bytes = case when account_saved_messages.file_status = 'stored'
                                     then account_saved_messages.size_bytes
                                     else excluded.size_bytes end,
                   synced_at = excluded.synced_at,
                   deleted_at = null`,
            [
              message.externalMessageId,
              message.kind,
              message.body?.slice(0, 5_000) ?? null,
              message.durationSeconds,
              message.minithumbnailBase64 !== null && message.minithumbnailBase64.length <= 20_000
                ? message.minithumbnailBase64
                : null,
              message.externalFileId,
              message.fileName?.slice(0, 300) ?? null,
              message.mimeType?.slice(0, 200) ?? null,
              message.sizeBytes,
              wantsFile ? "pending" : "none",
              message.sentAt,
              input.at
            ]
          );
        }

        // Пропавшее из просмотренного окна удалено из «Избранного». Окно — от самого
        // старого увиденного: то, что старше, мы просто не смотрели.
        const oldest = input.ids
          .map((id) => BigInt(id))
          .reduce((min, id) => (id < min ? id : min));
        await connection.query(
          `update public.account_saved_messages
              set deleted_at = $3::timestamptz
            where channel = 'telegram'
              and deleted_at is null
              and external_message_id::numeric >= $1::numeric
              and not (external_message_id = any($2::text[]))`,
          [oldest.toString(), [...input.ids], input.at]
        );
        await connection.query("commit");
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }

  async markDeleted(input: {
    readonly externalMessageIds: readonly string[];
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.account_saved_messages
            set deleted_at = $2::timestamptz
          where channel = 'telegram'
            and deleted_at is null
            and external_message_id = any($1::text[])`,
        [[...input.externalMessageIds], input.at]
      );
    } finally {
      connection.release();
    }
  }

  async listPendingFiles(input: {
    readonly limit: number;
    readonly maxAttempts: number;
  }): Promise<readonly PendingSavedMessageFile[]> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<PendingFileRow>(
        `select id, external_file_id, kind, file_name, mime_type, file_attempts
           from public.account_saved_messages
          where file_status = 'pending'
            and deleted_at is null
            and external_file_id is not null
            and file_attempts < $2::int
          order by sent_at desc
          limit $1::int`,
        [input.limit, input.maxAttempts]
      );
      return result.rows.map((row) => ({
        savedMessageId: row.id,
        externalFileId: row.external_file_id,
        kind: row.kind,
        fileName: row.file_name,
        mimeType: row.mime_type,
        attempts: row.file_attempts
      }));
    } finally {
      connection.release();
    }
  }

  async markFileStored(input: {
    readonly savedMessageId: string;
    readonly storagePath: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.account_saved_messages
            set file_status = 'stored',
                storage_path = $2::text,
                sha256 = $3::text,
                size_bytes = $4::bigint,
                file_attempts = file_attempts + 1
          where id = $1::uuid and file_status = 'pending'`,
        [input.savedMessageId, input.storagePath, input.sha256, input.sizeBytes]
      );
    } finally {
      connection.release();
    }
  }

  async markFileFailed(input: {
    readonly savedMessageId: string;
    readonly giveUp: boolean;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.account_saved_messages
            set file_attempts = file_attempts + 1,
                file_status = case when $2::boolean then 'failed' else 'pending' end
          where id = $1::uuid and file_status = 'pending'`,
        [input.savedMessageId, input.giveUp]
      );
    } finally {
      connection.release();
    }
  }
}

interface ClaimedRow {
  readonly id: string;
  readonly broadcast_id: string;
  readonly contact_id: string | null;
  readonly conversation_id: string;
  readonly external_chat_id: string;
  readonly attempts: number;
}

interface PartRow {
  readonly is_test: boolean;
  readonly created_by_admin_id: string;
  readonly saved_message_id: string;
  readonly external_message_id: string;
  readonly kind: AccountSavedMessageKind;
  readonly body: string | null;
  readonly duration_seconds: number | null;
  readonly deleted: boolean;
  readonly storage_path: string | null;
  readonly file_name: string | null;
  readonly mime_type: string | null;
  readonly size_bytes: string | number | null;
  readonly sha256: string | null;
}

/** Очередь отправки — её разбирает процесс аккаунта, один на сессию. */
export class PostgresAccountBroadcastQueue implements AccountBroadcastQueue {
  constructor(private readonly pool: SqlConnectionPool) {}

  async activePause(at: Date): Promise<{ readonly until: Date; readonly reason: string } | null> {
    // Пауза — свойство аккаунта, а не рассылки: смотрим её и у остановленных и законченных.
    // Иначе рассылка, запущенная после отмены той, что попала под ограничение, пошла бы
    // сразу — прямо в ещё действующий запрет.
    const result = await this.query<{
      readonly paused_until: Date | string;
      readonly pause_reason: string;
    }>(
      `select paused_until, pause_reason
         from public.account_broadcasts
        where channel = 'telegram' and paused_until > $1::timestamptz
        order by paused_until desc
        limit 1`,
      [at]
    );
    const row = result.rows[0];
    return row === undefined ? null : { until: new Date(row.paused_until), reason: row.pause_reason };
  }

  async countSentSince(since: Date): Promise<number> {
    const result = await this.query<{ readonly sent: number }>(
      `select count(*)::int as sent
         from public.account_broadcast_recipients recipient
         join public.account_broadcasts broadcast on broadcast.id = recipient.broadcast_id
        where recipient.status = 'sent'
          and recipient.sent_at >= $1::timestamptz
          and not broadcast.is_test`,
      [since]
    );
    return result.rows[0]?.sent ?? 0;
  }

  async claimNext(input: {
    readonly at: Date;
    readonly includeLive: boolean;
    readonly leaseUntil: Date;
  }): Promise<ClaimedBroadcastRecipient | null> {
    const connection = await this.pool.connect();
    try {
      // Строка в статусе `sending` с истёкшей арендой — процесс упал посреди отправки.
      // Ушло ли сообщение, неизвестно; берём снова и считаем попытку. Вторая копия у
      // человека хуже тишины, но заметна, а молча потерянная рассылка — нет.
      const claimed = await connection.query<ClaimedRow>(
        `with candidate as (
           select recipient.id
             from public.account_broadcast_recipients recipient
             join public.account_broadcasts broadcast on broadcast.id = recipient.broadcast_id
            where broadcast.status = 'sending'
              and (broadcast.is_test or $2::boolean)
              and (
                (recipient.status = 'pending'
                  and (recipient.next_attempt_at is null
                       or recipient.next_attempt_at <= $1::timestamptz))
                or (recipient.status = 'sending' and recipient.next_attempt_at <= $1::timestamptz)
              )
            order by broadcast.is_test desc, broadcast.created_at, recipient.created_at, recipient.id
            limit 1
            for update of recipient skip locked
         )
         update public.account_broadcast_recipients recipient
            set status = 'sending',
                attempts = case when recipient.status = 'sending'
                                then recipient.attempts + 1
                                else recipient.attempts end,
                next_attempt_at = $3::timestamptz,
                updated_at = $1::timestamptz
           from candidate
          where recipient.id = candidate.id
         returning recipient.id, recipient.broadcast_id, recipient.contact_id,
                   recipient.conversation_id, recipient.external_chat_id, recipient.attempts`,
        [input.at, input.includeLive, input.leaseUntil]
      );
      const row = claimed.rows[0];
      if (row === undefined) {
        return null;
      }

      const parts = await connection.query<PartRow>(
        `select broadcast.is_test,
                broadcast.created_by_admin_id,
                part.saved_message_id,
                saved.external_message_id,
                saved.kind,
                saved.body,
                saved.duration_seconds,
                saved.deleted_at is not null as deleted,
                saved.storage_path,
                saved.file_name,
                saved.mime_type,
                saved.size_bytes,
                saved.sha256
           from public.account_broadcasts broadcast
           join public.account_broadcast_parts part on part.broadcast_id = broadcast.id
           join public.account_saved_messages saved on saved.id = part.saved_message_id
          where broadcast.id = $1::uuid
          order by part.position`,
        [row.broadcast_id]
      );
      const first = parts.rows[0];

      return {
        recipientId: row.id,
        broadcastId: row.broadcast_id,
        isTest: first?.is_test ?? false,
        contactId: row.contact_id,
        conversationId: row.conversation_id,
        externalChatId: row.external_chat_id,
        attempts: row.attempts,
        actorAdminId: first?.created_by_admin_id ?? "",
        parts: parts.rows.map((part): ClaimedBroadcastPart => ({
          savedMessageId: part.saved_message_id,
          externalMessageId: part.external_message_id,
          kind: part.kind,
          body: part.body,
          durationSeconds: part.duration_seconds,
          deleted: part.deleted,
          storagePath: part.storage_path,
          fileName: part.file_name,
          mimeType: part.mime_type,
          sizeBytes: part.size_bytes === null ? null : Number(part.size_bytes),
          sha256: part.sha256
        }))
      };
    } finally {
      connection.release();
    }
  }

  /**
   * Реплика в ленте, вложения, касание и судьба получателя — одной транзакцией.
   *
   * Реплика пишется уже отправленной: в очередь ответов её класть нельзя — та отправила бы
   * её второй раз, текстом. Автор — тот, кто запустил рассылку: писал не бот, а человек,
   * просто через «Избранное».
   *
   * Вложение — ссылка на ту же копию файла, что у сообщения «Избранного». Двести получателей
   * одного кружка — двести строк в ленте и один файл на диске.
   */
  async markSent(input: {
    readonly recipient: ClaimedBroadcastRecipient;
    readonly parts: readonly ClaimedBroadcastPart[];
    readonly messageId: string;
    readonly attachmentIds: readonly string[];
    readonly providerMessageIds: readonly string[];
    readonly body: string | null;
    readonly partialReason: string | null;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    const recipient = input.recipient;
    try {
      await connection.query("begin");
      try {
        await connection.query(
          `insert into public.conversation_messages (
             id, conversation_id, direction, author_kind, author_admin_id, body,
             external_message_id, delivery_status, payload, occurred_at
           ) values (
             $1::uuid, $2::uuid, 'outbound', 'manager', $3::uuid, $4::text,
             $5::text, 'sent', $6::jsonb, $7::timestamptz
           )`,
          [
            input.messageId,
            recipient.conversationId,
            recipient.actorAdminId,
            input.body,
            input.providerMessageIds[0] ?? null,
            JSON.stringify({
              source: "account_broadcast",
              broadcastId: recipient.broadcastId,
              savedMessageIds: input.parts.map((part) => part.savedMessageId),
              skippedSavedMessageIds: recipient.parts
                .filter((part) => !input.parts.includes(part))
                .map((part) => part.savedMessageId),
              providerMessageIds: input.providerMessageIds
            }),
            input.at
          ]
        );

        const stored = input.parts.filter((part) => part.storagePath !== null);
        for (const [index, part] of stored.entries()) {
          const attachmentId = input.attachmentIds[index];
          if (attachmentId === undefined) {
            break;
          }
          await connection.query(
            `insert into public.conversation_attachments (
               id, message_id, kind, file_name, mime_type, size_bytes, storage_path,
               sha256, download_status, downloaded_at
             ) values (
               $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::bigint, $7::text,
               $8::text, 'stored', $9::timestamptz
             )`,
            [
              attachmentId,
              input.messageId,
              attachmentKindOf(part.kind),
              part.fileName,
              part.mimeType,
              part.sizeBytes,
              part.storagePath,
              part.sha256,
              input.at
            ]
          );
        }

        await connection.query(
          `update public.conversations
              set last_message_at = greatest(coalesce(last_message_at, $2::timestamptz), $2::timestamptz),
                  updated_at = now()
            where id = $1::uuid`,
          [recipient.conversationId, input.at]
        );
        await connection.query(
          `update public.account_broadcast_recipients
              set status = 'sent',
                  sent_at = $2::timestamptz,
                  message_id = $3::uuid,
                  next_attempt_at = null,
                  failure_reason = $4::text,
                  updated_at = $2::timestamptz
            where id = $1::uuid`,
          [recipient.recipientId, input.at, input.messageId, input.partialReason?.slice(0, 500) ?? null]
        );
        // Пробная уходит своим — касание в карточке сотрудника было бы шумом.
        if (!recipient.isTest) {
          await recordTouchpoint(connection, {
            contactId: recipient.contactId,
            channel: "telegram",
            actorAdminId: recipient.actorAdminId,
            result: "sent",
            note: input.body ?? "Рассылка из «Избранного»",
            occurredAt: input.at,
            activityId: input.messageId
          });
        }
        await connection.query("commit");
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }

  async markFailed(input: {
    readonly recipientId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<void> {
    await this.query(
      `update public.account_broadcast_recipients
          set status = 'failed',
              failure_reason = $2::text,
              attempts = attempts + 1,
              next_attempt_at = null,
              updated_at = $3::timestamptz
        where id = $1::uuid`,
      [input.recipientId, input.reason.slice(0, 500), input.at]
    );
  }

  async release(input: {
    readonly recipientId: string;
    readonly reason: string | null;
    readonly retryAt: Date | null;
    readonly countAttempt: boolean;
    readonly at: Date;
  }): Promise<void> {
    // Рассылку могли остановить, пока шла попытка: тогда строка не возвращается в
    // очередь, которую больше никто не разбирает, а закрывается вместе с остальными.
    await this.query(
      `update public.account_broadcast_recipients recipient
          set status = case when broadcast.status = 'sending' then 'pending' else 'cancelled' end,
              failure_reason = coalesce($2::text, recipient.failure_reason),
              next_attempt_at = case when broadcast.status = 'sending' then $3::timestamptz end,
              attempts = recipient.attempts + case when $4::boolean then 1 else 0 end,
              updated_at = $5::timestamptz
         from public.account_broadcasts broadcast
        where recipient.id = $1::uuid
          and broadcast.id = recipient.broadcast_id`,
      [input.recipientId, input.reason?.slice(0, 500) ?? null, input.retryAt, input.countAttempt, input.at]
    );
  }

  async pauseAll(input: { readonly until: Date; readonly reason: string; readonly at: Date }): Promise<void> {
    await this.query(
      `update public.account_broadcasts
          set paused_until = $1::timestamptz,
              pause_reason = $2::text,
              updated_at = $3::timestamptz
        where channel = 'telegram' and status = 'sending'`,
      [input.until, input.reason.slice(0, 500), input.at]
    );
  }

  async stopBroadcast(input: {
    readonly broadcastId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      try {
        await connection.query(
          `update public.account_broadcasts
              set status = 'cancelled',
                  cancelled_at = $2::timestamptz,
                  stop_reason = $3::text,
                  updated_at = $2::timestamptz
            where id = $1::uuid and status = 'sending'`,
          [input.broadcastId, input.at, input.reason.slice(0, 500)]
        );
        await connection.query(
          `update public.account_broadcast_recipients
              set status = 'cancelled', next_attempt_at = null, updated_at = $2::timestamptz
            where broadcast_id = $1::uuid and status in ('pending', 'sending')`,
          [input.broadcastId, input.at]
        );
        await connection.query("commit");
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }

  async completeFinished(at: Date): Promise<number> {
    const result = await this.query<{ readonly id: string }>(
      `update public.account_broadcasts broadcast
          set status = 'completed', completed_at = $1::timestamptz, updated_at = $1::timestamptz
        where broadcast.status = 'sending'
          and not exists (
            select 1 from public.account_broadcast_recipients recipient
             where recipient.broadcast_id = broadcast.id
               and recipient.status in ('pending', 'sending')
          )
       returning broadcast.id`,
      [at]
    );
    return result.rows.length;
  }

  private async query<T>(text: string, values: readonly unknown[]) {
    const connection = await this.pool.connect();
    try {
      return await connection.query<T>(text, values);
    } finally {
      connection.release();
    }
  }
}

/** Вид вложения в ленте. Кружок — это видео: отдельного вида у ленты нет и не нужно. */
function attachmentKindOf(kind: AccountSavedMessageKind): AttachmentKind {
  switch (kind) {
    case "video_note":
    case "video":
    case "animation":
      return "video";
    case "photo":
      return "photo";
    case "voice":
      return "voice";
    case "audio":
      return "audio";
    case "document":
      return "document";
    default:
      return "other";
  }
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function createAccountBroadcastPersistence(pool: SqlConnectionPool) {
  return {
    admin: new PostgresAdminAccountBroadcastRepository(pool),
    savedMessages: new PostgresAccountSavedMessagesRepository(pool),
    queue: new PostgresAccountBroadcastQueue(pool)
  } as const;
}
