import {
  DEFAULT_GREETING_TEMPLATE,
  GREETING_PHRASE_LIMIT,
  GREETING_TEMPLATE_LIMIT,
  unknownGreetingPlaceholders,
  type AdminRequestActor,
  type EventGreetingStats,
  type EventGreetingView,
  type SaveEventGreetingRequest
} from "@ticket-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Настройки приветствия у мероприятия: писать ли по заявкам, как назвать мероприятие и
 * каким текстом.
 *
 * Правятся и у опубликованного мероприятия — в отличие от содержимого, по которому уже
 * приняты согласия. Приветствие ни во что не вшито: следующая заявка получит новый текст,
 * а ушедшие сообщения остаются в переписке такими, какими ушли.
 *
 * **По умолчанию выключено.** Решение владельца от 26.10.2026: писать по заявкам только на
 * мастер-классы Чурсина, а не на встречу 18 ноября. Правило «включается галочкой у
 * мероприятия» держит это само: новая встреча никому не напишет, пока её не включили, а
 * забытая галочка стоит одного неотправленного «получили заявку», а не волны сообщений
 * незнакомым людям.
 *
 * **Текст с опечаткой в подстановке не сохраняется.** Проверка стоит и в воркере, но там
 * она уже ничего не спасает: приветствие не уходит, а человек остаётся без сообщения. Здесь
 * же менеджер видит ошибку сразу, у поля, которое только что написал.
 */

export interface GreetingEventRow {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly timeZone: string;
  readonly locationName: string | null;
  readonly locationAddress: string | null;
}

export interface StoredEventGreeting {
  readonly isEnabled: boolean;
  readonly eventPhrase: string | null;
  readonly bodyTemplate: string | null;
  readonly updatedAt: Date;
  readonly updatedByName: string | null;
}

export interface AdminEventGreetingRepository {
  findEvent(eventId: string): Promise<GreetingEventRow | null>;
  /** Пусто — настройки ни разу не сохраняли. */
  loadSettings(eventId: string): Promise<StoredEventGreeting | null>;
  countGreetings(eventId: string): Promise<EventGreetingStats>;
  hasPermission(adminId: string, permission: string): Promise<boolean>;
  saveSettings(input: {
    readonly eventId: string;
    readonly isEnabled: boolean;
    readonly eventPhrase: string | null;
    readonly bodyTemplate: string | null;
    readonly adminId: string;
    readonly at: Date;
  }): Promise<void>;
}

export interface GreetingClock {
  now(): Date;
}

export class GreetingEventNotFoundError extends Error {
  constructor() {
    super("Event was not found");
    this.name = "GreetingEventNotFoundError";
  }
}

/** Текст или название не годятся. `reason` видит менеджер — он про дело. */
export class InvalidEventGreetingError extends Error {
  constructor(readonly reason: string) {
    super("Event greeting is invalid");
    this.name = "InvalidEventGreetingError";
  }
}

export class AdminEventGreetingService {
  constructor(
    private readonly repository: AdminEventGreetingRepository,
    private readonly clock: GreetingClock
  ) {}

  async get(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<EventGreetingView> {
    requirePermission(input.actor, "events.read");
    requireUuid(input.eventId);

    return await this.view(input.eventId, input.actor.adminId);
  }

  async save(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly settings: SaveEventGreetingRequest;
  }): Promise<EventGreetingView> {
    requirePermission(input.actor, "events.write");
    requireUuid(input.eventId);

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new GreetingEventNotFoundError();
    }

    const eventPhrase = cleanPhrase(input.settings.eventPhrase);
    const bodyTemplate = cleanTemplate(input.settings.bodyTemplate);

    await this.repository.saveSettings({
      eventId: input.eventId,
      isEnabled: input.settings.isEnabled,
      eventPhrase,
      bodyTemplate,
      adminId: input.actor.adminId,
      at: this.clock.now()
    });

    return await this.view(input.eventId, input.actor.adminId);
  }

  private async view(eventId: string, adminId: string): Promise<EventGreetingView> {
    const event = await this.repository.findEvent(eventId);
    if (!event) {
      throw new GreetingEventNotFoundError();
    }
    const [settings, stats, canEdit] = await Promise.all([
      this.repository.loadSettings(eventId),
      this.repository.countGreetings(eventId),
      this.repository.hasPermission(adminId, "events.write")
    ]);

    return {
      eventId: event.id,
      // Пока настройки не сохраняли, приветствие выключено — как его и считает воркер.
      isEnabled: settings?.isEnabled ?? false,
      eventPhrase: settings?.eventPhrase ?? null,
      bodyTemplate: settings?.bodyTemplate ?? null,
      defaultTemplate: DEFAULT_GREETING_TEMPLATE,
      event: {
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        timeZone: event.timeZone,
        locationName: event.locationName,
        locationAddress: event.locationAddress
      },
      stats,
      updatedAt: settings ? settings.updatedAt.toISOString() : null,
      updatedByName: settings?.updatedByName ?? null,
      canEdit
    };
  }
}

function cleanPhrase(value: string | null): string | null {
  const phrase = (value ?? "").replace(/\s+/g, " ").trim();
  if (phrase === "") {
    return null;
  }
  if (phrase.length > GREETING_PHRASE_LIMIT) {
    throw new InvalidEventGreetingError(
      `Название длиннее ${GREETING_PHRASE_LIMIT} знаков — в первой строке сообщения это много`
    );
  }
  if (/[{}]/.test(phrase)) {
    throw new InvalidEventGreetingError(
      "В названии фигурные скобки: подстановки работают в тексте, а не в названии"
    );
  }

  return phrase;
}

/**
 * Свой текст или общий.
 *
 * Текст, совпадающий с общим, хранится как «общий», а не копией: иначе правка общего текста
 * в коде обошла бы стороной мероприятие, где его однажды просто сохранили без изменений.
 */
function cleanTemplate(value: string | null): string | null {
  const template = (value ?? "").replaceAll("\r\n", "\n").trim();
  if (template === "" || template === DEFAULT_GREETING_TEMPLATE) {
    return null;
  }
  if (template.length > GREETING_TEMPLATE_LIMIT) {
    throw new InvalidEventGreetingError(
      `Текст длиннее ${GREETING_TEMPLATE_LIMIT} знаков — так не пишут первое сообщение`
    );
  }
  const unknown = unknownGreetingPlaceholders(template);
  if (unknown.length > 0) {
    throw new InvalidEventGreetingError(
      `Неизвестная подстановка: ${unknown.map((name) => `{${name}}`).join(", ")}`
    );
  }

  return template;
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "events.read" | "events.write"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator event greeting permission is invalid");
  }
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Event greeting request is invalid");
  }
}
