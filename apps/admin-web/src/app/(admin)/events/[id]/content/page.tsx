"use client";

import { EventContentEditor } from "@/components/event-content-editor";
import { useEventWorkspace } from "@/components/event-workspace";
import { PageError } from "@/components/page-state";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function EventContentPage() {
  const { event, reload } = useEventWorkspace();

  if (event.status !== "draft") {
    return (
      <PageError
        message="Управлять контентом можно только у черновика."
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
          <h1>Контент мероприятия</h1>
        </div>
      </div>
      <EventContentEditor event={event} reload={() => reload()} />
    </>
  );
}
