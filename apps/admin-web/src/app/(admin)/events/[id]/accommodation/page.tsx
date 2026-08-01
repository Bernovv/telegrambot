"use client";

import { PageError, PageLoading } from "@/components/page-state";
import { ParticipantDrawer } from "@/components/participant-drawer";
import {
  AdminApiError,
  addEventParticipant,
  fixAccommodationPlan,
  getAccommodationSummary,
  mergeAccommodationParties,
  removeEventParticipant,
  splitAccommodationGroup
} from "@/lib/admin-api";
import { formatDateTime, formatKopecks } from "@/lib/format";
import type {
  AccommodationPartyView,
  AccommodationSummary,
  EventParticipant,
  EventParticipantSource
} from "@ticket-platform/contracts/admin-accommodation";
import {
  ArrowLeft,
  CircleAlert,
  Link2,
  Link2Off,
  Plus,
  RefreshCw,
  Save,
  Tent,
  Trash2,
  Users,
  UtensilsCrossed,
  X
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function EventAccommodationPage() {
  const { id } = useParams<{ id: string }>();
  const [summary, setSummary] = useState<AccommodationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [openParticipantId, setOpenParticipantId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await getAccommodationSummary(id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить сводку.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function run(work: () => Promise<unknown>, done: string) {
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      setSelected([]);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось сохранить изменение.");
    } finally {
      setMutating(false);
    }
  }

  async function submitParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const number = (name: string) => Number.parseInt(text(name) || "0", 10);

    await run(
      () => addEventParticipant(id, {
        displayName: text("displayName"),
        source: text("source") as EventParticipantSource,
        adults: number("adults"),
        children: number("children"),
        sleepingPlaces: number("sleepingPlaces"),
        ...(text("phone") ? { phone: text("phone") } : {}),
        ...(text("ticketTitle") ? { ticketTitle: text("ticketTitle") } : {}),
        ...(text("note") ? { note: text("note") } : {})
      }),
      "Участник добавлен."
    );
    form.reset();
    setAddOpen(false);
  }

  function toggle(key: string) {
    setSelected((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]);
  }

  if (loading && !summary) {
    return <PageLoading label="Считаем, что везём" />;
  }
  if (error && !summary) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!summary) {
    return <PageError message="Сводка недоступна." retry={() => void load()} />;
  }

  const openParticipant: EventParticipant | null = openParticipantId === null
    ? null
    : summary.participants.find((person) => person.id === openParticipantId) ?? null;

  const selectedOrderIds = summary.parties
    .filter((party) => selected.includes(party.key))
    .flatMap((party) => party.orderIds);

  return (
    <>
      <Link className="back-link" href={`/events/${id}`}>
        <ArrowLeft size={16} />
        Мероприятие
      </Link>

      <div className="page-heading accommodation-heading">
        <div>
          <p className="eyebrow">Логистика</p>
          <h1>Что везём</h1>
          <p>
            {summary.eventTitle}
            {" · посчитано "}
            {formatDateTime(summary.calculatedAt)}
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button bordered"
            type="button"
            title="Пересчитать"
            aria-label="Пересчитать"
            disabled={loading || mutating}
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
          {summary.canManage ? (
            <button
              className="primary-button"
              type="button"
              disabled={mutating}
              onClick={() => void run(
                () => fixAccommodationPlan({ eventId: id }),
                "План зафиксирован."
              )}
            >
              <Save size={16} />
              Зафиксировать план
            </button>
          ) : null}
        </div>
      </div>

      {notice ? <div className="outreach-notice">{notice}</div> : null}
      {error ? <PageError message={error} retry={() => void load()} /> : null}

      <div className="metrics-strip">
        <div>
          <span>Гостей</span>
          <strong>{summary.headcount.guests}</strong>
          <small className="muted">
            {summary.headcount.adults} взрослых, {summary.headcount.children} детей
            {" · "}
            {summary.guestsFromOrders} из бота, {summary.guestsFromParticipants} завели руками
          </small>
        </div>
        <div>
          <span>Спальных мест</span>
          <strong>{summary.requiredBerths}</strong>
          <small className="muted">входит в билеты с ночёвкой</small>
        </div>
        <div>
          <span>Порций питания</span>
          <strong>{summary.mealsAdult + summary.mealsChild}</strong>
          <small className="muted">
            {summary.mealsAdult} взрослых, {summary.mealsChild} детских
            {" · "}
            {summary.eventDays} дн.
          </small>
        </div>
        <div>
          <span>Палаток</span>
          <strong>{summary.totalTents}</strong>
          <small className="muted">
            {summary.tents.length > 0
              ? summary.tents
                .map((tent) => `${tent.count} × ${tent.capacity}-мест.`)
                .join(", ")
              : "ночующих нет"}
          </small>
        </div>
      </div>

      {summary.lastPlan ? (
        <div className={summary.berthsSinceLastPlan > 0 ? "plan-banner plan-banner-stale" : "plan-banner"}>
          <div>
            <strong>
              План зафиксирован {formatDateTime(summary.lastPlan.fixedAt)}
              {summary.lastPlan.fixedByAdminName
                ? ` · ${summary.lastPlan.fixedByAdminName}`
                : ""}
            </strong>
            <span>
              {summary.lastPlan.totalTents} палаток на {summary.lastPlan.requiredBerths} мест
            </span>
          </div>
          {summary.berthsSinceLastPlan > 0 ? (
            <span className="plan-delta">
              <CircleAlert size={16} />
              После фиксации добавилось мест: {summary.berthsSinceLastPlan}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="plan-banner">
          <div>
            <strong>План ещё не фиксировали</strong>
            <span>Зафиксируйте перед погрузкой — потом будет видно, что изменилось.</span>
          </div>
        </div>
      )}

      {summary.excludedOrders > 0 ? (
        <div className="accommodation-note">
          <CircleAlert size={16} />
          <span>
            Заказов помечено тестовыми: <strong>{summary.excludedOrders}</strong>. В расчёт
            они не идут, из финансовой истории не удалены.
          </span>
        </div>
      ) : null}

      {summary.childrenWithoutBerth > 0 ? (
        <div className="accommodation-warning">
          <CircleAlert size={16} />
          <span>
            Детей в заказах с ночёвкой без своего спального места:{" "}
            <strong>{summary.childrenWithoutBerth}</strong>. Детский билет ночёвку не
            включает — спросите родителей, нужно ли место.
          </span>
        </div>
      ) : null}

      {summary.mergeSuggestion ? (
        <div className="accommodation-warning">
          <CircleAlert size={16} />
          <span>
            Одиночек: <strong>{summary.mergeSuggestion.singleParties}</strong>. Сейчас это{" "}
            {summary.mergeSuggestion.tentsNow} палаток, при подселении хватило бы{" "}
            {summary.mergeSuggestion.tentsIfMerged}. Незнакомых сама система не селит —
            договоритесь и объедините вручную.
          </span>
        </div>
      ) : null}

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Участники не из Telegram-бота</h2>
            <span>
              {summary.participants.length > 0
                ? `${summary.participants.length} · ${summary.guestsFromParticipants} гостей`
                : "MAX, сайт, договорились напрямую"}
            </span>
          </div>
          {summary.canManageParticipants ? (
            <div className="outreach-toolbar-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={mutating}
                onClick={() => setAddOpen((current) => !current)}
              >
                {addOpen ? <X size={16} /> : <Plus size={16} />}
                {addOpen ? "Отменить" : "Добавить участника"}
              </button>
            </div>
          ) : null}
        </div>

        {addOpen ? (
          <form className="participant-form" onSubmit={(event) => void submitParticipant(event)}>
            <label className="field">
              <span>Имя</span>
              <input name="displayName" required maxLength={200} autoFocus />
            </label>
            <label className="field">
              <span>Телефон</span>
              <input name="phone" placeholder="+79000000000" pattern="\+[1-9][0-9]{7,14}" />
            </label>
            <label className="field">
              <span>Откуда</span>
              <select name="source" defaultValue="direct">
                <option value="max">MAX</option>
                <option value="site">Сайт</option>
                <option value="direct">Договорились напрямую</option>
                <option value="other">Другое</option>
              </select>
            </label>
            <label className="field">
              <span>Тариф</span>
              <input name="ticketTitle" maxLength={200} placeholder="Все включено" />
            </label>
            <label className="field">
              <span>Взрослых</span>
              <input name="adults" type="number" min={0} max={100} defaultValue={1} required />
            </label>
            <label className="field">
              <span>Детей</span>
              <input name="children" type="number" min={0} max={100} defaultValue={0} required />
            </label>
            <label className="field">
              <span>Спальных мест</span>
              <input name="sleepingPlaces" type="number" min={0} max={200} defaultValue={0} required />
            </label>
            <label className="field field-full">
              <span>Заметка</span>
              <input name="note" maxLength={500} placeholder="Например: оплатил переводом 5 августа" />
            </label>
            <button className="primary-button" type="submit" disabled={mutating}>
              Добавить
            </button>
          </form>
        ) : null}

        {summary.participants.length === 0 ? (
          <div className="outreach-empty">
            <strong>Пока никого не завели</strong>
            <span>
              Здесь живут те, кто купил не через Telegram-бота. Без них сводка выше считает
              не всех.
            </span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Откуда</th>
                  <th>Тариф</th>
                  <th>Гостей</th>
                  <th>Мест</th>
                  <th>Сумма</th>
                  <th>{summary.canManageParticipants ? "Действия" : ""}</th>
                </tr>
              </thead>
              <tbody>
                {summary.participants.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <button
                        className="outreach-contact-link"
                        type="button"
                        onClick={() => setOpenParticipantId(person.id)}
                      >
                        <strong>{person.displayName}</strong>
                        <span>{person.phone ?? "телефон не указан"}</span>
                      </button>
                      {person.note ? <span className="muted">{person.note}</span> : null}
                    </td>
                    <td>{sourceLabel(person.source)}</td>
                    <td>{person.ticketTitle || "—"}</td>
                    <td>
                      {person.adults + person.children}
                      {person.children > 0 ? (
                        <span className="muted"> · детей {person.children}</span>
                      ) : null}
                    </td>
                    <td>{person.sleepingPlaces > 0 ? person.sleepingPlaces : "—"}</td>
                    <td className="money-cell">
                      {person.amountKopecks ? formatKopecks(person.amountKopecks) : "—"}
                    </td>
                    <td>
                      {summary.canManageParticipants ? (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={mutating}
                          onClick={() => {
                            const reason = window.prompt(
                              `Почему убираем ${person.displayName}? Причина попадёт в историю.`
                            );
                            if (reason && reason.trim().length >= 3) {
                              void run(
                                () => removeEventParticipant({
                                  eventId: id,
                                  participantId: person.id,
                                  reason: reason.trim()
                                }),
                                "Участник убран из мероприятия."
                              );
                            }
                          }}
                        >
                          <Trash2 size={15} />
                          Убрать
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Кто где спит</h2>
            <span>{summary.parties.length} компаний</span>
          </div>
          {summary.canManage ? (
            <div className="outreach-toolbar-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={mutating || selected.length < 2}
                onClick={() => void run(
                  () => mergeAccommodationParties({
                    eventId: id,
                    orderIds: selectedOrderIds
                  }),
                  "Компании объединены — селим вместе."
                )}
              >
                <Link2 size={16} />
                Селить вместе ({selected.length})
              </button>
            </div>
          ) : null}
        </div>

        {summary.parties.length === 0 ? (
          <div className="outreach-empty">
            <strong>Ночующих пока нет</strong>
            <span>Палатки нужны только для билетов, куда входит спальное место.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {summary.canManage ? <th><span className="sr-only">Выбрать</span></th> : null}
                  <th>Компания</th>
                  <th>Мест</th>
                  <th>Палатки</th>
                  <th>Заказы</th>
                  <th>{summary.canManage ? "Действия" : ""}</th>
                </tr>
              </thead>
              <tbody>
                {summary.parties.map((party) => (
                  <PartyRow
                    key={party.key}
                    party={party}
                    canManage={summary.canManage}
                    mutating={mutating}
                    checked={selected.includes(party.key)}
                    onToggle={() => toggle(party.key)}
                    onSplit={() => {
                      if (party.groupId) {
                        void run(
                          () => splitAccommodationGroup({
                            eventId: id,
                            groupId: party.groupId as string
                          }),
                          "Компания разъединена."
                        );
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>По тарифам</h2>
            <span>только оплаченные заказы</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Тариф</th>
                <th>Билетов</th>
                <th>Гостей</th>
                <th>Взрослых</th>
                <th>Детей</th>
                <th>Спальных мест</th>
              </tr>
            </thead>
            <tbody>
              {summary.products.map((product) => (
                <tr key={product.productId}>
                  <td><strong>{product.title}</strong></td>
                  <td>{product.ticketsSold}</td>
                  <td>{product.guests}</td>
                  <td>{product.adults}</td>
                  <td>{product.children}</td>
                  <td>{product.sleepingPlaces > 0 ? product.sleepingPlaces : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {openParticipant ? (
        <ParticipantDrawer
          eventId={id}
          participant={openParticipant}
          fields={summary.participantFields}
          canManage={summary.canManageParticipants}
          onClose={() => setOpenParticipantId(null)}
          onSaved={() => load()}
        />
      ) : null}

      <div className="accommodation-footnotes">
        <p>
          <Users size={15} aria-hidden="true" />
          Компания — это заказ: люди, которые купили вместе, спят вместе. Ребёнок занимает
          полноценное место.
        </p>
        <p>
          <Tent size={15} aria-hidden="true" />
          Палатки подбираются так, чтобы пустых мест было меньше, а при равном результате —
          чтобы палаток было меньше. Размеры: {summary.tentCapacities.join(" и ")} мест.
        </p>
        <p>
          <UtensilsCrossed size={15} aria-hidden="true" />
          Питание считается на всех гостей за каждый день мероприятия, включая тех, кто
          уезжает на ночь.
        </p>
      </div>
    </>
  );
}

function sourceLabel(source: EventParticipantSource): string {
  switch (source) {
    case "max":
      return "MAX";
    case "site":
      return "Сайт";
    case "direct":
      return "Напрямую";
    default:
      return "Другое";
  }
}

function PartyRow({
  party,
  canManage,
  mutating,
  checked,
  onToggle,
  onSplit
}: {
  readonly party: AccommodationPartyView;
  readonly canManage: boolean;
  readonly mutating: boolean;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly onSplit: () => void;
}) {
  return (
    <tr>
      {canManage ? (
        <td>
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`Выбрать ${party.title}`}
          />
        </td>
      ) : null}
      <td>
        <div className="stacked-cell">
          <strong>{party.title}</strong>
          {party.merged ? (
            <span className="accommodation-merged">
              <Link2 size={13} /> селим вместе
            </span>
          ) : null}
          {party.note ? <span className="muted">{party.note}</span> : null}
        </div>
      </td>
      <td>{party.berths}</td>
      <td>
        {party.tents.map((capacity) => `${capacity}-мест.`).join(" + ")}
        {party.emptyBerths > 0 ? (
          <span className="muted"> · свободно {party.emptyBerths}</span>
        ) : null}
      </td>
      <td className="muted">{party.orderNumbers.join(", ")}</td>
      <td>
        {canManage && party.groupId ? (
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={onSplit}
          >
            <Link2Off size={15} />
            Разъединить
          </button>
        ) : null}
      </td>
    </tr>
  );
}
