import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor, EventParticipant } from "@ticket-platform/contracts";
import {
  AdminEventParticipantsService,
  ImportParticipantsService,
  ParticipantAnswerTargetNotFoundError,
  ParticipantsEventNotFoundError,
  buildParticipantsView,
  type AdminEventParticipantsRepository,
  type CreateImportedParticipantInput,
  type ParticipantOrderItemRow
} from "./admin-event-participants.js";

const ADULT = [{ role: "adult", quantity: 1 }] as const;
const CHILD = [{ role: "child", quantity: 1 }] as const;

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const ORDER_ID = "019c0123-4567-789a-bcde-f0123456789c";
const OTHER_ORDER_ID = "019c0123-4567-789a-bcde-f0123456789d";
const FIELD_ID = "019c0123-4567-789a-bcde-f0123456789f";
const PARTICIPANT_ID = "019c0123-4567-789a-bcde-f01234567810";

const field = {
  id: FIELD_ID,
  label: "Город",
  type: "text" as const,
  options: null,
  global: false
};

function answer(value: string | null) {
  return { fieldId: FIELD_ID, label: "Город", type: "text" as const, options: null, value };
}

describe("buildParticipantsView", () => {
  it("collapses the items of one order into a single row", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [
        item({
          productTitle: "Все включено",
          quantity: 1,
          bundleComposition: [{ role: "adult", quantity: 2 }],
          inventoryUnitsPerItem: 2,
          includesSleepingPlace: true
        }),
        item({ productTitle: "Детский", quantity: 3, bundleComposition: CHILD }),
        // Тот же тариф второй строкой заказа: в подписи он должен остаться один.
        item({ productTitle: "Детский", quantity: 1, bundleComposition: CHILD })
      ],
      participants: [],
      fields: [],
      orderAnswers: [],
      attendance: [],
      excludedOrders: 0,
      canManageParticipants: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.rows.length, 1);
    const row = view.rows[0];
    assert.equal(row?.key, `order:${ORDER_ID}`);
    assert.equal(row?.ticketTitle, "Все включено, Детский");
    assert.equal(row?.adults, 2);
    assert.equal(row?.children, 4);
    assert.equal(row?.sleepingPlaces, 2);
    assert.equal(row?.channel, "telegram");
  });

  it("names a buyer by their order when the profile has no name at all", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [item({ buyerName: null, orderNumber: "BP-0042" })],
      participants: [],
      fields: [],
      orderAnswers: [],
      attendance: [],
      excludedOrders: 0,
      canManageParticipants: false,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.rows[0]?.displayName, "Заказ BP-0042");
  });

  it("adds up money as kopecks in bigint, not as floating point rubles", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [
        item({ totalKopecks: "9007199254740993" }),
        item({ orderId: OTHER_ORDER_ID, totalKopecks: "1" })
      ],
      participants: [],
      fields: [],
      orderAnswers: [],
      attendance: [],
      excludedOrders: 0,
      canManageParticipants: false,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.totals.amountKopecks, "9007199254740994");
  });

  it("keeps manual participants next to buyers and counts both in the totals", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [item({
        bundleComposition: [{ role: "adult", quantity: 2 }],
        inventoryUnitsPerItem: 2,
        includesSleepingPlace: true,
        totalKopecks: "498000"
      })],
      participants: [participant({ adults: 1, children: 2, sleepingPlaces: 3 })],
      fields: [],
      orderAnswers: [],
      attendance: [],
      excludedOrders: 2,
      canManageParticipants: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.deepEqual(view.totals, {
      people: 2,
      guests: 5,
      adults: 3,
      children: 2,
      sleepingPlaces: 5,
      amountKopecks: "748000",
      fromOrders: 2,
      fromManual: 3
    });
    assert.equal(view.rows[1]?.channel, "max");
    assert.equal(view.rows[1]?.origin, "manual");
    assert.equal(view.excludedOrders, 2);
  });

  it("hands the buyer their paper answers, matched by order", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [item({}), item({ orderId: OTHER_ORDER_ID })],
      participants: [],
      fields: [field],
      orderAnswers: [{ orderId: ORDER_ID, value: answer("Москва") }],
      attendance: [],
      excludedOrders: 0,
      canManageParticipants: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.deepEqual(view.rows[0]?.customFields, [answer("Москва")]);
    assert.deepEqual(view.rows[1]?.customFields, []);
    assert.deepEqual(view.fields, [field]);
  });

  it("counts an anketa as entered only when some answer is actually filled in", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [item({}), item({ orderId: OTHER_ORDER_ID })],
      // Пустой ответ остаётся в базе, если его стёрли: анкету он внесённой не делает.
      participants: [participant({ customFields: [answer(null)] })],
      fields: [field],
      orderAnswers: [{ orderId: ORDER_ID, value: answer("Москва") }],
      attendance: [],
      excludedOrders: 0,
      canManageParticipants: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.deepEqual(view.questionnaire, { people: 3, answered: 1 });
  });

  it("puts the mark on the right row and counts who reached the hall", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Вечер экспертов" },
      items: [item({}), item({ orderId: OTHER_ORDER_ID })],
      participants: [participant({})],
      fields: [],
      orderAnswers: [],
      attendance: [
        {
          orderId: null,
          participantId: "019c0123-4567-789a-bcde-f0123456789e",
          checkedInAt: new Date("2026-08-19T16:05:00.000Z")
        },
        {
          orderId: ORDER_ID,
          participantId: null,
          checkedInAt: new Date("2026-08-19T16:02:00.000Z")
        }
      ],
      excludedOrders: 0,
      canManageParticipants: true,
      calculatedAt: new Date("2026-08-19T17:00:00.000Z")
    });

    assert.equal(view.rows[0]?.attendedAt, "2026-08-19T16:02:00.000Z");
    assert.equal(view.rows[1]?.attendedAt, null);
    assert.equal(view.rows[2]?.attendedAt, "2026-08-19T16:05:00.000Z");
    assert.deepEqual(view.attendance, { registered: 3, attended: 2 });
  });
});

