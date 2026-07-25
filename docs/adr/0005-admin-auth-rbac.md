# ADR 0005: Administrator Authentication and RBAC

## Status

Accepted for the Phase 1 foundation.

## Context

The administrator API requires OIDC or Supabase Auth, deny-by-default permissions, MFA for
financial roles, session revocation, and an audit trail. Authorization must remain effective in
the application layer even when a transport guard is omitted or misconfigured.

## Decision

- Verify administrator access tokens with asymmetric `ES256` or `RS256` keys from the configured
  issuer JWKS endpoint.
- Validate issuer, audience, expiry, subject, issued-at time, and Supabase `aal`.
- Do not support the legacy shared JWT secret in the API runtime.
- Resolve administrator status, active role grants, permissions, MFA policy, and local session
  revocation from PostgreSQL for every protected request.
- Require `aal2` for MFA roles and for sensitive permissions even if role configuration is wrong.
- Enforce permission checks in the application service; the Nest guard is only the HTTP adapter.
- Register operations routes only when administrator authentication is configured.
- Keep `audit_log` append-only at the database boundary.

## Consequences

Access-token verification does not place Supabase Auth in the hot path after JWKS caching.
Permission changes and account suspension take effect without waiting for token expiry. Database
availability is required for administrator requests. The first super administrator is created by
a separately invoked, advisory-locked, audited transaction and is never embedded in a migration.
