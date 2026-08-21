import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  InvalidSiteRegistrationError,
  RegisterFromSiteService,
  type CreateSiteParticipantInput,
  type RecordSiteRegistrationInput,
  type SiteRegistrationRepository
} from "./site-registration.js";
import type { OutboxWriter, UnitOfWork } from "./identity.js";
import type { PhoneNormalizer } from "./phone.js";

const NOW = new Date("2026-08-20T10:00:00.000Z");
const EVENT = {
  id: "019c0123-4567-789a-bcde-f01234567801",
  title: "Бизнес-Среда, 26 августа",
  startsAt: new Date("2026-08-26T16:00:00.000Z")
};

describe("RegisterFromSiteService", () => {
  it("заводит участника ближайшей встречи и одно событие для организаторов", async () => {
    const state = repositoryState();
    const appended: DomainEvent[] = [];
    const service = createService(state.repository, appended);

    const result = await service.execute({
      name: "  Мария   Соколова ",
      phone: "8 999 123-45-67",
      consent: true,
      page: "sreda",
      now: NOW
    });

    assert.deepEqual(result, {
      status: "registered",
      eventTitle: EVENT.title,
      startsAt: EVENT.startsAt.toISOString()
    });
    // Лишние пробелы внутри имени — обычное дело при вводе с телефона, и в списке участников
    // они выглядят опечаткой.
    assert.equal(state.created[0]?.name, "Мария Соколова");
    assert.equal(state.created[0]?.phoneE164, "+79991234567");
    assert.equal(state.created[0]?.eventId, EVENT.id);
    assert.equal(state.created[0]?.consentAt.toISOString(), NOW.toISOString());
    assert.equal(appended.length, 1);
    assert.equal(appended[0]?.eventType, "SiteRegistrationSubmitted");
    assert.deepEqual(appended[0]?.payload, {
      registrationId: state.created[0]?.registrationId
    });
  });

  it("кладёт заявку в воронку направления и назначает звонок на окно обзвона", async () => {
    const state = repositoryState();
    const service = createService(state.repository, []);

    // 10:00 UTC — это 13:00 по Москве, окно обзвона уже идёт: звонить надо сейчас.
    await service.execute({
      name: "Мария Соколова",
      phone: "+79991234567",
      consent: true,
      now: NOW
    });

    const enrollment = state.created[0]?.enrollment;
    assert.equal(enrollment?.campaignId, STANDING_CAMPAIGN.campaignId);
    assert.equal(enrollment?.stage, "new");
    assert.equal(enrollment?.task?.dueAt.toISOString(), NOW.toISOString());
    assert.equal(enrollment?.task?.text, "Позвонить по заявке с сайта");
  });

  it("ночную заявку двигает на начало обзвона следующего дня", async () => {
    const state = repositoryState();
    const service = createService(state.repository, []);

    // 22:30 UTC 20 августа — это половина второго ночи 21-го по Москве.
    await service.execute({
      name: "Мария Соколова",
      phone: "+79991234567",
      consent: true,
      now: new Date("2026-08-20T22:30:00.000Z")
    });

    assert.equal(
      state.created[0]?.enrollment?.task?.dueAt.toISOString(),
      "2026-08-21T09:00:00.000Z"
    );
  });

  it("выключенное правило оставляет карточку без звонка", async () => {
    const state = repositoryState({
      standingCampaign: {
        ...STANDING_CAMPAIGN,
        taskRule: { ...STANDING_CAMPAIGN.taskRule, isEnabled: false }
      }
    });
    const service = createService(state.repository, []);

    await service.execute({
      name: "Мария Соколова",
      phone: "+79991234567",
      consent: true,
      now: NOW
    });

    // Карточка в воронке остаётся: заявка есть, работать по ней надо. Нет только звонка.
    assert.equal(state.created[0]?.enrollment?.campaignId, STANDING_CAMPAIGN.campaignId);
    assert.equal(state.created[0]?.enrollment?.task, null);
  });

  it("без воронки направления заявку всё равно принимает", async () => {
    const state = repositoryState({ standingCampaign: null });
    const service = createService(state.repository, []);

    const result = await service.execute({
      name: "Мария Соколова",
      phone: "+79991234567",
      consent: true,
      now: NOW
    });

    assert.equal(result.status, "registered");
    assert.equal(state.created[0]?.enrollment, null);
  });

  it("не заводит человека дважды и не пишет организаторам о повторе", async () => {
    const state = repositoryState({ existingParticipantId: "019c0123-4567-789a-bcde-f01234567802" });
    const appended: DomainEvent[] = [];
    const service = createService(state.repository, appended);

    const result = await service.execute({
      name: "Мария Соколова",
      phone: "+79991234567",
      consent: true,
      now: NOW
    });

    assert.equal(result.status, "already_registered");
    assert.equal(state.created.length, 0);
    assert.equal(appended.length, 0);
    // Сама заявка сохраняется: по ней видно, что человек приходил на форму снова.
    assert.equal(state.recorded[0]?.status, "duplicate");
    assert.equal(state.recorded[0]?.participantId, "019c0123-4567-789a-bcde-f01234567802");
  });

  it("принимает заявку, даже когда ближайшей встречи в панели нет", async () => {
    const state = repositoryState({ event: null });
    const appended: DomainEvent[] = [];
    const service = createService(state.repository, appended);

    const result = await service.execute({
      name: "Мария Соколова",
      phone: "+79991234567",
      consent: true,
      now: NOW
    });

    // Для человека это успех: он оставил телефон, и ему позвонят. Разбираться, почему встречи
    // нет, — наша забота, а не его.
    assert.deepEqual(result, {
      status: "registered",
      eventTitle: null,
      startsAt: null
    });
    assert.equal(state.recorded[0]?.status, "unassigned");
    assert.equal(state.recorded[0]?.eventId, null);
    assert.equal(appended.length, 1);
  });

  it("отказывает без согласия, с пустым именем и с непохожим телефоном", async () => {
    const state = repositoryState();
    const service = createService(state.repository, []);
    const valid = { name: "Мария Соколова", phone: "+79991234567", consent: true, now: NOW };

    await assert.rejects(
      service.execute({ ...valid, consent: false }),
      (error: unknown) =>
        error instanceof InvalidSiteRegistrationError && error.code === "consent_required"
    );
    await assert.rejects(
      service.execute({ ...valid, name: " М " }),
      (error: unknown) =>
        error instanceof InvalidSiteRegistrationError && error.code === "invalid_name"
    );
    await assert.rejects(
      service.execute({ ...valid, phone: "12345" }),
      (error: unknown) =>
        error instanceof InvalidSiteRegistrationError && error.code === "invalid_phone"
    );
    assert.equal(state.created.length, 0);
    assert.equal(state.recorded.length, 0);
  });

  it("ищет встречу по заданному началу слага", async () => {
    const state = repositoryState();
    const service = createService(state.repository, []);

    await service.execute({
      name: "Мария Соколова",
      phone: "+79991234567",
      consent: true,
      now: NOW
    });

    assert.equal(state.lookups[0]?.slugPrefix, "sreda");
  });
});

