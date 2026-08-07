"use client";

import { EventGeneralForm } from "@/components/event-general-form";
import { useEventWorkspace } from "@/components/event-workspace";
import { PageError } from "@/components/page-state";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function EditEventPage() {
  const { event } = useEventWorkspace();

  if (event.status !== "draft") {
    return (
      <PageError
        message="Редактировать общие настройки можно только у черновика."
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
          <h1>Основные настройки</h1>
        </div>
      </div>
      <EventGeneralForm event={event} />
    </>
  );
}
