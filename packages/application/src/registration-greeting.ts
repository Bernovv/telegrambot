import type { ConversationChannel } from "@ticket-platform/domain";
import { nextCallSlot, type CallWindow } from "./call-window.js";
import type { IdGenerator } from "./identity.js";

/**
 * Приветствие по заявке с сайта: «получили вашу заявку, ждём».
 *
 * Пишет аккаунт компании — тот же, что отвечает из панели, — в первый мессенджер, где
 * нашёлся человек. Порядок каналов задаёт владелец: сейчас Telegram, затем MAX; WhatsApp
 * добавится в конец списка, когда два первых поработают.
 *
 * Сама служба ничего не отправляет и ни у кого ничего не спрашивает. Номер проверяют
 * процессы аккаунтов (`contact_channel_lookups`), отправляют они же (очередь реплик).
 * Здесь только решение: куда и что писать, или почему не писать вовсе. Поэтому служба
 * живёт в воркере и не зависит от того, подняты ли аккаунты: не поднят Telegram — его
 * проверка не ответит, и после ожидания приветствие уйдёт в MAX.
 *
 * **Первое сообщение незнакомому — самое опасное, что делает аккаунт.** Оно приходит с
 * кнопками «Заблокировать» и «Пожаловаться», а жалобы решают судьбу аккаунта, через
 * который идёт вся переписка с клиентами. Отсюда тихие часы, суточный потолок на канал и
 * отказ писать, если менеджер уже написал сам: второе «здравствуйте» от того же имени
 * выглядит как рассылка.
 */

/** Текст владельца от 24.10.2026. Своё у мероприятия — в `event_greetings.body_template`. */
export const DEFAULT_GREETING_TEMPLATE = [
  "Привет! На связи Бизнес-Прорыв✨",
  "",
  "📨 Получили Вашу заявку на участие в {мероприятии} – {когда}, {где}",
  "",
  "Вас ждет увлекательная программа от наших спикеров и эффективный нетворкинг с другими участниками.",
  "Уже ждем вас!",
  "",
  "В ближайшее время свяжусь с вами для уточнения деталей🌿"
].join("\n");

/** Что можно подставить в текст. Всё остальное в фигурных скобках — опечатка. */
export const GREETING_PLACEHOLDERS = ["мероприятии", "когда", "где", "имя"] as const;

export type GreetingLookupStatus = "queued" | "found" | "not_found" | "failed";

export interface PendingGreeting {
  readonly registrationId: string;
  readonly contactId: string;
  readonly registeredAt: Date;
  /** Имя из формы, как человек его написал. */
  readonly name: string;
  readonly event: {
    readonly title: string;
    /** Название в предложном падеже. Пусто — «мероприятии «Название»». */
    readonly phrase: string | null;
    readonly startsAt: Date;
    readonly timeZone: string;
    readonly locationName: string | null;
    readonly locationAddress: string | null;
    readonly greetingEnabled: boolean;
    /** Свой текст мероприятия. Пусто — общий. */
    readonly template: string | null;
  };
  /** Ответы проверки по каналам. Канала нет — проверку для него не заводили. */
  readonly lookups: Readonly<Partial<Record<ConversationChannel, GreetingLookupStatus>>>;
  /** Ветка переписки от аккаунта по каналу: она заводится вместе с ответом «найден». */
  readonly conversations: Readonly<Partial<Record<ConversationChannel, string>>>;
  /** После заявки человеку уже писали — менеджер успел раньше автоматики. */
  readonly contactedSinceRegistration: boolean;
}

