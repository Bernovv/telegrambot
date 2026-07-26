# Administrator Read Operations Runbook

## Endpoints

- `GET /api/v1/users` requires `users.read`.
- `GET /api/v1/users/:id` requires `users.read`.
- `GET /api/v1/orders` requires `orders.read`.
- `GET /api/v1/orders/:id` requires `orders.read`.
- `GET /api/v1/events` requires `events.read`.
- `GET /api/v1/events/:id` requires `events.read`.

All endpoints require the configured administrator bearer token. Role-level MFA policy still
applies. List filters are strict; unknown fields return HTTP 400.

## Web Administrator UI

`apps/admin-web` uses Supabase Auth and never stores a bearer token in application state. Its
same-origin `/admin-api/*` route validates the current Supabase user, reads the short-lived session
token server-side, and forwards only allowlisted GET requests to `ADMIN_API_BASE_URL`.

Required build/runtime configuration:

```text
NEXT_PUBLIC_SUPABASE_URL=<trusted Supabase project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<public browser key>
ADMIN_API_BASE_URL=<private or trusted API origin>
```

The publishable key is intentionally browser-visible and is not a service-role secret. Never put a
Supabase service-role key, database URL, T-Bank password, or Telegram token in a `NEXT_PUBLIC_*`
variable. In local development, keep the values in ignored `apps/admin-web/.env.local`.

The currently implemented UI routes are `/login`, `/events`, `/events/new`, `/events/:id`,
`/events/:id/edit`, `/users`, `/users/:id`, `/orders`, and `/orders/:id`. Event draft mutation
operations are documented separately in `docs/runbooks/admin-event-drafts.md`. A 401 sends the
operator back through authentication on the next navigation. A 403 means the authenticated
account lacks the exact API permission or required assurance level.

## Pagination

Lists accept `limit` from 1 through 100 and an opaque `cursor`. Do not parse or modify the cursor
in clients. Send the returned `nextCursor` unchanged with the same filters.

User filters:

```text
search=<display-name|telegram-username|telegram-id|phone>
blocked=true|false
cursor=<opaque>
limit=25
```

Order filters:

```text
search=<order-number|display-name|telegram-username|telegram-id>
status=<order-status>
userId=<uuid>
eventId=<uuid>
cursor=<opaque>
limit=25
```

Event filters:

```text
search=<title|slug|location>
status=<event-status>
cursor=<opaque>
limit=25
```

Event timestamps leave the API in UTC and are rendered in the event's configured IANA timezone.
Capacity values distinguish active reservations from consumed inventory. Paid-order counts include
orders that were later partially or fully refunded because they represent orders that reached a
paid state.

Normal reads return masked phone values. Use a future reviewed export operation with
`contacts.export` for raw contact data.

## Failure And Recovery

- HTTP 400: remove unknown filters and restart from the first page if the cursor is malformed.
- HTTP 401: verify the OIDC issuer, audience, bearer token, and local session revocation.
- HTTP 403: verify active role grants and the exact read permission.
- HTTP 404: the record is missing, deleted, or outside the normal read projection.
- HTTP 500 with an invalid timestamp/count message: stop retries and inspect schema/data
  invariants read-only.
- Slow list query: reduce `limit`, narrow filters, inspect the PostgreSQL plan in staging, and add
  a reviewed versioned index if needed. Do not add runtime DDL.

These endpoints are diagnostic and operational reads. Never repair event, product, price, user,
order, wallet, payment, or ticket state with ad hoc SQL.
