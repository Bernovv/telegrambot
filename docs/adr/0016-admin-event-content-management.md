# ADR 0016: Draft Event Content Management

## Status

Accepted on 2026-07-26.

## Context

Content managers need to assemble event pages before publication without changing published
events, bypassing event-level concurrency control, or introducing unbounded JSON into the
database. Content remains part of the event aggregate and can be edited by multiple administrators
while products and sales are configured.

## Decision

- Add draft-only create and update operations for event content blocks.
- Protect every operation with `events.write`, a human-entered reason, and the event's exact
  `expectedLockVersion`.
- Serialize mutations with the existing `event-sales:<eventId>` transaction advisory lock and an
  event row lock. Increment the aggregate lock version exactly once on success.
- Use the existing additive `event_content_blocks` table; this slice requires no migration.
- Keep content blocks instead of physically deleting them. Operators withdraw a block by setting
  `isVisible` to false.
- Require an event-unique non-negative `sortOrder` and return a conflict instead of silently
  reordering another block.
- Accept only the reviewed block-type enum and store content schema version 1.
- Require `content` to be a JSON object. Bound its serialized size, nesting depth, node count,
  array length, object width, key length, and string length before persistence.
- Append before/after audit data in the same transaction as every mutation.
- Keep published events immutable through these operations. Publication and public rendering
  remain separate reviewed contracts.

## Consequences

- Concurrent or stale writes return HTTP 409 and require the operator to reload the event.
- Ordering changes are explicit and cannot accidentally overwrite another block's position.
- Hide-instead-of-delete behavior preserves operational history.
- Schema-versioned bounded JSON allows several content shapes without accepting arbitrary
  unreviewed payload growth.
- Content templates, media upload, preview rendering, localization, publication, and destructive
  cleanup remain outside this slice.

## Compatibility And Rollback

No migration is introduced. Rollback removes the two handlers, BFF allowlist entries, and editor
route. Existing event, content-block, audit, order, offer, and financial rows remain valid.