function createService(
  repository: SiteRegistrationRepository,
  appended: DomainEvent[]
): RegisterFromSiteService {
  let id = 0;

  return new RegisterFromSiteService(
    repository,
    phoneNormalizer(),
    {
      async append(event) {
        appended.push(event);
      }
    } satisfies OutboxWriter,
    unitOfWork(),
    { newId() { id += 1; return `id-${id}`; } },
    { eventSlugPrefix: "sreda", systemAdminId: "00000000-0000-4000-8000-000000000001" }
  );
}

const STANDING_CAMPAIGN = {
  campaignId: "campaign-1",
  stage: "new",
  callWindowStart: 12,
  callWindowEnd: 19,
  callWindowTimezone: "Europe/Moscow",
  taskRule: {
    ruleId: "rule-1",
    isEnabled: true,
    taskText: "Позвонить по заявке с сайта"
  }
};

function repositoryState(options: {
  readonly event?: typeof EVENT | null;
  readonly existingParticipantId?: string;
  readonly standingCampaign?: typeof STANDING_CAMPAIGN | null;
} = {}) {
  const created: CreateSiteParticipantInput[] = [];
  const recorded: RecordSiteRegistrationInput[] = [];
  const lookups: { readonly slugPrefix: string; readonly now: Date }[] = [];
  const event = options.event === undefined ? EVENT : options.event;

  const repository: SiteRegistrationRepository = {
    async findRegistrationEvent(input) {
      lookups.push(input);
      return event;
    },
    async findStandingCampaign() {
      return options.standingCampaign === undefined
        ? STANDING_CAMPAIGN
        : options.standingCampaign;
    },
    async findParticipantByPhone() {
      return options.existingParticipantId ?? null;
    },
    async createParticipant(input) {
      created.push(input);
    },
    async recordRegistration(input) {
      recorded.push(input);
    }
  };

  return { repository, created, recorded, lookups };
}

/** Тот же разбор, что у боевого нормализатора, но без зависимости на библиотеку. */
function phoneNormalizer(): PhoneNormalizer {
  return {
    normalize(rawPhone) {
      const digits = rawPhone.replace(/\D/g, "");
      const russian = digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))
        ? `+7${digits.slice(1)}`
        : null;
      if (!russian) {
        throw new Error("Phone number is invalid");
      }
      return russian;
    }
  };
}

function unitOfWork(): UnitOfWork {
  return {
    transact(work) {
      return work();
    }
  };
}
