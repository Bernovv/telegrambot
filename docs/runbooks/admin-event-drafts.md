# Administrator Event Draft Management Runbook

## Scope

- `POST /api/v1/events` creates a draft and requires `events.write`.
- `PATCH /api/v1/events/:id/general` updates general settings and requires `events.write`.
- `POST /api/v1/events/:id/products` creates a product.
- `PATCH /api/v1/events/:id/products/:productId` updates or deactivates a product.
- `POST /api/v1/events/:id/products/:productId/pricing-rules` creates a simple price rule.
- `PATCH /api/v1/events/:id/products/:productId/pricing-rules/:pricingRuleId` updates or
  deactivates a simple price rule.
- `POST /api/v1/events/:id/content-blocks` creates a content block.
- `PATCH /api/v1/events/:id/content-blocks/:contentBlockId` updates or hides a content block.
- `POST /api/v1/events/:id/offer-versions` publishes and activates an immutable offer snapshot.
- `PATCH /api/v1/events/:id/offer/deactivate` withdraws the current offer from new orders.
- `POST /api/v1/events/:id/publish` validates the complete sales setup and opens the event.
- `/events/new` and `/events/:id/edit` expose these operations in the administrator UI.
- `/events/:id/catalog` exposes draft product and pricing management.
- `/events/:id/content` exposes draft content-block management.
- `/events/:id/offer` exposes offer history, publication, and withdrawal.

Only the explicit `/publish` operation publishes an event. None of these endpoints changes
existing orders or financial records. Only an event whose current status is `draft` can be
updated or published.

## Required Controls

Every request includes a reason from 3 through 500 characters. Updates also include the exact
`expectedLockVersion` returned by the event detail read. Timestamps use RFC 3339 with an explicit
offset; `timezone` is a valid IANA timezone used for display.

General, product, pricing, content-block, and offer-assignment updates use the same event aggregate
transaction:

1. acquires the `event-sales:<eventId>` advisory lock where an event already exists;
2. locks the event row and validates draft state and lock version;
3. validates slug, product-code, product ownership, pricing ownership, content-block ownership,
   unique content order, and currency invariants;
4. creates or updates the requested resource and increments the event lock version once;
5. appends the corresponding event, product, pricing, content, or offer action to `audit_log`;
6. commits.

Audit records contain administrator ID and roles, reason, request ID, API-observed IP, user agent,
and masked before/after configuration. `audit_log` remains append-only.

Publication requires `events.publish` and uses the same aggregate lock. It fails atomically unless
the draft has a title, start date, support contact, at least one active product, an active pricing
rule for every active product, a published scenario, and an active offer when
`offerRequired=true`. A zero-priced active rule is valid because the internal zero-due
confirmation path issues tickets without T-Bank. Success sets `status=published`, `published_at`,
increments `lock_version`, and appends `event.published` in one transaction.

Products and pricing rules are never physically deleted through the API. Set `isActive` to false
to withdraw them. Prices are integer-kopeck strings at the API boundary; the administrator form
converts rubles with `BigInt` arithmetic. This slice supports quantity bounds, validity dates,
priority, and unit price. Conditional rule predicates are not accepted.

Content blocks are never physically deleted through the API. Set `isVisible` to false to withdraw
one while preserving history. Each block uses content schema version 1, one of the reviewed block
types, and an event-unique `sortOrder`. `content` must be a JSON object no larger than 50,000
serialized characters, 12 nested levels, and 2,000 total nodes. The application also bounds array
length, object width, key length, and string length before persistence.

## Browser Boundary

The Next.js BFF permits only the event, publication, product, pricing, and content-block paths
listed in Scope plus the offer paths listed in Scope. Mutations require:

- an exact same-origin `Origin`;
- `Content-Type: application/json`;
- a body no larger than 64 KiB, except the bounded offer publication body, which is limited to
  256 KiB;
- a valid Supabase administrator session.

The Nest API remains authoritative for RBAC and input validation.

## Failure And Recovery

- HTTP 400: correct fields, RFC 3339 timestamps, timezone, or numeric bounds.
- HTTP 401: renew the Supabase administrator session.
- HTTP 403: grant the reviewed `events.write` permission; do not bypass the API.
- HTTP 409 `ADMIN_EVENT_SLUG_CONFLICT`: choose another slug.
- HTTP 409 `ADMIN_EVENT_PRODUCT_CODE_CONFLICT`: choose another product code within the event.
- HTTP 409 `ADMIN_EVENT_CONTENT_SORT_ORDER_CONFLICT`: choose another content-block position.
- HTTP 409 `ADMIN_EVENT_OFFER_DOCUMENT_AMBIGUOUS`: inspect duplicate non-archived offer documents
  read-only before any repair.
- HTTP 409 `ADMIN_EVENT_OFFER_NOT_ACTIVE`: reload the offer history; it was already withdrawn.
- HTTP 409 `ADMIN_EVENT_VERSION_CONFLICT`: reload the detail, review the newer values, and reapply
  the intended change with a new reason.
- HTTP 409 `ADMIN_EVENT_NOT_DRAFT`: use a future reviewed lifecycle operation; never change status
  or event data with ad hoc SQL.
- HTTP 422 `ADMIN_EVENT_PUBLICATION_REQUIREMENTS_FAILED`: reload the event and correct every
  returned publication issue. Never force the status with ad hoc SQL.
- HTTP 404 for a product, pricing rule, or content block: reload the editor and verify the resource
  belongs to the current event.
- HTTP 503 `ADMIN_OFFER_STORAGE_UNAVAILABLE`: verify the feature flag, server-only credentials,
  public bucket, upload policy, and Supabase Storage health before retrying.
- HTTP 500 during audit persistence: the transaction is rolled back. Verify the audit table and
  database logs read-only before retrying.

No migration or production data repair is part of this slice.
