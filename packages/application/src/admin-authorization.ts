import type {
  AdminPermission,
  AdminRequestActor,
  AuthenticatorAssuranceLevel
} from "@ticket-platform/contracts";

const MFA_REQUIRED_PERMISSIONS: ReadonlySet<AdminPermission> = new Set([
  "orders.manual_paid",
  "payments.refund",
  "wallet.adjust",
  "system.manage",
  "admins.manage"
]);

export interface VerifiedAdminToken {
  readonly subject: string;
  readonly assuranceLevel: AuthenticatorAssuranceLevel;
  readonly issuedAt: Date;
}

export interface AdminPrincipal {
  readonly adminId: string;
  readonly authSubject: string;
  readonly status: "active" | "suspended";
  readonly roleCodes: readonly string[];
  readonly permissions: readonly AdminPermission[];
  readonly requiresMfa: boolean;
  readonly sessionsRevokedBefore: Date | null;
}

export interface AdminPrincipalRepository {
  findByAuthSubject(authSubject: string): Promise<AdminPrincipal | null>;
}

export interface AdminAccessTokenVerifier {
  verify(accessToken: string): Promise<VerifiedAdminToken>;
}

export interface AuthorizeAdminRequest {
  execute(
    token: VerifiedAdminToken,
    requiredPermission: AdminPermission
  ): Promise<AdminRequestActor>;
}

export class AdminAuthenticationError extends Error {
  constructor() {
    super("Administrator authentication is required");
    this.name = "AdminAuthenticationError";
  }
}

export class AdminMfaRequiredError extends Error {
  constructor() {
    super("Multi-factor authentication is required");
    this.name = "AdminMfaRequiredError";
  }
}

export class AdminPermissionDeniedError extends Error {
  constructor() {
    super("Administrator permission is denied");
    this.name = "AdminPermissionDeniedError";
  }
}

/**
 * Нужен ли второй фактор.
 *
 * Выключение снимает оба требования сразу — и роль, помеченную `requires_mfa`, и список
 * денежных разрешений ниже. Половинчатое выключение было бы хуже отсутствия: панель
 * пускала бы в заказы, но отказывала в подтверждении оплаты, и понять, почему именно,
 * было бы не по чему.
 */
export interface AdminAuthorizationOptions {
  readonly mfaRequired: boolean;
}

export class AuthorizeAdminRequestService implements AuthorizeAdminRequest {
  constructor(
    private readonly principals: AdminPrincipalRepository,
    private readonly options: AdminAuthorizationOptions = { mfaRequired: true }
  ) {}

  async execute(
    token: VerifiedAdminToken,
    requiredPermission: AdminPermission
  ): Promise<AdminRequestActor> {
    const principal = await this.principals.findByAuthSubject(token.subject);

    if (!principal || principal.status !== "active" || sessionWasRevoked(principal, token)) {
      throw new AdminAuthenticationError();
    }

    if (
      this.options.mfaRequired
      && (principal.requiresMfa || MFA_REQUIRED_PERMISSIONS.has(requiredPermission))
      && token.assuranceLevel !== "aal2"
    ) {
      throw new AdminMfaRequiredError();
    }

    if (!principal.permissions.includes(requiredPermission)) {
      throw new AdminPermissionDeniedError();
    }

    return {
      adminId: principal.adminId,
      authSubject: principal.authSubject,
      roleCodes: principal.roleCodes,
      permission: requiredPermission
    };
  }
}

function sessionWasRevoked(
  principal: AdminPrincipal,
  token: VerifiedAdminToken
): boolean {
  return principal.sessionsRevokedBefore !== null
    && token.issuedAt.getTime() <= principal.sessionsRevokedBefore.getTime();
}
