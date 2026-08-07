import type { AccommodationBundleRole } from "@ticket-platform/application";

/**
 * Состав тарифа лежит в `ticket_products.bundle_composition` как jsonb и читается двумя
 * отчётами — расселением и списком участников. Драйвер отдаёт его то объектом, то строкой,
 * поэтому разбор один на обоих: разойдись он, два экрана считали бы разное число гостей.
 */
export function toBundleComposition(
  value: unknown
): readonly AccommodationBundleRole[] {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(parsed)) {
    return [];
  }

  const roles: AccommodationBundleRole[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const role = (entry as { role?: unknown }).role;
    const quantity = (entry as { quantity?: unknown }).quantity;
    if (typeof role === "string" && typeof quantity === "number") {
      roles.push({ role, quantity });
    }
  }
  return roles;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
