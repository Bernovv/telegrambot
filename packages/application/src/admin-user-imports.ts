import { createHash } from "node:crypto";
import type {
  AdminRequestActor,
  AdminUserImportBatch,
  AdminUserImportNormalizedRow,
  AdminUserImportRow,
  CreateAdminUserImportPreviewRequest,
  CreateAdminUserImportPreviewResponse
} from "@ticket-platform/contracts";
import { parse } from "csv-parse/sync";
import {
  buildAdminEventAuditContext,
  type AdminEventAuditContext,
  type AdminEventMutationMetadata
} from "./admin-event-management.js";
import type { IdGenerator } from "./identity.js";
import type { PhoneNormalizer } from "./phone.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
const MAX_FILE_BYTES = 512 * 1_024;
const MAX_ROWS = 5_000;
const PREVIEW_ROWS = 200;
const DELIMITERS = [",", ";", "\t"] as const;
const HEADER_NAMES = [
  "telegram_id",
  "telegram_username",
  "phone",
  "external_crm_id",
  "first_name",
  "last_name"
] as const;
const IDENTITY_HEADERS = new Set([
  "telegram_id",
  "telegram_username",
  "phone",
  "external_crm_id"
]);
const UNSAFE_SPREADSHEET_PREFIX = /^[=+\-@]/;

type HeaderName = typeof HEADER_NAMES[number];
type Delimiter = typeof DELIMITERS[number];

export interface AdminUserImportStagedRow {
  readonly rowNumber: number;
  readonly normalizedContentHash: string;
  readonly status: AdminUserImportRow["status"];
  readonly normalized: AdminUserImportNormalizedRow | null;
  readonly issueCodes: readonly string[];
}

