import {
  CanActivate,
  DynamicModule,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Module,
  SetMetadata,
  UnauthorizedException
} from "@nestjs/common";
import {
  APP_GUARD,
  Reflector
} from "@nestjs/core";
import type {
  AdminAccessTokenVerifier,
  AuthorizeAdminRequest
} from "@ticket-platform/application";
import {
  AdminAuthenticationError,
  AdminMfaRequiredError,
  AdminPermissionDeniedError
} from "@ticket-platform/application";
import type {
  AdminPermission,
  AdminRequestActor
} from "@ticket-platform/contracts";
import type { FastifyRequest } from "fastify";

const ADMIN_TOKEN_VERIFIER = Symbol("ADMIN_TOKEN_VERIFIER");
const ADMIN_AUTHORIZER = Symbol("ADMIN_AUTHORIZER");
const REQUIRED_ADMIN_PERMISSION = Symbol("REQUIRED_ADMIN_PERMISSION");

export const RequireAdminPermission = (permission: AdminPermission) =>
  SetMetadata(REQUIRED_ADMIN_PERMISSION, permission);

export interface AdminAuthorizationModuleOptions {
  readonly tokenVerifier: AdminAccessTokenVerifier;
  readonly authorizer: AuthorizeAdminRequest;
}

export interface AuthenticatedAdminRequest extends FastifyRequest {
  adminActor?: AdminRequestActor;
}

@Injectable()
export class AdminAuthorizationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ADMIN_TOKEN_VERIFIER)
    private readonly tokenVerifier: AdminAccessTokenVerifier,
    @Inject(ADMIN_AUTHORIZER)
    private readonly authorizer: AuthorizeAdminRequest
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<AdminPermission>(
      REQUIRED_ADMIN_PERMISSION,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedAdminRequest>();
    const accessToken = parseBearerToken(request.headers.authorization);

    if (!accessToken) {
      throw new UnauthorizedException();
    }

    try {
      const token = await this.tokenVerifier.verify(accessToken);
      request.adminActor = await this.authorizer.execute(token, requiredPermission);
      return true;
    } catch (error) {
      if (error instanceof AdminPermissionDeniedError || error instanceof AdminMfaRequiredError) {
        throw new ForbiddenException();
      }
      if (error instanceof AdminAuthenticationError) {
        throw new UnauthorizedException();
      }

      throw new UnauthorizedException();
    }
  }
}

@Module({})
export class AdminAuthorizationModule {
  static register(options: AdminAuthorizationModuleOptions): DynamicModule {
    return {
      module: AdminAuthorizationModule,
      providers: [
        { provide: ADMIN_TOKEN_VERIFIER, useValue: options.tokenVerifier },
        { provide: ADMIN_AUTHORIZER, useValue: options.authorizer },
        AdminAuthorizationGuard,
        { provide: APP_GUARD, useExisting: AdminAuthorizationGuard }
      ]
    };
  }
}

function parseBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(header);
  return match?.[1] ?? null;
}
