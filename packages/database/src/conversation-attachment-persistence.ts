import type {
  AttachmentDownloadRepository,
  PendingAttachment
} from "@ticket-platform/application";
import type { SqlConnectionPool } from "./postgres.js";

/**
 * Срок аренды строки. Пять минут — с запасом на медленную сеть у мессенджера и достаточно
 * мало, чтобы файл не завис на час из-за упавшего воркера.
 */
const LEASE_SECONDS = 300;

interface PendingRow {
  readonly id: string;
  readonly channel: PendingAttachment["channel"];
  readonly kind: PendingAttachment["kind"];
  readonly file_name: string | null;
  readonly mime_type: string | null;
  readonly external_file_id: string | null;
  readonly download_attempts: number;
}

/**
 * Очередь скачивания вложений.
 *
 * Канал берётся из диалога: у вложения его нет и быть не должно — вложение принадлежит
 * реплике, а реплика уже знает, где она сказана. Хранить канал третий раз значило бы
 * завести третье место, где он может разойтись с остальными.
 */
export class PostgresAttachmentDownloadRepository
implements AttachmentDownloadRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async claimPending(input: {
    readonly batchSize: number;
    readonly at: Date;
  }): Promise<readonly PendingAttachment[]> {
    const connection = await this.pool.connect();
    try {
      // Отбор и аренда — одним запросом. Просто `select … for update` здесь не работает:
      // соединение вне транзакции отпускает блокировку сразу, и второй воркер потянул бы
      // те же файлы. Поэтому взятая строка тут же отодвигается на срок аренды: воркер,
      // умерший с файлом на руках, вернёт его в очередь сам, когда аренда истечёт.
      const result = await connection.query<PendingRow>(
        `with claimed as (
           select attachment.id
             from public.conversation_attachments attachment
            where attachment.download_status = 'pending'
              and (attachment.next_attempt_at is null
                   or attachment.next_attempt_at <= $2::timestamptz)
            order by attachment.next_attempt_at nulls first, attachment.created_at
            limit $1::int
            for update of attachment skip locked
         ),
         leased as (
           update public.conversation_attachments attachment
              set next_attempt_at = $2::timestamptz + make_interval(secs => $3::int)
             from claimed
            where attachment.id = claimed.id
            returning attachment.id, attachment.message_id, attachment.kind,
                      attachment.file_name, attachment.mime_type,
                      attachment.external_file_id, attachment.download_attempts
         )
         select leased.id, conversation.channel, leased.kind,
                leased.file_name, leased.mime_type,
                leased.external_file_id, leased.download_attempts
           from leased
           join public.conversation_messages message on message.id = leased.message_id
           join public.conversations conversation on conversation.id = message.conversation_id`,
        [input.batchSize, input.at, LEASE_SECONDS]
      );
      return result.rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        kind: row.kind,
        fileName: row.file_name,
        mimeType: row.mime_type,
        externalFileId: row.external_file_id,
        attempts: row.download_attempts
      }));
    } finally {
      connection.release();
    }
  }

  async markStored(input: {
    readonly attachmentId: string;
    readonly stored: {
      readonly storagePath: string;
      readonly sha256: string;
      readonly sizeBytes: number;
    };
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.conversation_attachments
            set download_status = 'stored',
                storage_path = $2::text,
                sha256 = $3::text,
                size_bytes = $4::bigint,
                downloaded_at = $5::timestamptz,
                next_attempt_at = null,
                failure_reason = null,
                download_attempts = download_attempts + 1
          where id = $1::uuid and download_status = 'pending'`,
        [
          input.attachmentId,
          input.stored.storagePath,
          input.stored.sha256,
          input.stored.sizeBytes,
          input.at
        ]
      );
    } finally {
      connection.release();
    }
  }

  async markAttemptFailed(input: {
    readonly attachmentId: string;
    readonly reason: string;
    readonly at: Date;
    readonly retryAt: Date | null;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      // Причина неудачи попадает в базу только тогда, когда она окончательна: колонка
      // разрешена схемой лишь у `failed`, и это не мелочь, а решение. Строка с причиной —
      // это работа для человека: файл надо забрать руками, пока он жив у мессенджера. Пока
      // мы ещё пробуем сами, причина живёт в журнале воркера, а в базе стоит только время
      // следующего захода.
      await connection.query(
        `update public.conversation_attachments
            set download_attempts = download_attempts + 1,
                download_status = case when $3::timestamptz is null then 'failed' else 'pending' end,
                failure_reason = case when $3::timestamptz is null then $2::text else null end,
                next_attempt_at = $3::timestamptz
          where id = $1::uuid and download_status = 'pending'`,
        [input.attachmentId, input.reason, input.retryAt]
      );
    } finally {
      connection.release();
    }
  }
}

export function createAttachmentDownloadPersistence(pool: SqlConnectionPool) {
  return { repository: new PostgresAttachmentDownloadRepository(pool) } as const;
}
