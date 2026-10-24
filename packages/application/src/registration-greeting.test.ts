import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationChannel } from "@ticket-platform/domain";
import {
  DEFAULT_GREETING_TEMPLATE,
  GreetRegistrationsBatchService,
  decideGreeting,
  formatEventWhen,
  renderGreeting,
  type GreetRegistrationsOptions,
  type PendingGreeting,
  type RegistrationGreetingRepository
} from "./registration-greeting.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Полдень по Москве: внутри окна.
const NOON = new Date("2026-10-25T09:00:00.000Z");

const OPTIONS: GreetRegistrationsOptions = {
  channels: ["telegram", "max"],
  lookupWaitMs: 2 * HOUR,
  maxAgeMs: 48 * HOUR,
  dailyLimit: 50,
  window: { startHour: 9, endHour: 21, timeZone: "Europe/Moscow" },
  systemAdminId: "00000000-0000-4000-8000-000000000001"
};

function greeting(overrides: Partial<PendingGreeting> = {}): PendingGreeting {
  return {
    registrationId: "11111111-1111-4111-8111-111111111111",
    contactId: "22222222-2222-4222-8222-222222222222",
    registeredAt: new Date(NOON.getTime() - 5 * MINUTE),
    name: "Анна",
    event: {
      title: "Открытая встреча предпринимателей",
      phrase: "Открытой встрече предпринимателей",
      // 18 ноября 2026, среда, 18:30 по Москве.
      startsAt: new Date("2026-11-18T15:30:00.000Z"),
      timeZone: "Europe/Moscow",
      locationName: null,
      locationAddress: "ул. Рубинштейна, 27",
      greetingEnabled: true,
      template: null
    },
    lookups: {},
    conversations: {},
    contactedSinceRegistration: false,
    ...overrides
  };
}

const TG_CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAX_CHAT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("куда писать приветствие", () => {
  it("пишет в Telegram, если человек там есть", () => {
    const decision = decideGreeting(
      greeting({
        lookups: { telegram: "found", max: "found" },
        conversations: { telegram: TG_CHAT, max: MAX_CHAT }
      }),
      NOON,
      OPTIONS
    );

    assert.deepEqual(decision, { kind: "send", channel: "telegram", conversationId: TG_CHAT });
  });

  it("ждёт ответа Telegram, даже если MAX уже нашёл человека", () => {
    // Иначе человек с Telegram получил бы сообщение в MAX только потому, что MAX ответил
    // на минуту раньше.
    const decision = decideGreeting(
      greeting({
        lookups: { telegram: "queued", max: "found" },
        conversations: { max: MAX_CHAT }
      }),
      NOON,
      OPTIONS
    );

    assert.deepEqual(decision, { kind: "wait" });
  });

  it("не дождавшись Telegram, пишет в MAX", () => {
    const decision = decideGreeting(
      greeting({
        registeredAt: new Date(NOON.getTime() - 3 * HOUR),
        lookups: { telegram: "queued", max: "found" },
        conversations: { max: MAX_CHAT }
      }),
      NOON,
      OPTIONS
    );

    assert.deepEqual(decision, { kind: "send", channel: "max", conversationId: MAX_CHAT });
  });

  it("переходит к MAX, когда Telegram ответил «нет» или отказал", () => {
    for (const telegram of ["not_found", "failed"] as const) {
      const decision = decideGreeting(
        greeting({
          lookups: { telegram, max: "found" },
          conversations: { max: MAX_CHAT }
        }),
        NOON,
        OPTIONS
      );

      assert.deepEqual(decision, { kind: "send", channel: "max", conversationId: MAX_CHAT });
    }
  });

  it("ждёт MAX, если Telegram ответил «нет», а MAX ещё думает", () => {
    const decision = decideGreeting(
      greeting({ lookups: { telegram: "not_found", max: "queued" } }),
      NOON,
      OPTIONS
    );

    assert.deepEqual(decision, { kind: "wait" });
  });

  it("никого не нашли — так и записываем", () => {
    const decision = decideGreeting(
      greeting({ lookups: { telegram: "not_found", max: "not_found" } }),
      NOON,
      OPTIONS
    );

    assert.deepEqual(decision, { kind: "no_channel" });
  });

  it("в WhatsApp не пишет, пока его нет в списке каналов", () => {
    const decision = decideGreeting(
      greeting({
        lookups: { telegram: "not_found", max: "not_found", whatsapp: "found" },
        conversations: { whatsapp: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }
      }),
      NOON,
      OPTIONS
    );

    assert.deepEqual(decision, { kind: "no_channel" });
  });

  it("найден, но ветки нет — пробует следующий канал", () => {
    const decision = decideGreeting(
      greeting({
        lookups: { telegram: "found", max: "found" },
        conversations: { max: MAX_CHAT }
      }),
      NOON,
      OPTIONS
    );

    assert.deepEqual(decision, { kind: "send", channel: "max", conversationId: MAX_CHAT });
  });

  it("упёрся в потолок канала — ждёт завтра, а не уходит в другой мессенджер", () => {
    const decision = decideGreeting(
      greeting({
        lookups: { telegram: "found", max: "found" },
        conversations: { telegram: TG_CHAT, max: MAX_CHAT }
      }),
      NOON,
      OPTIONS,
      new Set<ConversationChannel>(["telegram"])
    );

    assert.deepEqual(decision, { kind: "wait" });
  });

  it("не пишет, если менеджер уже написал сам", () => {
    const decision = decideGreeting(
      greeting({
        lookups: { telegram: "found" },
        conversations: { telegram: TG_CHAT },
        contactedSinceRegistration: true
      }),
      NOON,
      OPTIONS
    );

    assert.equal(decision.kind, "skip");
  });

  it("не пишет по выключенному мероприятию, прошедшему и по старой заявке", () => {
    const found = {
      lookups: { telegram: "found" as const },
      conversations: { telegram: TG_CHAT }
    };
    const base = greeting(found);

    const disabled = decideGreeting(
      greeting({ ...found, event: { ...base.event, greetingEnabled: false } }),
      NOON,
      OPTIONS
    );
    const started = decideGreeting(
      greeting({ ...found, event: { ...base.event, startsAt: new Date(NOON.getTime() - MINUTE) } }),
      NOON,
      OPTIONS
    );
    const old = decideGreeting(
      greeting({ ...found, registeredAt: new Date(NOON.getTime() - 49 * HOUR) }),
      NOON,
      OPTIONS
    );

    assert.equal(disabled.kind, "skip");
    assert.equal(started.kind, "skip");
    assert.equal(old.kind, "skip");
  });
});

