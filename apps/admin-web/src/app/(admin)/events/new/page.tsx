import { EventGeneralForm } from "@/components/event-general-form";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewEventPage() {
  return (
    <>
      <Link className="back-link" href="/events">
        <ArrowLeft size={17} />
        Все мероприятия
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Новый черновик</p>
          <h1>Создание мероприятия</h1>
          <p>Основная информация, расписание и параметры продаж.</p>
        </div>
      </div>
      <EventGeneralForm />
    </>
  );
}
