import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseConfiguration } from "../environment";

export async function createServerSupabaseClient() {
  const configuration = getPublicSupabaseConfiguration();
  if (!configuration) {
    return null;
  }
  const cookieStore = await cookies();
  return createServerClient(
    configuration.url,
    configuration.publishableKey,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const cookie of cookiesToSet) {
              cookieStore.set(cookie.name, cookie.value, cookie.options);
            }
          } catch {
            // Server Components cannot write cookies; proxy.ts refreshes sessions.
          }
        }
      }
    }
  );
}
