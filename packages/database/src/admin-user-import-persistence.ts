import type {
  AdminEventAuditContext,
  AdminUserImportPreviewRepository
} from "@ticket-platform/application";
import { ADMIN_USER_IMPORT_LIMITS } from "@ticket-platform/application";
import type {
  AdminUserImportBatch,
  AdminUserImportNormalizedRow,
  AdminUserImportRow,
  AdminUserImportRowStatus
} from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface BatchRow {
  readonly id: string;
  readonly file_name: string;
  readonly file_checksum: string;
  readonly byte_size: number;
  readonly delimiter: string;
  readonly status: string;
  readonly total_row_count: number;
  readonly new_row_count: number;
  readonly invalid_row_count: number;
  readonly ignored_row_count: number;
  readonly created_at: Date;
}

interface ImportRow {
  readonly row_number: number;
  readonly status: string;
  readonly normalized_data: unknown;
  readonly issue_codes: readonly string[];
}

export class PostgresAdminUserImportPreviewRepository
implements AdminUserImportPreviewRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  findByChecksum(fileChecksum: string): Promise<AdminUserImportBatch | null> {
    return this.read(async (connection) => {
      const result = await connection.query<BatchRow>(
        `${BATCH_SELECT}
         where file_checksum = $1`,
        [fileChecksum]
      );
      return result.rows[0]
        ? readBatch(connection, result.rows[0])
        : null;
    });
  }

  create(input: Parameters<AdminUserImportPreviewRepository["create"]>[0]) {
    return this.write(async (connection) => {
      const counts = countRows(input.rows);
      const inserted = await connection.query<{ readonly id: string }>(
        `insert into public.user_import_batches (
           id, import_kind, file_name, file_checksum, byte_size,
           delimiter, status, total_row_count, new_row_count,
           invalid_row_count, ignored_row_count, created_by_admin_id,
           reason, created_at
         ) values (
           $1, 'users_csv', $2, $3, $4,
           $5, 'preview_ready', $6, $7,
           $8, $9, $10,
           $11, $12
         )
         on conflict (file_checksum) do nothing
         returning id`,
        [
          input.batchId,
          input.fileName,
          input.fileChecksum,
          input.byteSize,
          input.delimiter,
          counts.total,
          counts.newRows,
          counts.invalidRows,
          counts.ignoredRows,
          input.audit.actorAdminId,
          input.audit.reason,
          input.audit.occurredAt
        ]
      );
      if (!inserted.rows[0]) {
        const existing = await readBatchByChecksum(
          connection,
          input.fileChecksum
        );
        return { status: "existing" as const, value: existing };
      }
      await connection.query(
        `insert into public.user_import_rows (
           batch_id, row_number, normalized_content_hash, status,
           normalized_data, issue_codes, created_at
         )
         select $1, rows.row_number, rows.normalized_content_hash,
                rows.status, rows.normalized_data, rows.issue_codes, $3
         from jsonb_to_recordset($2::jsonb) as rows (
           row_number integer,
           normalized_content_hash text,
           status text,
           normalized_data jsonb,
           issue_codes text[]
         )`,
        [
          input.batchId,
          JSON.stringify(input.rows.map((row) => ({
            row_number: row.rowNumber,
            normalized_content_hash: row.normalizedContentHash,
            status: row.status,
            normalized_data: row.normalized,
            issue_codes: row.issueCodes
          }))),
          input.audit.occurredAt
        ]
      );
      await appendAudit(
        connection,
        input.audit,
        input.batchId,
        {
          importKind: "users_csv",
          fileChecksum: input.fileChecksum,
          byteSize: input.byteSize,
          delimiter: input.delimiter === "\t" ? "tab" : input.delimiter,
          totalRowCount: counts.total,
          newRowCount: counts.newRows,
          invalidRowCount: counts.invalidRows,
          ignoredRowCount: counts.ignoredRows
        }
      );
      return {
        status: "created" as const,
        value: await readBatchById(connection, input.batchId)
      };
    });
  }

  private async read<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
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

  private async write<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
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

export function createAdminUserImportPreviewPersistence(
  pool: SqlConnectionPool
): AdminUserImportPreviewRepository {
  return new PostgresAdminUserImportPreviewRepository(pool);
}

const BATCH_SELECT = `
  select id, file_name, file_checksum, byte_size, delimiter, status,
         total_row_count, new_row_count, invalid_row_count,
         ignored_row_count, created_at
  from public.user_import_batches`;

