# Health and Readiness Runbook

## Public Endpoints

- `GET /health/live` reports whether the API process can serve HTTP.
- `GET /health/ready` reports aggregate dependency readiness.
- `GET /health` remains a liveness alias for compatibility.

Railway health checks must use `/health/ready`. A `healthy` or `degraded` aggregate returns
HTTP 200. A `failed`, `unknown`, or `maintenance` aggregate returns HTTP 503.

Public responses contain only `service`, `status`, `version`, and `checkedAt`. Component
messages, timings, and runbook links are available only through the authenticated
`GET /api/v1/operations/health` endpoint with `system.read`.

## Database Connectivity

The database probe runs `SELECT 1`. Check connection limits, network reachability, database
availability, and `DATABASE_URL`. Do not print the connection string or credentials.

## Database Migrations

The migration probe compares the newest row in `supabase_migrations.schema_migrations` with the
newest migration descriptor compiled into the API. Apply only reviewed versioned migrations.
Do not use runtime DDL or destructive repair statements.

## Job Queue

The queue probe requires pg-boss schema version 37, `outbox-dispatch`,
`outbox-dispatch-dead-letter`, and the configured dead-letter link. Regenerate and review the
versioned pg-boss migration if the pinned library version changes.

## Worker Heartbeat

The newest outbox worker heartbeat is healthy through 30 seconds, degraded after 30 seconds,
and failed after 60 seconds by default. Check worker process state and logs before redeploying.
Do not mutate heartbeat rows manually.

## Outbox Lag

The oldest unprocessed outbox event is healthy through 60 seconds, degraded after 60 seconds,
and failed after 300 seconds by default. Inspect worker and pg-boss health before retrying.
Never delete outbox events to make the check green.

## Probe Failure

An exception is reduced to the safe `probe_failed` message. Correlate the timestamp with
structured API logs; raw database errors and secrets are intentionally absent from health
responses.

## Deferred Checks

Synthetic queue roundtrip, object-storage safety checks, Telegram safe checks, and pool
saturation remain separate implementation slices.