describe("AdminEventParticipantsService", () => {
  it("refuses an actor that arrived with someone else's permission", async () => {
    const service = new AdminEventParticipantsService(repository(), clock);

    await assert.rejects(
      () => service.list({ actor: actorWith("orders.read"), eventId: EVENT_ID }),
      /permission is invalid/
    );
  });

  it("reports a missing event instead of an empty list", async () => {
    const service = new AdminEventParticipantsService(
      repository({ async findEvent() { return null; } }),
      clock
    );

    await assert.rejects(
      () => service.list({ actor: actorWith("accommodation.read"), eventId: EVENT_ID }),
      ParticipantsEventNotFoundError
    );
  });

  it("reports whether the administrator may edit manual participants", async () => {
    const readOnly = new AdminEventParticipantsService(
      repository({ async hasPermission() { return false; } }),
      clock
    );

    const view = await readOnly.list({
      actor: actorWith("accommodation.read"),
      eventId: EVENT_ID
    });

    assert.equal(view.canManageParticipants, false);
    assert.equal(view.eventTitle, "Бизнес-Пикник");
  });
});

describe("AdminEventParticipantsService.saveAnswer", () => {
  it("routes a buyer answer to the order table and a manual one to the participant table", async () => {
    const orders: unknown[] = [];
    const participants: unknown[] = [];
    const service = new AdminEventParticipantsService(
      repository({
        async saveOrderFieldValue(input) {
          orders.push(input);
          return true;
        },
        async saveParticipantFieldValue(input) {
          participants.push(input);
          return true;
        }
      }),
      clock
    );

    await service.saveAnswer({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      orderId: ORDER_ID,
      fieldId: FIELD_ID,
      value: "  Москва  "
    });
    await service.saveAnswer({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      participantId: PARTICIPANT_ID,
      fieldId: FIELD_ID,
      value: "Казань"
    });

    assert.deepEqual(orders, [{
      eventId: EVENT_ID,
      orderId: ORDER_ID,
      fieldId: FIELD_ID,
      value: "Москва",
      adminId: ADMIN_ID
    }]);
    assert.deepEqual(participants, [{
      eventId: EVENT_ID,
      participantId: PARTICIPANT_ID,
      fieldId: FIELD_ID,
      value: "Казань"
    }]);
  });

  it("stores a cleared answer as empty rather than as a blank string", async () => {
    const saved: unknown[] = [];
    const service = new AdminEventParticipantsService(
      repository({
        async saveOrderFieldValue(input) {
          saved.push(input.value);
          return true;
        }
      }),
      clock
    );

    await service.saveAnswer({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      orderId: ORDER_ID,
      fieldId: FIELD_ID,
      value: "   "
    });

    assert.deepEqual(saved, [null]);
  });

  it("refuses an answer aimed at nobody or at both at once", async () => {
    const service = new AdminEventParticipantsService(repository(), clock);
    const base = {
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      fieldId: FIELD_ID,
      value: "Москва"
    };

    await assert.rejects(() => service.saveAnswer(base), /request is invalid/);
    await assert.rejects(
      () => service.saveAnswer({ ...base, orderId: ORDER_ID, participantId: PARTICIPANT_ID }),
      /request is invalid/
    );
  });

  it("requires participants.manage, not merely the read permission", async () => {
    const service = new AdminEventParticipantsService(repository(), clock);

    await assert.rejects(
      () => service.saveAnswer({
        actor: actorWith("accommodation.read"),
        eventId: EVENT_ID,
        orderId: ORDER_ID,
        fieldId: FIELD_ID,
        value: "Москва"
      }),
      /permission is invalid/
    );
  });

  it("reports a vanished order or participant instead of silently doing nothing", async () => {
    const service = new AdminEventParticipantsService(
      repository({ async saveOrderFieldValue() { return false; } }),
      clock
    );

    await assert.rejects(
      () => service.saveAnswer({
        actor: actorWith("participants.manage"),
        eventId: EVENT_ID,
        orderId: ORDER_ID,
        fieldId: FIELD_ID,
        value: "Москва"
      }),
      ParticipantAnswerTargetNotFoundError
    );
  });
});

