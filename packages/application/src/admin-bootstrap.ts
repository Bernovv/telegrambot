import type { IdGenerator } from "./identity.js";

export interface BootstrapFirstAdminCommand {
  readonly authSubject: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly reason: string;
  readonly occurredAt: Date;
}

export interface BootstrapAdminRecord {
  readonly adminId: string;
  readonly roleGrantId: string;
  readonly auditId: string;
  readonly authSubject: string;
  readonly emailNormalized: string | null;
  readonly displayName: string | null;
  readonly reason: string;
  readonly occurredAt: Date;
}

export interface FirstAdminBootstrapRepository {
  tryBootstrap(record: BootstrapAdminRecord): Promise<boolean>;
}

export class AdminBootstrapAlreadyCompletedError extends Error {
  constructor() {
    super("The first administrator has already been provisioned");
    this.name = "AdminBootstrapAlreadyCompletedError";
  }
}

export class InvalidAdminBootstrapInputError extends Error {
  constructor() {
    super("Invalid first administrator bootstrap input");
    this.name = "InvalidAdminBootstrapInputError";
  }
}

export class BootstrapFirstAdminService {
  constructor(
    private readonly repository: FirstAdminBootstrapRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(command: BootstrapFirstAdminCommand): Promise<{ readonly adminId: string }> {
    const authSubject = normalizeRequired(command.authSubject, 255);
    const reason = normalizeRequired(command.reason, 500);
    const emailNormalized = normalizeEmail(command.email);
    const displayName = normalizeOptional(command.displayName, 200);
    const adminId = this.idGenerator.newId();

    const created = await this.repository.tryBootstrap({
      adminId,
      roleGrantId: this.idGenerator.newId(),
      auditId: this.idGenerator.newId(),
      authSubject,
      emailNormalized,
      displayName,
      reason,
      occurredAt: command.occurredAt
    });

    if (!created) {
      throw new AdminBootstrapAlreadyCompletedError();
    }

    return { adminId };
  }
}

function normalizeRequired(value: string, maxLength: number): string {
  const normalized = value.trim();

  if (!normalized || normalized.length > maxLength) {
    throw new InvalidAdminBootstrapInputError();
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
    throw new InvalidAdminBootstrapInputError();
  }

  return normalized;
}

function normalizeEmail(value: string | null): string | null {
  const normalized = normalizeOptional(value, 320)?.toLowerCase() ?? null;

  if (normalized !== null && !/^[^@\s]+@[^@\s]+$/.test(normalized)) {
    throw new InvalidAdminBootstrapInputError();
  }

  return normalized;
}
