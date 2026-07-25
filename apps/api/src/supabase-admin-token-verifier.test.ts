import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT
} from "jose";
import {
  InvalidAdminAccessTokenError,
  SupabaseAdminAccessTokenVerifier
} from "./supabase-admin-token-verifier.js";

const issuer = "https://project.supabase.co/auth/v1";
const audience = "authenticated";

describe("SupabaseAdminAccessTokenVerifier", () => {
  it("verifies an asymmetric token and maps Supabase MFA assurance", async () => {
    const fixture = await jwtFixture();
    const verifier = new SupabaseAdminAccessTokenVerifier(
      { issuer, audience },
      fixture.keyResolver
    );
    const token = await fixture.sign({ aal: "aal2" });

    const result = await verifier.verify(token);

    assert.deepEqual(result, {
      subject: "auth-subject",
      assuranceLevel: "aal2",
      issuedAt: new Date("2026-07-23T10:00:00.000Z")
    });
  });

  it("rejects the wrong audience and unsupported assurance claims", async () => {
    const fixture = await jwtFixture();
    const verifier = new SupabaseAdminAccessTokenVerifier(
      { issuer, audience },
      fixture.keyResolver
    );

    await assert.rejects(
      verifier.verify(await fixture.sign({ audience: "other" })),
      InvalidAdminAccessTokenError
    );
    await assert.rejects(
      verifier.verify(await fixture.sign({ aal: "aal3" })),
      InvalidAdminAccessTokenError
    );
  });
});

async function jwtFixture() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  const keyResolver = createLocalJWKSet({
    keys: [{ ...publicJwk, alg: "ES256", kid: "test-key", use: "sig" }]
  });

  return {
    keyResolver,
    async sign(options: { readonly aal?: string; readonly audience?: string }) {
      const token = new SignJWT({
        aal: options.aal,
        role: "authenticated"
      })
        .setProtectedHeader({ alg: "ES256", kid: "test-key" })
        .setIssuer(issuer)
        .setAudience(options.audience ?? audience)
        .setSubject("auth-subject")
        .setIssuedAt(new Date("2026-07-23T10:00:00.000Z"))
        .setExpirationTime(new Date("2030-07-23T10:00:00.000Z"));

      return token.sign(privateKey);
    }
  };
}
