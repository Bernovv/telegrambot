# Administrator Event Offer Management Runbook

## Scope

- `GET /api/v1/events/:id` returns offer version history and acceptance counts.
- `POST /api/v1/events/:id/offer-versions` creates and activates a new immutable HTML snapshot.
- `PATCH /api/v1/events/:id/offer/deactivate` removes the active assignment for new orders.
- `/events/:id/offer` exposes these operations for draft events.

The operation does not publish the event. Existing orders retain their pinned
`offer_version_id`, public URL, checksum, and acceptance evidence.

## Storage Provisioning

Provision one public Supabase Storage bucket outside application startup. Restrict upload,
overwrite, move, and delete operations; public access is required only for reading an exact
snapshot URL from Telegram. Configure the API process:

```text
OFFER_STORAGE_ENABLED=true
OFFER_STORAGE_SUPABASE_URL=https://<project>.supabase.co
OFFER_STORAGE_SERVICE_ROLE_KEY=<server-only secret>
OFFER_STORAGE_BUCKET=offer-snapshots
```

Never expose the service-role key through `NEXT_PUBLIC_*`, browser code, logs, Graphify, or source
control. The API uploads with `upsert: false`, a one-year cache setting, and a unique
`offers/<eventId>/<offerVersionId>.html` path.

## Publication Controls

Every publication requires `events.write`, a reason, an exact `expectedLockVersion`, and explicit
operator confirmation. The application accepts a Google Docs HTTPS source or system text source,
but never publishes mutable source content directly.
The same-origin BFF permits up to 256 KiB only for this bounded text publication route; other event
mutations retain their 64 KiB limit.

The API:

1. validates one non-archived offer document for the event;
2. normalizes the approved display text and escapes it into static HTML;
3. adds a restrictive CSP and no user-provided executable markup;
4. calculates SHA-256 over the exact uploaded bytes;
5. uploads the object without overwrite;
6. acquires `event-sales:<eventId>` and locks the event row;
7. rechecks draft state and aggregate version;
8. deactivates only the previous version's routing flag;
9. inserts the immutable version, assigns it to the event, increments the event version once, and
   appends audit in one PostgreSQL transaction.

The database trigger permits changing only `is_active` on an offer version. Content and metadata
cannot be updated or deleted.

## Failure And Recovery

- HTTP 400: correct the source URL, title, revision, reason, or approved text.
- HTTP 409 `ADMIN_EVENT_VERSION_CONFLICT`: reload and review the current event before retrying.
- HTTP 409 `ADMIN_EVENT_OFFER_DOCUMENT_AMBIGUOUS`: do not guess which document is authoritative;
  investigate and repair through a reviewed data-change procedure.
- HTTP 503 `ADMIN_OFFER_STORAGE_UNAVAILABLE`: verify configuration and Storage health without
  printing the service key.
- Storage failure occurs before PostgreSQL mutation and creates no offer version.
- A successful upload followed by a database conflict can leave an unreferenced immutable object.
  It is not reachable from an event or order. Record it for a future reviewed orphan-cleanup job;
  do not delete objects manually during incident response.
- Audit failure rolls back document, version, routing, and event-version changes.

No schema migration or production data repair is part of this slice.