export interface AdminUserImportPreviewRepository {
  findByChecksum(fileChecksum: string): Promise<AdminUserImportBatch | null>;
  create(input: {
    readonly batchId: string;
    readonly fileName: string;
    readonly fileChecksum: string;
    readonly byteSize: number;
    readonly delimiter: Delimiter;
    readonly rows: readonly AdminUserImportStagedRow[];
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "created"; readonly value: AdminUserImportBatch }
    | { readonly status: "existing"; readonly value: AdminUserImportBatch }
  >;
}

export class InvalidAdminUserImportError extends Error {
  constructor(readonly code: string = "invalid_import") {
    super(`Administrator user import is invalid: ${code}`);
    this.name = "InvalidAdminUserImportError";
  }
}

export class PreviewAdminUserImportService {
  constructor(
    private readonly repository: AdminUserImportPreviewRepository,
    private readonly phoneNormalizer: PhoneNormalizer,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly request: CreateAdminUserImportPreviewRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<CreateAdminUserImportPreviewResponse> {
    requirePermission(input.actor);
    const fileName = normalizeFileName(input.request.fileName);
    const reason = bounded(input.request.reason, 1, 500);
    const bytes = decodeBase64(input.request.contentBase64);
    const fileChecksum = sha256(bytes);
    const existing = await this.repository.findByChecksum(fileChecksum);
    if (existing) {
      return { batch: existing, reusedExisting: true };
    }
    const csvText = decodeUtf8(bytes);
    const parsed = parseCsv(csvText);
    const rows = stageRows(
      parsed.records,
      parsed.headers,
      this.phoneNormalizer
    );
    const audit = buildAdminEventAuditContext(
      input.actor,
      reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.create({
      batchId: requireUuid(this.idGenerator.newId()),
      fileName,
      fileChecksum,
      byteSize: bytes.byteLength,
      delimiter: parsed.delimiter,
      rows,
      audit
    });
    return {
      batch: result.value,
      reusedExisting: result.status === "existing"
    };
  }
}

function parseCsv(input: string): {
  readonly delimiter: Delimiter;
  readonly headers: readonly HeaderName[];
  readonly records: readonly (readonly string[])[];
} {
  let lastError: unknown;
  for (const delimiter of DELIMITERS) {
    try {
      const records = parse(input, {
        bom: true,
        delimiter,
        encoding: "utf8",
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false,
        max_record_size: 10_000
      }) as readonly (readonly string[])[];
      if (records.length < 2 || records.length > MAX_ROWS + 1) {
        throw new InvalidAdminUserImportError("row_count");
      }
      const headers = parseHeaders(records[0] ?? []);
      return { delimiter, headers, records: records.slice(1) };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof InvalidAdminUserImportError) {
    throw lastError;
  }
  throw new InvalidAdminUserImportError("invalid_csv");
}

function parseHeaders(values: readonly string[]): readonly HeaderName[] {
  const headers = values.map((value) =>
    value.normalize("NFKC").trim().toLowerCase()
  );
  if (
    headers.length < 1
    || headers.length > HEADER_NAMES.length
    || new Set(headers).size !== headers.length
    || headers.some((header) =>
      !HEADER_NAMES.includes(header as HeaderName)
    )
    || !headers.some((header) => IDENTITY_HEADERS.has(header))
  ) {
    throw new InvalidAdminUserImportError("invalid_headers");
  }
  return headers as readonly HeaderName[];
}

function stageRows(
  records: readonly (readonly string[])[],
  headers: readonly HeaderName[],
  phoneNormalizer: PhoneNormalizer
): readonly AdminUserImportStagedRow[] {
  const seen = new Set<string>();
  return records.map((record, index) => {
    const rowNumber = index + 2;
    const values = {
      telegram_id: "",
      telegram_username: "",
      phone: "",
      external_crm_id: "",
      first_name: "",
      last_name: "",
      ...Object.fromEntries(
        headers.map((header, column) => [header, record[column] ?? ""])
      )
    } satisfies Readonly<Record<HeaderName, string>>;
    const issues: string[] = [];
    const normalized = normalizeRow(values, phoneNormalizer, issues);
    const normalizedContentHash = sha256Text(JSON.stringify(
      normalized ?? record
    ));
    if (!normalized) {
      return {
        rowNumber,
        normalizedContentHash,
        status: "INVALID",
        normalized: null,
        issueCodes: [...new Set(issues)].sort()
      };
    }
    if (seen.has(normalizedContentHash)) {
      return {
        rowNumber,
        normalizedContentHash,
        status: "IGNORED",
        normalized,
        issueCodes: ["duplicate_in_file"]
      };
    }
    seen.add(normalizedContentHash);
    return {
      rowNumber,
      normalizedContentHash,
      status: "NEW",
      normalized,
      issueCodes: []
    };
  });
}

function normalizeRow(
  values: Readonly<Record<HeaderName, string>>,
  phoneNormalizer: PhoneNormalizer,
  issues: string[]
): AdminUserImportNormalizedRow | null {
  const telegramUserId = nullable(values.telegram_id);
  if (telegramUserId && !/^\d{1,20}$/.test(telegramUserId)) {
    issues.push("invalid_telegram_id");
  }
  const rawUsername = nullable(values.telegram_username);
  const telegramUsername = rawUsername
    ? rawUsername.replace(/^@/, "").toLowerCase()
    : null;
  if (
    telegramUsername
    && !/^[a-z0-9_]{5,32}$/.test(telegramUsername)
  ) {
    issues.push("invalid_telegram_username");
  }
  let phone: string | null = null;
  const rawPhone = nullable(values.phone);
  if (rawPhone) {
    try {
      phone = phoneNormalizer.normalize(rawPhone);
    } catch {
      issues.push("invalid_phone");
    }
  }
  const externalCrmId = safeText(
    values.external_crm_id,
    100,
    "invalid_external_crm_id",
    issues
  );
  const firstName = safeText(
    values.first_name,
    100,
    "invalid_first_name",
    issues
  );
  const lastName = safeText(
    values.last_name,
    100,
    "invalid_last_name",
    issues
  );
  if (!telegramUserId && !telegramUsername && !phone && !externalCrmId) {
    issues.push("identity_required");
  }
  if (issues.length > 0) {
    return null;
  }
  return {
    telegramUserId,
    telegramUsername,
    phone,
    externalCrmId,
    firstName,
    lastName
  };
}

function safeText(
  value: string,
  maxLength: number,
  issueCode: string,
  issues: string[]
): string | null {
  const normalized = nullable(value)?.replace(/\s+/gu, " ") ?? null;
  if (
    normalized
    && (
      normalized.length > maxLength
      || UNSAFE_SPREADSHEET_PREFIX.test(normalized)
    )
  ) {
    issues.push(issueCode);
    return null;
  }
  return normalized;
}

function nullable(value: string): string | null {
  const normalized = value.normalize("NFKC").trim();
  return normalized ? normalized : null;
}

function decodeBase64(value: string): Uint8Array {
  if (
    value.length < 4
    || value.length > Math.ceil(MAX_FILE_BYTES / 3) * 4
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new InvalidAdminUserImportError("invalid_file");
  }
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.byteLength < 1
    || bytes.byteLength > MAX_FILE_BYTES
    || bytes.toString("base64") !== value
  ) {
    throw new InvalidAdminUserImportError("invalid_file");
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) {
      throw new Error("NUL");
    }
    return text;
  } catch {
    throw new InvalidAdminUserImportError("invalid_utf8");
  }
}

function normalizeFileName(value: string): string {
  const fileName = bounded(value, 1, 120).normalize("NFKC");
  if (
    !fileName.toLowerCase().endsWith(".csv")
    || fileName.includes("\\")
    || fileName.includes("/")
    || [...fileName].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new InvalidAdminUserImportError("invalid_file_name");
  }
  return fileName;
}

function bounded(value: string, min: number, max: number): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new InvalidAdminUserImportError();
  }
  return normalized;
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminUserImportError();
  }
  return value;
}

function requirePermission(actor: AdminRequestActor): void {
  if (
    actor.permission !== "imports.execute"
    || !UUID_PATTERN.test(actor.adminId)
  ) {
    throw new InvalidAdminUserImportError("permission");
  }
}

function sha256(bytes: Uint8Array): string {
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (!CHECKSUM_PATTERN.test(checksum)) {
    throw new Error("SHA-256 failed");
  }
  return checksum;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const ADMIN_USER_IMPORT_LIMITS = {
  maxFileBytes: MAX_FILE_BYTES,
  maxRows: MAX_ROWS,
  previewRows: PREVIEW_ROWS
} as const;
