import type {
  SiteRegistrationResponse,
  SiteRegistrationStatus
} from "@ticket-platform/contracts";
import type { DomainEvent } from "@ticket-platform/domain";
import { nextCallSlot } from "./call-window.js";
import type { IdGenerator, OutboxWriter, UnitOfWork } from "./identity.js";
import type { PhoneNormalizer } from "./phone.js";

/**
 * Заявка с формы на сайте.
 *
 * Форму открывает кто угодно, поэтому у сервиса две обязанности, которые легко перепутать:
 * принять заявку и завести участника. Первое обязано случиться всегда — человек оставил
 * телефон и ждёт звонка; второе возможно только тогда, когда нашлось мероприятие, к которому
 * его отнести. Разделение и делает открытый эндпоинт безопасным: любая наша ошибка в
 * настройке встречи стоит места в списке, но не самого контакта.
 *
 * Встреча ищется по слагу, а не по идентификатору из запроса: событие из тела запроса значило
 * бы, что записать человека можно в любое мероприятие, включая платное.
 */

/** Как долго после начала встречи заявка всё ещё относится к ней, а не к следующей. */
const LATE_REGISTRATION_HOURS = 6;

export const SITE_REGISTRATION_NAME_LIMIT = 200;

/** Текст звонка по заявке, если правило автозадач ещё не заводили. */
const DEFAULT_SITE_TASK_TEXT = "Позвонить по заявке с сайта";

export interface SiteRegistrationEvent {
  readonly id: string;
  readonly title: string;
  readonly startsAt: Date;
}

export interface CreateSiteParticipantInput {
  readonly registrationId: string;
  readonly participantId: string;
  readonly contactSeedId: string;
  readonly eventId: string;
  readonly name: string;
  readonly phoneE164: string;
  readonly consentAt: Date;
  readonly page: string;
  readonly createdByAdminId: string;
  /** Куда положить карточку и когда по ней звонить. Пусто — воронки направления нет. */
  readonly enrollment: SiteRegistrationEnrollment | null;
}

/**
 * Карточка в постоянной воронке направления и звонок по ней.
 *
 * Заводится в той же транзакции, что и участник: заявка, по которой никому не поручено
 * позвонить, — это заявка, о которой вспомнят через неделю. Раньше человек попадал в
 * воронку только следующим проходом сверки и без всякой задачи.
 */
export interface SiteRegistrationEnrollment {
  readonly campaignId: string;
  readonly campaignContactId: string;
  readonly stage: string;
  /** Пусто — правило выключено: карточку заводим, звонок не ставим. */
  readonly task: {
    readonly taskId: string;
    readonly ruleId: string | null;
    readonly text: string;
    readonly dueAt: Date;
  } | null;
  readonly assignedAdminId: string;
}

/** Постоянная воронка направления вместе с её окном обзвона и правилом автозадачи. */
export interface SiteRegistrationCampaign {
  readonly campaignId: string;
  /** Первая колонка воронки: у среды это «Новые заявки». */
  readonly stage: string;
  readonly callWindowStart: number;
  readonly callWindowEnd: number;
  readonly callWindowTimezone: string;
  /**
   * Правило автозадачи по заявке. `null` — правила не заводили: тогда звонок ставится с
   * текстом по умолчанию, как было до появления правил.
   */
  readonly taskRule: {
    readonly ruleId: string;
    readonly isEnabled: boolean;
    readonly taskText: string;
  } | null;
}

export interface RecordSiteRegistrationInput {
  readonly registrationId: string;
  readonly eventId: string | null;
  readonly participantId: string | null;
  readonly name: string;
  readonly phoneE164: string;
  readonly consentAt: Date;
  readonly page: string;
  readonly status: "duplicate" | "unassigned";
}

export interface SiteRegistrationRepository {
  /** Воронка направления, в которую попадают заявки. `null` — её не завели. */
  findStandingCampaign(slugPrefix: string): Promise<SiteRegistrationCampaign | null>;
  /** Ближайшая встреча, на которую сейчас идёт запись с сайта. */
  findRegistrationEvent(input: {
    readonly slugPrefix: string;
    readonly now: Date;
  }): Promise<SiteRegistrationEvent | null>;
  /** Идентификатор участника с этим телефоном, если он в списке встречи уже есть. */
  findParticipantByPhone(input: {
    readonly eventId: string;
    readonly phoneE164: string;
  }): Promise<string | null>;
  /** Заводит участника, контакт базы и саму заявку одной транзакцией. */
  createParticipant(input: CreateSiteParticipantInput): Promise<void>;
  /** Заявка без нового участника: дубль или мероприятие не нашлось. */
  recordRegistration(input: RecordSiteRegistrationInput): Promise<void>;
}

export class InvalidSiteRegistrationError extends Error {
  constructor(readonly code: "invalid_name" | "invalid_phone" | "consent_required") {
    super(`Site registration is invalid: ${code}`);
    this.name = "InvalidSiteRegistrationError";
  }
}

export interface SiteRegistrationOptions {
  /** С чего начинается слаг мероприятий, на которые пишет форма сайта. */
  readonly eventSlugPrefix: string;
  /** От чьего имени заводится участник: служебная учётная запись из миграции. */
  readonly systemAdminId: string;
}

export class RegisterFromSiteService {
  constructor(
    private readonly repository: SiteRegistrationRepository,
    private readonly phoneNormalizer: PhoneNormalizer,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly options: SiteRegistrationOptions
  ) {}

