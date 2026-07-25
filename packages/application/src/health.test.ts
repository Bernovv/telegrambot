import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HealthProbe } from "./health.js";
import {
  GetReadinessService,
  isReadyStatus
} from "./health.js";

describe("GetReadinessService", () => {
  it("aggregates successful probes into a healthy report", async () => {
    const service = new GetReadinessService(
      "api",
      "test",
      [probe("database", "healthy"), probe("worker", "healthy")],
      fixedClock()
    );

    const report = await service.execute();

    assert.equal(report.status, "healthy");
    assert.deepEqual(report.components.map((component) => component.name), [
      "database",
      "worker"
    ]);
    assert.equal(report.components[0]?.lastSuccessAt, "2026-07-23T10:00:00.000Z");
  });

  it("uses the most severe component status", async () => {
    const degraded = new GetReadinessService(
      "api",
      "test",
      [probe("database", "healthy"), probe("outbox", "degraded")],
      fixedClock()
    );
    const failed = new GetReadinessService(
      "api",
      "test",
      [probe("outbox", "degraded"), probe("worker", "failed")],
      fixedClock()
    );

    assert.equal((await degraded.execute()).status, "degraded");
    assert.equal((await failed.execute()).status, "failed");
    assert.equal(isReadyStatus("degraded"), true);
    assert.equal(isReadyStatus("failed"), false);
  });

  it("sanitizes probe exceptions", async () => {
    const service = new GetReadinessService(
      "api",
      "test",
      [{
        name: "database",
        async check() {
          throw new Error("postgresql://secret@production");
        }
      }],
      fixedClock()
    );

    const report = await service.execute();

    assert.equal(report.status, "failed");
    assert.equal(report.components[0]?.message, "probe_failed");
    assert.equal(report.components[0]?.lastSuccessAt, null);
  });
});

function probe(name: string, status: "healthy" | "degraded" | "failed"): HealthProbe {
  return {
    name,
    async check() {
      return { status, message: `${name}_${status}`, runbook: `${name}-health` };
    }
  };
}

function fixedClock() {
  return {
    now: () => new Date("2026-07-23T10:00:00.000Z")
  };
}
