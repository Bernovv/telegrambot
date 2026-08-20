export interface PublicSupabaseConfiguration {
  readonly url: string;
  readonly publishableKey: string;
}

export function getPublicSupabaseConfiguration():
PublicSupabaseConfiguration | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return null;
  }
  return { url, publishableKey };
}

/**
 * Требует ли панель второй фактор.
 *
 * По умолчанию требует: выключение — это осознанное послабление, и опечатка в имени
 * переменной не должна снимать защиту молча. Значение подставляется в сборку, поэтому
 * менять его надо до `pnpm --filter @ticket-platform/admin-web build`, а не после.
 *
 * Панель и api читают разные переменные (`NEXT_PUBLIC_ADMIN_MFA_REQUIRED` и
 * `ADMIN_MFA_REQUIRED`) и должны совпадать. Разойдутся — панель пустит без кода, а api
 * откажет в денежных операциях: неприятно, но безопасно, а не наоборот.
 */
export function isAdminMfaRequired(): boolean {
  const value = process.env.NEXT_PUBLIC_ADMIN_MFA_REQUIRED?.trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off" && value !== "no";
}

export function getAdminApiBaseUrl(): string | null {
  const value = process.env.ADMIN_API_BASE_URL;
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getAdminAppOrigin(): string | null {
  const value = process.env.ADMIN_APP_URL;
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
