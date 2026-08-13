import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminOutreachService,
  computeTaskUrgency,
  type AdminOutreachRepository
} from "./admin-outreach.js";

describe("computeTaskUrgency", () => {
  const now = new Date("2026-07-30T12:00:00.000Z");

  it("buckets a past due time as overdue", () => {
    assert.equal(
      computeTaskUrgency(new Date("2026-07-30T09:00:00.000Z"), now),
      "overdue"
    );
  });

  it("buckets the same calendar day as today", () => {
    assert.equal(
      computeTaskUrgency(new Date("2026-07-30T20:00:00.000Z"), now),
      "today"
    );
  });

  it("buckets the next calendar day as tomorrow", () => {
    assert.equal(
      computeTaskUrgency(new Date("2026-07-31T08:00:00.000Z"), now),
      "tomorrow"
    );
  });

  it("buckets within a week as this_week and beyond as later", () => {
    assert.equal(
      computeTaskUrgency(new Date("2026-08-04T08:00:00.000Z"), now),
      "this_week"
    );
    assert.equal(
      computeTaskUrgency(new Date("2026-08-10T08:00:00.000Z"), now),
      "later"
    );
  });
});

describe("AdminOutreachService", () => {
  it("normalizes a bounded import and assigns it to the current manager", async () => {
    let received:
      Parameters<AdminOutreachRepository["importContacts"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          received = input;
          return {
            received: input.rows.length,
            createdContacts: 1,
            updatedContacts: 0,
            addedToCampaign: 1,
            alreadyInCampaign: 0,
            invalidRows: 0,
            invalidRowIndexes: [],
            ambiguousRows: 0,
            ambiguousRowIndexes: []
          };
        }
      }),
      { normalize: () => "+79991234567" },
      sequenceIds()
    );

    const result = await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [{
        name: " Анна ",
        phone: "8 999 123-45-67",
        telegram: "@Anna_Test",
        source: " База 2025 "
      }],
      now
    });

    assert.equal(result.addedToCampaign, 1);
    assert.equal(received?.assignedAdminId, ADMIN_ID);
    assert.deepEqual(received?.rows[0], {
      displayName: "Анна",
      phoneE164: "+79991234567",
      telegramUsername: "Anna_Test",
      telegramUsernameNormalized: "anna_test",
      maxIdentifier: null,
      maxIdentifierNormalized: null,
      email: null,
      emailNormalized: null,
      source: "База 2025",
      note: null,
      contactId: "00000000-0000-4000-8000-000000000201",
      campaignContactId: "00000000-0000-4000-8000-000000000202"
    });
  });

  it("keeps a row whose phone is junk but whose handle is good", async () => {
    // Раньше такая строка пропадала целиком: разбор телефона ронял её вместе с ником, и из
    // выгрузки на восемь тысяч так терялись живые контакты.
    let received:
      Parameters<AdminOutreachRepository["importContacts"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          received = input;
          return {
            received: input.rows.length,
            createdContacts: 1,
            updatedContacts: 0,
            addedToCampaign: 1,
            alreadyInCampaign: 0,
            ambiguousRowIndexes: []
          };
        }
      }),
      rejectingPhones(),
      sequenceIds()
    );

    const result = await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [{ name: "Анна", phone: "мобильный", telegram: "@anna_test" }],
      skipInvalid: true,
      now
    });

    assert.equal(result.invalidRows, 0);
    assert.equal(received?.rows[0]?.telegramUsername, "anna_test");
    assert.equal(received?.rows[0]?.phoneE164, null);
  });

  it("puts a second phone from one cell into the note instead of dropping it", async () => {
    let received:
      Parameters<AdminOutreachRepository["importContacts"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          received = input;
          return {
            received: input.rows.length,
            createdContacts: 1,
            updatedContacts: 0,
            addedToCampaign: 1,
            alreadyInCampaign: 0,
            ambiguousRowIndexes: []
          };
        }
      }),
      { normalize: (value) => `+${value.replace(/\D/g, "")}` },
      sequenceIds()
    );

    await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [{ phone: "+79991234567, +79997654321", note: "звонить после 18" }],
      now
    });

    assert.equal(received?.rows[0]?.phoneE164, "+79991234567");
    assert.equal(
      received?.rows[0]?.note,
      "звонить после 18\nЕщё телефоны: +79997654321"
    );
  });

  it("names the field that failed when a contact is added by hand", async () => {
    // «Нет признаков» человеку, который ввёл кривой ник, ничего не объясняет.
    const service = new AdminOutreachService(
      repository({}),
      { normalize: () => "+79991234567" },
      countingIds()
    );

    await assert.rejects(
      service.createContact({
        actor: writeActor,
        campaignId: CAMPAIGN_ID,
        contact: { name: "Анна", telegram: "не ник" },
        now
      }),
      /messenger identifier is invalid/
    );
  });

  // В выгрузке Timepad почта есть у всех, а телефона нет у части: без неё такой контакт
  // некуда положить — проверка требует хотя бы один признак.
  it("accepts a contact identified by email alone", async () => {
    let received:
      Parameters<AdminOutreachRepository["importContacts"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          received = input;
          return {
            received: input.rows.length,
            createdContacts: 1,
            updatedContacts: 0,
            addedToCampaign: 1,
            alreadyInCampaign: 0,
            invalidRows: 0,
            invalidRowIndexes: [],
            ambiguousRows: 0,
            ambiguousRowIndexes: []
          };
        }
      }),
      rejectingPhones(),
      sequenceIds()
    );

    await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [{ name: "Иван", email: "  Ivan@Example.COM  " }],
      now
    });

    const row = received?.rows[0];
    assert.equal(row?.email, "Ivan@Example.COM");
    assert.equal(row?.emailNormalized, "ivan@example.com");
    assert.equal(row?.phoneE164, null);
  });

  it("refuses a row whose email is not an email, so junk cannot become an identity", async () => {
    let received:
      Parameters<AdminOutreachRepository["importContacts"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          received = input;
          return {
            received: input.rows.length,
            createdContacts: 0,
            updatedContacts: 0,
            addedToCampaign: 0,
            alreadyInCampaign: 0,
            invalidRows: 0,
            invalidRowIndexes: [],
            ambiguousRows: 0,
            ambiguousRowIndexes: []
          };
        }
      }),
      rejectingPhones(),
      sequenceIds()
    );

    const result = await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [{ name: "Иван", email: "не почта" }],
      skipInvalid: true,
      now
    });

    assert.equal(result.addedToCampaign, 0);
    assert.equal(result.invalidRows, 1);
    // До базы такая строка не доходит вовсе — «не почта» не признак человека.
    assert.equal(received, undefined);
  });

  it("skips an unparseable phone instead of losing the whole batch", async () => {
    // Ровно случай выгрузки из amoCRM: пара номеров с приписанным +7 к уже
    // начинавшемуся с 7, а из-за них не проходили все восемь тысяч.
    let received:
      Parameters<AdminOutreachRepository["importContacts"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          received = input;
          return {
            received: input.rows.length,
            createdContacts: input.rows.length,
            updatedContacts: 0,
            addedToCampaign: input.rows.length,
            alreadyInCampaign: 0,
            ambiguousRowIndexes: []
          };
        }
      }),
      {
        normalize: (value) => {
          if (value === "+77921533554") {
            throw new Error("Phone number is invalid");
          }
          return value;
        }
      },
      countingIds()
    );

    const result = await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [
        { phone: "+79991234567" },
        { phone: "+77921533554" },
        { phone: "+79991234568" }
      ],
      skipInvalid: true,
      now
    });

    assert.equal(received?.rows.length, 2);
    assert.equal(result.received, 3);
    assert.equal(result.addedToCampaign, 2);
    assert.equal(result.invalidRows, 1);
    assert.deepEqual(result.invalidRowIndexes, [1]);
  });

  it("still refuses a single bad phone when a contact is added by hand", async () => {
    const service = new AdminOutreachService(
      repository({}),
      {
        normalize: () => {
          throw new Error("Phone number is invalid");
        }
      },
      countingIds()
    );

    await assert.rejects(
      service.createContact({
        actor: writeActor,
        campaignId: CAMPAIGN_ID,
        contact: { phone: "+77921533554" },
        now
      }),
      /Phone number is invalid/
    );
  });

  it("reports a batch where nothing could be parsed without touching the database", async () => {
    let called = false;
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          called = true;
          return {
            received: input.rows.length,
            createdContacts: 0,
            updatedContacts: 0,
            addedToCampaign: 0,
            alreadyInCampaign: 0,
            ambiguousRowIndexes: []
          };
        }
      }),
      {
        normalize: () => {
          throw new Error("Phone number is invalid");
        }
      },
      countingIds()
    );

    const result = await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [{ phone: "+77921533554" }, { phone: "+78800500550" }],
      skipInvalid: true,
      now
    });

    assert.equal(called, false);
    assert.equal(result.invalidRows, 2);
    assert.equal(result.addedToCampaign, 0);
  });

  it("skips a row whose phone and telegram point at different contacts", async () => {
    // Ровно случай из выгрузки: один человек уже заведён дважды — по телефону и по нику.
    // Какой контакт правильный, решает человек, но соседние 149 строк из-за этого терять
    // нельзя.
    let received:
      Parameters<AdminOutreachRepository["importContacts"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          received = input;
          return {
            received: input.rows.length,
            createdContacts: input.rows.length - 1,
            updatedContacts: 0,
            addedToCampaign: input.rows.length - 1,
            alreadyInCampaign: 0,
            ambiguousRowIndexes: [1]
          };
        }
      }),
      { normalize: (value) => value },
      countingIds()
    );

    const result = await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [
        { phone: "+79991234567" },
        { phone: "+79500234550", telegram: "lovepashyan" },
        { phone: "+79991234569" }
      ],
      skipInvalid: true,
      now
    });

    assert.equal(received?.skipAmbiguous, true);
    assert.equal(result.ambiguousRows, 1);
    assert.deepEqual(result.ambiguousRowIndexes, [1]);
  });

  it("maps ambiguous rows back to their original positions", async () => {
    // База считает индексы по отфильтрованному списку: если первую строку выбросили
    // из-за телефона, вторая для базы станет нулевой — и панель покажет не ту строку.
    const service = new AdminOutreachService(
      repository({
        async importContacts() {
          return {
            received: 2,
            createdContacts: 1,
            updatedContacts: 0,
            addedToCampaign: 1,
            alreadyInCampaign: 0,
            ambiguousRowIndexes: [1]
          };
        }
      }),
      {
        normalize: (value) => {
          if (value === "битый") {
            throw new Error("Phone number is invalid");
          }
          return value;
        }
      },
      countingIds()
    );

    const result = await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [
        { phone: "битый" },
        { phone: "+79991234567" },
        { phone: "+79500234550" }
      ],
      skipInvalid: true,
      now
    });

    assert.deepEqual(result.invalidRowIndexes, [0]);
    // база сказала «индекс 1» из двух оставшихся — это исходная строка 2
    assert.deepEqual(result.ambiguousRowIndexes, [2]);
  });

  it("still fails loudly on an ambiguous contact added by hand", async () => {
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          assert.equal(input.skipAmbiguous, false);
          throw new Error("Outreach contact identifiers belong to different contacts");
        }
      }),
      { normalize: (value) => value },
      countingIds()
    );

    await assert.rejects(
      service.createContact({
        actor: writeActor,
        campaignId: CAMPAIGN_ID,
        contact: { phone: "+79500234550", telegram: "lovepashyan" },
        now
      }),
      /belong to different contacts/
    );
  });

  it("records a manager-owned message batch and rejects impossible results", async () => {
    let received:
      Parameters<AdminOutreachRepository["recordActivities"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async recordActivities(input) {
          received = input;
          return input.activities.length;
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    const result = await service.recordActivities({
      actor: writeActor,
      campaignContactIds: [CAMPAIGN_CONTACT_ID, CAMPAIGN_CONTACT_ID_2],
      channel: "telegram",
      result: "sent",
      note: "Первая рассылка",
      now
    });

    assert.equal(result.recorded, 2);
    assert.equal(received?.actorAdminId, ADMIN_ID);
    assert.equal(received?.action, "message");
    assert.ok(received?.batchId);
    await assert.rejects(
      service.recordActivities({
        actor: writeActor,
        campaignContactIds: [CAMPAIGN_CONTACT_ID],
        channel: "phone",
        result: "sent",
        now
      }),
      /activity result/
    );
  });

  it("does not accept a read-scoped actor for mutations", async () => {
    const service = new AdminOutreachService(
      repository({}),
      { normalize: (value) => value },
      sequenceIds()
    );
    await assert.rejects(
      service.createCampaign({
        actor: { ...writeActor, permission: "outreach.read" },
        name: "Test",
        now
      }),
      /permission/
    );
  });

  it("stores the event a campaign sells for, and null when there is none", async () => {
    const created: Parameters<AdminOutreachRepository["createCampaign"]>[0][] = [];
    const service = new AdminOutreachService(
      repository({
        async createCampaign(input) { created.push(input); },
        async getCampaign() {
          return {
            id: CAMPAIGN_ID,
            name: "Тест",
            description: null,
            status: "active",
            eventId: null,
            eventTitle: null,
            archivedAt: null,
            totalContacts: 0,
            untouchedContacts: 0,
            interestedContacts: 0,
            convertedContacts: 0,
            createdAt: now.toISOString(),
            completedAt: null
          };
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await service.createCampaign({
      actor: writeActor,
      name: "Пикник, холодная база",
      eventId: CAMPAIGN_ID,
      now
    });
    await service.createCampaign({ actor: writeActor, name: "Без события", now });

    assert.equal(created[0]?.eventId, CAMPAIGN_ID);
    assert.equal(created[1]?.eventId, null);
  });

  it("rejects a campaign pointed at something that is not an event id", async () => {
    const service = new AdminOutreachService(
      repository({}),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.createCampaign({
        actor: writeActor,
        name: "Пикник",
        eventId: "не-uuid",
        now
      }),
      /invalid/
    );
  });

  it("tells the campaign apart from clearing its event link", async () => {
    const updates: Parameters<AdminOutreachRepository["updateCampaign"]>[0][] = [];
    const service = new AdminOutreachService(
      repository({
        async updateCampaign(input) {
          updates.push(input);
          return false;
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    // Не трогаем привязку.
    await service.updateCampaign({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      name: "Новое имя",
      now
    });
    // Снимаем привязку.
    await service.updateCampaign({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      eventId: null,
      now
    });

    assert.equal("eventId" in (updates[0] ?? {}), false);
    assert.equal(updates[1]?.eventId, null);
  });

  it("refuses to pull participants into a campaign with no event", async () => {
    const service = new AdminOutreachService(
      repository({
        async getCampaign() {
          return {
            id: CAMPAIGN_ID,
            name: "Без события",
            description: null,
            status: "active",
            eventId: null,
            eventTitle: null,
            archivedAt: null,
            totalContacts: 0,
            untouchedContacts: 0,
            interestedContacts: 0,
            convertedContacts: 0,
            createdAt: now.toISOString(),
            completedAt: null
          };
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.importEventParticipants({
        actor: writeActor,
        campaignId: CAMPAIGN_ID,
        now
      }),
      /no event/
    );
  });

  it("pulls participants in batches the import endpoint can actually take", async () => {
    const batches: number[] = [];
    const service = new AdminOutreachService(
      repository({
        async getCampaign() {
          return {
            id: CAMPAIGN_ID,
            name: "Пикник",
            description: null,
            status: "active",
            eventId: EVENT_ID,
            eventTitle: "Бизнес-Пикник",
            archivedAt: null,
            totalContacts: 0,
            untouchedContacts: 0,
            interestedContacts: 0,
            convertedContacts: 0,
            createdAt: now.toISOString(),
            completedAt: null
          };
        },
        async listEventParticipantRows() {
          return Array.from({ length: 1200 }, (_, index) => ({
            phone: `+7999000${String(index).padStart(4, "0")}`
          }));
        },
        async importContacts(input) {
          batches.push(input.rows.length);
          return {
            received: input.rows.length,
            createdContacts: input.rows.length,
            updatedContacts: 0,
            addedToCampaign: input.rows.length,
            alreadyInCampaign: 0,
            invalidRows: 0,
            invalidRowIndexes: [],
            ambiguousRows: 0,
            ambiguousRowIndexes: []
          };
        }
      }),
      { normalize: (value) => value },
      countingIds()
    );

    const result = await service.importEventParticipants({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      now
    });

    assert.deepEqual(batches, [500, 500, 200]);
    assert.equal(result.received, 1200);
    assert.equal(result.createdContacts, 1200);
    assert.equal(result.eventTitle, "Бизнес-Пикник");
  });

  it("does not call the import at all when the event has nobody yet", async () => {
    let called = false;
    const service = new AdminOutreachService(
      repository({
        async getCampaign() {
          return {
            id: CAMPAIGN_ID,
            name: "Пикник",
            description: null,
            status: "active",
            eventId: EVENT_ID,
            eventTitle: "Бизнес-Пикник",
            archivedAt: null,
            totalContacts: 0,
            untouchedContacts: 0,
            interestedContacts: 0,
            convertedContacts: 0,
            createdAt: now.toISOString(),
            completedAt: null
          };
        },
        async listEventParticipantRows() { return []; },
    async listBaseContacts() { return []; },
    async addExistingContacts() { return { added: 0, alreadyInCampaign: 0 }; },
        async importContacts(input) {
          called = true;
          return {
            received: input.rows.length,
            createdContacts: 0,
            updatedContacts: 0,
            addedToCampaign: 0,
            alreadyInCampaign: 0,
            invalidRows: 0,
            invalidRowIndexes: [],
            ambiguousRows: 0,
            ambiguousRowIndexes: []
          };
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    const result = await service.importEventParticipants({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      now
    });

    assert.equal(called, false);
    assert.equal(result.received, 0);
  });

  it("requires a reason for a lost stage and creates a trimmed follow-up task", async () => {
    let received: Parameters<AdminOutreachRepository["createTask"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async getPipelineColumnOutcome() { return "lost"; },
        async createTask(input) {
          received = input;
          return true;
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.updateContactStage({
        actor: writeActor,
        campaignContactId: CAMPAIGN_CONTACT_ID,
        stage: "lost",
        now
      }),
      /lost reason/
    );
    const result = await service.createTask({
      actor: writeActor,
      campaignContactId: CAMPAIGN_CONTACT_ID,
      type: "call",
      text: "  Перезвонить после обеда  ",
      dueAt: new Date("2026-07-30T12:00:00.000Z"),
      now
    });

    assert.equal(result.created, true);
    assert.equal(received?.text, "Перезвонить после обеда");
    assert.equal(received?.assignedAdminId, null);
  });

  it("normalizes pipeline labels and derives positions from the submitted order", async () => {
    let received:
      Parameters<AdminOutreachRepository["updatePipelineColumns"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async updatePipelineColumns(input) {
          received = input;
          return "updated";
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    const result = await service.updatePipelineColumns({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      columns: [
        { stage: "dialogue", label: "Обсуждаем", outcome: "open" },
        { stage: "new", label: " Новые лиды ", outcome: "open" },
        { stage: "won", label: "Успешно", outcome: "won" },
        { stage: "lost", label: "Закрыто", outcome: "lost" },
        { label: "Новая колонка", outcome: "open" }
      ],
      now
    });

    assert.equal(result.updated, true);
    assert.equal(received?.columns[0]?.stage, "dialogue");
    assert.equal(received?.columns[0]?.position, 1);
    assert.equal(received?.columns[1]?.label, "Новые лиды");
    assert.equal(received?.columns[1]?.position, 2);
    assert.equal(received?.columns[4]?.label, "Новая колонка");
    assert.match(received?.columns[4]?.stage ?? "", /^s_[a-z0-9]+$/);
  });

  it("rejects a duplicate lost-stage move without a reason via the outcome lookup", async () => {
    const service = new AdminOutreachService(
      repository({
        async getPipelineColumnOutcome() { return "lost"; }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.updateContactStage({
        actor: writeActor,
        campaignContactId: CAMPAIGN_CONTACT_ID,
        stage: "closed_lost",
        now
      }),
      /lost reason/
    );
  });

  it("rejects moving a contact to a stage the campaign no longer has", async () => {
    const service = new AdminOutreachService(
      repository({
        async getPipelineColumnOutcome() { return null; }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.updateContactStage({
        actor: writeActor,
        campaignContactId: CAMPAIGN_CONTACT_ID,
        stage: "deleted_stage",
        now
      }),
      /was not found/
    );
  });

  it("requires select options and rejects options on a non-select field", async () => {
    const service = new AdminOutreachService(
      repository({}),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.createCustomFieldDefinition({
        actor: writeActor,
        label: "Источник",
        type: "select",
        options: [],
        now
      }),
      /options are invalid/
    );
    await assert.rejects(
      service.createCustomFieldDefinition({
        actor: writeActor,
        label: "Бюджет",
        type: "number",
        options: ["a"],
        now
      }),
      /only valid for a select field/
    );

    const created = await service.createCustomFieldDefinition({
      actor: writeActor,
      label: "Источник",
      type: "select",
      options: [" Instagram ", "Instagram", "Сайт"],
      now
    });
    assert.deepEqual(created.options, ["Instagram", "Сайт"]);
  });

  it("surfaces a friendly error when deleting a pipeline stage still in use", async () => {
    const service = new AdminOutreachService(
      repository({
        async updatePipelineColumns() { return "stage_in_use"; }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.updatePipelineColumns({
        actor: writeActor,
        campaignId: CAMPAIGN_ID,
        columns: [{ stage: "new", label: "Новые", outcome: "open" }],
        now
      }),
      /still has contacts/
    );
  });
});

function repository(
  overrides: Partial<AdminOutreachRepository>
): AdminOutreachRepository {
  return {
    async listCampaigns() { return []; },
    async listEventParticipantRows() { return []; },
    async listBaseContacts() { return []; },
    async listPeople() { return { items: [], total: 0, page: 1, limit: 50 }; },
    async getPerson() { return null; },
    async addExistingContacts() { return { added: 0, alreadyInCampaign: 0 }; },
    async archiveCampaign() { return true; },
    async restoreCampaign() { return true; },
    async moveContacts() { return { moved: 0, alreadyThere: 0 }; },
    async removeContacts() { return 0; },
    async getCampaign() { return null; },
    async createCampaign() {},
    async updateCampaign() { return false; },
    async listPipelineColumns() { return []; },
    async updatePipelineColumns() { return "updated"; },
    async getPipelineColumnOutcome() { return "open"; },
    async listCustomFieldDefinitions() { return []; },
    async createCustomFieldDefinition(input) {
      return {
        id: input.id,
        campaignId: input.campaignId,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.options,
        position: 1
      };
    },
    async deleteCustomFieldDefinition() { return false; },
    async setCustomFieldValue() { return false; },
    async listTaskBoard() { return []; },
    async listContacts() { return { items: [], total: 0, page: 1, limit: 50 }; },
    async getContact() { return null; },
    async importContacts(input) {
      return {
        received: input.rows.length,
        createdContacts: 0,
        updatedContacts: 0,
        addedToCampaign: 0,
        alreadyInCampaign: 0,
        invalidRows: 0,
        invalidRowIndexes: [],
        ambiguousRows: 0,
        ambiguousRowIndexes: []
      };
    },
    async assignContacts() { return 0; },
    async recordActivities() { return 0; },
    async updateContactStage() { return false; },
    async createTask() { return false; },
    async completeTask() { return false; },
    async listManagers() { return []; },
    async exportCampaignContacts() { return { campaign: null, rows: [] }; },
    ...overrides
  };
}

/** Неограниченный генератор: пакетный импорт съедает по два идентификатора на строку. */
/**
 * Разборщик, который не принимает ни одного номера. Отказ — это исключение, а не null:
 * так устроен настоящий LibPhoneNumberNormalizer, и заглушка обязана вести себя как он.
 */
function rejectingPhones() {
  return {
    normalize(): string {
      throw new Error("Phone number is invalid");
    }
  };
}

function countingIds() {
  let index = 0;
  return {
    newId() {
      index += 1;
      return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    }
  };
}

function sequenceIds() {
  let index = 0;
  const ids = [
    "00000000-0000-4000-8000-000000000201",
    "00000000-0000-4000-8000-000000000202",
    "00000000-0000-4000-8000-000000000203",
    "00000000-0000-4000-8000-000000000204",
    "00000000-0000-4000-8000-000000000205"
  ];
  return {
    newId() {
      const id = ids[index];
      index += 1;
      if (!id) {
        throw new Error("ID fixture exhausted");
      }
      return id;
    }
  };
}

const ADMIN_ID = "00000000-0000-4000-8000-000000000101";
const EVENT_ID = "00000000-0000-4000-8000-000000000801";
const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000102";
const CAMPAIGN_CONTACT_ID = "00000000-0000-4000-8000-000000000103";
const CAMPAIGN_CONTACT_ID_2 = "00000000-0000-4000-8000-000000000104";
const now = new Date("2026-07-29T12:00:00.000Z");

const writeActor: AdminRequestActor = {
  adminId: ADMIN_ID,
  authSubject: "auth-1",
  roleCodes: ["sales_manager"],
  permission: "outreach.write"
};
