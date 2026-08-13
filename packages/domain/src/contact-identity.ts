/**
 * Единый стандарт нормализации контакта.
 *
 * Раньше правила были размазаны по трём слоям: заголовки CSV разбирались в панели, ники и
 * почта — в приложении, телефон — в messenger-core. Из-за этого ручная форма вела себя не так,
 * как загрузка файла, и одна и та же выгрузка давала разный результат.
 *
 * Главное правило: **поле, которое не разобралось, не роняет строку и не исчезает молча.**
 * Оно возвращается в `rejections` вместе с исходным значением, а контакт сохраняется, если у
 * него остался хоть один признак. Строка из выгрузки, где телефон записан словом «мобильный»,
 * а ник указан верно, раньше терялась целиком — теперь остаётся человек с ником.
 */

export type ContactFieldName = "name" | "phone" | "telegram" | "max" | "email";

export type ContactRejectionReason =
  | "not_a_phone_number"
  | "not_a_telegram_username"
  | "not_a_max_identifier"
  | "not_an_email"
  | "not_a_name";

export interface ContactFieldRejection {
  readonly field: ContactFieldName;
  /** Что было в ячейке — чтобы человек в панели увидел, что именно не разобралось. */
  readonly rawValue: string;
  readonly reason: ContactRejectionReason;
}

export interface NormalizedContactIdentity {
  readonly name: string | null;
  readonly phoneE164: string | null;
  readonly telegramUsername: string | null;
  readonly telegramUsernameNormalized: string | null;
  readonly maxIdentifier: string | null;
  readonly maxIdentifierNormalized: string | null;
  readonly email: string | null;
  readonly emailNormalized: string | null;
  /**
   * Остальные номера из ячейки, где их было несколько. Второго поля под телефон в базе нет,
   * поэтому их дописывают в примечание — но терять их нельзя, это рабочие контакты.
   */
  readonly extraPhones: readonly string[];
}

export interface NormalizedContact {
  readonly identity: NormalizedContactIdentity;
  readonly rejections: readonly ContactFieldRejection[];
  /** Остался ли хоть один признак, по которому человека можно узнать и сохранить. */
  readonly hasIdentifier: boolean;
}

export interface ContactInput {
  readonly name?: string | undefined;
  readonly phone?: string | undefined;
  readonly telegram?: string | undefined;
  readonly max?: string | undefined;
  readonly email?: string | undefined;
}

export interface ContactNormalizationOptions {
  /**
   * Приводит очищенный номер к E.164 или отдаёт null. Живёт снаружи намеренно: разбор номеров
   * тянет libphonenumber, а этот пакет обязан оставаться без зависимостей. Здесь — только та
   * чистка, после которой у разборщика появляется шанс: сам он не переживает ни второго номера
   * в ячейке, ни приписки «тел.» перед цифрами.
   */
  readonly parsePhone: (candidate: string) => string | null;
}

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;

/** Настоящее правило Telegram: латиница, цифры и подчёркивание, от 5 до 32 символов. */
const TELEGRAM_USERNAME = /^[a-zA-Z0-9_]{5,32}$/;

/**
 * MAX намеренно мягче: собственных правил для идентификатора у нас на руках нет, а данные
 * приезжают из чужих выгрузок. Лучше принять лишнее, чем отбросить живой контакт.
 */
const MAX_IDENTIFIER = /^[a-zA-Z0-9_.-]{2,100}$/;

const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function normalizeContactInput(
  input: ContactInput,
  options: ContactNormalizationOptions
): NormalizedContact {
  const rejections: ContactFieldRejection[] = [];

  const phones = normalizePhones(input.phone, options.parsePhone, rejections);
  let phoneE164 = phones.primary;

  const telegram = normalizeTelegram(input.telegram, rejections);
  // В колонке ника нередко оказывается телефон — так выгружает половина CRM. Это не повод
  // потерять человека: если поле телефона пустое, номер забирает оно.
  if (!telegram.username && telegram.phoneCandidate && !phoneE164) {
    const rescued = options.parsePhone(telegram.phoneCandidate);
    if (rescued) {
      phoneE164 = rescued;
      dropRejection(rejections, "telegram");
    }
  }

  const maxIdentifier = normalizeMax(input.max, rejections);
  const email = normalizeEmailAddress(input.email, rejections);
  const name = normalizeName(input.name, rejections);

  const identity: NormalizedContactIdentity = {
    name,
    phoneE164,
    telegramUsername: telegram.username,
    telegramUsernameNormalized: telegram.username?.toLowerCase() ?? null,
    maxIdentifier,
    maxIdentifierNormalized: maxIdentifier?.toLowerCase() ?? null,
    email,
    emailNormalized: email?.toLowerCase() ?? null,
    extraPhones: phones.extra
  };

  return {
    identity,
    rejections,
    hasIdentifier: Boolean(
      phoneE164 || telegram.username || maxIdentifier || email
    )
  };
}

/**
 * Делит ячейку на отдельные номера и чистит каждый. Разборщик номеров сам справляется с
 * пробелами, скобками, ведущей восьмёркой и добавочным, но ломается на двух номерах через
 * запятую и на тексте перед цифрами — ровно это здесь и снимается.
 */
export function splitPhoneCandidates(value: string): readonly string[] {
  return value
    .split(/[,;/|\n\r]+/)
    .map(cleanPhoneCandidate)
    .filter((candidate) => candidate !== "");
}

