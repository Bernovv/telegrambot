"use client";

import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  createOutreachCampaign,
  getEvent,
  listOutreachCampaigns
} from "@/lib/admin-api";
import type { AdminEventDetail } from "@ticket-platform/contracts/admin-events";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/**
 * Воронка мероприятия.
 *
 * Отдельного раздела «Кампании» больше нет: продажи каждого события ведутся в его
 * собственной воронке, и открывается она отсюда. Сама доска живёт по прежнему адресу и
 * переписана не была — она большая, рабочая и трогать её ради переезда вкладки незачем.
 *
 * У мероприятия воронки может ещё не быть: события заводят раньше, чем начинают продавать.
 * Тогда вкладка предлагает её завести — с привязкой к этому событию, чтобы оплатившие
 * попадали в участников сами.
 */
export default function EventFunnelPage() {
  const params = useParams<{ readonly id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<AdminEventDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const [campaigns, loaded] = await Promise.all([
        listOutreachCampaigns(signal),
        getEvent(params.id, signal)
      ]);
      if (signal?.aborted) {
        return;
      }
      setEvent(loaded);
      const own = campaigns.find((campaign) => campaign.eventId === params.id);
      if (own) {
        // Доска — по своему адресу. `replace`, а не `push`: кнопка «назад» должна
        // возвращать в мероприятие, а не швырять обратно сюда же.
        router.replace(`/outreach/${own.id}`);

        return;
      }
      setMissing(true);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось открыть воронку.");
      }
    }
  }, [params.id, router]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function create() {
    if (event === null) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const campaign = await createOutreachCampaign({
        name: event.title,
        eventId: event.id
      });
      router.replace(`/outreach/${campaign.id}`);
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось завести воронку.");
      setCreating(false);
    }
  }

  if (error) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!missing) {
    return <PageLoading label="Открываем воронку" />;
  }

  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Воронки у этого мероприятия ещё нет</h2>
          <span>Заведите — и оплатившие попадут в участников сами</span>
        </div>
      </div>
      <div className="section-body">
        <p>
          В воронке ведут переговоры до оплаты: этапы, ответственные, задачи-звонки. Как
          только карточка человека доезжает до этапа «оплатил», он появляется в списке
          участников этого мероприятия — вносить его руками не нужно.
        </p>
        <button
          className="primary-button"
          type="button"
          disabled={creating}
          onClick={() => void create()}
        >
          {creating ? "Заводим…" : `Завести воронку «${event?.title ?? ""}»`}
        </button>
      </div>
    </section>
  );
}
