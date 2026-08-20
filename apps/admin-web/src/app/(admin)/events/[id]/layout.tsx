"use client";

import { EventTabs } from "@/components/event-tabs";
import { EventWorkspaceProvider } from "@/components/event-workspace";
import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import { AdminApiError, getEvent } from "@/lib/admin-api";
import {
  eventStatusLabel,
  eventStatusTone,
  formatEventDateTime
} from "@/lib/format";
import type { AdminEventDetail } from "@ticket-platform/contracts/admin-events";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

/**
 * Общая часть всех вкладок мероприятия: возврат к списку, шапка с названием и статусом,
 * переключатель разделов. Карточка грузится здесь и раздаётся вкладкам через контекст —
 * до этого каждая из шести страниц грузила её сама.
 */
export default function EventWorkspaceLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<AdminEventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setEvent(await getEvent(id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(
          caught instanceof AdminApiError
            ? caught.message
            : "Сервис временно недоступен."
        );
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const workspace = useMemo(
    () => (event ? { event, reload: async () => { await load(); } } : null),
    [event, load]
  );

  return (
    <>
      <Link className="back-link" href="/events">
        <ArrowLeft size={17} />
        Все мероприятия
      </Link>

      {event ? (
        <div className="event-workspace-heading">
          <div className="title-with-status">
            <h1>{event.title}</h1>
            <StatusPill tone={eventStatusTone(event.status)}>
              {eventStatusLabel(event.status)}
            </StatusPill>
          </div>
          <p>
            {formatEventDateTime(event.startsAt, event.timezone)}
            {" · "}
            {event.locationName ?? "Площадка не указана"}
          </p>
        </div>
      ) : null}

      <EventTabs eventId={id} format={event?.format ?? "offsite"} />

      {loading && !event ? <PageLoading /> : null}
      {error && !event ? (
        <PageError message={error} retry={() => void load()} />
      ) : null}
      {workspace ? (
        <EventWorkspaceProvider value={workspace}>
          {children}
        </EventWorkspaceProvider>
      ) : null}
    </>
  );
}
