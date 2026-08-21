import { nextCallSlot } from "./call-window.js";
import type { IdGenerator } from "./identity.js";
import type { PhoneNormalizer } from "./phone.js";

/**
 * Звонобот: обратная связь с автообзвона становится новой заявкой.
 *
 * Работа разрезана надвое намеренно, и линия реза — это то, что мы про Звонобота знаем.
 *
 * **Приём** знает про их формат ровно одно: это JSON. Он кладёт тело целиком и отвечает
 * `200`. Ни телефон, ни кнопка на этом шаге не обязательны: вебхук, который мы отвергли,
 * они повторят несколько раз и бросят, и человек, нажавший «интересно», просто исчезнет.
 * Принять и не понять — хуже, чем понять, но лучше, чем потерять.
 *
 * **Разбор** идёт вторым проходом, по сохранённым строкам, и его можно переписать, когда
 * формат подтвердится, а потом прогнать по уже принятому. Разбор на лету такой второй
 * попытки не оставляет.
 */

/** Поля, в которых у провайдеров автообзвона обычно лежит телефон. */
const PHONE_KEYS = [
  "phone", "phone_number", "phonenumber", "number", "msisdn",
  "to", "callee", "caller", "client_phone", "subscriber"
] as const;

/** Поля с нажатой кнопкой. У Звонобота это `button`, у соседей по рынку — `dtmf`. */
const BUTTON_KEYS = [
  "button", "buttons", "dtmf", "pressed", "pressed_button", "digit", "key", "answer"
] as const;

const DURATION_KEYS = [
  "duration", "duration_seconds", "talk_time", "talktime",
  "billsec", "conversation_duration"
] as const;

const CAMPAIGN_KEYS = [
  "campaign", "campaign_name", "campaignname", "campaign_title",
  "record_name", "task_name"
] as const;

const CALL_ID_KEYS = [
  "call_id", "callid", "id", "uuid", "record_id", "session_id", "external_id"
] as const;

/** Текст задачи, если правило автозадач ещё не заводили. */
const DEFAULT_ZVONOBOT_TASK_TEXT = "Позвонить: человек ответил роботу";

/** Откуда человек попал в базу — видно в карточке и в отборе по источнику. */
export const ZVONOBOT_CONTACT_SOURCE = "Звонобот";

export type ZvonobotCallStatus = "pending" | "lead" | "ignored" | "unparsed";

/** Сырой вебхук в том виде, в каком его сохранил приёмник. */
export interface ZvonobotCallRecord {
  readonly id: string;
  readonly externalCallId: string;
  readonly campaignName: string;
  readonly phoneE164: string | null;
  readonly pressedButton: string | null;
  readonly durationSeconds: number | null;
  readonly payload: unknown;
  readonly receivedAt: Date;
}

export interface StoreZvonobotCallInput {
  readonly id: string;
  readonly externalCallId: string;
  readonly campaignName: string;
  readonly phoneE164: string | null;
  readonly pressedButton: string | null;
  readonly durationSeconds: number | null;
  readonly payload: unknown;
  readonly receivedAt: Date;
}

export interface ZvonobotIntakeRepository {
  /**
   * Сохраняет вебхук. `false` — звонок с таким ключом уже приняли: повтор вебхука это
   * норма, а не ошибка, и отвечать на него надо тем же `200`.
   */
  store(input: StoreZvonobotCallInput): Promise<boolean>;
}

/** Что считается заявкой. Настройка живёт в базе, потому что меняют её, а не код. */
export interface ZvonobotSettings {
  readonly leadButtons: readonly string[];
  readonly leadMinDurationSeconds: number | null;
  readonly campaignSlugPrefix: string;
}

/** Воронка направления, окно обзвона и правило автозадачи по обратной связи. */
export interface ZvonobotCampaign {
  readonly campaignId: string;
  readonly stage: string;
  readonly callWindowStart: number;
  readonly callWindowEnd: number;
  readonly callWindowTimezone: string;
  readonly taskRule: {
    readonly ruleId: string;
    readonly isEnabled: boolean;
    readonly taskText: string;
  } | null;
}

export interface ZvonobotLeadToCreate {
  readonly callId: string;
  readonly phoneE164: string;
  readonly campaignName: string;
  readonly pressedButton: string | null;
  readonly contactSeedId: string;
  readonly noteId: string;
  readonly campaignId: string;
  readonly campaignContactId: string;
  readonly stage: string;
  readonly assignedAdminId: string;
  readonly task: {
    readonly taskId: string;
    readonly ruleId: string | null;
    readonly text: string;
    readonly dueAt: Date;
  } | null;
  readonly processedAt: Date;
}

