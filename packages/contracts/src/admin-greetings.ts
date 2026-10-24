/**
 * Приветствие по заявке с сайта: настройки мероприятия и сборка текста.
 *
 * Сборка текста живёт здесь, а не в прикладном слое, потому что нужна в двух местах сразу:
 * воркеру — чтобы отправить, панели — чтобы показать, что именно уйдёт, ещё до сохранения.
 * Две копии одной функции разошлись бы на первой правке, и предпросмотр показывал бы не то,
 * что получит человек.
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

export type GreetingPlaceholder = typeof GREETING_PLACEHOLDERS[number];

/** Пределы те же, что у проверок в таблице `event_greetings`. */
export const GREETING_PHRASE_LIMIT = 250;
export const GREETING_TEMPLATE_LIMIT = 4000;

/** Что известно о мероприятии для подстановок. */
export interface GreetingEventFacts {
  readonly title: string;
  /** Название в предложном падеже. Пусто — «мероприятии «Название»». */
  readonly phrase: string | null;
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly locationName: string | null;
  readonly locationAddress: string | null;
}

export type RenderedGreeting =
  | { readonly kind: "ok"; readonly body: string }
  | { readonly kind: "invalid"; readonly reason: string };

/** Подстановки в тексте, которых нет в списке. Пусто — текст годится. */
export function unknownGreetingPlaceholders(template: string): readonly string[] {
  const known: readonly string[] = GREETING_PLACEHOLDERS;
  const found = [...template.matchAll(/\{([^{}\n]{1,60})\}/g)]
    .map((match) => match[1] ?? "")
    .filter((name) => !known.includes(name));

  return [...new Set(found)];
}

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
    readonly event: GreetingEventFacts;
  }
): RenderedGreeting {
  const unknown = unknownGreetingPlaceholders(template);
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

/** Сколько заявок мероприятия чем кончились. По ним видно, работает ли приветствие вообще. */
export interface EventGreetingStats {
  readonly pending: number;
  readonly queued: number;
  readonly noChannel: number;
  readonly skipped: number;
}

export interface EventGreetingView {
  readonly eventId: string;
  readonly isEnabled: boolean;
  /** Название в предложном падеже. Пусто — «мероприятии «Название»». */
  readonly eventPhrase: string | null;
  /** Свой текст. Пусто — общий, он же в `defaultTemplate`. */
  readonly bodyTemplate: string | null;
  readonly defaultTemplate: string;
  /** Что подставится вместо `{когда}` и `{где}`: панель собирает предпросмотр сама. */
  readonly event: {
    readonly title: string;
    readonly startsAt: string;
    readonly timeZone: string;
    readonly locationName: string | null;
    readonly locationAddress: string | null;
  };
  readonly stats: EventGreetingStats;
  /** Пусто — настройки ни разу не сохраняли, действует всё по умолчанию. */
  readonly updatedAt: string | null;
  readonly updatedByName: string | null;
  readonly canEdit: boolean;
}

/**
 * Сохранение настроек целиком. Пустая строка и `null` значат одно — «по умолчанию»: текст
 * общий, название в кавычках.
 */
export interface SaveEventGreetingRequest {
  readonly isEnabled: boolean;
  readonly eventPhrase: string | null;
  readonly bodyTemplate: string | null;
}
