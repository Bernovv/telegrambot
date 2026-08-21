import type { IdGenerator } from "./identity.js";

/**
 * Выдача роли администратору панели.
 *
 * Первого супер-администратора заводит `BootstrapFirstAdminService` — он для того и
 * одноразовый. Всех, кто приходит после, заводят этим сценарием: учётная запись в Supabase
 * Auth уже создана, здесь ей находится соответствие в нашей базе и выдаётся роль.
 *
 * Кто выдал и почему, записывается в журнал: доступ к боевым продажам — не та вещь, о
 * которой через полгода можно позволить себе гадать.
 */
export interface GrantAdminRoleCommand {
  /** Идентификатор пользователя в Supabase Auth (`sub` в токене). */
  readonly authSubject: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly roleCode: string;
  /** Кто выдаёт роль. Пусто — выдача из сценария, без действующего администратора. */
  readonly grantedByAuthSubject: string | null;
  readonly reason: string;
  readonly occurredAt: Date;
}

export interface GrantAdminRoleRecord {
  readonly adminId: string;
  readonly roleGrantId: string;
  readonly auditId: string;
  readonly authSubject: string;
  readonly emailNormalized: string | null;
  readonly displayName: string | null;
  readonly roleCode: string;
  readonly grantedByAuthSubject: string | null;
  readonly reason: string;
  readonly occurredAt: Date;
}

export type GrantAdminRoleOutcome =
  | { readonly status: "granted"; readonly adminId: string }
  | { readonly status: "already_granted"; readonly adminId: string }
  | { readonly status: "unknown_role" }
  | { readonly status: "unknown_granting_admin" };

export interface AdminRoleGrantRepository {
  grant(record: GrantAdminRoleRecord): Promise<GrantAdminRoleOutcome>;
}

export class InvalidAdminRoleGrantInputError extends Error {
  constructor() {
    super("Invalid administrator role grant input");
    this.name = "InvalidAdminRoleGrantInputError";
  }
}

export class GrantAdminRoleService {
  constructor(
    private readonly repository: AdminRoleGrantRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  // Метод асинхронный намеренно: проверки ввода тоже должны приходить отказом промиса, а
  // не броском до первого await, иначе вызывающий код ловит их не там, где ждёт.
  async grant(command: GrantAdminRoleCommand): Promise<GrantAdminRoleOutcome> {
    return await this.repository.grant({
      adminId: this.idGenerator.newId(),
      roleGrantId: this.idGenerator.newId(),
      auditId: this.idGenerator.newId(),
      authSubject: normalizeRequired(command.authSubject, 255),
      emailNormalized: normalizeEmail(command.email),
      displayName: normalizeOptional(command.displayName, 200),
      roleCode: normalizeRoleCode(command.roleCode),
      grantedByAuthSubject: normalizeOptional(command.grantedByAuthSubject, 255),
      reason: normalizeRequired(command.reason, 500),
      occurredAt: command.occurredAt
    });
  }
}

function normalizeRoleCode(value: string): string {
  const normalized = normalizeRequired(value, 40).toLowerCase();

  // Тот же вид, что проверяет ограничение на таблице ролей. Несуществующую роль поймает
  // внешний ключ, но опечатку вида «Sales Manager» лучше не доносить до базы вовсе.
  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) {
    throw new InvalidAdminRoleGrantInputError();
  }

  return normalized;
}

function normalizeRequired(value: string, maxLength: number): string {
  const normalized = value.trim();

  if (!normalized || normalized.length > maxLength) {
    throw new InvalidAdminRoleGrantInputError();
  }

  return normalized;
}

function normalizeOptional(value: string | null, maxLength: number): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new InvalidAdminRoleGrantInputError();
  }

  return normalized;
}

function normalizeEmail(value: string | null): string | null {
  const normalized = normalizeOptional(value, 320)?.toLowerCase() ?? null;

  if (normalized !== null && !/^[^@\s]+@[^@\s]+$/.test(normalized)) {
    throw new InvalidAdminRoleGrantInputError();
  }

  return normalized;
}
