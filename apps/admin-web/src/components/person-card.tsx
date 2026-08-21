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
  OutreachCampaignSummary,
  OutreachChannel,
  OutreachManager,
  OutreachPersonCampaign,
  OutreachPersonCard,
  OutreachPersonQuestionnaire,
  OutreachPersonTask
} from "@ticket-platform/contracts/admin-outreach";
import {
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  PhoneCall,
  Send,
  Trash2
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PersonComposer } from "@/components/person-composer";
import { PersonFieldsCard } from "@/components/person-fields";

/**
 * Карточка человека.
 *
 * Одна сборка на два места: своя страница в базе контактов и панель справа, когда контакт
 * открывают прямо из воронки. Раньше в воронке была своя урезанная версия — без денег,
 * заметок, анкет и истории по другим кампаниям, — и менеджер звонил, не зная половины того,
 * что о человеке уже известно.
 *
 * Порядок здесь — порядок работы, а не список того, что мы про человека храним. Слева то,
 * кто это и как до него дотянуться; справа то, что с ним происходит: следующий шаг, лента
 * событий и поле, которым в эту ленту дописывают. Редкое — поездки, деньги, согласия —
 * убрано во вкладки: это история, её смотрят изредка, а места она занимала столько же,
 * сколько задачи.
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

/**
 * Открыть разбор касания по одной воронке.
 *
 * Канал приходит заполненным, когда менеджер только что нажал «Telegram» или «Позвонить»:
 * переспрашивать, чем он воспользовался секунду назад, незачем.
 */
export type PersonTouchHandler = (
  campaign: OutreachPersonCampaign,
  note: string,
  channel: OutreachChannel | null
) => void;

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

/** Кампании, из которых человека не убирали. Работа идёт только по ним. */
export function activeCampaigns(
  person: OutreachPersonCard
): readonly OutreachPersonCampaign[] {
  return person.campaigns.filter((item) => !item.removedAt);
}

export function openTasks(
  person: OutreachPersonCard
): readonly OutreachPersonTask[] {
  return person.tasks.filter((task) => task.status === "open");
}

/**
 * Стадия, которую показываем в шапке как статус человека.
 *
 * Своего статуса у человека нет и заводить его не стоит: стадия принадлежит работе по нему
 * в конкретной воронке, и второй ответ на тот же вопрос рано или поздно разойдётся с первым.
 * Поэтому показываем стадию самой свежей воронки и подписываем, из какой она.
 */
export function headlineStage(
  person: OutreachPersonCard
): OutreachPersonCampaign | null {
  const active = activeCampaigns(person);
  if (active.length === 0) {
    return null;
  }
  // Свежесть считаем по последнему переходу стадии в этой воронке: кампания, в которой
  // сейчас работают, — та, где последний раз двигали карточку.
  const movedAt = new Map<string, string>();
  for (const change of person.stageChanges) {
    const known = movedAt.get(change.campaignId);
    if (!known || known < change.occurredAt) {
      movedAt.set(change.campaignId, change.occurredAt);
    }
  }
  return [...active].sort((left, right) =>
    (movedAt.get(right.campaignId) ?? "").localeCompare(
      movedAt.get(left.campaignId) ?? ""
    ))[0] ?? null;
}

/**
 * Три цифры в шапке вместо прежних пяти.
 *
 * Деньги и поездки нужны перед каждым звонком, следующий шаг — почти перед каждым. «Касаний
 * 47» и «кампаний 3» во время разговора не говорят ничего: за первым идут в ленту, за вторым
 * — в список воронок, и оба рядом.
 */
export function PersonFacts({ person }: { readonly person: OutreachPersonCard }) {
  const open = openTasks(person);
  const next = [...open].sort((left, right) =>
    left.dueAt.localeCompare(right.dueAt))[0];
  const overdue = next ? new Date(next.dueAt).getTime() < Date.now() : false;
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
      {next ? (
        <span className={overdue ? "fact-attention" : undefined}>
          {overdue ? "просрочено с " : "следующий шаг "}
          <b>{formatDateTime(next.dueAt)}</b>
        </span>
      ) : (
        <span className="fact-attention"><b>шага нет</b></span>
      )}
    </p>
  );
}

