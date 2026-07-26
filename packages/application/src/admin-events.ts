import {
  ADMIN_EVENT_STATUSES,
  type AdminEventDetail,
  type AdminEventStatus,
  type AdminEventSummary,
  type AdminRequestActor,
  type CursorPage
} from "@ticket-platform/contracts";

export interface AdminEventPageCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

export interface AdminEventsRepository {
  listEvents(input: {
    readonly search: string | null;
    readonly status: AdminEventStatus | null;
    readonly cursor: AdminEventPageCursor | null;
    readonly limit: number;
  }): Promise<readonly AdminEventSummary[]>;
  getEvent(eventId: string): Promise<AdminEventDetail | null>;
}

export class ListAdminEventsService {
  constructor(private readonly repository: AdminEventsRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly search?: string;
    readonly status?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<CursorPage<AdminEventSummary>> {
    requireEventsRead(input.actor);
    const limit = parseLimit(input.limit);
    const rows = await this.repository.listEvents({
      search: parseSearch(input.search),
      status: parseStatus(input.status),
      cursor: decodeCursor(input.cursor),
      limit: limit + 1
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: rows.length > limit && last
        ? encodeCursor({
            occurredAt: new Date(last.createdAt),
            id: last.id
          })
        : null
    };
  }
}

export class GetAdminEventService {
  constructor(private readonly repository: AdminEventsRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<AdminEventDetail | null> {
    requireEventsRead(input.actor);
    requireUuid(input.eventId, "Administrator event lookup is invalid");
    return this.repository.getEvent(input.eventId);
  }
}

function requireEventsRead(actor: AdminRequestActor): void {
  if (actor.permission !== "events.read" || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator event permission is invalid");
  }
}

function parseLimit(value: number | undefined): number {
  const limit = value ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Administrator event page limit is invalid");
  }
  return limit;
}

function parseSearch(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const search = value.trim();
  if (search.length < 2 || search.length > 100) {
    throw new Error("Administrator event search is invalid");
  }
  return search;
}

function parseStatus(value: string | undefined): AdminEventStatus | null {
  if (value === undefined || value === "") {
    return null;
  }
  if (!ADMIN_EVENT_STATUSES.includes(value as AdminEventStatus)) {
    throw new Error("Administrator event status is invalid");
  }
  return value as AdminEventStatus;
}

function encodeCursor(cursor: AdminEventPageCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      at: cursor.occurredAt.toISOString(),
      id: cursor.id
    }),
    "utf8"
  ).toString("base64url");
}

function decodeCursor(value: string | undefined): AdminEventPageCursor | null {
  if (!value) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{20,300}$/.test(value)) {
    throw new Error("Administrator event page cursor is invalid");
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as { readonly v?: unknown; readonly at?: unknown; readonly id?: unknown };
    const occurredAt = new Date(String(parsed.at));
    if (
      parsed.v !== 1
      || typeof parsed.at !== "string"
      || typeof parsed.id !== "string"
      || Number.isNaN(occurredAt.getTime())
    ) {
      throw new Error("invalid");
    }
    requireUuid(parsed.id, "invalid");
    return { occurredAt, id: parsed.id };
  } catch {
    throw new Error("Administrator event page cursor is invalid");
  }
}

function requireUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(message);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
