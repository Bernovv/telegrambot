"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  CalendarDays,
  Megaphone,
  LogOut,
  Menu,
  ReceiptText,
  ShieldCheck,
  Users,
  X
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

const NAVIGATION = [
  { href: "/events", label: "Мероприятия", icon: CalendarDays },
  { href: "/users", label: "Пользователи", icon: Users },
  { href: "/outreach", label: "Работа с базой", icon: Megaphone },
  { href: "/orders", label: "Заказы", icon: ReceiptText }
] as const;

export function AdminShell({
  identity,
  children
}: Readonly<{ identity: string; children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

  return (
    <div className="admin-frame">
      <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={20} />
          </div>
          <div>
            <strong>Ticket Ops</strong>
            <span>Control room</span>
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

        <nav className="sidebar-nav" aria-label="Основная навигация">
          <span className="nav-caption">Операции</span>
          {NAVIGATION.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                className={active ? "nav-link nav-link-active" : "nav-link"}
                href={item.href}
                onClick={() => setMenuOpen(false)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
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
          <strong>Ticket Ops</strong>
          <span className="mobile-spacer" />
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