/**
 * Всё тело карточки: вкладки, две колонки, лента и поле ввода.
 *
 * Страница и панель в воронке отдают сюда одни и те же обработчики. Разница между ними
 * только в раскладке (`variant`) и живёт в стилях, а не здесь: расхождение двух видов
 * карточки — та самая ошибка, которую уже однажды исправляли.
 */
export function PersonBody({
  person,
  managers,
  busy,
  variant,
  availableCampaigns,
  onAddToCampaign,
  onSaveNote,
  onRemoveNote,
  onSaveContact,
  onSaveField,
  onCreateTask,
  onTouch,
  onCompleteTask,
  onRescheduleTask
}: {
  readonly person: OutreachPersonCard;
  readonly managers: readonly OutreachManager[];
  readonly busy: boolean;
  readonly variant: "page" | "drawer";
  /** Воронки, в которых человека ещё нет. Пусто — добавлять отсюда некуда. */
  readonly availableCampaigns: readonly OutreachCampaignSummary[];
  readonly onAddToCampaign: ((campaignId: string) => void) | null;
  readonly onSaveNote: (body: string) => Promise<boolean>;
  readonly onRemoveNote: (noteId: string) => Promise<void>;
  readonly onSaveContact: (changes: {
    readonly source?: string | null;
    readonly assignedAdminId?: string | null;
    readonly nextMeetingAt?: string | null;
  }) => Promise<boolean>;
  readonly onSaveField: (fieldId: string, value: string | null) => Promise<boolean>;
  readonly onCreateTask: (input: {
    readonly type: string;
    readonly text: string;
    readonly dueAt: Date;
    readonly assignedAdminId: string | null;
  }) => Promise<boolean>;
  /**
   * Открывает разбор касания. Канал — тот, которым только что воспользовались, либо `null`,
   * когда его ещё не выбрали. Пусто целиком — в этом месте касание не записывают.
   */
  readonly onTouch: PersonTouchHandler | null;
  readonly onCompleteTask: (taskId: string) => Promise<void>;
  readonly onRescheduleTask: (task: OutreachPersonTask) => void;
}) {
  const [tab, setTab] = useState<"work" | "events" | "money">("work");
  const events = buildPersonEvents(person);
  const hasMoney = person.orders.length > 0
    || person.consents.length > 0
    || person.bot !== null;

  return (
    <>
      <div className="person-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "work"}
          className={tab === "work" ? "person-tab person-tab-active" : "person-tab"}
          onClick={() => setTab("work")}
        >
          Работа
        </button>
        {events.length > 0 ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "events"}
            className={tab === "events" ? "person-tab person-tab-active" : "person-tab"}
            onClick={() => setTab("events")}
          >
            Мероприятия и анкеты
            <span className="person-tab-count">{events.length}</span>
          </button>
        ) : null}
        {hasMoney ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "money"}
            className={tab === "money" ? "person-tab person-tab-active" : "person-tab"}
            onClick={() => setTab("money")}
          >
            Деньги и согласия
          </button>
        ) : null}
      </div>

      {tab === "work" ? (
        <div className={variant === "drawer" ? "person-layout person-layout-narrow" : "person-layout"}>
          <div className="person-rail">
            <PersonContactsCard
              person={person}
              campaign={activeCampaigns(person).length === 1
                ? activeCampaigns(person)[0] ?? null
                : null}
              onTouch={onTouch}
            />
            <PersonFieldsCard
              person={person}
              managers={managers}
              busy={busy}
              onSaveContact={onSaveContact}
              onSaveField={onSaveField}
            />
            <PersonAboutCard person={person} />
            <PersonCampaignsCard
              person={person}
              busy={busy}
              available={availableCampaigns}
              onAdd={onAddToCampaign}
              onTouch={onTouch}
            />
          </div>
          <div className="person-main">
            <PersonNextStep
              person={person}
              busy={busy}
              onComplete={onCompleteTask}
              onReschedule={onRescheduleTask}
            />
            <section className="data-section person-stream">
              <PersonFeed person={person} busy={busy} onRemoveNote={onRemoveNote} />
              <PersonComposer
                person={person}
                managers={managers}
                busy={busy}
                onSaveNote={onSaveNote}
                onCreateTask={onCreateTask}
                onTouch={onTouch}
              />
            </section>
          </div>
        </div>
      ) : null}

      {tab === "events" ? <PersonEventsCard person={person} /> : null}
      {tab === "money" ? <PersonMoneyCard person={person} /> : null}
    </>
  );
}

