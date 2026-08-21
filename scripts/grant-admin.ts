import { randomUUID } from "node:crypto";
import { GrantAdminRoleService } from "@ticket-platform/application";
import {
  createNodePostgresPool,
  PostgresAdminRoleGrantRepository
} from "@ticket-platform/database";

/**
 * Выдача роли администратору панели.
 *
 * Учётная запись создаётся не здесь, а в Supabase Auth: панель пускает по её токену, и
 * пароль с двухфакторным кодом живут там. Здесь Supabase-пользователю находится
 * соответствие в нашей базе и выдаётся роль, от которой зависит, что человек увидит.
 */
async function main(): Promise<void> {
  const pool = createNodePostgresPool({
    connectionString: required("DATABASE_DIRECT_URL"),
    maxConnections: 1,
    applicationName: "ticket-platform-admin-grant"
  });

  try {
    const service = new GrantAdminRoleService(
      new PostgresAdminRoleGrantRepository(pool),
      { newId: randomUUID }
    );
    const result = await service.grant({
      authSubject: required("ADMIN_AUTH_SUBJECT"),
      email: optional("ADMIN_EMAIL"),
      displayName: optional("ADMIN_DISPLAY_NAME"),
      roleCode: required("ADMIN_ROLE"),
      grantedByAuthSubject: optional("ADMIN_GRANTED_BY_AUTH_SUBJECT"),
      reason: required("ADMIN_REASON"),
      occurredAt: new Date()
    });

    if (result.status === "unknown_role") {
      throw new Error(
        `Role ${process.env.ADMIN_ROLE} does not exist.`
        + " Known roles: content_manager, sales_manager, financial_admin,"
        + " technical_admin, super_admin"
      );
    }
    if (result.status === "unknown_granting_admin") {
      throw new Error(
        "ADMIN_GRANTED_BY_AUTH_SUBJECT does not match any administrator account"
      );
    }
    console.log(
      result.status === "granted"
        ? `Role granted. Administrator: ${result.adminId}`
        : `Role was already granted. Administrator: ${result.adminId}`
    );
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
  // логирования: одного имени класса ошибки для этого мало.
  console.error("Administrator role grant failed", {
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
