"use client";

import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  archiveOutreachPerson,
  deleteOutreachPerson,
  getOutreachPerson,
  listOutreachPeople,
  mergeOutreachPeople,
  restoreOutreachPerson,
  updateOutreachPerson
} from "@/lib/admin-api";
import { formatCompactDate, formatDateTime } from "@/lib/format";
import type {
  OutreachDeleteBlocker,
  OutreachMergeBlocker,
  OutreachPerson,
  OutreachPersonCard
} from "@ticket-platform/contracts/admin-outreach";
import {
  ArchiveRestore,
  ArrowLeft,
  Bot,
  CalendarDays,
  Mail,
  Merge,
  MessageSquare,
  Pencil,
  Phone,
  RefreshCw,
  Search,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, use, useCallback, useEffect, useState } from "react";

const CHANNEL_LABELS: Record<string, string> = {
  phone: "Звонок",
  telegram: "Telegram",
  max: "MAX",
  whatsapp: "WhatsApp",
  sms: "SMS",
  other: "Другое"
};

const RESULT_LABELS: Record<string, string> = {
  sent: "Отправлено",
  no_answer: "Не ответил",
  answered: "Ответил",
  callback: "Перезвонить",
  interested: "Заинтересован",
  declined: "Отказ",
  converted: "Оплатил",
  invalid: "Неверный контакт"
};

const BLOCKER_LABELS: Record<OutreachDeleteBlocker, string> = {
  in_bot: "человек есть в боте — там его согласия и, возможно, оплаты",
  has_activity: "по нему есть звонки и сообщения, их нельзя стирать",
  has_participation: "он записан на мероприятие"
};

const MERGE_BLOCKER_LABELS: Record<OutreachMergeBlocker, string> = {
  same_contact: "Это один и тот же контакт.",
  already_merged: "Эта карточка уже объединена с другой.",
  target_already_merged:
    "Выбранный контакт сам является дублем. Выберите того, к кому его свели."
};

const CONFLICT_FIELDS: Record<string, string> = {
  phone: "Телефон",
  telegram: "Telegram",
  max: "MAX",
  email: "Почта"
};

