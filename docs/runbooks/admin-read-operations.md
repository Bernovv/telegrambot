# Administrator Read Operations Runbook

## Endpoints

- `GET /api/v1/users` requires `users.read`.
- `GET /api/v1/users/:id` requires `users.read`.
- `GET /api/v1/orders` requires `orders.read`.
- `GET /api/v1/orders/:id` requires `orders.read`.

All endpoints require the configured administrator bearer token. Role-level MFA policy still
applies. List filters are strict; unknown fields return HTTP 400.

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

These endpoints are diagnostic and operational reads. Never repair user, order, wallet, payment,
or ticket state with ad hoc SQL.
