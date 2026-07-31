import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planTents, type AccommodationParty } from "./accommodation.js";

const CAPACITIES = [2, 3];

function party(key: string, berths: number, merged = false): AccommodationParty {
  return {
    key,
    berths,
    title: `Компания ${key}`,
    orderNumbers: [key],
    merged
  };
}

function tentsFor(berths: number): readonly number[] {
  const [allocation] = planTents([party("a", berths)], CAPACITIES).allocations;
  assert.ok(allocation);
  return allocation.tents;
}

describe("planTents", () => {
  it("selects the packing with no empty berths where one exists", () => {
    assert.deepEqual(tentsFor(2), [2]);
    assert.deepEqual(tentsFor(3), [3]);
    assert.deepEqual(tentsFor(5), [3, 2]);
    assert.deepEqual(tentsFor(6), [3, 3]);
  });

  it("does not take the greedy largest-first packing when it wastes a berth", () => {
    // Жадный выбор дал бы 3+2 с пустым местом, правильный ответ — 2+2.
    assert.deepEqual(tentsFor(4), [2, 2]);
  });

  it("prefers fewer tents when several packings waste nothing", () => {
    // 8 мест это и 3+3+2, и 2+2+2+2 — берём то, где палаток меньше.
    assert.deepEqual(tentsFor(8), [3, 3, 2]);
  });

  it("gives a lone guest their own tent and counts the empty berth", () => {
    const plan = planTents([party("solo", 1)], CAPACITIES);
    const [allocation] = plan.allocations;

    assert.ok(allocation);
    assert.deepEqual(allocation.tents, [2]);
    assert.equal(allocation.emptyBerths, 1);
    assert.equal(plan.singles.length, 1);
  });

  it("never merges strangers on its own", () => {
    const plan = planTents(
      [party("one", 1), party("two", 1), party("three", 1)],
      CAPACITIES
    );

    assert.equal(plan.totalTents, 3);
    assert.equal(plan.singles.length, 3);
  });

  it("suggests how many tents merging the singles would save", () => {
    const plan = planTents(
      [party("one", 1), party("two", 1), party("three", 1)],
      CAPACITIES
    );

    assert.deepEqual(plan.mergeSuggestion, {
      singleParties: 3,
      tentsNow: 3,
      tentsIfMerged: 1
    });
  });

  it("keeps quiet about merging when there is nothing to gain", () => {
    assert.equal(planTents([party("one", 1)], CAPACITIES).mergeSuggestion, null);
    assert.equal(
      planTents([party("one", 1), party("two", 4)], CAPACITIES).mergeSuggestion,
      null
    );
  });

  it("totals tents, berths, and waste across parties", () => {
    const plan = planTents(
      [party("family", 3), party("pair", 2), party("solo", 1)],
      CAPACITIES
    );

    assert.deepEqual(plan.tents, [
      { capacity: 3, count: 1 },
      { capacity: 2, count: 2 }
    ]);
    assert.equal(plan.totalTents, 3);
    assert.equal(plan.requiredBerths, 6);
    assert.equal(plan.plannedBerths, 7);
    assert.equal(plan.emptyBerths, 1);
  });

  it("ignores parties that need no sleeping place", () => {
    const plan = planTents([party("daytime", 0)], CAPACITIES);

    assert.deepEqual(plan.allocations[0]?.tents, []);
    assert.equal(plan.totalTents, 0);
    assert.equal(plan.singles.length, 0);
  });

  it("uses whatever tent sizes it is given", () => {
    assert.deepEqual(planTents([party("a", 4)], [4]).allocations[0]?.tents, [4]);
    assert.deepEqual(planTents([party("a", 7)], [4, 3]).allocations[0]?.tents, [4, 3]);
  });

  it("rejects a plan with no tents to hand out", () => {
    assert.throws(() => planTents([party("a", 2)], []), /tent capacity is required/);
  });

  it("rejects a negative party size", () => {
    assert.throws(
      () => planTents([party("a", -1)], CAPACITIES),
      /non-negative integer/
    );
  });
});
