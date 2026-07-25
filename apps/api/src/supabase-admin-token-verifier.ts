import type {
  AdminAccessTokenVerifier,
  VerifiedAdminToken
} from "@ticket-platform/application";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey
} from "jose";

export interface SupabaseAdminTokenVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
}

export class InvalidAdminAccessTokenError extends Error {
  constructor() {
    super("Invalid administrator access token");
    this.name = "InvalidAdminAccessTokenError";
  }
}

export class SupabaseAdminAccessTokenVerifier implements AdminAccessTokenVerifier {
  private readonly keyResolver: JWTVerifyGetKey;

  constructor(
    private readonly options: SupabaseAdminTokenVerifierOptions,
    keyResolver?: JWTVerifyGetKey
  ) {
    this.keyResolver = keyResolver ?? createRemoteJWKSet(
      new URL(`${options.issuer}/.well-known/jwks.json`)
    );
  }

  async verify(accessToken: string): Promise<VerifiedAdminToken> {
    try {
      const { payload } = await jwtVerify(accessToken, this.keyResolver, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ["ES256", "RS256"]
      });

      if (!payload.sub || !Number.isSafeInteger(payload.iat)) {
        throw new InvalidAdminAccessTokenError();
      }
      if (payload.aal !== undefined && payload.aal !== "aal1" && payload.aal !== "aal2") {
        throw new InvalidAdminAccessTokenError();
      }

      return {
        subject: payload.sub,
        assuranceLevel: payload.aal === "aal2" ? "aal2" : "aal1",
        issuedAt: new Date((payload.iat as number) * 1_000)
      };
    } catch (error) {
      if (error instanceof InvalidAdminAccessTokenError) {
        throw error;
      }

      throw new InvalidAdminAccessTokenError();
    }
  }
}
