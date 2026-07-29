import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PricingRuleConflictError,
  calculatePrice,
  type PricingInput,
  type PricingRule
} from "./pricing.js";

const pricedAt = new Date("2026-07-24T12:00:00.000Z");

describe("calculatePrice", () => {
  it("prices two Standard adults at 2490 RUB per person", () => {
    const result = calculatePrice(input("standard", 2), standardRules);

    assert.equal(result.unitPrice, 249_000n);
    assert.equal(result.lineTotal, 498_000n);
    assert.equal(result.appliedRuleId, "standard-1-2");
    assert.equal(result.snapshot.unitPriceKopecks, "249000");
  });

  it("prices three Standard adults independently from child quantity", () => {
    const adultResult = calculatePrice(
      {
        ...input("standard", 3),
        relatedItems: [{ productType: "child", quantity: 2 }]
      },
      standardRules
    );
    const childResult = calculatePrice(input("child", 2), childRules);

    assert.equal(adultResult.unitPrice, 199_000n);
    assert.equal(adultResult.lineTotal, 597_000n);
    assert.equal(childResult.unitPrice, 49_000n);
    assert.equal(childResult.lineTotal, 98_000n);
  });

  it("preserves an explicit zero-price rule for a free product", () => {
    const result = calculatePrice(
      input("standard", 1),
      [rule({ id: "free", unitPrice: 0n })]
    );

    assert.equal(result.unitPrice, 0n);
    assert.equal(result.lineTotal, 0n);
    assert.equal(result.snapshot.unitPriceKopecks, "0");
  });

  it("uses priority, specificity, valid-from, then deterministic ID ordering", () => {
    const result = calculatePrice(input("standard", 1), [
      rule({ id: "old", priority: 10, specificity: 1, validFrom: new Date("2026-01-01"), unitPrice: 250_000n }),
      rule({ id: "specific", priority: 10, specificity: 2, validFrom: new Date("2025-01-01"), unitPrice: 249_000n }),
      rule({ id: "priority", priority: 20, specificity: 0, validFrom: null, unitPrice: 245_000n })
    ]);

    assert.equal(result.appliedRuleId, "priority");
  });

  it("rejects equally ranked matching rules as a configuration conflict", () => {
    assert.throws(
      () => calculatePrice(input("standard", 1), [
        rule({ id: "rule-b", unitPrice: 249_000n }),
        rule({ id: "rule-a", unitPrice: 248_000n })
      ]),
      (error: unknown) => {
        assert.ok(error instanceof PricingRuleConflictError);
        assert.deepEqual(error.ruleIds, ["rule-a", "rule-b"]);
        return true;
      }
    );
  });

  it("rejects quantities above the server-side product limit", () => {
    assert.throws(
      () => calculatePrice({ ...input("standard", 6), maximumQuantity: 5 }, standardRules),
      /outside the allowed product range/
    );
  });
});

function input(productId: string, quantity: number): PricingInput {
  return {
    eventId: "event-1",
    productId,
    quantity,
    relatedItems: [],
    userId: "user-1",
    timestamp: pricedAt,
    currency: "RUB",
    maximumQuantity: 10
  };
}

function rule(overrides: Partial<PricingRule>): PricingRule {
  return {
    id: "rule",
    productId: "standard",
    currency: "RUB",
    unitPrice: 249_000n,
    priority: 10,
    specificity: 1,
    minimumQuantity: 1,
    maximumQuantity: 2,
    validFrom: null,
    validUntil: null,
    explanation: "Standard price",
    ...overrides
  };
}

const standardRules: readonly PricingRule[] = [
  rule({ id: "standard-1-2", minimumQuantity: 1, maximumQuantity: 2, unitPrice: 249_000n }),
  rule({ id: "standard-3-4", minimumQuantity: 3, maximumQuantity: 4, unitPrice: 199_000n }),
  rule({ id: "standard-5-plus", minimumQuantity: 5, maximumQuantity: null, unitPrice: 171_000n })
];

const childRules: readonly PricingRule[] = [
  rule({
    id: "child",
    productId: "child",
    minimumQuantity: 1,
    maximumQuantity: null,
    unitPrice: 49_000n
  })
];
