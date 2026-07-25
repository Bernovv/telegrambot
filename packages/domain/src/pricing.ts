import type { MoneyKopecks } from "./index.js";

export interface RelatedPricingItem {
  readonly productType: string;
  readonly quantity: number;
}

export interface PricingInput {
  readonly eventId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly relatedItems: readonly RelatedPricingItem[];
  readonly userId: string;
  readonly timestamp: Date;
  readonly currency: string;
  readonly maximumQuantity: number;
}

export interface PricingRule {
  readonly id: string;
  readonly productId: string;
  readonly currency: string;
  readonly unitPrice: MoneyKopecks;
  readonly priority: number;
  readonly specificity: number;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number | null;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
  readonly explanation: string;
}

export interface PricingSnapshot {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly relatedItems: readonly RelatedPricingItem[];
  readonly userId: string;
  readonly currency: string;
  readonly unitPriceKopecks: string;
  readonly lineTotalKopecks: string;
  readonly appliedRuleId: string;
  readonly pricedAt: string;
}

export interface PricingResult {
  readonly unitPrice: MoneyKopecks;
  readonly lineTotal: MoneyKopecks;
  readonly appliedRuleId: string;
  readonly explanation: string;
  readonly snapshot: PricingSnapshot;
}

export class PricingRuleConflictError extends Error {
  constructor(readonly ruleIds: readonly string[]) {
    super(`Conflicting pricing rules: ${ruleIds.join(", ")}`);
    this.name = "PricingRuleConflictError";
  }
}

export function calculatePrice(
  input: PricingInput,
  rules: readonly PricingRule[]
): PricingResult {
  validatePricingInput(input);

  const matchingRules = rules
    .filter((rule) => matchesPricingInput(rule, input))
    .sort(comparePricingRules);
  const selectedRule = matchingRules[0];

  if (!selectedRule) {
    throw new Error(`No pricing rule matches product ${input.productId}`);
  }

  const equallyRankedRules = matchingRules.filter(
    (rule) => compareRuleRank(rule, selectedRule) === 0
  );
  if (equallyRankedRules.length > 1) {
    throw new PricingRuleConflictError(equallyRankedRules.map((rule) => rule.id).sort());
  }

  const lineTotal = selectedRule.unitPrice * BigInt(input.quantity);

  return {
    unitPrice: selectedRule.unitPrice,
    lineTotal,
    appliedRuleId: selectedRule.id,
    explanation: selectedRule.explanation,
    snapshot: {
      schemaVersion: 1,
      eventId: input.eventId,
      productId: input.productId,
      quantity: input.quantity,
      relatedItems: input.relatedItems,
      userId: input.userId,
      currency: input.currency,
      unitPriceKopecks: selectedRule.unitPrice.toString(),
      lineTotalKopecks: lineTotal.toString(),
      appliedRuleId: selectedRule.id,
      pricedAt: input.timestamp.toISOString()
    }
  };
}

function validatePricingInput(input: PricingInput): void {
  if (
    !Number.isSafeInteger(input.quantity)
    || input.quantity < 1
    || !Number.isSafeInteger(input.maximumQuantity)
    || input.maximumQuantity < 1
    || input.quantity > input.maximumQuantity
  ) {
    throw new Error("Quantity is outside the allowed product range");
  }

  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error("Currency must be an ISO 4217 uppercase code");
  }

  for (const item of input.relatedItems) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 0) {
      throw new Error("Related item quantity must be a non-negative integer");
    }
  }
}

function matchesPricingInput(rule: PricingRule, input: PricingInput): boolean {
  return rule.productId === input.productId
    && rule.currency === input.currency
    && input.quantity >= rule.minimumQuantity
    && (rule.maximumQuantity === null || input.quantity <= rule.maximumQuantity)
    && (rule.validFrom === null || rule.validFrom <= input.timestamp)
    && (rule.validUntil === null || rule.validUntil > input.timestamp);
}

function comparePricingRules(left: PricingRule, right: PricingRule): number {
  const rank = compareRuleRank(left, right);
  return rank !== 0 ? rank : left.id.localeCompare(right.id);
}

function compareRuleRank(left: PricingRule, right: PricingRule): number {
  return right.priority - left.priority
    || right.specificity - left.specificity
    || dateRank(right.validFrom) - dateRank(left.validFrom);
}

function dateRank(value: Date | null): number {
  return value?.getTime() ?? Number.MIN_SAFE_INTEGER;
}
