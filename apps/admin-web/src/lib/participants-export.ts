// Content-Disposition arrives as `attachment; filename="participants-2026-08-08.csv"`; anything
// else (missing header, unquoted value, a path separator smuggled into the name) falls back to a
// locally built name so the browser never writes outside the download folder.
export function readExportFilename(
  contentDisposition: string | null,
  fallback: string
): string {
  const match = /filename="([^"]+)"/i.exec(contentDisposition ?? "");
  const candidate = match?.[1]?.trim();
  if (!candidate || candidate.includes("/") || candidate.includes("\\")) {
    return fallback;
  }
  return candidate;
}

export async function participantsExportErrorMessage(
  response: Response
): Promise<string> {
  if (response.status === 403) {
    return "Для выгрузки участников требуется разрешение participants.export.";
  }
  if (response.status === 401) {
    return "Сессия истекла. Войдите заново.";
  }
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === "object" && body !== null) {
    const title = (body as Record<string, unknown>).title;
    if (typeof title === "string") {
      return title;
    }
  }
  return "Не удалось выгрузить участников.";
}
