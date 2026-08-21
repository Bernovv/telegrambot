import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RunAutoTasksBatchService,
  autoTaskDueAt,
  type AutoTaskCandidate,
  type AutoTaskRepository,
  type AutoTaskToCreate
} from "./auto-tasks.js";

const NOW = new Date("2026-08-21T09:00:00.000Z");

function candidate(overrides: Partial<AutoTaskCandidate> = {}): AutoTaskCandidate {
  return {
    ruleId: "rule-1",
    trigger: "attended",
    campaignContactId: "member-1",
    contactId: "contact-1",
    anchorAt: new Date("2026-08-19T16:00:00.000Z"),
    autoKey: "member-1:event-1",
    offsetDays: 1,
    useCallWindow: true,
    atHour: null,
    taskType: "call",
    taskText: "Позвонить, собрать обратную связь",
    callWindowStart: 12,
    callWindowEnd: 19,
    callWindowTimezone: "Europe/Moscow",
    ...overrides
  };
}

describe("срок автозадачи", () => {
  it("сдвигает от повода и попадает в окно обзвона", () => {
    // Мероприятие кончилось 20 августа в 22:00 по Москве. «На следующий день» без окна
    // означало бы звонок в десять вечера.
    const due = autoTaskDueAt(
      candidate({ anchorAt: new Date("2026-08-20T19:00:00.000Z") }),
      NOW
    );
    assert.equal(due.toISOString(), "2026-08-21T09:00:00.000Z");
  });

  it("напоминание за день до встречи встаёт в окно того дня", () => {
    const due = autoTaskDueAt(
      candidate({
        trigger: "event_upcoming",
        offsetDays: -1,
        anchorAt: new Date("2026-08-26T16:00:00.000Z")
      }),
      NOW
    );
    assert.equal(due.toISOString(), "2026-08-25T09:00:00.000Z");
  });

  it("догоняющий повод не выдаёт задачу задним числом", () => {
    // Мероприятие прошло неделю назад, правило включили сегодня.
    const due = autoTaskDueAt(
      candidate({ anchorAt: new Date("2026-08-10T16:00:00.000Z") }),
      NOW
    );
    assert.equal(due.getTime() >= NOW.getTime(), true);
  });

  it("догоняющий повод без окна не рождается просроченным", () => {
    // Назначенный час — девять утра, а сейчас полдень по Москве: значит завтра.
    const due = autoTaskDueAt(
      candidate({
        useCallWindow: false,
        atHour: 9,
        anchorAt: new Date("2026-08-10T16:00:00.000Z")
      }),
      NOW
    );
    assert.equal(due.toISOString(), "2026-08-22T06:00:00.000Z");
  });

  it("без окна обзвона ставит срок в назначенный час", () => {
    const due = autoTaskDueAt(
      candidate({
        useCallWindow: false,
        atHour: 9,
        anchorAt: new Date("2026-08-24T16:00:00.000Z")
      }),
      NOW
    );
    // 09:00 по Москве 25 августа — это 06:00 UTC.
    assert.equal(due.toISOString(), "2026-08-25T06:00:00.000Z");
  });
});

describe("RunAutoTasksBatchService", () => {
  it("на пустой выборке в базу не ходит", async () => {
    let createCalls = 0;
    const service = new RunAutoTasksBatchService(
      {
        async listCandidates() { return []; },
        async createTasks() { createCalls += 1; return 0; }
      },
      { newId: () => "task-1" }
    );

    const result = await service.execute({ at: NOW, batchSize: 100 });

    assert.deepEqual(result, { candidates: 0, created: 0 });
    assert.equal(createCalls, 0);
  });

  it("переносит повод в задачу и считает, сколько встало", async () => {
    const written: AutoTaskToCreate[] = [];
    let id = 0;
    const repository: AutoTaskRepository = {
      async listCandidates() {
        return [candidate(), candidate({ autoKey: "member-2:event-1" })];
      },
      async createTasks(input) {
        written.push(...input.tasks);
        // Одна не встала: между отбором и записью менеджер поставил свою задачу.
        return 1;
      }
    };
    const service = new RunAutoTasksBatchService(repository, {
      newId: () => { id += 1; return `task-${id}`; }
    });

    const result = await service.execute({ at: NOW, batchSize: 100 });

    assert.deepEqual(result, { candidates: 2, created: 1 });
    assert.equal(written.length, 2);
    assert.equal(written[0]?.taskText, "Позвонить, собрать обратную связь");
    assert.equal(written[0]?.autoKey, "member-1:event-1");
    assert.notEqual(written[0]?.id, written[1]?.id);
  });
});
