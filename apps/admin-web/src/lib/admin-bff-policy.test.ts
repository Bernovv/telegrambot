import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminMutationBodyLimit,
  isAllowedAdminApiPath,
  isFileDownloadPath,
  isTrustedMutationOrigin,
  isValidIdempotencyKey,
  requiresIdempotencyKey
} from "./admin-bff-policy";

test("allowlists only implemented administrator API methods and paths", () => {
  assert.equal(isAllowedAdminApiPath("GET", "events"), true);
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/publish"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/scenario-drafts"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/scenario-versions/00000000-0000-4000-8000-000000000701/publish"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/offer-versions"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "PATCH",
      "events/00000000-0000-4000-8000-000000000101/offer/deactivate"
    ),
    true
  );
  assert.equal(isAllowedAdminApiPath("POST", "events"), true);
  assert.equal(
    isAllowedAdminApiPath(
      "PATCH",
      "events/00000000-0000-4000-8000-000000000101/general"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/products"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/content-blocks"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "PATCH",
      "events/00000000-0000-4000-8000-000000000101/content-blocks/00000000-0000-4000-8000-000000000401"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "PATCH",
      "events/00000000-0000-4000-8000-000000000101/products/00000000-0000-4000-8000-000000000201/pricing-rules/00000000-0000-4000-8000-000000000301"
    ),
    true
  );
  assert.equal(isAllowedAdminApiPath("POST", "orders"), false);
  assert.equal(isAllowedAdminApiPath("PATCH", "events/all/general"), false);
});

test("allowlists the operational endpoints backing the administrator screens", () => {
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "orders/00000000-0000-4000-8000-000000000501/manual-payment"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "orders/00000000-0000-4000-8000-000000000501/refunds/full"
    ),
    true
  );
  assert.equal(isAllowedAdminApiPath("POST", "broadcasts"), true);
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/participants/export"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath("POST", "orders/all/manual-payment"),
    false
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "orders/00000000-0000-4000-8000-000000000501/refunds/partial"
    ),
    false
  );
  assert.equal(isAllowedAdminApiPath("PATCH", "broadcasts"), false);
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/participants"
    ),
    false
  );
});

test("demands a forwardable idempotency key for money-moving requests only", () => {
  assert.equal(
    requiresIdempotencyKey(
      "orders/00000000-0000-4000-8000-000000000501/manual-payment"
    ),
    true
  );
  assert.equal(
    requiresIdempotencyKey(
      "orders/00000000-0000-4000-8000-000000000501/refunds/full"
    ),
    true
  );
  assert.equal(requiresIdempotencyKey("broadcasts"), false);
  assert.equal(requiresIdempotencyKey("events"), false);

  assert.equal(isValidIdempotencyKey("manual-payment:2026-08-01:abc123"), true);
  assert.equal(isValidIdempotencyKey("short"), false);
  assert.equal(isValidIdempotencyKey("has spaces in it"), false);
  assert.equal(isValidIdempotencyKey("a".repeat(201)), false);
  assert.equal(isValidIdempotencyKey(null), false);
});

test("marks only the participants export as a file download", () => {
  assert.equal(
    isFileDownloadPath(
      "events/00000000-0000-4000-8000-000000000101/participants/export"
    ),
    true
  );
  assert.equal(
    isFileDownloadPath("events/00000000-0000-4000-8000-000000000101"),
    false
  );
});

test("allows a larger body only for bounded document and graph payloads", () => {
  assert.equal(
    getAdminMutationBodyLimit(
      "events/00000000-0000-4000-8000-000000000101/offer-versions"
    ),
    262_144
  );
  assert.equal(
    getAdminMutationBodyLimit(
      "events/00000000-0000-4000-8000-000000000101/scenario-drafts"
    ),
    262_144
  );
  assert.equal(
    getAdminMutationBodyLimit(
      "events/00000000-0000-4000-8000-000000000101/content-blocks"
    ),
    65_536
  );
});

test("requires an exact same-origin mutation request", () => {
  assert.equal(
    isTrustedMutationOrigin(
      "https://admin.example.com",
      "https://admin.example.com/events"
    ),
    true
  );
  assert.equal(
    isTrustedMutationOrigin(
      "https://attacker.example",
      "https://admin.example.com/events"
    ),
    false
  );
  assert.equal(isTrustedMutationOrigin(null, "https://admin.example.com"), false);
});
