export type AdminBffMethod = "GET" | "POST" | "PATCH";

export function getAdminMutationBodyLimit(path: string): number {
  return (
    /^events\/[0-9a-f-]{36}\/offer-versions$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/scenario-drafts$/i.test(path)
  )
    ? 262_144
    : 65_536;
}

export function isAllowedAdminApiPath(
  method: AdminBffMethod,
  path: string
): boolean {
  if (method === "GET") {
    return /^(?:users|orders|events)(?:\/[0-9a-f-]{36})?$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/participants\/export$/i.test(path);
  }
  if (method === "POST") {
    return path === "events"
      || path === "broadcasts"
      || /^orders\/[0-9a-f-]{36}\/manual-payment$/i.test(path)
      || /^orders\/[0-9a-f-]{36}\/refunds\/full$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/publish$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/content-blocks$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/offer-versions$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/scenario-drafts$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/scenario-versions\/[0-9a-f-]{36}\/publish$/i
        .test(path)
      || /^events\/[0-9a-f-]{36}\/products$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/products\/[0-9a-f-]{36}\/pricing-rules$/i
        .test(path);
  }
  return /^events\/[0-9a-f-]{36}\/general$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/content-blocks\/[0-9a-f-]{36}$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/offer\/deactivate$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/products\/[0-9a-f-]{36}$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/products\/[0-9a-f-]{36}\/pricing-rules\/[0-9a-f-]{36}$/i
      .test(path);
}

// Money-moving endpoints in apps/api require an Idempotency-Key header and reject the request
// without one (manual-payments-api.ts, full-refunds-api.ts). The key is generated once per form
// submission in the browser so that a retry after a timeout settles the same operation instead of
// charging or refunding twice, which means the BFF has to forward the client header rather than
// mint a fresh one per proxy hop.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export function requiresIdempotencyKey(path: string): boolean {
  return /^orders\/[0-9a-f-]{36}\/manual-payment$/i.test(path)
    || /^orders\/[0-9a-f-]{36}\/refunds\/full$/i.test(path);
}

export function isValidIdempotencyKey(value: string | null): value is string {
  return value !== null && IDEMPOTENCY_KEY_PATTERN.test(value);
}

// The participants export answers with text/csv and a Content-Disposition filename; both have to
// survive the proxy or the browser renders the CSV inline instead of downloading it.
export function isFileDownloadPath(path: string): boolean {
  return /^events\/[0-9a-f-]{36}\/participants\/export$/i.test(path);
}

export function isTrustedMutationOrigin(
  origin: string | null,
  expectedOrigin: string
): boolean {
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}