export function cleanPhoneCandidate(value: string): string {
  // Добавочный отрезаем сами: без него «89991234567 доб. 12» схлопнется в тринадцать цифр и
  // перестанет быть номером. Границу слова тут ставить нельзя — \b считает по латинице и
  // после кириллического «доб» не срабатывает.
  const withoutExtension = value.split(/доб|доп|ext|extension|#/iu)[0] ?? "";
  const digits = withoutExtension.replace(/[^\d+]/g, "");
  if (digits === "") {
    return "";
  }
  // Плюс имеет смысл только в начале: «+7 (999) 123» после чистки не должен стать «+7999+123».
  const leadingPlus = digits.startsWith("+") ? "+" : "";
  return `${leadingPlus}${digits.replace(/\+/g, "")}`;
}

/**
 * Снимает обёртку вокруг ника: `@`, ссылку на t.me, `tg://resolve?domain=`. Формат не
 * проверяет — за это отвечают правила конкретного мессенджера.
 */
export function stripHandleWrapping(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(?:www\.)?(?:t(?:elegram)?\.me|max\.ru)\//i, "")
    .replace(/^tg:\/\/resolve\?domain=/i, "")
    .replace(/^@+/, "")
    .replace(/[/?].*$/, "")
    .trim();
}

/**
 * Ник Telegram по настоящему правилу мессенджера — или null, если это не ник. Обёртка вроде
 * `@` и ссылки на t.me снимается. Регистр сохраняется: приводить к нижнему нужно только для
 * поиска и уникальности.
 */
export function parseTelegramUsername(
  value: string | null | undefined
): string | null {
  if (!value?.trim()) {
    return null;
  }
  const handle = stripHandleWrapping(value);
  return TELEGRAM_USERNAME.test(handle) ? handle : null;
}

/** Имя ли это вообще: «a cloud» — да, «+7 999 123-45-67» и «12» — нет. */
export function looksLikeName(value: string): boolean {
  const text = value.trim();
  if (text.length < 2 || text.length > MAX_NAME_LENGTH) {
    return false;
  }
  // Ни одной буквы — это заехавший не в свою колонку телефон, а не имя.
  if (!/\p{L}/u.test(text)) {
    return false;
  }
  return !EMAIL.test(text);
}

function normalizePhones(
  raw: string | undefined,
  parsePhone: ContactNormalizationOptions["parsePhone"],
  rejections: ContactFieldRejection[]
): { readonly primary: string | null; readonly extra: readonly string[] } {
  const text = (raw ?? "").trim();
  if (text === "") {
    return { primary: null, extra: [] };
  }

  const parsed = splitPhoneCandidates(text)
    .map((candidate) => parsePhone(candidate))
    .filter((phone): phone is string => phone !== null);
  const unique = [...new Set(parsed)];

  if (unique.length === 0) {
    rejections.push({
      field: "phone",
      rawValue: text,
      reason: "not_a_phone_number"
    });
    return { primary: null, extra: [] };
  }

  return { primary: unique[0] ?? null, extra: unique.slice(1) };
}

function normalizeTelegram(
  raw: string | undefined,
  rejections: ContactFieldRejection[]
): { readonly username: string | null; readonly phoneCandidate: string | null } {
  const text = (raw ?? "").trim();
  if (text === "") {
    return { username: null, phoneCandidate: null };
  }

  const username = parseTelegramUsername(text);
  if (username) {
    return { username, phoneCandidate: null };
  }

  rejections.push({
    field: "telegram",
    rawValue: text,
    reason: "not_a_telegram_username"
  });
  const candidate = cleanPhoneCandidate(text);
  return {
    username: null,
    phoneCandidate: candidate === "" ? null : candidate
  };
}

function normalizeMax(
  raw: string | undefined,
  rejections: ContactFieldRejection[]
): string | null {
  const text = (raw ?? "").trim();
  if (text === "") {
    return null;
  }

  const handle = stripHandleWrapping(text);
  if (MAX_IDENTIFIER.test(handle)) {
    return handle;
  }

  rejections.push({
    field: "max",
    rawValue: text,
    reason: "not_a_max_identifier"
  });
  return null;
}

function normalizeEmailAddress(
  raw: string | undefined,
  rejections: ContactFieldRejection[]
): string | null {
  const text = (raw ?? "").trim();
  if (text === "") {
    return null;
  }
  if (text.length > MAX_EMAIL_LENGTH || !EMAIL.test(text)) {
    rejections.push({ field: "email", rawValue: text, reason: "not_an_email" });
    return null;
  }
  return text;
}

function normalizeName(
  raw: string | undefined,
  rejections: ContactFieldRejection[]
): string | null {
  const text = collapseSpaces(raw ?? "");
  if (text === "") {
    return null;
  }

  const unquoted = text.replace(/^["'«](.*)["'»]$/u, "$1").trim();
  if (!looksLikeName(unquoted)) {
    rejections.push({ field: "name", rawValue: text, reason: "not_a_name" });
    return null;
  }

  return unquoted.slice(0, MAX_NAME_LENGTH);
}

/** \s покрывает и неразрывный пробел, которым полны выгрузки из таблиц. */
function collapseSpaces(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function dropRejection(
  rejections: ContactFieldRejection[],
  field: ContactFieldName
): void {
  const index = rejections.findIndex((rejection) => rejection.field === field);
  if (index >= 0) {
    rejections.splice(index, 1);
  }
}
