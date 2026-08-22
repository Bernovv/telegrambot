import { randomUUID } from "node:crypto";
import {
  getAdminApiBaseUrl,
  getAdminAppOrigin
} from "@/lib/environment";
import {
  getAdminMutationBodyLimit,
  isAllowedAdminApiPath,
  isBinaryDownloadPath,
  isFileDownloadPath,
  isTrustedMutationOrigin,
  isValidIdempotencyKey,
  requiresIdempotencyKey,
  type AdminBffMethod
} from "@/lib/admin-bff-policy";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

interface RouteContext {
  readonly params: Promise<{ readonly path: readonly string[] }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  return forwardAdminRequest("GET", request, context);
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  return forwardAdminRequest("POST", request, context);
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  return forwardAdminRequest("PATCH", request, context);
}

async function forwardAdminRequest(
  method: AdminBffMethod,
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const { path } = await context.params;
  const upstreamPath = path.join("/");
  if (!isAllowedAdminApiPath(method, upstreamPath)) {
    // Без пути в ответе такую ошибку невозможно разобрать: видно только «404», а какой
    // именно запрос отклонён — нет. Путь здесь не секрет, его же прислал сам браузер.
    // Sec-Fetch-* показывают, переход это по адресу или программный запрос: без них
    // непонятно, кто вообще постучался.
    // eslint-disable-next-line no-console -- диагностика отклонённых маршрутов идёт в лог pm2
    console.warn(
      "[admin-bff] route rejected",
      JSON.stringify({
        method,
        path: upstreamPath,
        mode: request.headers.get("sec-fetch-mode"),
        dest: request.headers.get("sec-fetch-dest"),
        site: request.headers.get("sec-fetch-site"),
        referer: request.headers.get("referer"),
        contentType: request.headers.get("content-type")
      })
    );
    return problem(
      404,
      "ADMIN_ROUTE_NOT_FOUND",
      `Route was not found: ${method} ${upstreamPath}`
    );
  }
  const mutationBody =
    method === "GET"
      ? null
      : await readMutationBody(
          request,
          getAdminMutationBodyLimit(upstreamPath),
          getAdminAppOrigin() ?? request.nextUrl.origin
        );
  if (mutationBody instanceof Response) {
    return mutationBody;
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (requiresIdempotencyKey(upstreamPath) && !isValidIdempotencyKey(idempotencyKey)) {
    return problem(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key header is invalid"
    );
  }

  const apiBaseUrl = getAdminApiBaseUrl();
  if (!apiBaseUrl) {
    return problem(
      503,
      "ADMIN_API_NOT_CONFIGURED",
      "Administrator API is not configured"
    );
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return problem(
      503,
      "ADMIN_AUTH_NOT_CONFIGURED",
      "Administrator authentication is not configured"
    );
  }

  const [{ data: userData, error: userError }, { data: sessionData }] =
    await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getSession()
    ]);
  const accessToken = sessionData.session?.access_token;
  if (userError || !userData.user || !accessToken) {
    return problem(401, "ADMIN_SESSION_REQUIRED", "Sign in is required");
  }

  const url = new URL(`/api/v1/${upstreamPath}`, apiBaseUrl);
  url.search = request.nextUrl.search;
  try {
    const upstream = await fetch(url, {
      method,
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        ...(method === "GET"
          ? {}
          : {
              "content-type": "application/json",
              "x-request-id": randomUUID(),
              "user-agent":
                request.headers.get("user-agent")?.slice(0, 500)
                ?? "ticket-admin-web"
            }),
        ...(isValidIdempotencyKey(idempotencyKey)
          ? { "idempotency-key": idempotencyKey }
          : {})
      },
      ...(mutationBody === null ? {} : { body: mutationBody }),
      signal: AbortSignal.timeout(12_000)
    });
    if (isBinaryDownloadPath(upstreamPath)) {
      // Файл отдаём потоком, не превращая в строку: `text()` разбирает байты как UTF-8 и
      // портит всё, что в него не уложилось. Картинка при этом остаётся правильного
      // размера и не открывается — ошибка, которую ищут долго.
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "cache-control": "private, max-age=300",
          "content-type":
            upstream.headers.get("content-type") ?? "application/octet-stream",
          ...(upstream.headers.get("content-disposition") !== null
            ? { "content-disposition": upstream.headers.get("content-disposition") as string }
            : {})
        }
      });
    }

    const upstreamBody = await upstream.text();
    const contentDisposition = upstream.headers.get("content-disposition");
    return new Response(upstreamBody, {
      status: upstream.status,
      headers: {
        "cache-control": "no-store",
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
        ...(isFileDownloadPath(upstreamPath)
          && upstream.ok
          && contentDisposition !== null
          ? { "content-disposition": contentDisposition }
          : {})
      }
    });
  } catch {
    return problem(
      502,
      "ADMIN_API_UNAVAILABLE",
      "Administrator API is unavailable"
    );
  }
}

async function readMutationBody(
  request: NextRequest,
  maximumBytes: number,
  trustedOrigin: string
): Promise<string | Response> {
  if (
    !isTrustedMutationOrigin(
      request.headers.get("origin"),
      trustedOrigin
    )
  ) {
    return problem(403, "ADMIN_CSRF_REJECTED", "Request origin is not trusted");
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return problem(
      415,
      "ADMIN_JSON_REQUIRED",
      "Application JSON content is required"
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isSafeInteger(contentLength)
    || contentLength < 0
    || contentLength > maximumBytes
  ) {
    return problem(413, "ADMIN_BODY_TOO_LARGE", "Request body is too large");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    return problem(413, "ADMIN_BODY_TOO_LARGE", "Request body is too large");
  }
  return body;
}

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { code, title, status },
    { status, headers: { "cache-control": "no-store" } }
  );
}
