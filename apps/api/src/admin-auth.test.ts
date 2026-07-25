import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminMfaRequiredError,
  AdminPermissionDeniedError,
  type AdminAccessTokenVerifier,
  type AuthorizeAdminRequest
} from "@ticket-platform/application";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";

describe("admin authorization HTTP contract", () => {
  it("requires a bearer token for the operations API", async () => {
    const app = await testApplication(verifier(), authorizer());

    try {
      const response = await inject(app);

      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it("returns component health to an authorized system reader", async () => {
    const app = await testApplication(verifier(), authorizer());

    try {
      const response = await inject(app, "Bearer valid-token");

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().status, "healthy");
      assert.equal(response.json().components[0].name, "database");
    } finally {
      await app.close();
    }
  });

  it("maps permission and MFA denial to forbidden", async () => {
    for (const error of [
      new AdminPermissionDeniedError(),
      new AdminMfaRequiredError()
    ]) {
      const app = await testApplication(verifier(), authorizer(error));

      try {
        const response = await inject(app, "Bearer valid-token");
        assert.equal(response.statusCode, 403);
      } finally {
        await app.close();
      }
    }
  });

  it("does not register operations routes when admin auth is disabled", async () => {
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness: readiness()
    });
    await app.init();

    try {
      const response = await inject(app, "Bearer anything");
      assert.equal(response.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

async function testApplication(
  tokenVerifier: AdminAccessTokenVerifier,
  adminAuthorizer: AuthorizeAdminRequest
) {
  const app = await createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 262_144,
    readiness: readiness(),
    adminAuth: {
      tokenVerifier,
      authorizer: adminAuthorizer
    }
  });
  await app.init();
  return app;
}

function verifier(): AdminAccessTokenVerifier {
  return {
    async verify(accessToken) {
      assert.equal(accessToken, "valid-token");
      return {
        subject: "auth-subject",
        assuranceLevel: "aal2",
        issuedAt: new Date("2026-07-23T10:00:00.000Z")
      };
    }
  };
}

function authorizer(error?: Error): AuthorizeAdminRequest {
  return {
    async execute(_token, permission) {
      if (error) {
        throw error;
      }

      return {
        adminId: "admin-id",
        authSubject: "auth-subject",
        roleCodes: ["technical_admin"],
        permission
      };
    }
  };
}

function readiness() {
  return {
    async execute() {
      return {
        service: "api",
        status: "healthy" as const,
        version: "test",
        checkedAt: "2026-07-23T10:00:00.000Z",
        components: [{
          name: "database",
          status: "healthy" as const,
          checkedAt: "2026-07-23T10:00:00.000Z",
          latencyMs: 1,
          message: "database_reachable",
          lastSuccessAt: "2026-07-23T10:00:00.000Z",
          runbook: "docs/runbooks/health-readiness.md#database-connectivity"
        }]
      };
    }
  };
}

async function inject(
  app: Awaited<ReturnType<typeof testApplication>>,
  authorization?: string
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  return fastify.inject({
    method: "GET",
    url: "/api/v1/operations/health",
    headers: authorization ? { authorization } : {}
  });
}