export interface ZvonobotProcessingRepository {
  loadSettings(): Promise<ZvonobotSettings>;
  findCampaign(slugPrefix: string): Promise<ZvonobotCampaign | null>;
  /** Самые старые неразобранные звонки. */
  claimPending(batchSize: number): Promise<readonly ZvonobotCallRecord[]>;
  /** Заводит человека, карточку в воронке и звонок по ней — одной транзакцией. */
  createLead(input: ZvonobotLeadToCreate): Promise<void>;
  /** Разобрали, но заявки не вышло: не нажал, сбросил, телефона в теле не нашлось. */
  markSettled(input: {
    readonly callId: string;
    readonly status: "ignored" | "unparsed";
    readonly processedAt: Date;
  }): Promise<void>;
}

export class InvalidZvonobotCallError extends Error {
  constructor(readonly code: "invalid_payload") {
    super(`Zvonobot call is invalid: ${code}`);
    this.name = "InvalidZvonobotCallError";
  }
}

/**
 * Приём вебхука.
 *
 * Разбор здесь ровно тот, что нужен, чтобы строку потом нашли руками: телефон, кнопка,
 * длительность, кампания. Не нашлось — не беда, тело сохранено целиком.
 */
export class ReceiveZvonobotCallService {
  constructor(
    private readonly repository: ZvonobotIntakeRepository,
    private readonly phoneNormalizer: PhoneNormalizer,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly payload: unknown;
    readonly now: Date;
  }): Promise<{ readonly status: "accepted" | "duplicate" }> {
    if (input.payload === null || typeof input.payload !== "object") {
      throw new InvalidZvonobotCallError("invalid_payload");
    }
    const body = input.payload as Record<string, unknown>;
    const rawPhone = findString(body, PHONE_KEYS);
    const stored = await this.repository.store({
      id: this.idGenerator.newId(),
      externalCallId: externalCallId(body, input.now),
      campaignName: (findString(body, CAMPAIGN_KEYS) ?? "").slice(0, 200),
      phoneE164: rawPhone === null ? null : this.normalizePhone(rawPhone),
      pressedButton: normalizeButton(findString(body, BUTTON_KEYS)),
      durationSeconds: findNumber(body, DURATION_KEYS),
      payload: input.payload,
      receivedAt: input.now
    });
    return { status: stored ? "accepted" : "duplicate" };
  }

  /** Телефон в неизвестном виде — не повод отвергать вебхук: строка сохранится без него. */
  private normalizePhone(rawPhone: string): string | null {
    try {
      return this.phoneNormalizer.normalize(rawPhone);
    } catch {
      return null;
    }
  }
}

/**
 * Разбор принятого: кто ответил роботу — тот новая заявка.
 *
 * Проход идёт по тем же рельсам, что заявка с сайта: человек в базе (с поиском дубля по
 * телефону), карточка в постоянной воронке направления, первая колонка, звонок в
 * ближайшее окно обзвона. Ничего своего здесь нет намеренно — «заявка» должна выглядеть
 * одинаково, откуда бы она ни пришла.
 */
export class ProcessZvonobotCallsBatchService {
  constructor(
    private readonly repository: ZvonobotProcessingRepository,
    private readonly idGenerator: IdGenerator,
    private readonly options: { readonly systemAdminId: string }
  ) {}

  async execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<{
    readonly claimed: number;
    readonly leads: number;
    readonly ignored: number;
    readonly unparsed: number;
  }> {
    const pending = await this.repository.claimPending(input.batchSize);
    if (pending.length === 0) {
      return { claimed: 0, leads: 0, ignored: 0, unparsed: 0 };
    }

    const settings = await this.repository.loadSettings();
    const campaign = await this.repository.findCampaign(settings.campaignSlugPrefix);
    let leads = 0;
    let ignored = 0;
    let unparsed = 0;

    for (const call of pending) {
      if (call.phoneE164 === null) {
        // Телефона нет — заводить некого. Строка остаётся с телом целиком, и по ней видно,
        // что именно приехало: это и есть материал для следующей версии разбора.
        await this.repository.markSettled({
          callId: call.id,
          status: "unparsed",
          processedAt: input.at
        });
        unparsed += 1;
        continue;
      }
      if (!isLead(call, settings) || campaign === null) {
        // Воронки нет — это не «не заявка», но и завести карточку некуда. Строка помечается
        // разобранной, чтобы проход не крутил её вечно; повторный разбор делается руками,
        // когда воронку заведут.
        await this.repository.markSettled({
          callId: call.id,
          status: "ignored",
          processedAt: input.at
        });
        ignored += 1;
        continue;
      }

      const rule = campaign.taskRule;
      await this.repository.createLead({
        callId: call.id,
        phoneE164: call.phoneE164,
        campaignName: call.campaignName,
        pressedButton: call.pressedButton,
        contactSeedId: this.idGenerator.newId(),
        noteId: this.idGenerator.newId(),
        campaignId: campaign.campaignId,
        campaignContactId: this.idGenerator.newId(),
        stage: campaign.stage,
        assignedAdminId: this.options.systemAdminId,
        task: rule !== null && !rule.isEnabled
          ? null
          : {
              taskId: this.idGenerator.newId(),
              ruleId: rule?.ruleId ?? null,
              text: rule?.taskText ?? DEFAULT_ZVONOBOT_TASK_TEXT,
              dueAt: nextCallSlot(input.at, {
                startHour: campaign.callWindowStart,
                endHour: campaign.callWindowEnd,
                timeZone: campaign.callWindowTimezone
              })
            },
        processedAt: input.at
      });
      leads += 1;
    }

    return { claimed: pending.length, leads, ignored, unparsed };
  }
}

