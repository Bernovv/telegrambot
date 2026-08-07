"use client";

import { EventOfferEditor } from "@/components/event-offer-editor";
import { useEventWorkspace } from "@/components/event-workspace";
import { PageError } from "@/components/page-state";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function EventOfferPage() {
  const { event, reload } = useEventWorkspace();

  if (event.status !== "draft") {
    return (
      <PageError
        message="Управлять офертой можно только у черновика."
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
          <h1>Оферта мероприятия</h1>
        </div>
      </div>
      <EventOfferEditor event={event} reload={() => reload()} />
    </>
  );
}