/**
 * Как дотянуться до человека.
 *
 * Пустые признаки прячутся: строка «Почта — не знаем» занимает столько же места, сколько
 * настоящая почта, и ровно этим карточка в amoCRM и нечитаема. Исключение — телефон и
 * Telegram: по ним звонят и пишут, и их отсутствие само по себе новость.
 */
/**
 * Куда написать или позвонить — в один клик.
 *
 * Раньше между «написал человеку» и «записал касание» не было ничего: ник открывали
 * ссылкой из строки, а разбор искали кнопкой в шапке, и половина разговоров до базы не
 * доезжала. Поэтому кнопка не только открывает переписку, но и спрашивает потом, чем
 * разговор кончился.
 */
export function PersonChannels({
  person,
  campaign,
  onTouch
}: {
  readonly person: OutreachPersonCard;
  /** Единственная воронка человека. Когда их несколько, касание пишут полем внизу. */
  readonly campaign: OutreachPersonCampaign | null;
  readonly onTouch: PersonTouchHandler | null;
}) {
  const [used, setUsed] = useState<OutreachChannel | null>(null);
  const digits = person.phone ? person.phone.replace(/[^\d]/g, "") : null;
  // Ссылка на профиль в MAX собирается из ника: `https://max.ru/<ник>`. Из числового
  // идентификатора ссылку не собрать — у профилей MAX она другой формы, и подставлять
  // наугад значит вести менеджера в никуда.
  const maxHandle = person.maxIdentifier
    && !/^\d+$/.test(person.maxIdentifier.replace(/^@/, ""))
    ? person.maxIdentifier.replace(/^@/, "")
    : null;

  const channels: readonly {
    readonly key: OutreachChannel;
    readonly label: string;
    readonly href: string | null;
    readonly missing: string;
    readonly icon: typeof Phone;
  }[] = [
    {
      key: "phone",
      label: "Позвонить",
      href: digits ? `tel:${person.phone?.replace(/[^+\d]/g, "")}` : null,
      missing: "телефона не знаем",
      icon: Phone
    },
    {
      key: "telegram",
      label: "Telegram",
      href: person.telegramUsername
        ? `https://t.me/${person.telegramUsername}`
        : null,
      missing: "ника в Telegram не знаем",
      icon: Send
    },
    {
      key: "max",
      label: "MAX",
      href: maxHandle ? `https://max.ru/${maxHandle}` : null,
      missing: person.maxIdentifier
        ? "в MAX записан числовой идентификатор — ссылку по нему не собрать"
        : "в MAX человека не знаем",
      icon: MessageSquare
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      href: digits ? `https://wa.me/${digits}` : null,
      missing: "телефона не знаем, а WhatsApp открывается по нему",
      icon: MessageCircle
    }
  ];

  return (
    <div className="person-channels">
      <div className="person-channel-row">
        {channels.map((channel) => {
          const Icon = channel.icon;
          if (!channel.href) {
            return (
              <span
                key={channel.key}
                className="person-channel person-channel-off"
                title={channel.missing}
              >
                <Icon size={15} />
                {channel.label}
              </span>
            );
          }
          return (
            <a
              key={channel.key}
              className="person-channel"
              href={channel.href}
              target={channel.key === "phone" ? undefined : "_blank"}
              rel="noreferrer"
              onClick={() => setUsed(channel.key)}
            >
              <Icon size={15} />
              {channel.label}
            </a>
          );
        })}
      </div>
      {used && campaign && onTouch ? (
        <p className="person-channel-followup">
          Записать, чем кончилось?
          <button
            type="button"
            className="inline-link"
            onClick={() => {
              onTouch(campaign, "", used);
              setUsed(null);
            }}
          >
            Разобрать касание
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function PersonContactsCard({
  person,
  campaign,
  onTouch
}: {
  readonly person: OutreachPersonCard;
  readonly campaign: OutreachPersonCampaign | null;
  readonly onTouch: PersonTouchHandler | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const hidden = [
    person.maxIdentifier === null,
    person.email === null,
    person.source === null
  ].filter(Boolean).length;

  return (
    <section className="data-section">
      <div className="section-title-row"><div><h2>Контакты</h2></div></div>
      <PersonChannels person={person} campaign={campaign} onTouch={onTouch} />
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
        {person.maxIdentifier || showAll ? (
          <div className="person-contact">
            <MessageSquare size={16} />
            <dt>MAX</dt>
            <dd>{person.maxIdentifier ?? <span className="muted">не знаем</span>}</dd>
          </div>
        ) : null}
        {person.email || showAll ? (
          <div className="person-contact">
            <Mail size={16} />
            <dt>Почта</dt>
            <dd>
              {person.email
                ? <a href={`mailto:${person.email}`}>{person.email}</a>
                : <span className="muted">не знаем</span>}
            </dd>
          </div>
        ) : null}
        {person.bot ? (
          <div className="person-contact">
            <Bot size={16} />
            <dt>В боте</dt>
            <dd>
              {person.linkedUserId ? (
                <Link href={`/users/${person.linkedUserId}`}>
                  с {formatCompactDate(person.bot.registeredAt)}
                </Link>
              ) : `с ${formatCompactDate(person.bot.registeredAt)}`}
              {person.bot.isBlocked ? (
                <span className="muted"> · бот заблокирован, сообщения не дойдут</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {hidden > 0 && !showAll ? (
        <button
          className="person-more-fields"
          type="button"
          onClick={() => setShowAll(true)}
        >
          Показать пустые поля ({hidden})
        </button>
      ) : null}
      <p className="muted person-meta">
        В базе с {formatCompactDate(person.createdAt)}
        {person.createdByName ? `, завёл ${person.createdByName}` : ""}
      </p>
    </section>
  );
}

/**
 * Что мы про человека знаем: источник, комментарий из выгрузки и поля кампаний.
 *
 * Заметки менеджеров сюда больше не входят — они ушли в ленту, где им и место: у каждой есть
 * автор и время, и читать их надо вперемешку со звонками, а не отдельным списком.
 */
export function PersonAboutCard(
  { person }: { readonly person: OutreachPersonCard }
) {
  const hasAnything = person.note !== null || person.customFields.length > 0;
  if (!hasAnything) {
    return null;
  }
  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Что знаем</h2>
          {/* Комментарий приезжает из импорта и перезаписывается целиком, поля воронок
              заполняются в них же. Править их здесь нельзя — не потому, что нельзя вообще,
              а потому, что у поля воронки значение своё в каждой из них. */}
          <span>Комментарий из импорта и поля воронок</span>
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
      {person.note ? <p className="person-note">{person.note}</p> : null}
    </section>
  );
}

/** Воронки, в которых человек состоит, и стадия в каждой. */
export function PersonCampaignsCard({
  person,
  busy,
  available,
  onAdd,
  onTouch
}: {
  readonly person: OutreachPersonCard;
  readonly busy: boolean;
  readonly available: readonly OutreachCampaignSummary[];
  readonly onAdd: ((campaignId: string) => void) | null;
  readonly onTouch: PersonTouchHandler | null;
}) {
  const active = activeCampaigns(person);
  if (person.campaigns.length === 0 && available.length === 0) {
    return null;
  }
  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Воронки</h2>
          <span>{active.length}</span>
        </div>
        {onAdd && available.length > 0 ? (
          <label className="select-field outreach-assign">
            <span>Добавить</span>
            <select
              defaultValue=""
              disabled={busy}
              onChange={(event) => {
                const chosen = event.target.value;
                event.target.value = "";
                if (chosen) {
                  onAdd(chosen);
                }
              }}
            >
              <option value="">Выберите</option>
              {available.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <ul className="person-list person-list-tight">
        {person.campaigns.map((membership) => (
          <li key={membership.campaignContactId}>
            <div className="person-list-main">
              <strong>
                <Link
                  href={`/outreach/${membership.campaignId}?contact=${membership.campaignContactId}`}
                >
                  {membership.campaignName}
                </Link>
              </strong>
              <span className="person-list-sub">
                {membership.removedAt ? "убран · " : ""}
                {membership.stageLabel}
                {membership.assignedAdminName
                  ? ` · ${membership.assignedAdminName}`
                  : ""}
              </span>
            </div>
            {!membership.removedAt && onTouch ? (
              <div className="person-list-side">
                <button
                  className="icon-button"
                  type="button"
                  title="Записать касание"
                  aria-label={`Записать касание по воронке ${membership.campaignName}`}
                  disabled={busy}
                  onClick={() => onTouch(membership, "", null)}
                >
                  <PhoneCall size={16} />
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Следующий шаг — первое, что видно справа.
 *
 * Открытых задач по человеку может быть несколько: по одной на каждую воронку плюс одна про
 * него самого. Показываем ближайшую по сроку, остальные — строкой под ней: разбирать их
 * по одной идут в ленту.
 */
export function PersonNextStep({
  person,
  busy,
  onComplete,
  onReschedule
}: {
  readonly person: OutreachPersonCard;
  readonly busy: boolean;
  readonly onComplete: (taskId: string) => Promise<void>;
  readonly onReschedule: (task: OutreachPersonTask) => void;
}) {
  const open = [...openTasks(person)].sort((left, right) =>
    left.dueAt.localeCompare(right.dueAt));
  const next = open[0];
  return (
    <section className="data-section person-next-step">
      <div className="section-title-row">
        <div>
          <h2>Следующий шаг</h2>
          {open.length > 1 ? (
            <span>
              и ещё {open.length - 1}
              {" "}
              {plural(open.length - 1, "задача", "задачи", "задач")}
            </span>
          ) : null}
        </div>
      </div>
      {next ? (
        <div className="person-next-body">
          <div className="person-next-main">
            <strong>{next.text}</strong>
            <span className="person-list-sub">
              {taskTypeLabel(next.type)}
              {next.autoRuleId ? " · поставлена автоматически" : ""}
              {" · "}
              <span
                className={new Date(next.dueAt).getTime() < Date.now()
                  ? "overdue"
                  : undefined}
              >
                срок {formatDateTime(next.dueAt)}
              </span>
              {" · "}
              {next.assignedAdminName}
              {next.campaignName ? ` · ${next.campaignName}` : ""}
            </span>
          </div>
          <div className="outreach-row-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => onReschedule(next)}
            >
              <Clock size={16} />
              Перенести
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onComplete(next.id)}
            >
              <CheckCircle2 size={16} />
              Выполнено
            </button>
          </div>
        </div>
      ) : (
        <p className="muted person-empty">
          Открытой задачи нет. Поставьте следующий шаг полем внизу, иначе человек потеряется.
        </p>
      )}
    </section>
  );
}

const FEED_FILTERS = [
  { key: "all", label: "Всё" },
  { key: "touch", label: "Звонки" },
  { key: "note", label: "Заметки" },
  { key: "stage", label: "Этапы" }
] as const;

type FeedFilter = typeof FEED_FILTERS[number]["key"];

/**
 * Одна лента на всё, что с человеком было.
 *
 * Раньше лент было три и выглядели они одинаково: «История» со звонками, заметки в «Что
 * знаем» и «Откуда пришёл» с источниками. По отдельности каждая отвечала на свой вопрос, а
 * «что с этим человеком вообще происходило» — только все вместе и по времени.
 */
export function PersonFeed({
  person,
  busy,
  onRemoveNote
}: {
  readonly person: OutreachPersonCard;
  readonly busy: boolean;
  readonly onRemoveNote: (noteId: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const entries = buildPersonTimeline(person);
  const shown = filter === "all"
    ? entries
    : entries.filter((entry) => entry.kind === filter);

  return (
    <>
      <div className="section-title-row">
        <div>
          <h2>История</h2>
          <span>{entries.length}</span>
        </div>
        <div className="person-feed-filters">
          {FEED_FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={filter === option.key
                ? "person-feed-filter person-feed-filter-active"
                : "person-feed-filter"}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="muted person-empty">
          {entries.length === 0
            ? "С человеком ещё ничего не происходило."
            : "В этой части истории пусто."}
        </p>
      ) : (
        <ol className="person-spine">
          {shown.map((entry) => (
            <li key={entry.id} data-kind={entry.kind}>
              <div className="person-spine-head">
                <strong>{entry.title}</strong>
                {entry.tone ? (
                  <StatusPill tone={entry.tone}>{entry.badge}</StatusPill>
                ) : null}
                <span className="person-spine-time">
                  {formatDateTime(entry.occurredAt)}
                </span>
                {/* Снять можно только свою заметку: она подписана именем, и стирать чужую
                    подпись значит менять сказанное другим человеком. */}
                {entry.removableNoteId ? (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Снять заметку"
                    title="Снять заметку"
                    disabled={busy}
                    onClick={() => void onRemoveNote(entry.removableNoteId as string)}
                  >
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
              {entry.actor || entry.campaignName ? (
                <div className="person-spine-meta">
                  {[entry.actor, entry.campaignName].filter(Boolean).join(" · ")}
                </div>
              ) : null}
              {entry.note ? <p>{entry.note}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </>
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

/** Деньги: заказы, согласия и то, что человек принёс через бота. */
export function PersonMoneyCard(
  { person }: { readonly person: OutreachPersonCard }
) {
  const unpaid = person.orders.filter((order) =>
    order.excludedAt === null
    && (order.status === "awaiting_payment"
      || order.status === "awaiting_offer"
      || order.status === "payment_processing"));
  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Деньги и согласия</h2>
          <span>{person.orders.length}</span>
        </div>
        <span className="muted">Из бота</span>
      </div>
      {/* Незакрытый заказ — самое ценное, что можно знать перед звонком, и раньше его было
          видно, только если дочитать список заказов до конца. */}
      {unpaid.length > 0 ? (
        <p className="page-warning">
          {plural(unpaid.length, "Висит", "Висят", "Висят")}
          {" "}
          {unpaid.length}
          {" "}
          {plural(unpaid.length, "неоплаченный заказ", "неоплаченных заказа", "неоплаченных заказов")}
          {" на "}
          {formatKopecks(unpaid.reduce(
            (sum, order) => (BigInt(sum) + BigInt(order.totalKopecks)).toString(),
            "0"
          ))}.
        </p>
      ) : null}
      {person.bot ? (
        <dl className="person-contacts">
          <div className="person-contact person-contact-plain">
            <dt>Кошелёк</dt>
            <dd>{formatKopecks(person.bot.walletAvailableKopecks)}</dd>
          </div>
          <div className="person-contact person-contact-plain">
            <dt>Телефон в боте</dt>
            <dd>{PHONE_STATUS_LABELS[person.bot.phoneStatus] ?? person.bot.phoneStatus}</dd>
          </div>
          <div className="person-contact person-contact-plain">
            <dt>Последний заход</dt>
            <dd>
              {person.bot.lastSeenAt
                ? formatDateTime(person.bot.lastSeenAt)
                : <span className="muted">не заходил после регистрации</span>}
            </dd>
          </div>
        </dl>
      ) : null}
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
  /** Форма метки в ленте: касание, заметка, смена этапа или задача. */
  readonly kind: "touch" | "note" | "stage" | "task";
  readonly title: string;
  readonly badge: string | null;
  readonly tone: "positive" | "neutral" | "danger" | "warning" | null;
  readonly actor: string;
  readonly campaignName: string | null;
  readonly occurredAt: string;
  readonly note: string | null;
  /** Заполнено только у своих заметок: чужую снять нельзя, и кнопки для неё быть не должно. */
  readonly removableNoteId: string | null;
}

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
    note: activity.note,
    removableNoteId: null
  }));

  const notes: readonly TimelineEntry[] = person.notes.map((note) => ({
    id: `note-${note.id}`,
    kind: "note",
    title: "Заметка",
    badge: null,
    tone: null,
    actor: note.authorName,
    campaignName: null,
    occurredAt: note.createdAt,
    note: note.body,
    removableNoteId: note.canDelete ? note.id : null
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
        : null,
      removableNoteId: null
    }));

  const tasks: readonly TimelineEntry[] = person.tasks.map((task) => ({
    id: `task-${task.id}`,
    kind: "task",
    title: task.status === "completed"
      ? "Задача выполнена"
      : task.status === "cancelled"
        ? "Задача заменена"
        : "Задача поставлена",
    badge: task.autoRuleId
      ? `${taskTypeLabel(task.type)} · автоматически`
      : taskTypeLabel(task.type),
    tone: "neutral",
    // У автозадачи автор — служебная учётка. Показывать её именем — значит утверждать,
    // что задачу поставил человек с таким именем.
    actor: task.autoRuleId && task.status !== "completed"
      ? "автоматика"
      : task.status === "completed"
        ? task.completedByAdminName ?? task.createdByAdminName
        : task.createdByAdminName,
    campaignName: task.campaignName,
    occurredAt: task.completedAt ?? task.createdAt,
    note: `${task.text} · срок ${formatDateTime(task.dueAt)}`,
    removableNoteId: null
  }));

  // Метки источника и заявки с сайта раньше жили отдельной карточкой «Откуда пришёл». Это
  // события того же ряда: они случились с человеком в своё время и читаются в общем потоке.
  const origins: readonly TimelineEntry[] = [
    ...(person.bot?.touchpoints ?? []).map((touchpoint) => ({
      id: `touchpoint-${touchpoint.channel}-${touchpoint.occurredAt}`,
      kind: "touch" as const,
      title: touchpoint.partnerCode
        ? `Пришёл по партнёру ${touchpoint.partnerCode}`
        : `Пришёл: ${touchpoint.source ?? "прямой заход"}`,
      badge: touchpoint.isFirstTouch ? "первый переход" : null,
      tone: touchpoint.isFirstTouch ? ("neutral" as const) : null,
      actor: "",
      campaignName: touchpoint.campaign,
      occurredAt: touchpoint.occurredAt,
      note: null,
      removableNoteId: null
    })),
    ...person.siteRegistrations.map((registration) => ({
      id: `registration-${registration.id}`,
      kind: "touch" as const,
      title: `Заявка с сайта: ${registration.eventTitle ?? "встреча не определена"}`,
      badge: SITE_REGISTRATION_LABELS[registration.status] ?? registration.status,
      tone: "neutral" as const,
      actor: "",
      campaignName: null,
      occurredAt: registration.createdAt,
      note: registration.page || null,
      removableNoteId: null
    }))
  ];

  return [...activities, ...notes, ...stages, ...tasks, ...origins]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}
