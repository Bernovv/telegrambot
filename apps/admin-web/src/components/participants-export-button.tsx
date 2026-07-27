"use client";

import { buildParticipantsExportPath } from "@/lib/admin-api";
import {
  participantsExportErrorMessage,
  readExportFilename
} from "@/lib/participants-export";
import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";

export function ParticipantsExportButton({
  eventId,
  eventSlug
}: {
  readonly eventId: string;
  readonly eventSlug: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A plain <a download> would happily save a 403 problem+json body as if it were the report, so
  // the response is fetched first and only turned into a file once the status is known to be ok.
  async function download() {
    if (downloading) {
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const response = await fetch(buildParticipantsExportPath(eventId), {
        method: "GET",
        cache: "no-store",
        headers: { accept: "text/csv" }
      });
      if (!response.ok) {
        setError(await participantsExportErrorMessage(response));
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = readExportFilename(
        response.headers.get("content-disposition"),
        `participants-${eventSlug}.csv`
      );
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Не удалось скачать файл. Проверьте соединение и попробуйте снова.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <button
        className="secondary-button"
        type="button"
        disabled={downloading}
        onClick={() => void download()}
      >
        {downloading
          ? <LoaderCircle className="spin" size={16} />
          : <Download size={16} />}
        {downloading ? "Готовим файл..." : "Выгрузить участников"}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </>
  );
}
