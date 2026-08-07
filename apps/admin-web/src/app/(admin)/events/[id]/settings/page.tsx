"use client";

import { useEventWorkspace } from "@/components/event-workspace";
import {
  ArrowRight,
  FileCheck2,
  FileText,
  Lock,
  PackageOpen,
  Pencil,
  Workflow
} from "lucide-react";
import Link from "next/link";

/**
 * Пять экранов правки мероприятия. Все они работают только у черновика — раньше это
 * выражалось тем, что кнопки просто исчезали после публикации, и понять, куда они делись,
 * было нельзя. Теперь они на месте и подписаны, почему закрыты.
 */
const SCREENS = [
  {
    segment: "edit",
    label: "Основное",
    description: "Даты, площадка, ёмкость, окно продаж, поддержка",
    icon: Pencil
  },
  {
    segment: "catalog",
    label: "Продукты и тарифы",
    description: "Состав билетов, цены и ценовые правила",
    icon: PackageOpen
  },
  {
    segment: "content",
    label: "Контент",
    description: "Блоки, которые бот показывает участнику",
    icon: FileText
  },
  {
    segment: "scenario",
    label: "Сценарий",
    description: "Шаги диалога и переходы между экранами бота",
    icon: Workflow
  },
  {
    segment: "offer",
    label: "Оферта",
    description: "Версии документа и то, с чем соглашается покупатель",
    icon: FileCheck2
  }
] as const;

export default function EventSettingsPage() {
  const { event } = useEventWorkspace();
  const editable = event.status === "draft";

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Настройки</p>
          <h1>Как устроено мероприятие</h1>
          <p>
            {editable
              ? `Черновик, версия ${event.lockVersion}. Правки применяются сразу.`
              : "Мероприятие опубликовано — экраны открыты только на просмотр."}
          </p>
        </div>
      </div>

      {!editable ? (
        <div className="accommodation-note">
          <Lock size={16} />
          <span>
            У опубликованного мероприятия правки закрыты намеренно: по этим данным уже
            выставлены счета и приняты согласия. Цены меняются командой{" "}
            <code>pnpm price:set</code>, остальное — новой версией мероприятия.
          </span>
        </div>
      ) : null}

      <section className="data-section">
        <div className="settings-list">
          {SCREENS.map((screen) => {
            const Icon = screen.icon;
            return (
              <Link
                className="settings-item"
                key={screen.segment}
                href={`/events/${event.id}/${screen.segment}`}
              >
                <span className="settings-item-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="settings-item-copy">
                  <strong>{screen.label}</strong>
                  <small>{screen.description}</small>
                </span>
                {editable ? null : (
                  <span className="settings-item-lock">
                    <Lock size={14} />
                    только просмотр
                  </span>
                )}
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}