describe("текст приветствия", () => {
  it("собирает текст владельца для встречи 18 ноября", () => {
    const rendered = renderGreeting(DEFAULT_GREETING_TEMPLATE, greeting());

    assert.deepEqual(rendered, {
      kind: "ok",
      body: [
        "Привет! На связи Бизнес-Прорыв✨",
        "",
        "📨 Получили Вашу заявку на участие в Открытой встрече предпринимателей – в среду, 18 ноября в 18:30, ул. Рубинштейна, 27",
        "",
        "Вас ждет увлекательная программа от наших спикеров и эффективный нетворкинг с другими участниками.",
        "Уже ждем вас!",
        "",
        "В ближайшее время свяжусь с вами для уточнения деталей🌿"
      ].join("\n")
    });
  });

  it("перед вторником ставит «во»", () => {
    // 17 ноября 2026 — вторник, 9:05 по Москве.
    assert.equal(
      formatEventWhen(new Date("2026-11-17T06:05:00.000Z"), "Europe/Moscow"),
      "во вторник, 17 ноября в 09:05"
    );
  });

  it("без места убирает и запятую перед ним", () => {
    const base = greeting();
    const rendered = renderGreeting(
      "Ждём вас {когда}, {где}!",
      greeting({ event: { ...base.event, locationAddress: null } })
    );

    assert.deepEqual(rendered, { kind: "ok", body: "Ждём вас в среду, 18 ноября в 18:30!" });
  });

  it("без названия в падеже называет мероприятие в кавычках", () => {
    const base = greeting();
    const rendered = renderGreeting(
      "Заявка на участие в {мероприятии}",
      greeting({ event: { ...base.event, phrase: null } })
    );

    assert.deepEqual(rendered, {
      kind: "ok",
      body: "Заявка на участие в мероприятии «Открытая встреча предпринимателей»"
    });
  });

  it("место пишет вместе с названием площадки", () => {
    const base = greeting();
    const rendered = renderGreeting(
      "{где}",
      greeting({ event: { ...base.event, locationName: "Лофт «Цех»" } })
    );

    assert.deepEqual(rendered, { kind: "ok", body: "Лофт «Цех», ул. Рубинштейна, 27" });
  });

  it("подставляет имя", () => {
    assert.deepEqual(renderGreeting("{имя}, здравствуйте!", greeting()), {
      kind: "ok",
      body: "Анна, здравствуйте!"
    });
  });

  it("опечатку в подстановке не отправляет человеку", () => {
    const rendered = renderGreeting("Заявка на {мероприяти}", greeting());

    assert.equal(rendered.kind, "invalid");
  });

  it("неизвестный часовой пояс — не угадывает время", () => {
    const base = greeting();
    const rendered = renderGreeting(
      DEFAULT_GREETING_TEMPLATE,
      greeting({ event: { ...base.event, timeZone: "Марс/Олимп" } })
    );

    assert.equal(rendered.kind, "invalid");
  });
});

