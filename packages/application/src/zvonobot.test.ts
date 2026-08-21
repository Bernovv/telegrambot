import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidZvonobotCallError,
  ProcessZvonobotCallsBatchService,
  ReceiveZvonobotCallService,
  isLead,
  zvonobotNote,
  type StoreZvonobotCallInput,
  type ZvonobotCallRecord,
  type ZvonobotCampaign,
  type ZvonobotLeadToCreate,
  type ZvonobotProcessingRepository,
  type ZvonobotSettings
} from "./zvonobot.js";
import type { PhoneNormalizer } from "./phone.js";

const NOW = new Date("2026-08-22T10:00:00.000Z");
const SYSTEM_ADMIN_ID = "00000000-0000-4000-8000-000000000003";

const TASK_RULE = {
  ruleId: "019c0123-4567-789a-bcde-f01234567902",
  isEnabled: true,
  taskText: "Позвонить: человек ответил роботу"
};

const CAMPAIGN: ZvonobotCampaign = {
  campaignId: "019c0123-4567-789a-bcde-f01234567901",
  stage: "new",
  callWindowStart: 12,
  callWindowEnd: 19,
  callWindowTimezone: "Europe/Moscow",
  taskRule: TASK_RULE
};

const SETTINGS: ZvonobotSettings = {
  leadButtons: ["1"],
  leadMinDurationSeconds: null,
  campaignSlugPrefix: "sreda"
};

describe("ReceiveZvonobotCallService", () => {
  it("достаёт телефон, кнопку, длительность и кампанию из тела любой формы", async () => {
    const stored: StoreZvonobotCallInput[] = [];
    const service = receiver(stored);

    const result = await service.execute({
      payload: {
        id: "call-1",
        campaignName: "Среда, август",
        data: { phone: "89991234567", button: "1", duration: 34 }
      },
      now: NOW
    });

    assert.deepEqual(result, { status: "accepted" });
    assert.equal(stored[0]?.externalCallId, "call-1");
    assert.equal(stored[0]?.phoneE164, "+79991234567");
    assert.equal(stored[0]?.pressedButton, "1");
    assert.equal(stored[0]?.durationSeconds, 34);
    assert.equal(stored[0]?.campaignName, "Среда, август");
  });

  it("сохраняет тело, даже когда телефон в нём не распознан", async () => {
    const stored: StoreZvonobotCallInput[] = [];
    const service = receiver(stored);

    // Формат Звонобота подтверждён не до конца. Вебхук, который мы отвергли, повторят
    // несколько раз и бросят — вместе с человеком, который нажал «интересно».
    const result = await service.execute({
      payload: { id: "call-2", phone: "не телефон" },
      now: NOW
    });

    assert.deepEqual(result, { status: "accepted" });
    assert.equal(stored[0]?.phoneE164, null);
    assert.deepEqual(stored[0]?.payload, { id: "call-2", phone: "не телефон" });
  });

  it("без своего идентификатора считает ключ по телу, и повтор даёт тот же ключ", async () => {
    const stored: StoreZvonobotCallInput[] = [];
    const service = receiver(stored);
    const payload = { phone: "+79991234567", button: "1" };

    await service.execute({ payload, now: NOW });
    // Порядок ключей в JSON не гарантирован, а ключ повтора обязан совпасть.
    await service.execute({ payload: { button: "1", phone: "+79991234567" }, now: NOW });

    assert.equal(stored.length, 2);
    assert.equal(stored[0]?.externalCallId, stored[1]?.externalCallId);
  });

  it("отличает повтор доставки от нового звонка", async () => {
    const stored: StoreZvonobotCallInput[] = [];
    const service = receiver(stored);

    await service.execute({ payload: { phone: "+79991234567" }, now: NOW });
    await service.execute({ payload: { phone: "+79997654321" }, now: NOW });

    assert.notEqual(stored[0]?.externalCallId, stored[1]?.externalCallId);
  });

  it("отвечает «уже приняли», когда вебхук повторили", async () => {
    const service = new ReceiveZvonobotCallService(
      { store: async () => false },
      phoneNormalizer(),
      idGenerator()
    );

    const result = await service.execute({ payload: { id: "call-1" }, now: NOW });

    assert.deepEqual(result, { status: "duplicate" });
  });

  it("отвергает тело, которое не объект", async () => {
    const service = receiver([]);

    await assert.rejects(
      service.execute({ payload: "не json", now: NOW }),
      InvalidZvonobotCallError
    );
  });
});