describe("AdminEventParticipantsService.setAttendance", () => {
  it("marks a manual participant and passes the moment they arrived", async () => {
    const marks: { attended: boolean; checkedInAt: Date }[] = [];
    const service = new AdminEventParticipantsService(
      repository({
        async setAttendance(input) {
          marks.push(input);
          return true;
        }
      }),
      clock
    );

    await service.setAttendance({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      participantId: PARTICIPANT_ID,
      attended: true
    });

    assert.equal(marks[0]?.attended, true);
    assert.deepEqual(marks[0]?.checkedInAt, new Date("2026-08-10T09:00:00.000Z"));
  });

  it("takes the mark off when the wrong row was tapped", async () => {
    const marks: { attended: boolean }[] = [];
    const service = new AdminEventParticipantsService(
      repository({
        async setAttendance(input) {
          marks.push(input);
          return true;
        }
      }),
      clock
    );

    await service.setAttendance({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      orderId: ORDER_ID,
      attended: false
    });

    assert.equal(marks[0]?.attended, false);
  });

  it("refuses a request that names both an order and a participant", async () => {
    const service = new AdminEventParticipantsService(repository(), clock);

    await assert.rejects(
      () => service.setAttendance({
        actor: actorWith("participants.manage"),
        eventId: EVENT_ID,
        orderId: ORDER_ID,
        participantId: PARTICIPANT_ID,
        attended: true
      }),
      /request is invalid/
    );
  });

  it("requires participants.manage, not merely the read permission", async () => {
    const service = new AdminEventParticipantsService(repository(), clock);

    await assert.rejects(
      () => service.setAttendance({
        actor: actorWith("accommodation.read"),
        eventId: EVENT_ID,
        participantId: PARTICIPANT_ID,
        attended: true
      }),
      /permission is invalid/
    );
  });

  // Строка чужого мероприятия или удалённый участник: молчаливое «сохранено» здесь
  // означало бы, что человека отметили, а в списке пришедших его нет.
  it("reports a row that does not belong to the event", async () => {
    const service = new AdminEventParticipantsService(
      repository({ async setAttendance() { return false; } }),
      clock
    );

    await assert.rejects(
      () => service.setAttendance({
        actor: actorWith("participants.manage"),
        eventId: EVENT_ID,
        participantId: PARTICIPANT_ID,
        attended: true
      }),
      ParticipantAnswerTargetNotFoundError
    );
  });
});

const clock = { now: () => new Date("2026-08-10T09:00:00.000Z") };

function actorWith(permission: string): AdminRequestActor {
  return { adminId: ADMIN_ID, permission } as AdminRequestActor;
}

function repository(
  overrides: Partial<AdminEventParticipantsRepository> = {}
): AdminEventParticipantsRepository {
  return {
    async findEvent() {
      return { id: EVENT_ID, title: "Бизнес-Пикник" };
    },
    async listPaidOrderItems() {
      return [item({})];
    },
    async listParticipants() {
      return [];
    },
    async listParticipantFields() {
      return [];
    },
    async listOrderFieldValues() {
      return [];
    },
    async listAttendance() {
      return [];
    },
    async setAttendance() {
      return true;
    },
    async countExcludedOrders() {
      return 0;
    },
    async hasPermission() {
      return true;
    },
    async saveOrderFieldValue() {
      return true;
    },
    async saveParticipantFieldValue() {
      return true;
    },
    async loadExistingPeople() {
      return {
        buyerPhones: [],
        buyerHandles: [],
        manualPhones: [],
        manualEmails: [],
        manualNames: []
      };
    },
    async createImportedParticipants() {
      // ничего
    },
    ...overrides
  };
}