  async execute(input: {
    readonly name: string;
    readonly phone: string;
    readonly consent: boolean;
    readonly page?: string;
    readonly now: Date;
  }): Promise<SiteRegistrationResponse> {
    const name = normalizeName(input.name);
    const phoneE164 = this.normalizePhone(input.phone);
    if (input.consent !== true) {
      throw new InvalidSiteRegistrationError("consent_required");
    }

    const page = (input.page ?? "").trim().slice(0, 200);
    const registrationId = this.idGenerator.newId();
    const event = await this.repository.findRegistrationEvent({
      slugPrefix: this.options.eventSlugPrefix,
      now: input.now
    });

    if (!event) {
      // Встречи нет — заявка всё равно принята, а организаторы узнают об этом из сообщения:
      // молча потерять человека здесь хуже, чем прислать заявку без списка.
      await this.unitOfWork.transact(async () => {
        await this.repository.recordRegistration({
          registrationId,
          eventId: null,
          participantId: null,
          name,
          phoneE164,
          consentAt: input.now,
          page,
          status: "unassigned"
        });
        await this.outboxWriter.append(
          submittedEvent(registrationId, this.idGenerator.newId(), input.now)
        );
      });
      return response("registered", null, null);
    }

    const existingParticipantId = await this.repository.findParticipantByPhone({
      eventId: event.id,
      phoneE164
    });

    if (existingParticipantId) {
      // Повторная отправка формы — обычное дело: человек не увидел окно успеха или решил
      // «на всякий случай». В списке он остаётся один, и организаторам о нём не пишем
      // второй раз, но саму заявку сохраняем — по ней видно, что человек приходил снова.
      await this.unitOfWork.transact(async () => {
        await this.repository.recordRegistration({
          registrationId,
          eventId: event.id,
          participantId: existingParticipantId,
          name,
          phoneE164,
          consentAt: input.now,
          page,
          status: "duplicate"
        });
      });
      return response("already_registered", event.title, event.startsAt);
    }

    const participantId = this.idGenerator.newId();
    // Повторную заявку в воронку не заводим: человек попал туда с первой, и вторая карточка
    // означала бы два места, где по нему ведут работу.
    const enrollment = await this.buildEnrollment(input.now);
    await this.unitOfWork.transact(async () => {
      await this.repository.createParticipant({
        registrationId,
        participantId,
        contactSeedId: this.idGenerator.newId(),
        eventId: event.id,
        name,
        phoneE164,
        consentAt: input.now,
        page,
        createdByAdminId: this.options.systemAdminId,
        enrollment
      });
      await this.outboxWriter.append(
        submittedEvent(registrationId, this.idGenerator.newId(), input.now)
      );
    });

    return response("registered", event.title, event.startsAt);
  }

  /**
   * Куда положить заявку и когда звонить.
   *
   * Воронки может не быть — направление ещё не завели или префикс сменили. Это не повод
   * терять заявку: участник заведётся и без неё, а организаторы получат сообщение.
   */
  private async buildEnrollment(
    now: Date
  ): Promise<SiteRegistrationEnrollment | null> {
    const campaign = await this.repository.findStandingCampaign(
      this.options.eventSlugPrefix
    );
    if (!campaign) {
      return null;
    }
    const rule = campaign.taskRule;
    return {
      campaignId: campaign.campaignId,
      campaignContactId: this.idGenerator.newId(),
      stage: campaign.stage,
      task: rule !== null && !rule.isEnabled
        ? null
        : {
            taskId: this.idGenerator.newId(),
            ruleId: rule?.ruleId ?? null,
            text: rule?.taskText ?? DEFAULT_SITE_TASK_TEXT,
            dueAt: nextCallSlot(now, {
              startHour: campaign.callWindowStart,
              endHour: campaign.callWindowEnd,
              timeZone: campaign.callWindowTimezone
            })
          },
      assignedAdminId: this.options.systemAdminId
    };
  }

  private normalizePhone(rawPhone: string): string {
    const phone = (rawPhone ?? "").trim();
    if (phone.length < 5 || phone.length > 32) {
      throw new InvalidSiteRegistrationError("invalid_phone");
    }
    try {
      return this.phoneNormalizer.normalize(phone);
    } catch {
      throw new InvalidSiteRegistrationError("invalid_phone");
    }
  }
}

/** Сколько времени после начала встречи она остаётся «ближайшей» для формы. */
export function siteRegistrationWindowStart(now: Date): Date {
  return new Date(now.getTime() - LATE_REGISTRATION_HOURS * 60 * 60 * 1_000);
}

function response(
  status: SiteRegistrationStatus,
  eventTitle: string | null,
  startsAt: Date | null
): SiteRegistrationResponse {
  return {
    status,
    eventTitle,
    startsAt: startsAt ? startsAt.toISOString() : null
  };
}

function normalizeName(rawName: string): string {
  const name = (rawName ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > SITE_REGISTRATION_NAME_LIMIT) {
    throw new InvalidSiteRegistrationError("invalid_name");
  }
  return name;
}

function submittedEvent(
  registrationId: string,
  eventId: string,
  occurredAt: Date
): DomainEvent {
  return {
    eventId,
    aggregateType: "site_registration",
    aggregateId: registrationId,
    eventType: "SiteRegistrationSubmitted",
    schemaVersion: 1,
    payload: { registrationId },
    occurredAt
  };
}