describe("ProcessZvonobotCallsBatchService", () => {
  it("заводит заявку в воронке направления и звонок в окне обзвона", async () => {
    const state = processingState([
      call({ id: "019c0123-4567-789a-bcde-f01234567a01", pressedButton: "1" })
    ]);
    const service = processor(state.repository);

    const result = await service.execute({ at: NOW, batchSize: 100 });

    assert.deepEqual(result, { claimed: 1, leads: 1, ignored: 0, unparsed: 0 });
    const lead = state.leads[0];
    assert.equal(lead?.campaignId, CAMPAIGN.campaignId);
    assert.equal(lead?.stage, "new");
    assert.equal(lead?.phoneE164, "+79991234567");
    assert.equal(lead?.assignedAdminId, SYSTEM_ADMIN_ID);
    // 10:00 UTC — это 13:00 по Москве, окно обзвона уже идёт: звонить надо сейчас.
    assert.equal(lead?.task?.dueAt.toISOString(), NOW.toISOString());
    assert.equal(lead?.task?.text, "Позвонить: человек ответил роботу");
  });

  it("не считает заявкой того, кто ничего не нажал", async () => {
    const state = processingState([
      call({ id: "019c0123-4567-789a-bcde-f01234567a02", pressedButton: null })
    ]);
    const service = processor(state.repository);

    const result = await service.execute({ at: NOW, batchSize: 100 });

    assert.deepEqual(result, { claimed: 1, leads: 0, ignored: 1, unparsed: 0 });
    assert.equal(state.settled[0]?.status, "ignored");
  });

  it("помечает звонок без телефона отдельно: тут нужна рука, а не правило", async () => {
    const state = processingState([
      call({ id: "019c0123-4567-789a-bcde-f01234567a03", phoneE164: null })
    ]);
    const service = processor(state.repository);

    const result = await service.execute({ at: NOW, batchSize: 100 });

    assert.deepEqual(result, { claimed: 1, leads: 0, ignored: 0, unparsed: 1 });
    assert.equal(state.settled[0]?.status, "unparsed");
  });

  it("не ставит звонок, когда правило выключили", async () => {
    const state = processingState(
      [call({ id: "019c0123-4567-789a-bcde-f01234567a04", pressedButton: "1" })],
      {
        ...CAMPAIGN,
        taskRule: { ruleId: TASK_RULE.ruleId, isEnabled: false, taskText: "" }
      }
    );
    const service = processor(state.repository);

    await service.execute({ at: NOW, batchSize: 100 });

    assert.equal(state.leads[0]?.task, null);
  });

  it("без воронки помечает разобранным, а не крутит одно и то же каждый проход", async () => {
    const state = processingState(
      [call({ id: "019c0123-4567-789a-bcde-f01234567a05", pressedButton: "1" })],
      null
    );
    const service = processor(state.repository);

    const result = await service.execute({ at: NOW, batchSize: 100 });

    assert.deepEqual(result, { claimed: 1, leads: 0, ignored: 1, unparsed: 0 });
  });

  it("пустая очередь не трогает ни настройки, ни воронку", async () => {
    const state = processingState([]);
    const service = processor(state.repository);

    const result = await service.execute({ at: NOW, batchSize: 100 });

    assert.deepEqual(result, { claimed: 0, leads: 0, ignored: 0, unparsed: 0 });
    assert.equal(state.settingsReads, 0);
  });
});

