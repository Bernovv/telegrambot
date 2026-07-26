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
    return /^(?:users|orders|events)(?:\/[0-9a-f-]{36})?$/i.test(path);
  }
  if (method === "POST") {
    return path === "events"
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
