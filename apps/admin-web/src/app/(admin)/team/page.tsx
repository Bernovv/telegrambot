"use client";

import { useNotice } from "@/lib/use-notice";
import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import { MentorCalendar } from "@/components/mentor-calendar";
import {
  AdminApiError,
  getStaff,
  setStaffRole
} from "@/lib/admin-api";
import type {
  StaffMember,
  StaffRole,
  StaffView
} from "@ticket-platform/contracts/admin-staff";
import { CalendarClock, RefreshCw, ShieldCheck, UserRound, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Три роли — три ответа на вопрос «что человек здесь делает».
 *
 * Прежние технические роли (`super_admin`, `sales_manager`) с этой страницы не выдают:
 * они остались у тех, кому уже выданы, и их видно строкой под именем. Заводить четвёртый
 * и пятый способ описать одного и того же человека не стоит — ровно из-за этого роли и
 * переделывались.
 */
const ROLES: readonly {
  readonly code: StaffRole;
  readonly title: string;
  readonly description: string;
  readonly icon: typeof ShieldCheck;
}[] = [
  {
    code: "head",
    title: "Руководители",
    description: "Видят и меняют всё: деньги, роли, настройки воронок.",
    icon: ShieldCheck
  },
  {
    code: "manager",
    title: "Менеджеры",
    description:
      "Обзванивают, ведут базу, задачи и мероприятия. Записывают клиентов к наставникам.",
    icon: Users
  },
  {
    code: "mentor",
    title: "Наставники",
    description:
      "Проводят личные встречи. Свободные окошки из их календаря видит менеджер в карточке клиента.",
    icon: CalendarClock
  }
];

export default function TeamPage() {
  const [view, setView] = useState<StaffView | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setView(await getStaff(signal));
    } catch (caught) {
      if (!signal?.aborted) {
        // Роли у смотрящего может не быть вовсе: раздел видно всем, а открывается он по
        // разрешению. «Ошибка 403» на такое отвечает не тем словом.
        setError(caught instanceof AdminApiError && caught.status === 403
          ? "Раздел «Команда» открыт руководителям, менеджерам и наставникам."
            + " Попросите руководителя выдать роль."
          : caught instanceof AdminApiError
            ? caught.message
            : "Не удалось загрузить команду.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function toggleRole(
    member: StaffMember,
    role: StaffRole,
    granted: boolean
  ) {
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      await setStaffRole({ adminId: member.adminId, role, granted });
      setNotice(granted
        ? `${member.displayName}: роль выдана.`
        : `${member.displayName}: роль снята.`);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось изменить роль.");
    } finally {
      setMutating(false);
    }
  }

  if (loading && !view) {
    return <PageLoading />;
  }
  if (error && !view) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!view) {
    return null;
  }

  const withoutRole = view.members.filter((member) =>
    member.roles.length === 0 && member.status === "active");

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Кабинет</p>
          <h1>Команда</h1>
          <p>
            Кто здесь работает и что ему доступно. Роль определяет, какие разделы человек
            видит и что в них может менять.
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

      {notice ? <div className="page-notice">{notice}</div> : null}
      {error ? <div className="page-warning">{error}</div> : null}
      {!view.canManageRoles ? (
        <div className="page-notice">
          Роли меняет руководитель. Здесь видно, кто чем занимается.
        </div>
      ) : null}

      <div className="team-groups">
        {ROLES.map((role) => {
          const Icon = role.icon;
          const members = view.members.filter((member) =>
            member.roles.includes(role.code));
          return (
            <section className="data-section team-group" key={role.code}>
              <div className="section-title-row">
                <div>
                  <h2>
                    <Icon size={18} aria-hidden="true" /> {role.title}
                  </h2>
                  <span>{role.description}</span>
                </div>
                <StatusPill tone="neutral">{members.length}</StatusPill>
              </div>
              {members.length === 0 ? (
                <p className="muted person-empty">
                  Пока никого. Отметьте роль в списке ниже.
                </p>
              ) : (
                <ul className="person-list person-list-tight">
                  {members.map((member) => (
                    <li key={member.adminId}>
                      <div className="person-list-main">
                        <strong>{member.displayName}</strong>
                        <span className="person-list-sub">
                          {member.email ?? "почта не известна"}
                          {role.code === "mentor"
                            ? ` · свободных окошек: ${member.freeSlots}`
                            : ""}
                          {member.status === "suspended" ? " · вход закрыт" : ""}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Все, у кого есть вход</h2>
            <span>
              Отметьте роли. Человек может быть сразу и менеджером, и наставником —
              так и бывает.
            </span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="team-table">
            <thead>
              <tr>
                <th scope="col">Человек</th>
                {ROLES.map((role) => (
                  <th scope="col" key={role.code}>{role.title}</th>
                ))}
                <th scope="col">Окошки</th>
              </tr>
            </thead>
            <tbody>
              {view.members.map((member) => (
                <tr key={member.adminId}>
                  <th scope="row">
                    <div className="person-list-main">
                      <strong>
                        <UserRound size={14} aria-hidden="true" /> {member.displayName}
                      </strong>
                      <span className="person-list-sub">
                        {member.email ?? "почта не известна"}
                        {member.status === "suspended" ? " · вход закрыт" : ""}
                        {member.legacyRoleCodes.length > 0
                          ? ` · прежние роли: ${member.legacyRoleCodes.join(", ")}`
                          : ""}
                      </span>
                    </div>
                  </th>
                  {ROLES.map((role) => (
                    <td key={role.code}>
                      <label className="team-role-toggle">
                        <input
                          type="checkbox"
                          checked={member.roles.includes(role.code)}
                          disabled={!view.canManageRoles || mutating}
                          aria-label={`${role.title}: ${member.displayName}`}
                          onChange={(event) =>
                            void toggleRole(member, role.code, event.target.checked)}
                        />
                      </label>
                    </td>
                  ))}
                  <td>
                    {member.roles.includes("mentor")
                      ? `${member.freeSlots} свободно · ${member.bookedSlots} занято`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {withoutRole.length > 0 ? (
          <p className="muted">
            Без роли: {withoutRole.length}. Такой человек входит в панель, но не видит
            ничего.
          </p>
        ) : null}
        {/* Учётные записи заводятся в Supabase Auth, а не здесь: там живут пароль и второй
            фактор. Панель только выдаёт роль уже существующему человеку — и об этом
            приходится сказать прямо, иначе на этой странице ищут кнопку «Добавить». */}
        <p className="muted">
          Нового человека сначала заводят в Supabase Auth, а затем выдают ему первую роль
          скриптом <code>scripts/grant-admin.ts</code> на сервере. После этого он появится
          в этом списке, и роли ему меняют отсюда.
        </p>
      </section>

      <MentorCalendar
        mentors={view.members.filter((member) => member.roles.includes("mentor"))}
        canManageSlots={view.canManageSlots}
        canBookSlots={view.canBookSlots}
        viewerAdminId={view.viewerAdminId}
        onNotice={setNotice}
        onError={setError}
      />
    </>
  );
}