/**
 * Заявка это или нет.
 *
 * Два признака, и любого достаточно: нажал нужную кнопку либо проговорил с роботом дольше
 * порога. Порог пустой — по длительности не судим; список кнопок пустой — не судим по
 * кнопке. Оба пустые означают «ничего не считаем заявкой», и это осмысленное состояние:
 * так приёмник включают на первую кампанию, чтобы сперва посмотреть, что приезжает.
 */
export function isLead(
  call: Pick<ZvonobotCallRecord, "pressedButton" | "durationSeconds">,
  settings: ZvonobotSettings
): boolean {
  const button = call.pressedButton;
  if (
    button !== null
    && settings.leadButtons.some((allowed) => allowed.toLowerCase() === button.toLowerCase())
  ) {
    return true;
  }
  const threshold = settings.leadMinDurationSeconds;
  return (
    threshold !== null
    && call.durationSeconds !== null
    && call.durationSeconds >= threshold
  );
}

/**
 * Примечание в карточке: откуда взялась заявка.
 *
 * Кампания и нажатая кнопка вместе — это весь контекст, который есть у менеджера до
 * первого разговора: по какому поводу звонил робот и что человек ответил.
 */
export function zvonobotNote(
  campaignName: string,
  pressedButton: string | null
): string {
  const campaign = campaignName === "" ? "" : `, кампания «${campaignName}»`;
  const button = pressedButton === null ? "" : `, нажал ${pressedButton}`;
  return `Заявка из Звонобота${campaign}${button}`.slice(0, 4000);
}

/**
 * Ключ идемпотентности.
 *
 * Своего идентификатора у звонка может не оказаться — формат мы знаем не до конца. Тогда
 * ключом становится само тело: повтор того же вебхука даст ту же строку и упрётся в
 * уникальный индекс, а другой звонок — другую. Время добавляется только к телу без
 * идентификатора и только по дате: тот же человек в той же кампании завтра — это новый
 * звонок, а повтор доставки в течение дня — тот же.
 */
function externalCallId(body: Record<string, unknown>, now: Date): string {
  const declared = findString(body, CALL_ID_KEYS);
  if (declared !== null && declared.trim() !== "") {
    return declared.trim().slice(0, 200);
  }
  const day = now.toISOString().slice(0, 10);
  return `body:${day}:${hash(stableJson(body))}`;
}

/**
 * Поиск поля по именам, включая вложенные объекты.
 *
 * Провайдеры любят заворачивать полезное в `data`, `call`, `result`. Обход в глубину
 * дешевле, чем список из шести вариантов пути, и переживает переезд поля на уровень выше.
 */
function findValue(
  body: unknown,
  keys: readonly string[],
  depth = 0
): unknown {
  if (depth > 4 || body === null || typeof body !== "object") {
    return undefined;
  }
  const entries = Array.isArray(body)
    ? body.map((item, index) => [String(index), item] as const)
    : Object.entries(body as Record<string, unknown>);

  for (const [key, value] of entries) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      keys.some((candidate) => candidate.replace(/[^a-z0-9]/g, "") === normalized)
      && (typeof value === "string" || typeof value === "number")
    ) {
      return value;
    }
  }
  for (const [, value] of entries) {
    const nested = findValue(value, keys, depth + 1);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function findString(body: unknown, keys: readonly string[]): string | null {
  const value = findValue(body, keys);
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? null : text;
  }
  return typeof value === "number" ? String(value) : null;
}

function findNumber(body: unknown, keys: readonly string[]): number | null {
  const value = findValue(body, keys);
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 86_400
    ? Math.round(parsed)
    : null;
}

function normalizeButton(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const button = value.trim().slice(0, 32);
  return button === "" ? null : button;
}

/** Тело в устойчивом виде: порядок ключей у JSON не гарантирован, а ключ повтора обязан быть. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

/** Короткая свёртка тела. Не криптография: ей нужно лишь различать разные тела. */
function hash(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second + code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}