describe("isLead", () => {
  it("судит по кнопке без оглядки на регистр", () => {
    assert.equal(
      isLead({ pressedButton: "YES", durationSeconds: null }, {
        ...SETTINGS,
        leadButtons: ["yes"]
      }),
      true
    );
  });

  it("судит по длительности, когда порог задан", () => {
    assert.equal(
      isLead({ pressedButton: null, durationSeconds: 40 }, {
        ...SETTINGS,
        leadMinDurationSeconds: 30
      }),
      true
    );
    assert.equal(
      isLead({ pressedButton: null, durationSeconds: 20 }, {
        ...SETTINGS,
        leadMinDurationSeconds: 30
      }),
      false
    );
  });

  it("без обоих признаков не считает заявкой ничего — так включают первую кампанию", () => {
    assert.equal(
      isLead({ pressedButton: "1", durationSeconds: 300 }, {
        leadButtons: [],
        leadMinDurationSeconds: null,
        campaignSlugPrefix: "sreda"
      }),
      false
    );
  });
});

describe("zvonobotNote", () => {
  it("пишет кампанию и нажатую кнопку — весь контекст до первого разговора", () => {
    assert.equal(
      zvonobotNote("Среда, август", "1"),
      "Заявка из Звонобота, кампания «Среда, август», нажал 1"
    );
    assert.equal(zvonobotNote("", null), "Заявка из Звонобота");
  });
});

function receiver(stored: StoreZvonobotCallInput[]): ReceiveZvonobotCallService {
  return new ReceiveZvonobotCallService(
    {
      store: async (input) => {
        stored.push(input);
        return true;
      }
    },
    phoneNormalizer(),
    idGenerator()
  );
}

function processor(
  repository: ZvonobotProcessingRepository
): ProcessZvonobotCallsBatchService {
  return new ProcessZvonobotCallsBatchService(repository, idGenerator(), {
    systemAdminId: SYSTEM_ADMIN_ID
  });
}

function call(overrides: Partial<ZvonobotCallRecord> & { readonly id: string }): ZvonobotCallRecord {
  return {
    externalCallId: `external-${overrides.id}`,
    campaignName: "Среда, август",
    phoneE164: "+79991234567",
    pressedButton: null,
    durationSeconds: 12,
    payload: {},
    receivedAt: NOW,
    ...overrides
  };
}

function processingState(
  pending: readonly ZvonobotCallRecord[],
  campaign: ZvonobotCampaign | null = CAMPAIGN
) {
  const leads: ZvonobotLeadToCreate[] = [];
  const settled: { readonly callId: string; readonly status: string }[] = [];
  const state = {
    leads,
    settled,
    settingsReads: 0,
    repository: {
      loadSettings: async () => {
        state.settingsReads += 1;
        return SETTINGS;
      },
      findCampaign: async () => campaign,
      claimPending: async () => pending,
      createLead: async (input: ZvonobotLeadToCreate) => {
        leads.push(input);
      },
      markSettled: async (input: {
        readonly callId: string;
        readonly status: "ignored" | "unparsed";
      }) => {
        settled.push({ callId: input.callId, status: input.status });
      }
    } satisfies ZvonobotProcessingRepository
  };
  return state;
}

/** Разбор номера ровно тот, что нужен тестам: русский мобильный в любом написании. */
function phoneNormalizer(): PhoneNormalizer {
  return {
    normalize(rawPhone: string): string {
      const digits = rawPhone.replace(/\D/g, "");
      if (digits.length !== 11 || !/^[78]/.test(digits)) {
        throw new Error("unparseable phone");
      }
      return `+7${digits.slice(1)}`;
    }
  };
}

function idGenerator() {
  let counter = 0;
  return {
    newId(): string {
      counter += 1;
      return `019c0123-4567-789a-bcde-f012345670${String(counter).padStart(2, "0")}`;
    }
  };
}
