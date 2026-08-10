"use client";

import {
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Settings2,
  Tent,
  Users,
  Wallet
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Вкладки рабочего места мероприятия. Раньше это был ряд кнопок в шапке, и пять из них
 * исчезали после публикации — у живого мероприятия оставались две. Вкладки видны всегда:
 * что нельзя править у опубликованного, объясняет сама страница.
 *
 * Список будет расти (участники, анкеты, расходы, инвентарь, команда — см.
 * План_кабинета_мероприятия.md). Пять экранов правки живут под «Настройками», чтобы к концу
 * работ вкладок было восемь, а не двенадцать.
 */
const TABS = [
  { segment: "", label: "Обзор", icon: LayoutDashboard },
  { segment: "participants", label: "Участники", icon: Users },
  { segment: "questionnaire", label: "Анкеты", icon: ClipboardList },
  { segment: "accommodation", label: "Логистика", icon: Tent },
  { segment: "expenses", label: "Расходы", icon: Wallet },
  { segment: "inventory", label: "Инвентарь", icon: Boxes },
  { segment: "settings", label: "Настройки", icon: Settings2 }
] as const;

export function EventTabs({ eventId }: Readonly<{ eventId: string }>) {
  const pathname = usePathname();
  const base = `/events/${eventId}`;
  // Экраны правки открываются из «Настроек» и своей вкладки не имеют — пока мы на них,
  // подсвеченной должна оставаться она.
  const settingsSegments = ["settings", "edit", "catalog", "content", "scenario", "offer"];
  const current = pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length + 1).split("/")[0] ?? ""
    : "";
  const active = settingsSegments.includes(current) ? "settings" : current;

  return (
    <nav className="event-tabs" aria-label="Разделы мероприятия">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const isActive = active === tab.segment;
        return (
          <Link
            key={tab.segment || "overview"}
            className={isActive ? "event-tab event-tab-active" : "event-tab"}
            href={href}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={16} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
