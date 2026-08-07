"use client";

import { EventCatalogEditor } from "@/components/event-catalog-editor";
import { useEventWorkspace } from "@/components/event-workspace";
import { PageError } from "@/components/page-state";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function EventCatalogPage() {
  const { event, reload } = useEventWorkspace();

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
      <Link className="back-link" href={`/events/${event.id}/settings`}>
        <ArrowLeft size={17} />
        Настройки
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Черновик · версия {event.lockVersion}</p>
          <h1>Продукты и тарифы</h1>
        </div>
      </div>
      <EventCatalogEditor event={event} reload={() => reload()} />
    </>
  );
}