export interface RegistrationGreetingRepository {
  /** Заявки, по которым ещё не решили. Самые старые первыми. */
  listPending(input: {
    readonly batchSize: number;
  }): Promise<readonly PendingGreeting[]>;
  /** Сколько приветствий каждый канал отправил с этого момента. */
  countQueuedSince(input: {
    readonly since: Date;
  }): Promise<Readonly<Partial<Record<ConversationChannel, number>>>>;
  /**
   * Реплика в ветку и отметка о решении — одной транзакцией.
   *
   * `false` — решение по заявке уже принято другим проходом, и реплика не легла: второго
   * приветствия человеку быть не должно.
   */
  queueGreeting(input: {
    readonly registrationId: string;
    readonly contactId: string;
    /** От чьего имени касание в карточке: служебная учётная запись регистрации с сайта. */
    readonly actorAdminId: string;
    readonly channel: ConversationChannel;
    readonly conversationId: string;
    readonly messageId: string;
    readonly body: string;
    readonly at: Date;
  }): Promise<boolean>;
  markNoChannel(input: {
    readonly registrationId: string;
    readonly at: Date;
  }): Promise<void>;
  markSkipped(input: {
    readonly registrationId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<void>;
}

export interface GreetRegistrationsOptions {
  /** Куда пробуем писать, по порядку. Канала нет в списке — туда не пишем вовсе. */
  readonly channels: readonly ConversationChannel[];
  /**
   * Сколько ждать ответа проверки, прежде чем перейти к следующему каналу.
   *
   * Ответа нет, когда процесс аккаунта лежит или упёрся в суточный потолок проверок. Ждать
   * его вечно значило бы не написать вовсе, а не подождать — значило бы написать в MAX
   * человеку, у которого есть Telegram.
   */
  readonly lookupWaitMs: number;
  /** Заявка старше — писать «получили заявку» уже поздно и странно. */
  readonly maxAgeMs: number;
  /** Потолок приветствий на канал за сутки. Упёрлись — ждём до завтра. */
  readonly dailyLimit: number;
  /** Часы, когда пишем. Ночью сообщение от незнакомого — это повод пожаловаться. */
  readonly window: CallWindow;
  /** Служебная учётная запись регистрации с сайта: она и значится автором касания. */
  readonly systemAdminId: string;
}

export interface GreetRegistrationsResult {
  readonly pending: number;
  readonly queued: number;
  readonly noChannel: number;
  readonly skipped: number;
  readonly waiting: number;
  /** Сейчас тихие часы: никого не разбирали. */
  readonly outsideWindow: boolean;
}

export type GreetingDecision =
  | { readonly kind: "send"; readonly channel: ConversationChannel; readonly conversationId: string }
  | { readonly kind: "wait" }
  | { readonly kind: "no_channel" }
  | { readonly kind: "skip"; readonly reason: string };

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

export class GreetRegistrationsBatchService {
  constructor(
    private readonly repository: RegistrationGreetingRepository,
    private readonly ids: IdGenerator,
    private readonly options: GreetRegistrationsOptions
  ) {}

  async execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<GreetRegistrationsResult> {
    // Внутри окна `nextCallSlot` возвращает тот же момент — это и есть «сейчас можно».
    if (nextCallSlot(input.at, this.options.window).getTime() !== input.at.getTime()) {
      return {
        pending: 0,
        queued: 0,
        noChannel: 0,
        skipped: 0,
        waiting: 0,
        outsideWindow: true
      };
    }

    const pending = await this.repository.listPending({ batchSize: input.batchSize });
    if (pending.length === 0) {
      return {
        pending: 0,
        queued: 0,
        noChannel: 0,
        skipped: 0,
        waiting: 0,
        outsideWindow: false
      };
    }

    const sentToday = await this.repository.countQueuedSince({
      since: new Date(input.at.getTime() - DAY_MS)
    });
    // Счётчик живёт и внутри прохода: десять заявок одного утра не должны пролезть под
    // потолок только потому, что база ещё не видела ни одной из них отправленной.
    const sent = new Map<ConversationChannel, number>(
      this.options.channels.map((channel) => [channel, sentToday[channel] ?? 0])
    );
    const full = new Set<ConversationChannel>();

    let queued = 0;
    let noChannel = 0;
    let skipped = 0;
    let waiting = 0;

    for (const greeting of pending) {
      for (const [channel, count] of sent) {
        if (count >= this.options.dailyLimit) {
          full.add(channel);
        }
      }
      const decision = decideGreeting(greeting, input.at, this.options, full);

      if (decision.kind === "wait") {
        waiting += 1;
        continue;
      }
      if (decision.kind === "skip") {
        await this.repository.markSkipped({
          registrationId: greeting.registrationId,
          reason: decision.reason,
          at: input.at
        });
        skipped += 1;
        continue;
      }
      if (decision.kind === "no_channel") {
        await this.repository.markNoChannel({
          registrationId: greeting.registrationId,
          at: input.at
        });
        noChannel += 1;
        continue;
      }

      const rendered = renderGreeting(greeting.event.template ?? DEFAULT_GREETING_TEMPLATE, {
        name: greeting.name,
        event: greeting.event
      });
      if (rendered.kind === "invalid") {
        // Опечатка в тексте мероприятия. Отправить «{мероприяти}» человеку хуже, чем не
        // отправить ничего: причина видна в карточке, и текст поправят.
        await this.repository.markSkipped({
          registrationId: greeting.registrationId,
          reason: rendered.reason,
          at: input.at
        });
        skipped += 1;
        continue;
      }

      const accepted = await this.repository.queueGreeting({
        registrationId: greeting.registrationId,
        contactId: greeting.contactId,
        actorAdminId: this.options.systemAdminId,
        channel: decision.channel,
        conversationId: decision.conversationId,
        messageId: this.ids.newId(),
        body: rendered.body,
        at: input.at
      });
      if (accepted) {
        queued += 1;
        sent.set(decision.channel, (sent.get(decision.channel) ?? 0) + 1);
      }
    }

    return {
      pending: pending.length,
      queued,
      noChannel,
      skipped,
      waiting,
      outsideWindow: false
    };
  }
}

/**
 * Куда писать, или почему не писать.
 *
 * Каналы перебираются строго по порядку, и **неотвеченная проверка останавливает перебор**.
 * Иначе человек с Telegram получил бы сообщение в MAX только потому, что MAX ответил на
 * минуту раньше. Ждём до `lookupWaitMs` с момента заявки, потом канал считается
 * недоступным, и перебор идёт дальше.
 */
export function decideGreeting(
  greeting: PendingGreeting,
  at: Date,
  options: Pick<GreetRegistrationsOptions, "channels" | "lookupWaitMs" | "maxAgeMs">,
  fullChannels: ReadonlySet<ConversationChannel> = new Set()
): GreetingDecision {
  if (!greeting.event.greetingEnabled) {
    return { kind: "skip", reason: "Приветствие у этого мероприятия выключено" };
  }
  const age = at.getTime() - greeting.registeredAt.getTime();
  if (age > options.maxAgeMs) {
    return {
      kind: "skip",
      reason: `Заявка пролежала дольше ${Math.round(options.maxAgeMs / HOUR_MS)} ч — писать «получили заявку» поздно`
    };
  }
  if (greeting.event.startsAt.getTime() <= at.getTime()) {
    return { kind: "skip", reason: "Мероприятие уже началось" };
  }
  if (greeting.contactedSinceRegistration) {
    return { kind: "skip", reason: "После заявки человеку уже написали" };
  }

  for (const channel of options.channels) {
    const status = greeting.lookups[channel];
    if (status === "found") {
      const conversationId = greeting.conversations[channel];
      // Нашли, а ветки нет — писать некуда. Так быть не должно, ветка заводится вместе с
      // ответом, но кнопка «написать», ведущая в никуда, хуже соседнего канала.
      if (conversationId === undefined) {
        continue;
      }
      if (fullChannels.has(channel)) {
        // Не переходим к следующему каналу: человек есть здесь, и написать ему стоит здесь
        // же, только завтра. Иначе потолок незаметно переводил бы людей в другой мессенджер.
        return { kind: "wait" };
      }
      return { kind: "send", channel, conversationId };
    }
    if (status === "not_found" || status === "failed") {
      continue;
    }
    // Проверка ещё в очереди или её не заводили вовсе.
    if (age < options.lookupWaitMs) {
      return { kind: "wait" };
    }
  }

  return { kind: "no_channel" };
}

export type RenderedGreeting =
  | { readonly kind: "ok"; readonly body: string }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * Текст приветствия с подставленными мероприятием, временем и местом.
 *
 * `{когда}` подставляется вместе с предлогом: «в среду», но «во вторник». Подстановка одного
 * дня недели после «в» из текста дала бы «в вторник».
 *
 * Места может не быть. Тогда `{где}` уходит вместе с запятой перед ним: «… в 18:30, » с
 * висящей запятой выглядит как недописанное сообщение.
 */
export function renderGreeting(
  template: string,
  input: {
    readonly name: string;
    readonly event: PendingGreeting["event"];
  }
): RenderedGreeting {
  const unknown = [...template.matchAll(/\{([^{}\n]{1,60})\}/g)]
    .map((match) => match[1] ?? "")
    .filter((name) => !(GREETING_PLACEHOLDERS as readonly string[]).includes(name));
  if (unknown.length > 0) {
    return {
      kind: "invalid",
      reason: `В тексте приветствия неизвестная подстановка {${unknown[0]}}`
    };
  }

  const when = formatEventWhen(input.event.startsAt, input.event.timeZone);
  if (when === null) {
    return {
      kind: "invalid",
      reason: `Не распознан часовой пояс мероприятия: ${input.event.timeZone}`
    };
  }
  const place = formatPlace(input.event.locationName, input.event.locationAddress);
  const phrase = clean(input.event.phrase) ?? `мероприятии «${input.event.title.trim()}»`;

  const withPlace = place === null
    ? template.replace(/,[ \t]*\{где\}/g, "").replaceAll("{где}", "")
    : template.replaceAll("{где}", place);
  const body = withPlace
    .replaceAll("{мероприятии}", phrase)
    .replaceAll("{когда}", when)
    .replaceAll("{имя}", input.name.trim())
    .trim();

  return { kind: "ok", body };
}

const WEEKDAYS: Readonly<Record<string, string>> = {
  Mon: "в понедельник",
  Tue: "во вторник",
  Wed: "в среду",
  Thu: "в четверг",
  Fri: "в пятницу",
  Sat: "в субботу",
  Sun: "в воскресенье"
};

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"
] as const;

/** «в среду, 18 ноября в 18:30» — по местному времени мероприятия, а не сервера. */
export function formatEventWhen(startsAt: Date, timeZone: string): string | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(startsAt);
  } catch {
    return null;
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  const weekday = WEEKDAYS[part("weekday")];
  const month = MONTHS[Number(part("month")) - 1];
  if (weekday === undefined || month === undefined) {
    return null;
  }

  // Ноль впереди дописываем сами: без часа в формате минуты приходят как «5», и полагаться
  // на то, что с часом они станут «05», значит полагаться на версию ICU.
  const hour = part("hour").padStart(2, "0");
  const minute = part("minute").padStart(2, "0");

  return `${weekday}, ${Number(part("day"))} ${month} в ${hour}:${minute}`;
}

function formatPlace(name: string | null, address: string | null): string | null {
  const cleanName = clean(name);
  const cleanAddress = clean(address);
  if (cleanName !== null && cleanAddress !== null && cleanName !== cleanAddress) {
    return `${cleanName}, ${cleanAddress}`;
  }

  return cleanAddress ?? cleanName;
}

function clean(value: string | null): string | null {
  const trimmed = (value ?? "").trim();

  return trimmed === "" ? null : trimmed;
}
