import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  HealthReadinessReport,
  HealthStatus
} from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";

describe("health HTTP contract", () => {
  it("keeps liveness healthy when dependencies have failed", async () => {
    const app = await applicationWithStatus("failed");

    try {
      const response = await inject(app, "/health/live");

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().status, "healthy");
    } finally {
      await app.close();
    }
  });

  it("accepts healthy and degraded readiness without exposing components", async () => {
    for (const status of ["healthy", "degraded"] as const) {
      const app = await applicationWithStatus(status);

      try {
        const response = await inject(app, "/health/ready");

        assert.equal(response.statusCode, 200);
        assert.equal(response.json().status, status);
        assert.equal("components" in response.json(), false);
      } finally {
        await app.close();
      }
    }
  });

  it("returns 503 for failed readiness", async () => {
    const app = await applicationWithStatus("failed");

    try {
      const response = await inject(app, "/health/ready");

      assert.equal(response.statusCode, 503);
      assert.equal(response.json().status, "failed");
    } finally {
      await app.close();
    }
  });
});

async function applicationWithStatus(status: HealthStatus) {
  const app = await createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 262_144,
    readiness: {
      async execute(): Promise<HealthReadinessReport> {
        return {
          service: "api",
          status,
          version: "test",
          checkedAt: "2026-07-23T10:00:00.000Z",
          components: [{
            name: "database",
            status,
            checkedAt: "2026-07-23T10:00:00.000Z",
            latencyMs: 1,
            message: "internal_detail",
            lastSuccessAt: null,
            runbook: "database-connectivity"
          }]
        };
      }
    }
  });
  await app.init();
  return app;
}

async function inject(
  app: Awaited<ReturnType<typeof applicationWithStatus>>,
  url: string
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  return await fastify.inject({ method: "GET", url });
}
