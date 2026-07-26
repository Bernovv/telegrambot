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
