"use client";

import { StatusPill } from "@/components/status-pill";
import {
  formatCompactDate,
  formatDateTime,
  formatKopecks,
  orderStatusLabel,
  orderStatusTone
} from "@/lib/format";
import {
  channelLabel,
  lostReasonLabel,
  statusLabel,
  taskTypeLabel
} from "@/lib/outreach-labels";
import type {
  OutreachPersonCard,
  OutreachPersonQuestionnaire
} from "@ticket-platform/contracts/admin-outreach";
import {
  Bot,
  ExternalLink,
  Mail,
  MessageSquare,
  Phone,
  Send,
  StickyNote,
  Tag,
  Trash2
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

/**
 * Карточка человека по кускам.
 *
 * Те же разделы показывают в двух местах: на своей странице в базе контактов и в панели
 * справа, когда контакт открывают прямо из воронки. Раньше в воронке была своя урезанная
 * версия — без денег, заметок, анкет и истории по другим кампаниям, — и менеджер звонил,
 * не зная половины того, что о человеке уже известно.
 */

const PHONE_STATUS_LABELS: Record<string, string> = {
  unknown: "не знаем",
  imported: "из импорта, не подтверждён",
  verified: "подтверждён в боте",
  rejected: "человек отказался дать"
};

const SITE_REGISTRATION_LABELS: Record<string, string> = {
  registered: "записан на встречу",
  duplicate: "повтор заявки",
  unassigned: "встреча не нашлась"
};

/** Русские числительные: «1 задача», «2 задачи», «5 задач». */
export function plural(count: number, one: string, few: string, many: string): string {
  const last = count % 10;
  const lastTwo = count % 100;
  if (last === 1 && lastTwo !== 11) {
    return one;
  }
  if (last >= 2 && last <= 4 && (lastTwo < 10 || lastTwo >= 20)) {
    return few;
  }
  return many;
}

export function PersonFacts({ person }: { readonly person: OutreachPersonCard }) {
  const openTasks = person.tasks.filter((task) => task.status === "open");
  const activeCampaigns = person.campaigns.filter((item) => !item.removedAt);
  return (
    <p className="person-facts">
      <span title="Заказы бота плюс оплаты, заведённые руками. Частичные возвраты не вычтены — их видно в самом заказе.">
        <b>{formatKopecks(person.paidTotalKopecks)}</b> принёс
      </span>
      <span>
        <b>{person.participations.length}</b>
        {" "}
        {plural(
          person.participations.length,
          "мероприятие",
          "мероприятия",
          "мероприятий"
        )}
      </span>
      <span>
        <b>{person.activities.length}</b>
        {" "}
        {plural(person.activities.length, "касание", "касания", "касаний")}
      </span>
      <span className={openTasks.length > 0 ? "fact-attention" : undefined}>
        <b>{openTasks.length}</b>
        {" "}
        {plural(openTasks.length, "открытая", "открытые", "открытых")}
        {" "}
        {plural(openTasks.length, "задача", "задачи", "задач")}
      </span>
      <span>
        <b>{activeCampaigns.length}</b>
        {" "}
        {plural(activeCampaigns.length, "кампания", "кампании", "кампаний")}
      </span>
    </p>
  );
}

export function PersonContactsCard(
  { person }: { readonly person: OutreachPersonCard }
) {
  return (
    <section className="data-section">
      <div className="section-title-row"><div><h2>Контакты</h2></div></div>
      <dl className="person-contacts">
        <div className="person-contact person-contact-lead">
          <Phone size={16} />
          <dt>Телефон</dt>
          <dd>
            {person.phone
              ? <a href={`tel:${person.phone.replace(/[^+\d]/g, "")}`}>{person.phone}</a>
              : <span className="muted">не знаем</span>}
          </dd>
        </div>
        <div className="person-contact">
          <Send size={16} />
          <dt>Telegram</dt>
          <dd>
            {person.telegramUsername ? (
              <a
                href={`https://t.me/${person.telegramUsername}`}
                target="_blank"
                rel="noreferrer"
              >
                @{person.telegramUsername}
              </a>
            ) : <span className="muted">не знаем</span>}
          </dd>
        </div>
        <div className="person-contact">
          <MessageSquare size={16} />
          <dt>MAX</dt>
          <dd>{person.maxIdentifier ?? <span className="muted">не знаем</span>}</dd>
        </div>
        <div className="person-contact">
          <Mail size={16} />
          <dt>Почта</dt>
          <dd>
            {person.email
              ? <a href={`mailto:${person.email}`}>{person.email}</a>
              : <span className="muted">не знаем</span>}
          </dd>
        </div>
        <div className="person-contact">
          <Bot size={16} />
          <dt>В боте</dt>
          <dd>
            {person.linkedUserId ? (
              <Link href={`/users/${person.linkedUserId}`}>Открыть пользователя</Link>
            ) : <span className="muted">не заходил</span>}
          </dd>
        </div>
        <div className="person-contact">
          <Tag size={16} />
          <dt>Источник</dt>
          <dd>{person.source ?? <span className="muted">неизвестен</span>}</dd>
        </div>
      </dl>
      <p className="muted person-meta">
        В базе с {formatCompactDate(person.createdAt)}
        {person.createdByName ? `, завёл ${person.createdByName}` : ""}
        {person.updatedAt !== person.createdAt
          ? `, обновлён ${formatCompactDate(person.updatedAt)}`
          : ""}
      </p>
    </section>
  );
}

export function PersonKnowledgeCard({
  person,
  busy,
  onSaveNote,
  onRemoveNote
}: {
  readonly person: OutreachPersonCard;
  readonly busy: boolean;
  /** Возвращает true, если заметка сохранена: только тогда чистим поле. */
  readonly onSaveNote: (body: string) => Promise<boolean>;
  readonly onRemoveNote: (noteId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) {
      return;
    }
    if (await onSaveNote(body)) {
      setDraft("");
    }
  }

  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Что знаем о человеке</h2>
          {/* Комментарий приезжает из импорта и перезаписывается целиком, заметки копятся
              и подписаны именем. Рядом их и читают. */}
          <span>Комментарий из импорта и заметки менеджеров</span>
        </div>
      </div>
      {person.note ? <p className="person-note">{person.note}</p> : null}
      <form className="person-note-form" onSubmit={(event) => void submit(event)}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Например: просил не звонить до сентября, едет с женой"
        />
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || draft.trim().length === 0}
        >
          <StickyNote size={16} />
          Записать
        </button>
      </form>
      {person.notes.length === 0 ? (
        <p className="muted person-empty">Заметок пока нет.</p>
      ) : (
        <ol className="person-spine">
          {person.notes.map((note) => (
            <li key={note.id}>
              <div className="person-spine-head">
                <strong>{note.authorName}</strong>
                <span className="person-spine-time">{formatDateTime(note.createdAt)}</span>
                {/* Снять можно только свою: заметка подписана именем, и стирать чужую
                    подпись значит менять сказанное другим человеком. */}
                {note.canDelete ? (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Снять заметку"
                    title="Снять заметку"
                    disabled={busy}
                    onClick={() => void onRemoveNote(note.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
              <p>{note.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function PersonOriginCard(
  { person }: { readonly person: OutreachPersonCard }
) {
  if (!person.bot && person.siteRegistrations.length === 0) {
    return null;
  }
  const touchpoints = person.bot?.touchpoints ?? [];
  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Откуда пришёл</h2>
          <span>Бот, метки источника и заявки с сайта</span>
        </div>
      </div>
      {person.bot ? (
        <dl className="person-contacts">
          <div className="person-contact person-contact-plain">
            <dt>В боте с</dt>
            <dd>{formatDateTime(person.bot.registeredAt)}</dd>
          </div>
          <div className="person-contact person-contact-plain">
            <dt>Последний заход</dt>
            <dd>
              {person.bot.lastSeenAt
                ? formatDateTime(person.bot.lastSeenAt)
                : <span className="muted">не заходил после регистрации</span>}
            </dd>
          </div>
          <div className="person-contact person-contact-plain">
            <dt>Телефон в боте</dt>
            <dd>{PHONE_STATUS_LABELS[person.bot.phoneStatus] ?? person.bot.phoneStatus}</dd>
          </div>
          <div className="person-contact person-contact-plain">
            <dt>Кошелёк</dt>
            <dd>{formatKopecks(person.bot.walletAvailableKopecks)}</dd>
          </div>
          {person.bot.isBlocked ? (
            <div className="person-contact person-contact-plain">
              <dt>Состояние</dt>
              <dd>Бот заблокирован — сообщения не дойдут</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {person.bot && touchpoints.length === 0 ? (
        <p className="muted person-empty">
          Человек открыл бота напрямую, без метки источника и партнёрской ссылки.
        </p>
      ) : null}
      {touchpoints.length > 0 || person.siteRegistrations.length > 0 ? (
        <ol className="person-spine">
          {touchpoints.map((touchpoint) => (
            <li key={`${touchpoint.channel}-${touchpoint.occurredAt}`} data-kind="touch">
              <div className="person-spine-head">
                <strong>
                  {touchpoint.partnerCode
                    ? `Партнёр ${touchpoint.partnerCode}`
                    : touchpoint.source ?? "Прямой заход"}
                </strong>
                {touchpoint.isFirstTouch ? (
                  <StatusPill tone="neutral">первый переход</StatusPill>
                ) : null}
                <span className="person-spine-time">
                  {formatDateTime(touchpoint.occurredAt)}
                </span>
              </div>
              {touchpoint.campaign ? (
                <div className="person-spine-meta">Кампания: {touchpoint.campaign}</div>
              ) : null}
            </li>
          ))}
          {person.siteRegistrations.map((registration) => (
            <li key={registration.id}>
              <div className="person-spine-head">
                <strong>
                  Заявка с сайта: {registration.eventTitle ?? "встреча не определена"}
                </strong>
                <span className="person-spine-time">
                  {formatDateTime(registration.createdAt)}
                </span>
              </div>
              <div className="person-spine-meta">
                {[
                  registration.page || null,
                  SITE_REGISTRATION_LABELS[registration.status] ?? registration.status
                ].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function PersonCustomFieldsCard(
  { person }: { readonly person: OutreachPersonCard }
) {
  if (person.customFields.length === 0) {
    return null;
  }
  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Дополнительные поля</h2>
          <span>Заводятся по кампаниям</span>
        </div>
      </div>
      <dl className="person-contacts">
        {person.customFields.map((field) => (
          <div
            className="person-contact person-contact-plain"
            key={`${field.fieldId}-${field.campaignName}`}
          >
            <dt>{field.label}</dt>
            <dd>
              {field.value}
              <span className="muted"> · {field.campaignName}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function PersonEventsCard(
  { person }: { readonly person: OutreachPersonCard }
) {
  const entries = buildPersonEvents(person);
  if (entries.length === 0) {
    return null;
  }
  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Мероприятия и анкеты</h2>
          <span>{entries.length}</span>
        </div>
        {/* Ради анкет карточка и нужна: чтобы вспомнить, чем человек занимается, не надо
            помнить, на какое мероприятие он ездил. Раньше поездка и ответы жили в разных
            разделах, и название события повторялось дважды. */}
        <span className="muted">Ответы видны там же, где поездка</span>
      </div>
      <ul className="person-list person-list-blocks">
        {entries.map((entry) => (
          <li key={entry.key}>
            <div className="person-list-main">
              <strong>
                {entry.href
                  ? <Link href={entry.href}>{entry.title}</Link>
                  : entry.title}
              </strong>
              {entry.meta ? <span className="person-list-sub">{entry.meta}</span> : null}
              {entry.questionnaires.map((questionnaire, index) => (
                <dl className="person-answers" key={`${entry.key}-${index}`}>
                  {questionnaire.answers.map((answer) => (
                    <div key={answer.fieldId}>
                      <dt>{answer.label}</dt>
                      <dd>{answer.value}</dd>
                    </div>
                  ))}
                </dl>
              ))}
            </div>
            <div className="person-list-side">
              {entry.checkedInAt ? (
                <StatusPill tone="positive">
                  Пришёл {formatCompactDate(entry.checkedInAt)}
                </StatusPill>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PersonOrdersCard(
  { person }: { readonly person: OutreachPersonCard }
) {
  if (person.orders.length === 0 && person.consents.length === 0) {
    return null;
  }
  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Заказы и согласия</h2>
          <span>{person.orders.length}</span>
        </div>
        <span className="muted">Из бота</span>
      </div>
      <ul className="person-list">
        {person.orders.map((order) => (
          <li key={order.id}>
            <div className="person-list-main">
              <strong>{order.number}</strong>
              <span className="person-list-sub">
                {order.eventTitle}
                {" · "}
                {formatCompactDate(order.createdAt)}
                {order.excludedAt ? " · исключён из отчётов" : ""}
              </span>
            </div>
            <div className="person-list-side">
              <span className="person-list-money">{formatKopecks(order.totalKopecks)}</span>
              <StatusPill tone={orderStatusTone(order.status)}>
                {orderStatusLabel(order.status)}
              </StatusPill>
              <Link
                className="row-link"
                href={`/orders/${order.id}`}
                aria-label={`Открыть заказ ${order.number}`}
              >
                <ExternalLink size={17} />
              </Link>
            </div>
          </li>
        ))}
        {/* Ссылка ведёт на ту редакцию оферты, с которой человек согласился, а не на
            действующую: ради этого версии и сделаны неизменяемыми. */}
        {person.consents.map((consent) => (
          <li key={consent.orderId}>
            <div className="person-list-main">
              <strong>Оферта, редакция {consent.versionNumber}</strong>
              <span className="person-list-sub">
                заказ {consent.orderNumber}
                {" · принял "}
                {formatDateTime(consent.acceptedAt)}
              </span>
            </div>
            <div className="person-list-side">
              <a
                className="offer-link-inline"
                href={consent.publicUrl}
                target="_blank"
                rel="noreferrer"
              >
                Документ
                <ExternalLink size={15} />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PersonHistoryCard(
  { person }: { readonly person: OutreachPersonCard }
) {
  const timeline = buildPersonTimeline(person);
  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>История</h2>
          <span>{timeline.length}</span>
        </div>
        {/* Ради этой ленты карточка и заведена: раньше история резалась по кампаниям, и
            что человеку уже говорили, целиком не видел никто. */}
        <span className="muted">Звонки, стадии и задачи из всех кампаний</span>
      </div>
      {timeline.length === 0 ? (
        <p className="muted person-empty">С человеком ещё ничего не происходило.</p>
      ) : (
        <ol className="person-spine">
          {timeline.map((entry) => (
            <li key={entry.id} data-kind={entry.kind}>
              <div className="person-spine-head">
                <strong>{entry.title}</strong>
                {entry.tone ? (
                  <StatusPill tone={entry.tone}>{entry.badge}</StatusPill>
                ) : null}
                <span className="person-spine-time">
                  {formatDateTime(entry.occurredAt)}
                </span>
              </div>
              <div className="person-spine-meta">
                {[entry.actor, entry.campaignName].filter(Boolean).join(" · ")}
              </div>
              {entry.note ? <p>{entry.note}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Поездка вместе с анкетами по тому же мероприятию.
 *
 * Раньше это были два раздела, и название события повторялось в обоих: сначала «был на
 * Пикнике 2025», потом отдельно «анкета к Пикнику 2025». Ответы нужны ровно тогда, когда
 * смотришь на поездку, поэтому они живут в одной строке с ней.
 */
interface PersonEventEntry {
  readonly key: string;
  readonly href: string | null;
  readonly title: string;
  readonly meta: string;
  readonly checkedInAt: string | null;
  readonly questionnaires: readonly OutreachPersonQuestionnaire[];
}

function buildPersonEvents(person: OutreachPersonCard): readonly PersonEventEntry[] {
  const attended = person.participations.map((participation) => ({
    key: participation.participantId,
    href: `/events/${participation.eventId}/participants`,
    title: participation.eventTitle,
    meta: [
      `${participation.guests} чел.`,
      participation.sleepingPlaces > 0 ? `мест: ${participation.sleepingPlaces}` : null,
      participation.ticketTitle || null,
      participation.amountKopecks ? formatKopecks(participation.amountKopecks) : null
    ].filter(Boolean).join(" · "),
    checkedInAt: participation.checkedInAt,
    questionnaires: person.questionnaires.filter((questionnaire) =>
      questionnaire.eventId !== null && questionnaire.eventId === participation.eventId)
  }));

  // Анкета без поездки бывает: человек заполнил её к заказу и не доехал, или анкета вообще
  // не привязана к мероприятию. Терять такие ответы нельзя.
  const orphans = person.questionnaires
    .filter((questionnaire) => !person.participations.some((participation) =>
      participation.eventId === questionnaire.eventId))
    .map((questionnaire, index) => ({
      key: `questionnaire-${questionnaire.eventId ?? index}-${questionnaire.source}`,
      href: questionnaire.eventId
        ? `/events/${questionnaire.eventId}/questionnaire`
        : null,
      title: questionnaire.eventTitle ?? "Без мероприятия",
      meta: [
        questionnaire.source === "order" ? "анкета к заказу" : "анкета участника",
        questionnaire.filledAt ? formatCompactDate(questionnaire.filledAt) : null
      ].filter(Boolean).join(" · "),
      checkedInAt: null,
      questionnaires: [questionnaire]
    }));

  return [...attended, ...orphans];
}

interface TimelineEntry {
  readonly id: string;
  /** Форма метки в ленте: касание, смена этапа или задача. */
  readonly kind: "touch" | "stage" | "task";
  readonly title: string;
  readonly badge: string | null;
  readonly tone: "positive" | "neutral" | "danger" | "warning" | null;
  readonly actor: string;
  readonly campaignName: string | null;
  readonly occurredAt: string;
  readonly note: string | null;
}

/**
 * Одна лента на всё, что с человеком происходило: звонки и сообщения, движение по стадиям и
 * задачи. По отдельности каждый из трёх списков отвечает на свой вопрос, а «что с этим
 * человеком вообще было» — только все вместе и по времени.
 */
function buildPersonTimeline(person: OutreachPersonCard): readonly TimelineEntry[] {
  const activities: readonly TimelineEntry[] = person.activities.map((activity) => ({
    id: `activity-${activity.id}`,
    kind: "touch",
    title: channelLabel(activity.channel),
    badge: statusLabel(activity.result),
    tone: activity.result === "converted" || activity.result === "interested"
      ? "positive"
      : activity.result === "declined" || activity.result === "invalid"
        ? "danger"
        : "neutral",
    actor: activity.actorName,
    campaignName: activity.campaignName,
    occurredAt: activity.occurredAt,
    note: activity.note
  }));

  // Заведение карточки в ленту не идёт: первый переход в стадию — это не событие работы с
  // человеком, а строка, которую создал сам факт добавления в кампанию.
  const stages: readonly TimelineEntry[] = person.stageChanges
    .filter((change) => change.fromStage !== null)
    .map((change) => ({
      id: `stage-${change.id}`,
      kind: "stage",
      title: `Этап: ${change.toLabel}`,
      badge: change.fromLabel ? `из «${change.fromLabel}»` : null,
      tone: change.fromLabel ? "neutral" : null,
      actor: change.actorName,
      campaignName: change.campaignName,
      occurredAt: change.occurredAt,
      note: change.lostReason
        ? `Причина: ${lostReasonLabel(change.lostReason)}`
        : null
    }));

  const tasks: readonly TimelineEntry[] = person.tasks.map((task) => ({
    id: `task-${task.id}`,
    kind: "task",
    title: task.status === "completed"
      ? "Задача выполнена"
      : task.status === "cancelled"
        ? "Задача заменена"
        : "Задача поставлена",
    badge: taskTypeLabel(task.type),
    tone: "neutral",
    actor: task.status === "completed"
      ? task.completedByAdminName ?? task.createdByAdminName
      : task.createdByAdminName,
    campaignName: task.campaignName,
    occurredAt: task.completedAt ?? task.createdAt,
    note: `${task.text} · срок ${formatDateTime(task.dueAt)}`
  }));

  return [...activities, ...stages, ...tasks]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}