async function readBatchByChecksum(
  connection: SqlConnection,
  fileChecksum: string
): Promise<AdminUserImportBatch> {
  const result = await connection.query<BatchRow>(
    `${BATCH_SELECT}
     where file_checksum = $1`,
    [fileChecksum]
  );
  return requireBatch(connection, result.rows[0]);
}

async function readBatchById(
  connection: SqlConnection,
  batchId: string
): Promise<AdminUserImportBatch> {
  const result = await connection.query<BatchRow>(
    `${BATCH_SELECT}
     where id = $1`,
    [batchId]
  );
  return requireBatch(connection, result.rows[0]);
}

function requireBatch(
  connection: SqlConnection,
  row: BatchRow | undefined
): Promise<AdminUserImportBatch> {
  if (!row) {
    throw new Error("User import batch was not readable");
  }
  return readBatch(connection, row);
}

async function readBatch(
  connection: SqlConnection,
  row: BatchRow
): Promise<AdminUserImportBatch> {
  const rows = await connection.query<ImportRow>(
    `select row_number, status, normalized_data, issue_codes
     from public.user_import_rows
     where batch_id = $1
     order by row_number
     limit $2`,
    [row.id, ADMIN_USER_IMPORT_LIMITS.previewRows]
  );
  return {
    id: row.id,
    fileName: row.file_name,
    fileChecksum: row.file_checksum,
    byteSize: row.byte_size,
    delimiter: readDelimiter(row.delimiter),
    status: readBatchStatus(row.status),
    totalRowCount: row.total_row_count,
    newRowCount: row.new_row_count,
    invalidRowCount: row.invalid_row_count,
    ignoredRowCount: row.ignored_row_count,
    previewRows: rows.rows.map(mapImportRow),
    createdAt: row.created_at.toISOString()
  };
}

function mapImportRow(row: ImportRow): AdminUserImportRow {
  const status = readRowStatus(row.status);
  return {
    rowNumber: row.row_number,
    status,
    normalized: status === "INVALID"
      ? null
      : readNormalized(row.normalized_data),
    issueCodes: row.issue_codes.map(readIssueCode)
  };
}

function readNormalized(value: unknown): AdminUserImportNormalizedRow {
  const parsed = typeof value === "string"
    ? JSON.parse(value) as unknown
    : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("User import normalized data is invalid");
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  return {
    telegramUserId: optionalString(record.telegramUserId, 20),
    telegramUsername: optionalString(record.telegramUsername, 32),
    phone: optionalString(record.phone, 20),
    externalCrmId: optionalString(record.externalCrmId, 100),
    firstName: optionalString(record.firstName, 100),
    lastName: optionalString(record.lastName, 100)
  };
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maxLength
  ) {
    throw new Error("User import normalized value is invalid");
  }
  return value;
}

function readDelimiter(value: string): "," | ";" | "\t" {
  if (value !== "," && value !== ";" && value !== "\t") {
    throw new Error("User import delimiter is invalid");
  }
  return value;
}

function readBatchStatus(value: string): "preview_ready" {
  if (value !== "preview_ready") {
    throw new Error("User import batch status is invalid");
  }
  return value;
}

function readRowStatus(value: string): AdminUserImportRowStatus {
  if (value !== "NEW" && value !== "INVALID" && value !== "IGNORED") {
    throw new Error("User import row status is invalid");
  }
  return value;
}

function readIssueCode(value: string): string {
  if (!/^[a-z][a-z0-9_]{1,99}$/.test(value)) {
    throw new Error("User import issue code is invalid");
  }
  return value;
}

function countRows(rows: Parameters<
  AdminUserImportPreviewRepository["create"]
>[0]["rows"]) {
  return {
    total: rows.length,
    newRows: rows.filter((row) => row.status === "NEW").length,
    invalidRows: rows.filter((row) => row.status === "INVALID").length,
    ignoredRows: rows.filter((row) => row.status === "IGNORED").length
  };
}

function appendAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  batchId: string,
  after: unknown
): Promise<unknown> {
  return connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, 'import.preview_created', 'user_import_batch', $4,
       $5, null, $6::jsonb, $7,
       $8::inet, $9, $10
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      batchId,
      audit.reason,
      JSON.stringify(after),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}
