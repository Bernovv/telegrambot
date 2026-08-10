"use client";

import { useEventWorkspace } from "@/components/event-workspace";
import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  addEventOrganizer,
  getEventTeam,
  removeEventOrganizer,
  updateEventOrganizer
} from "@/lib/admin-api";
import { formatDateTime, formatKopecks } from "@/lib/format";
import type { EventTeamView } from "@ticket-platform/contracts/admin-organizers";
import { CircleAlert, Plus, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function EventTeamPage() {
  const { event } = useEventWorkspace();
  const [view, setView] = useState<EventTeamView | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setView(await getEventTeam(event.id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить команду.");
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

  async function run(work: () => Promise<unknown>) {
    setMutating(true);
    setError(null);
    try {
      await work();
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось сохранить изменение.");
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function submitOrganizer(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };

    const ok = await run(() => addEventOrganizer(event.id, {
      personName: text("personName"),
      sharePercent: text("sharePercent") || "0",
      ...(text("roleLabel") ? { roleLabel: text("roleLabel") } : {}),
      ...(text("responsibilities") ? { responsibilities: text("responsibilities") } : {}),
      ...(text("note") ? { note: text("note") } : {})
    }));
    if (ok) {
      form.reset();
      setAddOpen(false);
    }
  }

  if (loading && !view) {
    return <PageLoading label="Считаем прибыль" />;
  }
  if (error && !view) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!view) {
    return <PageError message="Команда недоступна." retry={() => void load()} />;
  }

  const profit = BigInt(view.profit.profitKopecks);
  const unallocated = BigInt(view.unallocatedKopecks);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Команда</p>
          <h1>Кто работает и кто сколько получает</h1>
          <p>Посчитано {formatDateTime(view.calculatedAt)}</p>
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
          {view.canManage ? (
            <button
              className="primary-button"
              type="button"
              disabled={mutating}
              onClick={() => setAddOpen((current) => !current)}
            >
              {addOpen ? <X size={16} /> : <Plus size={16} />}
              {addOpen ? "Отменить" : "Добавить человека"}
            </button>
          ) : (
            <span className="readonly-badge">Только просмотр</span>
          )}
        </div>
      </div>

      {error ? <PageError message={error} retry={() => void load()} /> : null}

      <div className="metrics-strip">
        <div>
          <span>Выручка</span>
          <strong>{formatKopecks(view.profit.revenueKopecks)}</strong>
          <small className="muted">
            бот {formatKopecks(view.profit.revenueFromOrdersKopecks)}
            {" · руками "}
            {formatKopecks(view.profit.revenueFromManualKopecks)}
          </small>
        </div>
        <div>
          <span>Расходы</span>
          <strong>{formatKopecks(view.profit.expensesKopecks)}</strong>
          <small className="muted">фактические, без отменённых</small>
        </div>
        <div>
          <span>Прибыль</span>
          <strong className={profit < 0n ? "money-negative" : undefined}>
            {formatKopecks(view.profit.profitKopecks)}
          </strong>
          <small className="muted">
            {view.profit.preliminary ? "предварительно" : "расход посчитан целиком"}
          </small>
        </div>
        <div>
          <span>Роздано долей</span>
          <strong>{view.allocatedPercent}%</strong>
          <small className="muted">
            {unallocated === 0n
              ? "распределено полностью"
              : `не распределено ${formatKopecks(view.unallocatedKopecks)}`}
          </small>
        </div>
      </div>

      {view.profit.preliminary ? (
        <div className="accommodation-warning">
          <CircleAlert size={16} />
          <span>
            Расчёт предварительный: у{" "}
            <strong>{view.profit.expensesWithoutActual}</strong> строк расхода ещё нет
            факта. Прибыль сейчас завышена, а доли вместе с ней — впишите факт на вкладке{" "}
            <Link href={`/events/${event.id}/expenses`}>Расходы</Link>.
          </span>
        </div>
      ) : null}

      <div className="accommodation-note">
        <CircleAlert size={16} />
        <span>
          Твёрдые оплаты — повар, фотограф — здесь не заводятся: это строка в расходах по
          статье «Персонал и подряд». Иначе одни и те же деньги посчитались бы дважды.
        </span>
      </div>

      {addOpen ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Новый человек в команде</h2>
              <span>доля — процент от прибыли</span>
            </div>
          </div>
          <form className="participant-form" onSubmit={(e) => void submitOrganizer(e)}>
            <label className="field">
              <span>Имя</span>
              <input name="personName" required maxLength={200} autoFocus />
            </label>
            <label className="field">
              <span>Роль</span>
              <input name="roleLabel" maxLength={80} placeholder="Организатор" />
            </label>
            <label className="field">
              <span>Доля, %</span>
              <input
                name="sharePercent"
                inputMode="decimal"
                defaultValue="0"
                required
                placeholder="33.33"
              />
            </label>
            <label className="field field-full">
              <span>За что отвечает</span>
              <input name="responsibilities" maxLength={1000} />
            </label>
            <label className="field field-full">
              <span>Заметка</span>
              <input name="note" maxLength={1000} />
            </label>
            <button className="primary-button" type="submit" disabled={mutating}>
              Добавить
            </button>
          </form>
        </section>
      ) : null}

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Команда</h2>
            <span>{view.organizers.length} человек</span>
          </div>
        </div>
        {view.organizers.length === 0 ? (
          <div className="outreach-empty">
            <strong>Команда пока не заведена</strong>
            <span>
              Добавьте тех, кто делит прибыль. Сумма долей не может быть больше ста
              процентов — остаток виден отдельной строкой.
            </span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Человек</th>
                  <th>Роль</th>
                  <th>Доля</th>
                  <th>Сумма</th>
                  <th>{view.canManage ? "Действия" : ""}</th>
                </tr>
              </thead>
              <tbody>
                {view.organizers.map((organizer) => {
                  const share = BigInt(organizer.shareKopecks);
                  return (
                    <tr key={organizer.id}>
                      <td>
                        <div className="stacked-cell">
                          <strong>{organizer.personName}</strong>
                          {organizer.responsibilities ? (
                            <span className="muted">{organizer.responsibilities}</span>
                          ) : null}
                          {organizer.note ? (
                            <span className="muted">{organizer.note}</span>
                          ) : null}
                        </div>
                      </td>
                      <td>{organizer.roleLabel || "—"}</td>
                      <td>
                        {view.canManage ? (
                          <input
                            className="share-input"
                            inputMode="decimal"
                            defaultValue={organizer.sharePercent}
                            aria-label={`Доля ${organizer.personName}`}
                            disabled={mutating}
                            onBlur={(e) => {
                              const next = e.target.value.trim();
                              if (next !== organizer.sharePercent) {
                                void run(() => updateEventOrganizer(event.id, {
                                  organizerId: organizer.id,
                                  sharePercent: next
                                }));
                              }
                            }}
                          />
                        ) : (
                          organizer.sharePercent
                        )}
                        {" %"}
                      </td>
                      <td
                        className={
                          share < 0n ? "money-cell money-negative" : "money-cell"
                        }
                      >
                        {formatKopecks(organizer.shareKopecks)}
                      </td>
                      <td>
                        {view.canManage ? (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={mutating}
                            onClick={() => {
                              const sure = window.confirm(
                                `Убрать ${organizer.personName} из команды?`
                              );
                              if (sure) {
                                void run(() => removeEventOrganizer(event.id, {
                                  organizerId: organizer.id
                                }));
                              }
                            }}
                          >
                            <Trash2 size={15} />
                            Убрать
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
