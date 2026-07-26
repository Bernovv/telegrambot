import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getPublicSupabaseConfiguration } from "../environment";

export async function refreshSupabaseSession(
  request: NextRequest
): Promise<NextResponse> {
  const configuration = getPublicSupabaseConfiguration();
  if (!configuration) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    configuration.url,
    configuration.publishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const cookie of cookiesToSet) {
            request.cookies.set(cookie.name, cookie.value);
          }
          response = NextResponse.next({ request });
          for (const cookie of cookiesToSet) {
            response.cookies.set(cookie.name, cookie.value, cookie.options);
          }
        }
      }
    }
  );

  await supabase.auth.getUser();
  return response;
}
