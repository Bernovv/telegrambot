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
  assert.equal(isAllowedAdminApiPath("GET", "broadcasts/audience"), true);
  assert.equal(isAllowedAdminApiPath("GET", "broadcasts"), true);
  // Загрузка картинки — только запись: читать её обратно панели незачем.
  assert.equal(isAllowedAdminApiPath("POST", "broadcast-images"), true);
  assert.equal(isAllowedAdminApiPath("GET", "broadcast-images"), false);
  assert.equal(isAllowedAdminApiPath("GET", "outreach/campaigns"), true);
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "outreach/contacts?campaignId=00000000-0000-4000-8000-000000000101"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/contacts/add"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath("GET", "outreach/campaigns?includeArchived=true"),
    true
  );
  assert.equal(
    isAllowedAdminApiPath("GET", "outreach/campaigns?includeArchived=maybe"),
    false
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/archive"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/restore"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/import-participants"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath("POST", "outreach/campaign-contacts/move"),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/delete"
    ),
    false
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/campaign-contacts/activities"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/import"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "PATCH",
      "outreach/campaign-contacts/00000000-0000-4000-8000-000000000101/stage"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/campaign-contacts/00000000-0000-4000-8000-000000000101/tasks"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "PATCH",
      "outreach/tasks/00000000-0000-4000-8000-000000000101/complete"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/pipeline"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "PATCH",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/pipeline"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/contacts"
    ),
    true
  );
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
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/accommodation"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/accommodation/groups"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/accommodation/groups/split"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/accommodation/plans"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "PATCH",
      "events/00000000-0000-4000-8000-000000000101/accommodation/plans"
    ),
    false
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/participants"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/participants/remove"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "orders/00000000-0000-4000-8000-000000000101/exclude"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "orders/00000000-0000-4000-8000-000000000101/include"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "orders/00000000-0000-4000-8000-000000000101/delete"
    ),
    false
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
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "orders/00000000-0000-4000-8000-000000000101/manual-payment"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/participants/export"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/participants"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/expenses"
    ),
    true
  );
  assert.equal(isAllowedAdminApiPath("POST", "vendors"), true);
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/inventory"
    ),
    true
  );
  assert.equal(isAllowedAdminApiPath("POST", "inventory/items"), true);
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/team"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/team/remove"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/inventory/movements"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/accommodation/private-tent"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "events/00000000-0000-4000-8000-000000000101/expenses/cancel"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/custom-fields"
    ),
    true
  );
  assert.equal(isAllowedAdminApiPath("POST", "outreach/custom-fields"), true);
  assert.equal(
    isAllowedAdminApiPath(
      "POST",
      "outreach/custom-fields/00000000-0000-4000-8000-000000000101/delete"
    ),
    true
  );
  assert.equal(
    isAllowedAdminApiPath(
      "PATCH",
      "outreach/campaign-contacts/00000000-0000-4000-8000-000000000101/custom-fields/00000000-0000-4000-8000-000000000201"
    ),
    true
  );
  assert.equal(isAllowedAdminApiPath("GET", "outreach/tasks/board"), true);
});

test("requires an idempotency key only on money-moving proxy paths", () => {
  assert.equal(
    requiresIdempotencyKey(
      "orders/00000000-0000-4000-8000-000000000101/manual-payment"
    ),
    true
  );
  assert.equal(
    requiresIdempotencyKey(
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/pipeline"
    ),
    false
  );
  assert.equal(isValidIdempotencyKey("a".repeat(20)), true);
  assert.equal(isValidIdempotencyKey(null), false);
  assert.equal(isValidIdempotencyKey("short"), false);
});

test("only the participants export streams as a file download", () => {
  assert.equal(
    isFileDownloadPath(
      "events/00000000-0000-4000-8000-000000000101/participants/export"
    ),
    true
  );
  assert.equal(isFileDownloadPath("outreach/campaigns"), false);
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
  // Сам список участников читать можно, но только его: выдуманные соседние пути прокси
  // пропускать не должен, иначе allowlist перестаёт быть allowlist.
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/participants/all"
    ),
    false
  );
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/not-a-uuid/participants"
    ),
    false
  );
  // Отмена расхода — POST с причиной; читать её как GET прокси пропускать не должен.
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/expenses/cancel"
    ),
    false
  );
  assert.equal(isAllowedAdminApiPath("GET", "vendors"), false);
  assert.equal(
    isAllowedAdminApiPath(
      "GET",
      "events/00000000-0000-4000-8000-000000000101/inventory/movements"
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
  assert.equal(
    getAdminMutationBodyLimit(
      "outreach/campaigns/00000000-0000-4000-8000-000000000101/import"
    ),
    524_288
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