export default function OutreachPersonPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = use(params);
  const router = useRouter();
  const [person, setPerson] = useState<OutreachPersonCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [blockers, setBlockers] = useState<readonly OutreachDeleteBlocker[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeResults, setMergeResults] = useState<readonly OutreachPerson[]>([]);
  const [mergeSearching, setMergeSearching] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setPerson(await getOutreachPerson(id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить карточку.");
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

  function messageFor(caught: unknown, fallback: string): string {
    return caught instanceof AdminApiError ? caught.message : fallback;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = data.get(name);
      // Пустое поле — это осознанное «стереть», а не «не менять»: правка приходит целиком.
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateOutreachPerson(id, {
        name: field("name"),
        phone: field("phone"),
        telegram: field("telegram"),
        max: field("max"),
        email: field("email"),
        source: field("source"),
        note: field("note")
      });
      if (result.status === "conflict") {
        const label = CONFLICT_FIELDS[result.conflict.field] ?? "Признак";
        const owner = result.conflict.displayName ?? "другого контакта";
        setError(
          `${label} уже занят: ${owner}. Это опечатка или тот же человек заведён дважды —`
          + " во втором случае контакты нужно объединить, а не переписывать."
        );
        return;
      }
      setEditing(false);
      setNotice("Карточка сохранена.");
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить карточку."));
    } finally {
      setMutating(false);
    }
  }

  async function toggleArchive() {
    if (!person) {
      return;
    }
    if (!person.archivedAt) {
      const reason = window.prompt(
        "Убрать человека из базы? Он исчезнет из списков и подбора в кампании,"
        + " история сохранится. Почему убираем?"
      );
      if (reason === null) {
        return;
      }
      await run(
        () => archiveOutreachPerson(id, reason.trim() || undefined),
        "Человек убран из базы."
      );
      return;
    }
    await run(() => restoreOutreachPerson(id), "Человек возвращён в базу.");
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось выполнить действие."));
    } finally {
      setMutating(false);
    }
  }

  async function searchForMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = mergeQuery.trim();
    if (query.length < 2) {
      return;
    }
    setMergeSearching(true);
    setError(null);
    try {
      const page = await listOutreachPeople({ search: query, limit: 20 });
      // Себя в списке кандидатов быть не должно: объединить карточку с самой собой нельзя.
      setMergeResults(page.items.filter((item) => item.contactId !== id));
    } catch (caught) {
      setError(messageFor(caught, "Не удалось найти контакты."));
    } finally {
      setMergeSearching(false);
    }
  }

  async function merge(target: OutreachPerson) {
    const targetName = target.displayName ?? "контакт без имени";
    if (!window.confirm(
      `Признать эту карточку дублем и свести её к «${targetName}»?\n\n`
      + "История звонков, кампании и мероприятия перейдут туда. Эта карточка останется"
      + " указателем на главного — старые ссылки продолжат работать."
    )) {
      return;
    }
    const reason = window.prompt("Почему это один человек? Останется в журнале.");
    if (reason === null) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await mergeOutreachPeople(
        id,
        target.contactId,
        reason.trim() || undefined
      );
      if (!result.merged) {
        setError(
          result.blocker
            ? MERGE_BLOCKER_LABELS[result.blocker]
            : "Не удалось объединить контакты."
        );
        return;
      }
      setMerging(false);
      router.push(`/base/${target.contactId}`);
    } catch (caught) {
      setError(messageFor(caught, "Не удалось объединить контакты."));
    } finally {
      setMutating(false);
    }
  }

  async function remove() {
    if (!window.confirm(
      "Стереть человека насовсем? Это необратимо. Если нужно просто убрать его с глаз,"
      + " используйте «Убрать из базы» — оттуда можно вернуть."
    )) {
      return;
    }
    const reason = window.prompt("Почему удаляем? Останется в журнале действий.");
    if (reason === null) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    setBlockers([]);
    try {
      const result = await deleteOutreachPerson(id, reason.trim() || undefined);
      if (!result.deleted) {
        setBlockers(result.blockers);
        return;
      }
      router.push("/base");
    } catch (caught) {
      setError(messageFor(caught, "Не удалось удалить человека."));
    } finally {
      setMutating(false);
    }
  }

  if (loading && !person) {
    return <PageLoading />;
  }
  if (error) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!person) {
    return null;
  }

  const activeCampaigns = person.campaigns.filter((item) => !item.removedAt);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <Link className="back-link" href="/base">
              <ArrowLeft size={14} />
              База контактов
            </Link>
          </p>
          <h1>{person.displayName ?? "Без имени"}</h1>
          <p>
            {activeCampaigns.length > 0
              ? `Сейчас в ${activeCampaigns.length} ${activeCampaigns.length === 1 ? "кампании" : "кампаниях"}`
              : "Ни в одной кампании не состоит"}
          </p>
        </div>
        <div className="heading-actions">
          {person.archivedAt ? (
            <StatusPill tone="neutral">В архиве</StatusPill>
          ) : null}
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
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => setEditing((current) => !current)}
          >
            <Pencil size={16} />
            {editing ? "Отменить" : "Изменить"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => void toggleArchive()}
          >
            <ArchiveRestore size={16} />
            {person.archivedAt ? "Вернуть в базу" : "Убрать из базы"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating || person.mergedIntoContactId !== null}
            onClick={() => setMerging((current) => !current)}
          >
            <Merge size={16} />
            {merging ? "Отменить" : "Это дубль"}
          </button>
          <button
            className="secondary-button danger"
            type="button"
            disabled={mutating}
            onClick={() => void remove()}
          >
            <Trash2 size={16} />
            Удалить
          </button>
        </div>
      </div>

      {notice ? <div className="page-notice">{notice}</div> : null}
      {error ? <div className="page-warning">{error}</div> : null}
      {person.mergedIntoContactId ? (
        <div className="page-warning">
          <strong>Это дубль.</strong>{" "}
          Карточка признана дублем и сведена к другому человеку. История здесь уже не ведётся —
          смотрите{" "}
          <Link href={`/base/${person.mergedIntoContactId}`}>
            {person.mergedIntoDisplayName ?? "главную карточку"}
          </Link>.
        </div>
      ) : null}
      {person.mergedDuplicates > 0 ? (
        <div className="page-notice">
          Сюда сведено дублей: {person.mergedDuplicates}. Их звонки, кампании и мероприятия
          показаны ниже вместе со своими.
        </div>
      ) : null}
      {person.archivedAt && person.archivedReason ? (
        <div className="page-notice">
          Убран из базы: {person.archivedReason}
        </div>
      ) : null}
      {blockers.length > 0 ? (
        <div className="page-warning">
          <strong>Стереть насовсем нельзя.</strong>
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker}>{BLOCKER_LABELS[blocker]}</li>
            ))}
          </ul>
          Уберите его из базы — он исчезнет из списков, а история останется.
        </div>
      ) : null}

      {merging ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>С кем объединить</h2>
              <span>Найдите вторую карточку того же человека</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Закрыть"
              onClick={() => setMerging(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form className="base-search" onSubmit={(event) => void searchForMerge(event)}>
            <label className="base-search-field">
              <Search size={16} />
              <input
                value={mergeQuery}
                onChange={(event) => setMergeQuery(event.target.value)}
                placeholder="Имя, телефон, Telegram, MAX или почта"
                maxLength={100}
                autoFocus
              />
            </label>
            <button className="secondary-button" type="submit" disabled={mergeSearching}>
              {mergeSearching ? "Ищем…" : "Найти"}
            </button>
          </form>
          {mergeResults.length > 0 ? (
            <ul className="merge-candidates">
              {mergeResults.map((candidate) => (
                <li key={candidate.contactId}>
                  <div className="stacked-cell">
                    <strong>{candidate.displayName ?? "Без имени"}</strong>
                    <span className="muted">
                      {[
                        candidate.phone,
                        candidate.telegramUsername ? `@${candidate.telegramUsername}` : null,
                        candidate.email
                      ].filter(Boolean).join(" · ") || "без признаков"}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={mutating}
                    onClick={() => void merge(candidate)}
                  >
                    Свести сюда
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="muted person-meta">
            Открытая карточка станет дублем, а выбранная — главной. Ничего не пропадёт: история
            останется видна в главной карточке.
          </p>
        </section>
      ) : null}

      {editing ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Изменить карточку</h2>
              <span>Пустое поле сотрёт значение</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Закрыть"
              onClick={() => setEditing(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form className="person-edit-form" onSubmit={(event) => void save(event)}>
            <label className="person-edit-wide">
              <span>Имя</span>
              <input name="name" defaultValue={person.displayName ?? ""} maxLength={200} />
            </label>
            <label>
              <span>Телефон</span>
              <input name="phone" defaultValue={person.phone ?? ""} maxLength={100} />
            </label>
            <label>
              <span>Telegram</span>
              <input
                name="telegram"
                defaultValue={person.telegramUsername ?? ""}
                maxLength={100}
              />
            </label>
            <label>
              <span>MAX</span>
              <input name="max" defaultValue={person.maxIdentifier ?? ""} maxLength={100} />
            </label>
            <label>
              <span>Почта</span>
              <input name="email" defaultValue={person.email ?? ""} maxLength={320} />
            </label>
            <label>
              <span>Источник</span>
              <input name="source" defaultValue={person.source ?? ""} maxLength={200} />
            </label>
            <label className="person-edit-wide">
              <span>Комментарий</span>
              <textarea name="note" defaultValue={person.note ?? ""} rows={3} maxLength={2000} />
            </label>
            <button className="primary-button" type="submit" disabled={mutating}>
              {mutating ? "Сохраняем…" : "Сохранить"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="data-section">
        <div className="section-title-row">
          <div><h2>Контакты</h2></div>
        </div>
        <dl className="person-identifiers">
          <div>
            <dt><Phone size={14} /> Телефон</dt>
            <dd>{person.phone ?? <span className="muted">не знаем</span>}</dd>
          </div>
          <div>
            <dt><MessageSquare size={14} /> Telegram</dt>
            <dd>
              {person.telegramUsername
                ? `@${person.telegramUsername}`
                : <span className="muted">не знаем</span>}
            </dd>
          </div>
          <div>
            <dt><MessageSquare size={14} /> MAX</dt>
            <dd>{person.maxIdentifier ?? <span className="muted">не знаем</span>}</dd>
          </div>
          <div>
            <dt><Mail size={14} /> Почта</dt>
            <dd>{person.email ?? <span className="muted">не знаем</span>}</dd>
          </div>
          <div>
            <dt><Bot size={14} /> В боте</dt>
            <dd>
              {person.linkedUserId ? (
                <Link href={`/users/${person.linkedUserId}`}>
                  Открыть пользователя
                </Link>
              ) : (
                <span className="muted">не заходил</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Источник</dt>
            <dd>{person.source ?? <span className="muted">неизвестен</span>}</dd>
          </div>
        </dl>
        {person.note ? <p className="person-note">{person.note}</p> : null}
        <p className="muted person-meta">
          В базе с {formatCompactDate(person.createdAt)}
          {person.updatedAt !== person.createdAt
            ? `, обновлён ${formatCompactDate(person.updatedAt)}`
            : ""}
        </p>
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Кампании</h2>
            <span>{person.campaigns.length}</span>
          </div>
        </div>
        {person.campaigns.length === 0 ? (
          <p className="muted">Человек ещё ни в одной кампании не участвовал.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Кампания</th>
                  <th>Стадия</th>
                  <th>Ответственный</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {person.campaigns.map((membership) => (
                  <tr key={membership.campaignContactId}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{membership.campaignName}</strong>
                        {membership.removedAt ? (
                          <span className="muted">убран из кампании</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{membership.stageLabel}</td>
                    <td>
                      {membership.assignedAdminName ?? (
                        <span className="muted">не назначен</span>
                      )}
                    </td>
                    <td>
                      <Link
                        className="row-link"
                        href={`/outreach/${membership.campaignId}`}
                      >
                        Открыть
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {person.participations.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Мероприятия</h2>
              <span>{person.participations.length}</span>
            </div>
          </div>
          <ul className="person-events">
            {person.participations.map((participation) => (
              <li key={participation.participantId}>
                <CalendarDays size={15} />
                <Link href={`/events/${participation.eventId}/participants`}>
                  {participation.eventTitle}
                </Link>
                <span className="muted">
                  {participation.guests} чел.
                  {participation.sleepingPlaces > 0
                    ? `, мест: ${participation.sleepingPlaces}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>История</h2>
            <span>{person.activities.length}</span>
          </div>
          {/* Ради этой ленты карточка и заведена: раньше история резалась по кампаниям,
              и что человеку уже говорили, целиком не видел никто. */}
          <span className="muted">Звонки и сообщения из всех кампаний</span>
        </div>
        {person.activities.length === 0 ? (
          <p className="muted">С человеком ещё не связывались.</p>
        ) : (
          <ol className="person-timeline">
            {person.activities.map((activity) => (
              <li key={activity.id}>
                <div className="person-timeline-head">
                  <strong>{CHANNEL_LABELS[activity.channel] ?? activity.channel}</strong>
                  <StatusPill
                    tone={
                      activity.result === "converted" || activity.result === "interested"
                        ? "positive"
                        : activity.result === "declined" || activity.result === "invalid"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {RESULT_LABELS[activity.result] ?? activity.result}
                  </StatusPill>
                  <span className="muted">{formatDateTime(activity.occurredAt)}</span>
                </div>
                <div className="person-timeline-meta muted">
                  {activity.actorName} · {activity.campaignName}
                </div>
                {activity.note ? <p>{activity.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
