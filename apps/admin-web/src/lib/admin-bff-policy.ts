export type AdminBffMethod = "GET" | "POST" | "PATCH";

export function getAdminMutationBodyLimit(path: string): number {
  if (path === "imports/users/preview") {
    return 750_000;
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
    return path === "classification"
      || path === "segments"
      || path === "broadcasts"
      || /^broadcasts\/[0-9a-f-]{36}$/i.test(path)
      || /^segments\/[0-9a-f-]{36}$/i.test(path)
      || /^segments\/[0-9a-f-]{36}\/audience-snapshots(?:\/[0-9a-f-]{36})?$/i
        .test(path)
      || /^imports\/users\/analyses\/[0-9a-f-]{36}\/rows$/i.test(path)
      || /^(?:users|orders|events)(?:\/[0-9a-f-]{36})?$/i.test(path);
  }
  if (method === "POST") {
    return path === "events"
      || path === "segments"
      || path === "broadcasts"
      || path === "imports/users/preview"
      || /^imports\/users\/[0-9a-f-]{36}\/analyze$/i.test(path)
      || /^imports\/users\/analyses\/[0-9a-f-]{36}\/rows\/(?:[2-9]|[1-9][0-9]{1,2}|[1-4][0-9]{3}|500[01])\/decision$/i
        .test(path)
      || /^broadcasts\/[0-9a-f-]{36}\/publish$/i.test(path)
      || /^broadcasts\/[0-9a-f-]{36}\/schedule$/i.test(path)
      || /^broadcasts\/[0-9a-f-]{36}\/test-send$/i.test(path)
      || /^broadcasts\/[0-9a-f-]{36}\/(?:pause|resume|cancel)$/i.test(path)
      || /^segments\/[0-9a-f-]{36}\/publish$/i.test(path)
      || /^segments\/[0-9a-f-]{36}\/audience-snapshots$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/publish$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/content-blocks$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/offer-versions$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/scenario-drafts$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/scenario-versions\/[0-9a-f-]{36}\/publish$/i
        .test(path)
      || /^events\/[0-9a-f-]{36}\/products$/i.test(path)
      || /^events\/[0-9a-f-]{36}\/products\/[0-9a-f-]{36}\/pricing-rules$/i
        .test(path)
      || path === "classification/statuses"
      || path === "classification/categories"
      || path === "segments/preview"
      || /^users\/[0-9a-f-]{36}\/classification\/(?:statuses|categories)$/i
        .test(path)
      || /^users\/[0-9a-f-]{36}\/classification\/(?:statuses|categories)\/[a-z][a-z0-9_]{1,63}\/remove$/i
        .test(path);
  }
  return /^events\/[0-9a-f-]{36}\/general$/i.test(path)
    || /^broadcasts\/[0-9a-f-]{36}\/draft$/i.test(path)
    || /^segments\/[0-9a-f-]{36}\/draft$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/content-blocks\/[0-9a-f-]{36}$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/offer\/deactivate$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/products\/[0-9a-f-]{36}$/i.test(path)
    || /^events\/[0-9a-f-]{36}\/products\/[0-9a-f-]{36}\/pricing-rules\/[0-9a-f-]{36}$/i
      .test(path)
    || /^classification\/(?:statuses|categories)\/[0-9a-f-]{36}$/i
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
