"use client";

import { EventCatalogEditor } from "@/components/event-catalog-editor";
import { PageError, PageLoading } from "@/components/page-state";
import { AdminApiError, getEvent } from "@/lib/admin-api";
import type { AdminEventDetail } from "@ticket-platform/contracts/admin-events";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function EventCatalogPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<AdminEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading && !event) {
    return <PageLoading />;
  }
  if (error || !event) {
    return <PageError message={error ?? "Мероприятие не найдено."} retry={() => void load()} />;
  }
  if (event.status !== "draft") {
    return (
      <PageError
        message="Управлять продуктами и тарифами можно только у черновика."
        retry={() => window.history.back()}
      />
    );
  }

  return (
    <>
      <Link className="back-link" href={`/events/${event.id}`}>
        <ArrowLeft size={17} />
        Карточка мероприятия
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Черновик · версия {event.lockVersion}</p>
          <h1>Продукты и тарифы</h1>
          <p>{event.title}</p>
        </div>
      </div>
      <EventCatalogEditor event={event} reload={() => load()} />
    </>
  );
}