function item(
  overrides: Partial<ParticipantOrderItemRow>
): ParticipantOrderItemRow {
  return {
    orderId: ORDER_ID,
    orderNumber: "BP-0001",
    buyerName: "Иван",
    phone: "+79000000000",
    telegramUsername: "ivan",
    paidAt: new Date("2026-08-01T10:00:00.000Z"),
    totalKopecks: "249000",
    productTitle: "Стандарт",
    quantity: 1,
    bundleComposition: ADULT,
    inventoryUnitsPerItem: 1,
    includesSleepingPlace: false,
    ...overrides
  };
}

function participant(overrides: Partial<EventParticipant>): EventParticipant {
  return {
    id: "019c0123-4567-789a-bcde-f0123456789e",
    displayName: "Мария",
    phone: null,
    email: null,
    source: "max",
    ticketTitle: "Все включено",
    adults: 1,
    children: 0,
    sleepingPlaces: 0,
    note: "оплатила переводом",
    outreachContactId: null,
    amountKopecks: "250000",
    paidAt: "2026-08-02T10:00:00.000Z",
    paymentMethod: "перевод",
    customFields: [],
    createdAt: "2026-08-02T10:00:00.000Z",
    ...overrides
  };
}

describe("ImportParticipantsService", () => {
  const row = {
    name: "Надежда",
    phone: "+79001234567",
    telegram: "@Nadinka88",
    adults: 2,
    children: 1,
    sleeping: 3,
    amountKopecks: "649000",
    note: "с ним: Муж, Ребенок"
  };

  it("writes the whole list and reports how many landed", async () => {
    const written: unknown[] = [];
    const service = importService(repository({
      async createImportedParticipants(inputs) {
        written.push(...inputs);
      }
    }));

    const result = await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      rows: [row]
    });

    assert.deepEqual(result, { added: 1, skipped: [] });
    assert.equal(written.length, 1);
  });

  it("hands the handle and a spare id down so the person can be linked to the base", async () => {
    // Разбирает ник и ищет человека слой базы — здесь важно лишь, что ему есть чем искать и
    // подо что заводить, если человека там ещё нет.
    const written: CreateImportedParticipantInput[] = [];
    const service = importService(repository({
      async createImportedParticipants(inputs) {
        written.push(...inputs);
      }
    }));

    await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      rows: [row]
    });

    assert.equal(written[0]?.telegram, "@Nadinka88");
    assert.notEqual(written[0]?.contactSeedId, written[0]?.participantId);
  });

  // Задвоение — главная опасность переноса: человек уже лежит оплаченным заказом.
  it("skips someone who already bought through the bot", async () => {
    const written: unknown[] = [];
    const service = importService(repository({
      async loadExistingPeople() {
        return {
          buyerPhones: ["+79001234567"],
          buyerHandles: [],
          manualPhones: [],
          manualEmails: [],
          manualNames: []
        };
      },
      async createImportedParticipants(inputs) {
        written.push(...inputs);
      }
    }));

    const result = await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      rows: [row]
    });

    assert.deepEqual(result, { added: 0, skipped: [{ name: "Надежда", reason: "bot_buyer" }] });
    assert.equal(written.length, 0);
  });

  it("recognises a bot buyer by their Telegram handle, ignoring the @ and case", async () => {
    const service = importService(repository({
      async loadExistingPeople() {
        return {
          buyerPhones: [],
          buyerHandles: ["nadinka88"],
          manualPhones: [],
          manualEmails: [],
          manualNames: []
        };
      }
    }));

    const result = await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      rows: [{ ...row, phone: "" }]
    });

    assert.equal(result.skipped[0]?.reason, "bot_buyer");
  });

  // Повторная загрузка того же файла не должна заводить всех второй раз.
  it("skips someone already added by hand", async () => {
    const service = importService(repository({
      async loadExistingPeople() {
        return {
          buyerPhones: [],
          buyerHandles: [],
          manualPhones: [],
          manualEmails: [],
          manualNames: ["надежда"]
        };
      }
    }));

    const result = await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      rows: [{ ...row, phone: "" }]
    });

    assert.equal(result.skipped[0]?.reason, "already_added");
  });

  it("catches a duplicate inside the very same file", async () => {
    const service = importService(repository());

    const result = await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      rows: [row, row]
    });

    assert.equal(result.added, 1);
    assert.deepEqual(result.skipped, [{ name: "Надежда", reason: "already_added" }]);
  });

  // Выгрузку Timepad берут дважды — до встречи и утром в день встречи. Телефона там у
  // части людей нет, и узнать их второй раз можно только по почте.
  it("skips a repeated Timepad row by its email when there is no phone", async () => {
    const service = importService(repository({
      async loadExistingPeople() {
        return {
          buyerPhones: [],
          buyerHandles: [],
          manualPhones: [],
          manualEmails: ["nadya@example.com"],
          manualNames: []
        };
      }
    }));

    const result = await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      source: "timepad",
      rows: [{ ...row, phone: "", email: "Nadya@Example.com" }]
    });

    assert.equal(result.skipped[0]?.reason, "already_added");
  });

  // Тёзки в выгрузке — обычное дело, и это два разных человека. Прежнее правило по имени
  // склеило бы их в одного, а вместе с ним потерялся бы и второй участник.
  it("keeps two namesakes apart when their emails differ", async () => {
    const written: { name: string }[] = [];
    const service = importService(repository({
      async loadExistingPeople() {
        return {
          buyerPhones: [],
          buyerHandles: [],
          manualPhones: [],
          manualEmails: [],
          manualNames: ["надежда"]
        };
      },
      async createImportedParticipants(inputs) {
        written.push(...inputs);
      }
    }));

    const result = await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      source: "timepad",
      rows: [{ ...row, phone: "", email: "nadya-2@example.com" }]
    });

    assert.equal(result.added, 1);
    assert.equal(written.length, 1);
  });

  it("puts the chosen source on every row of the list", async () => {
    const written: { source: string; email: string | null }[] = [];
    const service = importService(repository({
      async createImportedParticipants(inputs) {
        written.push(...inputs);
      }
    }));

    await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      source: "timepad",
      rows: [{ ...row, email: "nadya@example.com" }]
    });

    assert.equal(written[0]?.source, "timepad");
    assert.equal(written[0]?.email, "nadya@example.com");
  });

  // Загрузка без выбранного источника осталась от прежних таблиц — она не должна падать.
  it("falls back to direct when the list has no source", async () => {
    const written: { source: string }[] = [];
    const service = importService(repository({
      async createImportedParticipants(inputs) {
        written.push(...inputs);
      }
    }));

    await service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      rows: [row]
    });

    assert.equal(written[0]?.source, "direct");
  });

  it("rejects a row whose email is not an address", async () => {
    const service = importService(repository());

    await assert.rejects(() => service.execute({
      actor: actorWith("participants.manage"),
      eventId: EVENT_ID,
      rows: [{ ...row, email: "@example.com" }]
    }));
  });

  it("refuses a party with more sleeping places than people", async () => {
    const service = importService(repository());

    await assert.rejects(
      () => service.execute({
        actor: actorWith("participants.manage"),
        eventId: EVENT_ID,
        rows: [{ ...row, adults: 1, children: 0, sleeping: 2 }]
      }),
      /request is invalid/
    );
  });

  it("refuses a batch that is empty or absurdly large", async () => {
    const service = importService(repository());
    const many = Array.from({ length: 501 }, (_, index) => ({ ...row, name: `Гость ${index}` }));

    for (const rows of [[], many]) {
      await assert.rejects(
        () => service.execute({
          actor: actorWith("participants.manage"),
          eventId: EVENT_ID,
          rows
        }),
        /request is invalid/
      );
    }
  });

  it("requires participants.manage, not merely the read permission", async () => {
    const service = importService(repository());

    await assert.rejects(
      () => service.execute({
        actor: actorWith("accommodation.read"),
        eventId: EVENT_ID,
        rows: [row]
      }),
      /permission is invalid/
    );
  });

  it("reports a missing event instead of creating orphan cards", async () => {
    const service = importService(repository({ async findEvent() { return null; } }));

    await assert.rejects(
      () => service.execute({
        actor: actorWith("participants.manage"),
        eventId: EVENT_ID,
        rows: [row]
      }),
      ParticipantsEventNotFoundError
    );
  });
});

function importService(repo: AdminEventParticipantsRepository): ImportParticipantsService {
  let id = 0;
  return new ImportParticipantsService(repo, { newId: () => `generated-${(id += 1)}` });
}
