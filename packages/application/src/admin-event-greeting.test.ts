import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_GREETING_TEMPLATE,
  type AdminRequestActor,
  type EventGreetingStats
} from "@ticket-platform/contracts";
import {
  AdminEventGreetingService,
  GreetingEventNotFoundError,
  InvalidEventGreetingError,
  type AdminEventGreetingRepository,
  type GreetingEventRow,
  type StoredEventGreeting
} from "./admin-event-greeting.js";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-25T09:00:00.000Z");

function actor(permission: "events.read" | "events.write"): AdminRequestActor {
  return { adminId: ADMIN_ID, authSubject: "test", roleCodes: ["manager"], permission };
}

const EVENT: GreetingEventRow = {
  id: EVENT_ID,
  title: "Открытая встреча предпринимателей",
  startsAt: new Date("2026-11-18T15:30:00.000Z"),
  timeZone: "Europe/Moscow",
  locationName: null,
  locationAddress: "ул. Рубинштейна, 27"
};

class Settings implements AdminEventGreetingRepository {
  saved: Parameters<AdminEventGreetingRepository["saveSettings"]>[0][] = [];

  constructor(
    private stored: StoredEventGreeting | null = null,
    private readonly event: GreetingEventRow | null = EVENT,
    private readonly canEdit = true
  ) {}

  async findEvent() {
    return this.event;
  }

  async loadSettings() {
    return this.stored;
  }

  async countGreetings(): Promise<EventGreetingStats> {
    return { pending: 1, queued: 3, noChannel: 2, skipped: 0 };
  }

  async hasPermission() {
    return this.canEdit;
  }

  async saveSettings(input: Parameters<AdminEventGreetingRepository["saveSettings"]>[0]) {
    this.saved.push(input);
    this.stored = {
      isEnabled: input.isEnabled,
      eventPhrase: input.eventPhrase,
      bodyTemplate: input.bodyTemplate,
      updatedAt: input.at,
      updatedByName: "Любовь"
    };
  }
}

const clock = { now: () => NOW };

describe("настройки приветствия мероприятия", () => {
  it("без сохранённых настроек показывает общий текст и выключенное приветствие", async () => {
    // Новое мероприятие никому не пишет, пока приветствие у него не включили.
    const service = new AdminEventGreetingService(new Settings(), clock);

    const view = await service.get({ actor: actor("events.read"), eventId: EVENT_ID });

    assert.equal(view.isEnabled, false);
    assert.equal(view.eventPhrase, null);
    assert.equal(view.bodyTemplate, null);
    assert.equal(view.defaultTemplate, DEFAULT_GREETING_TEMPLATE);
    assert.equal(view.event.startsAt, "2026-11-18T15:30:00.000Z");
    assert.deepEqual(view.stats, { pending: 1, queued: 3, noChannel: 2, skipped: 0 });
    assert.equal(view.updatedAt, null);
    assert.equal(view.canEdit, true);
  });

  it("сохраняет название без лишних пробелов", async () => {
    const repository = new Settings();
    const service = new AdminEventGreetingService(repository, clock);

    const view = await service.save({
      actor: actor("events.write"),
      eventId: EVENT_ID,
      settings: {
        isEnabled: true,
        eventPhrase: "  Открытой   встрече предпринимателей ",
        bodyTemplate: null
      }
    });

    assert.equal(repository.saved[0]?.eventPhrase, "Открытой встрече предпринимателей");
    assert.equal(repository.saved[0]?.adminId, ADMIN_ID);
    assert.equal(view.eventPhrase, "Открытой встрече предпринимателей");
    assert.equal(view.updatedByName, "Любовь");
  });

  it("общий текст, сохранённый без правок, остаётся общим, а не копией", async () => {
    // Иначе правка общего текста в коде обошла бы это мероприятие стороной.
    const repository = new Settings();
    const service = new AdminEventGreetingService(repository, clock);

    await service.save({
      actor: actor("events.write"),
      eventId: EVENT_ID,
      settings: {
        isEnabled: true,
        eventPhrase: "",
        bodyTemplate: `${DEFAULT_GREETING_TEMPLATE.replaceAll("\n", "\r\n")}\n`
      }
    });

    assert.equal(repository.saved[0]?.bodyTemplate, null);
    assert.equal(repository.saved[0]?.eventPhrase, null);
  });

  it("свой текст с опечаткой в подстановке не сохраняет и называет её", async () => {
    const repository = new Settings();
    const service = new AdminEventGreetingService(repository, clock);

    await assert.rejects(
      service.save({
        actor: actor("events.write"),
        eventId: EVENT_ID,
        settings: {
          isEnabled: true,
          eventPhrase: null,
          bodyTemplate: "Ждём вас {когда} на {мероприятие} и {мероприятие}"
        }
      }),
      (error: unknown) => error instanceof InvalidEventGreetingError
        && error.reason === "Неизвестная подстановка: {мероприятие}"
    );
    assert.equal(repository.saved.length, 0);
  });

  it("фигурные скобки в названии не пропускает", async () => {
    const service = new AdminEventGreetingService(new Settings(), clock);

    await assert.rejects(
      service.save({
        actor: actor("events.write"),
        eventId: EVENT_ID,
        settings: { isEnabled: true, eventPhrase: "встрече {когда}", bodyTemplate: null }
      }),
      InvalidEventGreetingError
    );
  });

  it("сохраняет выключенное приветствие", async () => {
    const repository = new Settings();
    const service = new AdminEventGreetingService(repository, clock);

    const view = await service.save({
      actor: actor("events.write"),
      eventId: EVENT_ID,
      settings: { isEnabled: false, eventPhrase: null, bodyTemplate: null }
    });

    assert.equal(view.isEnabled, false);
  });

  it("без права на правку не сохраняет, без мероприятия — отвечает, что его нет", async () => {
    const service = new AdminEventGreetingService(new Settings(), clock);
    const missing = new AdminEventGreetingService(new Settings(null, null), clock);

    await assert.rejects(service.save({
      actor: actor("events.read"),
      eventId: EVENT_ID,
      settings: { isEnabled: true, eventPhrase: null, bodyTemplate: null }
    }));
    await assert.rejects(
      missing.get({ actor: actor("events.read"), eventId: EVENT_ID }),
      GreetingEventNotFoundError
    );
  });
});
