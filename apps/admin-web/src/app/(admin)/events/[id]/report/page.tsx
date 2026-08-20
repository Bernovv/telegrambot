"use client";

import { EventReportChart } from "@/components/event-report-chart";
import { useEventWorkspace } from "@/components/event-workspace";
import { PageError, PageLoading } from "@/components/page-state";
import { AdminApiError, getEventReport } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import type { EventReport } from "@ticket-platform/contracts/admin-event-report";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const ENTRY_LABELS: Record<string, string> = {
  order: "Купил в боте",
  site: "Форма на сайте",
  direct: "Завёл организатор",
  max: "Бот MAX",
  timepad: "Timepad",
  other: "Другое"
};

const OUTREACH_LABELS: Record<string, string> = {
  called: "Звонили до встречи",
  not_called: "Не звонили"
};

export default function EventReportPage() {
  const { event } = useEventWorkspace();
  const [report, setReport] = useState<EventReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getEventReport(event.id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось собрать отчёт.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [event.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && !report) {
    return <PageLoading label="Собираем отчёт" />;
  }
  if (error && !report) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!report) {
    return null;
  }

  const share = report.registered > 0
    ? Math.round((report.attended / report.registered) * 100)
    : 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Мероприятие</p>
          <h1>Отчёт</h1>
          <p>
            Кто откуда пришёл и кто дошёл. Числа те же, что на вкладке «Участники»:
            отчёт собран из её строк, а не посчитан заново.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button bordered"
            type="button"
            title="Обновить"
            aria-label="Обновить"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {error ? <div className="page-warning">{error}</div> : null}

      <div className="metrics-strip">
        <div>
          <span>Заявок с сайта</span>
          <strong>{report.siteRequests}</strong>
          {report.siteRequestDuplicates > 0 ? (
            <small>из них повторных: {report.siteRequestDuplicates}</small>
          ) : null}
        </div>
        <div>
          <span>В списке</span>
          <strong>{report.registered}</strong>
        </div>
        <div>
          <span>Дошло</span>
          <strong>{report.attended}</strong>
        </div>
        <div>
          <span>Доходимость</span>
          <strong>{share}%</strong>
        </div>
      </div>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Что приводит людей</h2>
            <span>Метка источника из карточки человека</span>
          </div>
        </div>
        {/* Главный разрез отчёта: он один отвечает на вопрос, ради которого отчёт заведён —
            какой канал приводит не просто записавшихся, а дошедших. */}
        <div className="report-body">
          <EventReportChart
            buckets={report.byChannel}
            labelOf={(key) => key || "Источник не указан"}
            emptyLabel="Ни у кого из списка нет метки источника."
          />
          <p className="muted report-hint">
            Метка берётся из карточки человека. У покупателя бота она есть, только если его
            узнали по телефону; у заведённого руками — если её вписали при импорте.
          </p>
        </div>
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Окупается ли обзвон</h2>
            <span>Звонили ли человеку до начала встречи</span>
          </div>
        </div>
        <div className="report-body">
          <EventReportChart
            buckets={report.byOutreach}
            labelOf={(key) => OUTREACH_LABELS[key] ?? key}
            emptyLabel="В списке пока никого нет."
          />
          <p className="muted report-hint">
            Считаются любые касания по человеку — из любой кампании, — случившиеся до начала
            встречи. Тот, кого в базе нет, попадает в «не звонили»: связаться с ним мы
            действительно не могли.
          </p>
        </div>
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Как попал в список</h2>
            <span>Это про работу, которую делали мы</span>
          </div>
        </div>
        <div className="report-body">
          <EventReportChart
            buckets={report.byEntry}
            labelOf={(key) => ENTRY_LABELS[key] ?? key}
            emptyLabel="В списке пока никого нет."
          />
        </div>
      </section>

      <p className="muted report-meta">
        Посчитано {formatDateTime(report.calculatedAt)}
      </p>
    </>
  );
}
