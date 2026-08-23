"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  listInbox,
  listOutreachImports,
  listOutreachTaskBoard,
  listSiteRegistrations
} from "@/lib/admin-api";
import {
  CalendarClock,
  CalendarDays,
  Contact,
  Globe,
  ListChecks,
  LogOut,
  MessagesSquare,
  Menu,
  Search,
  ShieldCheck,
  Users,
  UsersRound,
  X
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

/**
 * Меню кабинета.
 *
 * Разделено на три части, и это не украшение, а порядок работы. **Работа** — то, куда
 * заходят каждый день. **Настройка** — то, что заводят раз и правят редко. **Пока здесь** —
 * то, что ещё переедет.
 *
 * «Заказы», «Рассылки» и «Кампании» из меню уже ушли: заказы стали «Продажами» внутри
 * мероприятия, рассылка — его же вкладкой, а кампания каждого события — его «Воронкой».
 * Страницы остались по своим адресам, и на них ведут из мероприятия и из поиска.
 *
 * Третья группа существует по правилу «пункт меню убирается только после того, как его
 * работа где-то появилась». Заявки с сайта уедут в воронку отдельным шагом — там нужен
 * отбор «заявка не привязалась», иначе они пропадут молча.
 *
 * Поиска отдельным пунктом нет — он открывается по ⌘K из любого места.
 */

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: typeof ListChecks;
  /** Какой счётчик показывать рядом. Пусто — не показывать никакого. */
  readonly badge?: keyof SidebarCounts;
  /** Красный счётчик значит «просрочено, разберите»; обычный — просто число. */
  readonly loud?: boolean;
}

interface NavGroup {
  readonly caption: string;
  readonly items: readonly NavItem[];
  /** Группа сворачивается: в ней временные разделы, и открывать её каждый день не нужно. */
  readonly collapsible?: boolean;
  readonly hint?: string;
}

const NAVIGATION: readonly NavGroup[] = [
  {
    caption: "Работа",
    items: [
      {
        href: "/inbox",
        label: "Переписки",
        icon: MessagesSquare,
        badge: "unreadThreads",
        loud: true
      },
      { href: "/tasks", label: "Задачи", icon: ListChecks, badge: "overdueTasks", loud: true },
      { href: "/outreach/sreda", label: "Воронка", icon: CalendarClock },
      { href: "/base", label: "База контактов", icon: Contact, badge: "importRows" }
    ]
  },
  {
    caption: "Настройка",
    items: [
      { href: "/events", label: "Мероприятия", icon: CalendarDays },
      { href: "/team", label: "Команда", icon: UsersRound },
      { href: "/users", label: "Бот", icon: Users }
    ]
  },
  {
    caption: "Пока здесь",
    hint: "Уедет в воронку",
    collapsible: true,
    items: [
      {
        href: "/registrations",
        label: "Заявки с сайта",
        icon: Globe,
        badge: "registrations",
        loud: true
      }
    ]
  }
];

interface SidebarCounts {
  readonly unreadThreads: number;
  readonly overdueTasks: number;
  readonly registrations: number;
  readonly importRows: number;
}

const NO_COUNTS: SidebarCounts = {
  unreadThreads: 0,
  overdueTasks: 0,
  registrations: 0,
  importRows: 0
};

