"use client";

import {
  Boxes,
  ChartNoAxesColumn,
  ClipboardList,
  DoorOpen,
  Filter,
  HandCoins,
  LayoutDashboard,
  Megaphone,
  ReceiptText,
  Settings2,
  Tent,
  Users,
  Wallet
} from "lucide-react";
import type { AdminEventFormat } from "@ticket-platform/contracts/admin-events";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Вкладки рабочего места мероприятия.
 *
 * Их стало больше, чем помещается в один ряд: продажи и воронка переехали сюда из
 * отдельных разделов кабинета, потому что и то и другое — это про конкретное событие, а не
 * про базу вообще. Поэтому ряд разделён надвое: **семь ежедневных** и «Ещё» — то, что
 * открывают раз в неделю или один раз за подготовку.
 *
 * Порядок первых семи — это порядок работы: посмотрели, как идёт; продали; собрали список;
 * отметили на входе; посчитали расходы; посмотрели отчёт; поправили настройки.
 *
 * Расселение и инвентарь — про выезд с ночёвкой. У городской встречи на три часа их не
 * бывает, и пустые вкладки там только мешают искать нужную.
 */
const TABS = [
  { segment: "", label: "Обзор", icon: LayoutDashboard, offsiteOnly: false, extra: false },
  { segment: "funnel", label: "Воронка", icon: Filter, offsiteOnly: false, extra: false },
  { segment: "sales", label: "Продажи", icon: ReceiptText, offsiteOnly: false, extra: false },
  {
    segment: "participants",
    label: "Участники",
    icon: Users,
    offsiteOnly: false,
    extra: false
  },
  { segment: "attendance", label: "Явка", icon: DoorOpen, offsiteOnly: false, extra: false },
  { segment: "expenses", label: "Расходы", icon: Wallet, offsiteOnly: false, extra: false },
  {
    segment: "report",
    label: "Отчёт",
    icon: ChartNoAxesColumn,
    offsiteOnly: false,
    extra: false
  },
  {
    segment: "settings",
    label: "Настройки",
    icon: Settings2,
    offsiteOnly: false,
    extra: false
  },
  {
    segment: "questionnaire",
    label: "Анкеты",
    icon: ClipboardList,
    offsiteOnly: false,
    extra: true
  },
  {
    segment: "broadcast",
    label: "Рассылка",
    icon: Megaphone,
    offsiteOnly: false,
    extra: true
  },
  { segment: "accommodation", label: "Логистика", icon: Tent, offsiteOnly: true, extra: true },
  { segment: "inventory", label: "Инвентарь", icon: Boxes, offsiteOnly: true, extra: true },
  { segment: "team", label: "Команда", icon: HandCoins, offsiteOnly: false, extra: true }
] as const;

export function EventTabs({
  eventId,
  format
}: Readonly<{ eventId: string; format: AdminEventFormat }>) {
  const pathname = usePathname();
  const base = `/events/${eventId}`;
  // Экраны правки открываются из «Настроек» и своей вкладки не имеют — пока мы на них,
  // подсвеченной должна оставаться она.
  const settingsSegments = ["settings", "edit", "catalog", "content", "scenario", "offer"];
  const current = pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length + 1).split("/")[0] ?? ""
    : "";
  const active = settingsSegments.includes(current) ? "settings" : current;

  const shown = TABS.filter((tab) => format === "offsite" || !tab.offsiteOnly);
  const everyday = shown.filter((tab) => !tab.extra);
  const extra = shown.filter((tab) => tab.extra);
  // «Ещё» раскрыта, пока мы внутри неё: иначе непонятно, где находишься.
  const insideExtra = extra.some((tab) => tab.segment === active);

  function renderTab(tab: typeof TABS[number]) {
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
  }

  return (
    <nav className="event-tabs" aria-label="Разделы мероприятия">
      {everyday.map(renderTab)}
      {extra.length > 0 ? (
        <details className="event-tabs-extra" open={insideExtra}>
          <summary>Ещё</summary>
          <div>{extra.map(renderTab)}</div>
        </details>
      ) : null}
    </nav>
  );
}
