import { randomUUID } from "node:crypto";
import {
  BootstrapFirstAdminService
} from "@ticket-platform/application";
import {
  createNodePostgresPool,
  PostgresFirstAdminBootstrapRepository
} from "@ticket-platform/database";

const confirmationPhrase = "bootstrap-first-super-admin";

async function main(): Promise<void> {
  if (process.env.ADMIN_BOOTSTRAP_CONFIRM !== confirmationPhrase) {
    throw new Error(
      `ADMIN_BOOTSTRAP_CONFIRM must equal ${confirmationPhrase}`
    );
  }

  const pool = createNodePostgresPool({
    connectionString: required("DATABASE_DIRECT_URL"),
    maxConnections: 1,
    applicationName: "ticket-platform-admin-bootstrap"
  });

  try {
    const service = new BootstrapFirstAdminService(
      new PostgresFirstAdminBootstrapRepository(pool),
      { newId: randomUUID }
    );
    const result = await service.execute({
      authSubject: required("ADMIN_BOOTSTRAP_AUTH_SUBJECT"),
      email: optional("ADMIN_BOOTSTRAP_EMAIL"),
      displayName: optional("ADMIN_BOOTSTRAP_DISPLAY_NAME"),
      reason: required("ADMIN_BOOTSTRAP_REASON"),
      occurredAt: new Date()
    });

    console.log(`First super administrator created: ${result.adminId}`);
  } finally {
    await pool.close();
  }
}

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optional(name: string): string | null {
  return process.env[name] || null;
}

void main().catch((error: unknown) => {
  // Скрипт запускают руками на сервере, и разбираться с ним будет человек, а не система
  // логирования: одного имени класса ошибки для этого мало. Секретов в сообщениях драйвера
  // Postgres нет — там имена таблиц и колонок, — а строку подключения мы не печатаем.
  console.error("Administrator bootstrap failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && "code" in error
      ? { code: (error as { readonly code?: unknown }).code }
      : {}),
    ...(error instanceof Error && "detail" in error
      ? { detail: (error as { readonly detail?: unknown }).detail }
      : {})
  });
  process.exitCode = 1;
});