class Greetings implements RegistrationGreetingRepository {
  queued: Parameters<RegistrationGreetingRepository["queueGreeting"]>[0][] = [];
  noChannel: string[] = [];
  skipped: { readonly registrationId: string; readonly reason: string }[] = [];
  listed = 0;

  constructor(
    private readonly pending: PendingGreeting[],
    private readonly sentToday: Partial<Record<ConversationChannel, number>> = {},
    private readonly accept = true
  ) {}

  async listPending() {
    this.listed += 1;

    return this.pending;
  }

  async countQueuedSince() {
    return this.sentToday;
  }

  async queueGreeting(input: Parameters<RegistrationGreetingRepository["queueGreeting"]>[0]) {
    if (this.accept) {
      this.queued.push(input);
    }

    return this.accept;
  }

  async markNoChannel(input: { readonly registrationId: string }) {
    this.noChannel.push(input.registrationId);
  }

  async markSkipped(input: { readonly registrationId: string; readonly reason: string }) {
    this.skipped.push({ registrationId: input.registrationId, reason: input.reason });
  }
}

const ids = { newId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };

describe("проход по заявкам", () => {
  it("ночью никого не разбирает", async () => {
    const repository = new Greetings([greeting()]);
    const service = new GreetRegistrationsBatchService(repository, ids, OPTIONS);

    // 23:00 по Москве.
    const result = await service.execute({
      at: new Date("2026-10-25T20:00:00.000Z"),
      batchSize: 10
    });

    assert.equal(result.outsideWindow, true);
    assert.equal(repository.listed, 0);
  });

  it("кладёт приветствие в ветку найденного канала", async () => {
    const repository = new Greetings([
      greeting({ lookups: { telegram: "found" }, conversations: { telegram: TG_CHAT } })
    ]);
    const service = new GreetRegistrationsBatchService(repository, ids, OPTIONS);

    const result = await service.execute({ at: NOON, batchSize: 10 });

    assert.equal(result.queued, 1);
    assert.equal(repository.queued[0]?.channel, "telegram");
    assert.equal(repository.queued[0]?.conversationId, TG_CHAT);
    assert.match(repository.queued[0]?.body ?? "", /^Привет! На связи Бизнес-Прорыв/);
  });

  it("потолок считает и внутри прохода", async () => {
    // Вчерашних отправок 49 из 50: первая утренняя заявка проходит, вторая ждёт завтра.
    const found = { lookups: { telegram: "found" as const }, conversations: { telegram: TG_CHAT } };
    const repository = new Greetings(
      [
        greeting({ ...found, registrationId: "11111111-1111-4111-8111-000000000001" }),
        greeting({ ...found, registrationId: "11111111-1111-4111-8111-000000000002" })
      ],
      { telegram: 49 }
    );
    const service = new GreetRegistrationsBatchService(repository, ids, OPTIONS);

    const result = await service.execute({ at: NOON, batchSize: 10 });

    assert.equal(result.queued, 1);
    assert.equal(result.waiting, 1);
  });

  it("свой текст с опечаткой не отправляет и пишет почему", async () => {
    const base = greeting();
    const repository = new Greetings([
      greeting({
        lookups: { telegram: "found" },
        conversations: { telegram: TG_CHAT },
        event: { ...base.event, template: "Ждём вас на {мероприятие}" }
      })
    ]);
    const service = new GreetRegistrationsBatchService(repository, ids, OPTIONS);

    await service.execute({ at: NOON, batchSize: 10 });

    assert.equal(repository.queued.length, 0);
    assert.match(repository.skipped[0]?.reason ?? "", /\{мероприятие\}/);
  });

  it("решение, принятое другим проходом, не считает своим", async () => {
    const repository = new Greetings(
      [greeting({ lookups: { telegram: "found" }, conversations: { telegram: TG_CHAT } })],
      {},
      false
    );
    const service = new GreetRegistrationsBatchService(repository, ids, OPTIONS);

    const result = await service.execute({ at: NOON, batchSize: 10 });

    assert.equal(result.queued, 0);
  });
});
