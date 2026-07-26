import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminEventProductCodeConflictError,
  AdminEventPricingRuleNotFoundError,
  CreateAdminEventPricingRuleService,
  CreateAdminEventProductService,
  UpdateAdminEventPricingRuleService,
  type AdminEventCatalogManagementRepository
} from "./admin-event-catalog-management.js";
import { InvalidAdminEventMutationError } from "./admin-event-management.js";

describe("administrator event product and pricing management", () => {
  it("normalizes and creates a product under the aggregate version", async () => {
    const captured: unknown[] = [];
    const repository = repositoryStub();
    repository.createProduct = async (input) => {
      captured.push(input);
      return { status: "created", lockVersion: 4 };
    };
    const service = new CreateAdminEventProductService(
      repository,
      idGenerator(PRODUCT_ID, AUDIT_ID)
    );

    const result = await service.execute({
      actor,
      eventId: EVENT_ID,
      expectedLockVersion: 3,
      product: { ...productInput, code: " Adult_Standard ", currency: "rub" },
      reason: "Add standard ticket",
      metadata
    });

    assert.equal(result.resourceId, PRODUCT_ID);
    assert.equal(result.lockVersion, 4);
    const command = captured[0] as {
      readonly product: { readonly code: string; readonly currency: string };
    };
    assert.equal(command.product.code, "adult_standard");
    assert.equal(command.product.currency, "RUB");
  });

  it("creates a bigint-safe simple pricing rule", async () => {
    const captured: unknown[] = [];
    const repository = repositoryStub();
    repository.createPricingRule = async (input) => {
      captured.push(input);
      return { status: "created", lockVersion: 5 };
    };
    const service = new CreateAdminEventPricingRuleService(
      repository,
      idGenerator(PRICING_RULE_ID, AUDIT_ID)
    );

    const result = await service.execute({
      actor,
      eventId: EVENT_ID,
      productId: PRODUCT_ID,
      expectedLockVersion: 4,
      pricingRule: {
        ...pricingInput,
        unitPriceKopecks: "000249000"
      },
      reason: "Add base price",
      metadata
    });

    assert.equal(result.resourceId, PRICING_RULE_ID);
    const command = captured[0] as {
      readonly pricingRule: {
        readonly unitPriceKopecks: string;
        readonly specificity: number;
        readonly conditions: Readonly<Record<string, never>>;
      };
    };
    assert.equal(command.pricingRule.unitPriceKopecks, "249000");
    assert.equal(command.pricingRule.specificity, 0);
    assert.deepEqual(command.pricingRule.conditions, {});
  });

  it("maps catalog conflicts without hiding invalid input", async () => {
    const repository = repositoryStub();
    repository.createProduct = async () => ({
      status: "product_code_conflict"
    });
    const create = new CreateAdminEventProductService(
      repository,
      idGenerator(PRODUCT_ID, AUDIT_ID)
    );
    await assert.rejects(
      create.execute({
        actor,
        eventId: EVENT_ID,
        expectedLockVersion: 2,
        product: productInput,
        reason: "Add product",
        metadata
      }),
      AdminEventProductCodeConflictError
    );

    const update = new UpdateAdminEventPricingRuleService(
      {
        ...repositoryStub(),
        async updatePricingRule() {
          return { status: "pricing_rule_not_found" };
        }
      },
      idGenerator(AUDIT_ID)
    );
    await assert.rejects(
      update.execute({
        actor,
        eventId: EVENT_ID,
        productId: PRODUCT_ID,
        pricingRuleId: PRICING_RULE_ID,
        expectedLockVersion: 2,
        pricingRule: pricingInput,
        reason: "Change price",
        metadata
      }),
      AdminEventPricingRuleNotFoundError
    );
  });

  it("rejects unsupported condition semantics and invalid monetary bounds", async () => {
    const service = new CreateAdminEventPricingRuleService(
      repositoryStub(),
      idGenerator(PRICING_RULE_ID, AUDIT_ID)
    );
    await assert.rejects(
      service.execute({
        actor,
        eventId: EVENT_ID,
        productId: PRODUCT_ID,
        expectedLockVersion: 1,
        pricingRule: {
          ...pricingInput,
          unitPriceKopecks: "9223372036854775808"
        },
        reason: "Invalid price",
        metadata
      }),
      InvalidAdminEventMutationError
    );
  });
});

function repositoryStub(): AdminEventCatalogManagementRepository {
  return {
    async createProduct() {
      return { status: "created", lockVersion: 2 };
    },
    async updateProduct() {
      return { status: "updated", lockVersion: 2 };
    },
    async createPricingRule() {
      return { status: "created", lockVersion: 2 };
    },
    async updatePricingRule() {
      return { status: "updated", lockVersion: 2 };
    }
  };
}

function idGenerator(...ids: string[]) {
  let index = 0;
  return {
    newId() {
      const id = ids[index];
      index += 1;
      assert.ok(id);
      return id;
    }
  };
}

const actor: AdminRequestActor = {
  adminId: "00000000-0000-4000-8000-000000000010",
  authSubject: "auth-1",
  roleCodes: ["content_manager"],
  permission: "events.write"
};

const productInput = {
  code: "adult_standard",
  productType: "adult_standard" as const,
  title: "Standard",
  description: "Adult ticket",
  currency: "RUB",
  bundleComposition: [],
  inventoryUnitsPerItem: 1,
  capacity: 300,
  maximumQuantityPerOrder: 10,
  isActive: true,
  sortOrder: 0
};

const pricingInput = {
  currency: "RUB",
  minimumQuantity: 1,
  maximumQuantity: 2,
  unitPriceKopecks: "249000",
  priority: 10,
  validFrom: "2026-07-01T00:00:00.000Z",
  validUntil: null,
  explanation: "Standard tier",
  isActive: true
};

const metadata = {
  requestId: "request-catalog-1",
  ipAddress: "127.0.0.1",
  userAgent: "admin-web-test",
  occurredAt: new Date("2026-07-26T11:00:00.000Z")
};

const EVENT_ID = "00000000-0000-4000-8000-000000000101";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000201";
const PRICING_RULE_ID = "00000000-0000-4000-8000-000000000301";
const AUDIT_ID = "00000000-0000-4000-8000-000000000901";
