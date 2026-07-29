export type AdminBffMethod = "GET" | "POST" | "PATCH";

export function getAdminMutationBodyLimit(path: string): number {
  if (/^outreach\/campaigns\/[0-9a-f-]{36}\/import$/i.test(path)) {
    return 524_288;
  }
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
      || path === "outreach/campaigns"
      || path === "outreach/managers"
      || /^outreach\/campaigns\/[0-9a-f-]{36}(?:\/contacts|\/export)?$/i.test(path)
      || /^outreach\/campaign-contacts\/[0-9a-f-]{36}$/i.test(path);
  }
  if (method === "POST") {
    return path === "events"
      || path === "outreach/campaigns"
      || path === "outreach/campaign-contacts/activities"
      || path === "outreach/campaign-contacts/assign"
      || /^outreach\/campaign-contacts\/[0-9a-f-]{36}\/tasks$/i.test(path)
      || /^outreach\/campaigns\/[0-9a-f-]{36}\/import$/i.test(path)
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
  return /^outreach\/campaigns\/[0-9a-f-]{36}$/i.test(path)
    || /^outreach\/campaign-contacts\/[0-9a-f-]{36}\/stage$/i.test(path)
    || /^outreach\/tasks\/[0-9a-f-]{36}\/complete$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/general$/i.test(path)
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
