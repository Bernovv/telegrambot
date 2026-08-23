"use client";

import { PageLoading } from "@/components/page-state";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Рассылка по этому мероприятию.
 *
 * Отдельного раздела «Рассылки» в меню больше нет: письмо почти всегда пишут про
 * конкретное событие — тем, кто купил, или тем, кто не оплатил. Экран остался прежним, сюда
 * он приходит уже с выбранным мероприятием.
 *
 * Рассылка «всем, кто открывал бота» к событию не относится и живёт в «Базе контактов» —
 * отправкой по текущему отбору.
 */
export default function EventBroadcastPage() {
  const params = useParams<{ readonly id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/broadcasts?event=${encodeURIComponent(params.id)}`);
  }, [params.id, router]);

  return <PageLoading label="Открываем рассылку" />;
}