export function AdminShell({
  identity,
  children
}: Readonly<{ identity: string; children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [counts, setCounts] = useState<SidebarCounts>(NO_COUNTS);

  const allItems = NAVIGATION.flatMap((group) => group.items);
  const longestMatch = allItems
    .filter((item) => pathname.startsWith(item.href))
    .map((item) => item.href)
    .sort((left, right) => right.length - left.length)[0];

  // Свёрнутая группа помнит, открыл ли её человек. Без состояния она захлопывалась бы сама
  // при каждом обновлении счётчиков: React вернул бы `open` к значению из разметки.
  const insideExtras = NAVIGATION
    .filter((group) => group.collapsible)
    .some((group) => group.items.some((item) => item.href === longestMatch));
  const [extrasOpen, setExtrasOpen] = useState(insideExtras);

  useEffect(() => {
    if (insideExtras) {
      setExtrasOpen(true);
    }
  }, [insideExtras]);

  /**
   * Счётчики в меню.
   *
   * Каждый считается сам по себе и сам по себе пропадает: у роли может не быть прав на
   * базу или на заявки, и меню, потерявшее все цифры из-за одного отказа, было бы хуже
   * меню без одной цифры. Это те самые числа, ради которых существовал «Мой день».
   */
  const loadCounts = useCallback(async (signal?: AbortSignal) => {
    const [unread, tasks, registrations, imports] = await Promise.all([
      // Список просим самый короткий: нужны только числа у отборов, а они приходят вместе
      // со страницей независимо от её длины.
      listInbox({ limit: 1 }, signal)
        .then((page) => page.counts.unread)
        .catch(() => 0),
      listOutreachTaskBoard(true, signal)
        .then((items) => items.filter((task) => task.urgency === "overdue").length)
        .catch(() => 0),
      listSiteRegistrations({ needsAttention: true, limit: 1 }, signal)
        .then((page) => page.needsAttention)
        .catch(() => 0),
      listOutreachImports(signal)
        .then((runs) => runs.reduce((sum, run) => sum + run.pendingRows, 0))
        .catch(() => 0)
    ]);
    if (!signal?.aborted) {
      setCounts({
        unreadThreads: unread,
        overdueTasks: tasks,
        registrations,
        importRows: imports
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCounts(controller.signal);
    return () => controller.abort();
  }, [loadCounts]);

  // Обновляем, когда вкладку вернули на передний план: менеджер уходит звонить и
  // возвращается, а цифры за это время меняются. Опрос по таймеру здесь был бы запросом
  // каждые полминуты ради числа, на которое смотрят раз в час.
  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "visible") {
        void loadCounts();
      }
    }
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [loadCounts]);

  // ⌘K — поиск. Страница поиска существовала и раньше, но на неё не вело ничего.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        router.push("/search");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  async function signOut() {
    if (signingOut) {
      return;
    }
    setSigningOut(true);
    try {
      await createBrowserSupabaseClient().auth.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  function renderLink(item: NavItem) {
    // Совпадений может быть два: «Воронка» лежит внутри «Кампаний». Подсвечиваем самое
    // длинное — иначе подсвечены оба, и непонятно, где ты находишься.
    const active = item.href === longestMatch;
    const Icon = item.icon;
    const value = item.badge ? counts[item.badge] : 0;
    return (
      <Link
        key={item.href}
        className={active ? "nav-link nav-link-active" : "nav-link"}
        href={item.href}
        onClick={() => setMenuOpen(false)}
      >
        <Icon size={18} />
        <span>{item.label}</span>
        {value > 0 ? (
          <span className={item.loud ? "nav-count nav-count-loud" : "nav-count"}>
            {value}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <div className="admin-frame">
      <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={20} />
          </div>
          <div>
            <strong>Бизнес-Прорыв</strong>
            <span>Рабочий кабинет</span>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="Закрыть меню"
            title="Закрыть меню"
            onClick={() => setMenuOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <button
          className="sidebar-search"
          type="button"
          onClick={() => {
            setMenuOpen(false);
            router.push("/search");
          }}
        >
          <Search size={15} />
          <span>Поиск по всему</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="sidebar-nav" aria-label="Основная навигация">
          {NAVIGATION.map((group) => {
            if (!group.collapsible) {
              return (
                <div className="nav-group" key={group.caption}>
                  <span className="nav-caption">{group.caption}</span>
                  {group.items.map(renderLink)}
                </div>
              );
            }
            return (
              <details
                className="nav-group nav-group-fold"
                key={group.caption}
                open={extrasOpen}
                onToggle={(event) => setExtrasOpen(event.currentTarget.open)}
              >
                <summary className="nav-caption">
                  {group.caption}
                  {group.hint ? <em>{group.hint}</em> : null}
                </summary>
                {group.items.map(renderLink)}
              </details>
            );
          })}
        </nav>

        <div className="sidebar-account">
          <div className="account-avatar" aria-hidden="true">
            {identity.slice(0, 1).toUpperCase()}
          </div>
          <div className="account-copy">
            <strong>{identity}</strong>
            <span>Активная сессия</span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Выйти"
            title="Выйти"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {menuOpen ? (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Закрыть меню"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="admin-content">
        <header className="mobile-header">
          <button
            className="icon-button"
            type="button"
            aria-label="Открыть меню"
            title="Открыть меню"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={21} />
          </button>
          <strong>Бизнес-Прорыв</strong>
          <span className="mobile-spacer" />
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
