"use client";

import { EventScenarioEditor } from "@/components/event-scenario-editor";
import { useEventWorkspace } from "@/components/event-workspace";
import { PageError } from "@/components/page-state";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function EventScenarioPage() {
  const { event, reload } = useEventWorkspace();

  if (event.status !== "draft") {
    return (
      <PageError
        message="Редактировать сценарий можно только у черновика."
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
          <h1>Сценарий мероприятия</h1>
        </div>
      </div>
      <EventScenarioEditor event={event} reload={() => reload()} />
    </>
  );
}
