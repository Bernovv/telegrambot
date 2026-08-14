"use client";

import { useEventWorkspace } from "@/components/event-workspace";
import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  getEventParticipants,
  setParticipantAttendance
} from "@/lib/admin-api";
import { formatTime } from "@/lib/format";
import type {
  EventParticipantRow,
  EventParticipantsView
} from "@ticket-platform/contracts/admin-participants";
import { Check, RefreshCw, Search, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type AttendanceTab = "waiting" | "arrived" | "all";

/**
 * Отметка явки на входе в зал.
 *
 * Экран рассчитан на один телефон в одной руке: список приезжает целиком и ищется на
 * месте, без запроса на каждую букву, а отметка ставится сразу в интерфейсе и только потом
 * уходит на сервер. У входа очередь, и ждать ответа сети на каждого человека нельзя.
 *
 * Отмена отметки стоит рядом с отметкой и такая же простая: промах по соседней строке —
 * обычное дело, когда список листают пальцем.
 */
export default function EventAttendancePage() {
  const { event } = useEventWorkspace();
  const [view, setView] = useState<EventParticipantsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<AttendanceTab>("waiting");
  const [saving, setSaving] = useState<readonly string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setView(await getEventParticipants(event.id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить список.");
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

  const rows = useMemo(() => {
    if (!view) {
      return [];
    }
    const needle = search.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return view.rows.filter((row) => {
      if (tab === "waiting" && row.attendedAt !== null) {
        return false;
      }
      if (tab === "arrived" && row.attendedAt === null) {
        return false;
      }
      if (needle === "") {
        return true;
      }
      return matches(row, needle, digits);
    });
  }, [view, search, tab]);

  const mark = useCallback(async (row: EventParticipantRow, attended: boolean) => {
    if (!view) {
      return;
    }
    const previous = view;
    setFailed(null);
    setSaving((current) => [...current, row.key]);
    // Отметка появляется на экране сразу: у входа очередь, и ждать ответа сети нельзя.
    setView(withAttendance(view, row.key, attended ? new Date().toISOString() : null));
    try {
      await setParticipantAttendance(event.id, {
        ...(row.orderId === null
          ? { participantId: row.participantId as string }
          : { orderId: row.orderId }),
        attended
      });
    } catch (caught) {
      // Не сохранилось — возвращаем список как был. Отметка, которая есть на экране и
      // которой нет в базе, хуже отсутствующей: по ней потом считают пришедших.
      setView(previous);
      setFailed(caught instanceof AdminApiError
        ? caught.message
        : `Не удалось отметить: ${row.displayName}. Попробуйте ещё раз.`);
    } finally {
      setSaving((current) => current.filter((key) => key !== row.key));
    }
  }, [event.id, view]);

  if (loading && !view) {
    return <PageLoading label="Собираем список" />;
  }
  if (error && !view) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!view) {
    return <PageError message="Список недоступен." retry={() => void load()} />;
  }

  const { attended, registered } = view.attendance;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Явка</p>
          <h1>Кто пришёл</h1>
          <p>
            Отмечайте на входе. Отметка сохраняется сразу, отменить можно тут же.
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

      {failed ? <div className="accommodation-warning"><span>{failed}</span></div> : null}

      <div className="metrics-strip">
        <div>
          <span>Пришло</span>
          <strong>{attended} из {registered}</strong>
          <small className="muted">
            {registered === 0
              ? "в списке пока никого"
              : `не отмечено ${registered - attended}`}
          </small>
        </div>
      </div>

      <form className="participants-filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={search}
            placeholder="Имя, телефон или почта"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="attendance-tabs" role="group" aria-label="Кого показывать">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "base-chip active" : "base-chip"}
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="muted">
          {search.trim() === ""
            ? "Здесь пусто."
            : "Никого не нашли. Проверьте написание или поищите по телефону."}
        </p>
      ) : (
        <ul className="attendance-list">
          {rows.map((row) => (
            <li
              key={row.key}
              className={row.attendedAt === null
                ? "attendance-row"
                : "attendance-row attendance-row-done"}
            >
              <div className="attendance-person">
                <strong>{row.displayName}</strong>
                <small className="muted">{describe(row)}</small>
              </div>
              {row.attendedAt === null ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving.includes(row.key) || !view.canManageParticipants}
                  onClick={() => void mark(row, true)}
                >
                  <Check size={18} />
                  Пришёл
                </button>
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving.includes(row.key) || !view.canManageParticipants}
                  onClick={() => void mark(row, false)}
                >
                  <Undo2 size={16} />
                  {formatTime(row.attendedAt)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const TABS: readonly { readonly id: AttendanceTab; readonly label: string }[] = [
  { id: "waiting", label: "Ждём" },
  { id: "arrived", label: "Пришли" },
  { id: "all", label: "Все" }
];

/** Чем человека узнать в очереди: телефон, почта, ник — что есть. */
function describe(row: EventParticipantRow): string {
  const parts = [
    row.phone,
    row.email,
    row.telegramUsername === null ? null : `@${row.telegramUsername}`
  ].filter((part): part is string => part !== null && part !== "");
  return parts.length === 0 ? "контактов нет" : parts.join(" · ");
}

function withAttendance(
  view: EventParticipantsView,
  key: string,
  attendedAt: string | null
): EventParticipantsView {
  const rows = view.rows.map((row) =>
    row.key === key ? { ...row, attendedAt } : row);
  return {
    ...view,
    rows,
    attendance: {
      registered: view.attendance.registered,
      attended: rows.filter((row) => row.attendedAt !== null).length
    }
  };
}

/**
 * Поиск тот же, что в списке участников, плюс почта: на входе человек называет себя как
 * попало, а найти его надо с первой попытки. Телефон ищется только по цифрам и от трёх —
 * иначе запрос «7» выдаёт весь зал.
 */
function matches(
  row: EventParticipantRow,
  needle: string,
  digits: string
): boolean {
  const haystack = [
    row.displayName,
    row.email,
    row.telegramUsername,
    row.orderNumber
  ];
  for (const value of haystack) {
    if (value && value.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return digits.length >= 3
    && (row.phone ?? "").replace(/\D/g, "").includes(digits);
}
