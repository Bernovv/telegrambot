import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PARTICIPANT_CONTACT_SOURCE,
  resolveParticipantContact
} from "./participant-contact-link.js";
import type { SqlConnection, SqlQueryResult } from "./postgres.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const SEED_ID = "00000000-0000-4000-8000-000000000301";
const EXISTING_ID = "00000000-0000-4000-8000-000000000302";

describe("связь участника мероприятия с человеком в базе", () => {
  it("находит человека по телефону и второго не заводит", async () => {
    const connection = new FakeConnection({ selectReturns: EXISTING_ID });

    const contactId = await resolveParticipantContact(connection, {
      contactId: SEED_ID,
      displayName: "Мария Сидорова",
      phoneE164: "+79991234567",
      telegram: null,
      adminId: ADMIN_ID,
      source: PARTICIPANT_CONTACT_SOURCE
    });

    assert.equal(contactId, EXISTING_ID);
    assert.equal(
      connection.queries.some((query) => query.text.includes("insert into")),
      false,
      "человек уже есть — заводить второго значит получить дубль"
    );
  });

  it("находит человека по нику, когда телефона нет", async () => {
    // Половина строк в таблице участников — без телефона, зато с ником.
    const connection = new FakeConnection({ selectReturns: EXISTING_ID });

    const contactId = await resolveParticipantContact(connection, {
      contactId: SEED_ID,
      displayName: "Ирина",
      phoneE164: null,
      telegram: "@irina_alira",
      adminId: ADMIN_ID,
      source: PARTICIPANT_CONTACT_SOURCE
    });

    assert.equal(contactId, EXISTING_ID);
    const select = connection.queries[0];
    assert.ok(select);
    // Ник ищется в нижнем регистре: именно так он лежит в уникальном индексе.
    assert.deepEqual(select.values, [null, "irina_alira"]);
  });

  it("заводит человека в базе, когда его там ещё нет", async () => {
    const connection = new FakeConnection({ selectReturns: null, insertReturns: SEED_ID });

    const contactId = await resolveParticipantContact(connection, {
      contactId: SEED_ID,
      displayName: "Новый Человек",
      phoneE164: "+79997654321",
      telegram: "https://t.me/NewGuy",
      adminId: ADMIN_ID,
      source: PARTICIPANT_CONTACT_SOURCE
    });

    assert.equal(contactId, SEED_ID);
    const insert = connection.queries.find((query) =>
      query.text.includes("insert into public.outreach_contacts")
    );
    assert.ok(insert);
    assert.equal(insert.values[1], "Новый Человек");
    assert.equal(insert.values[2], "+79997654321");
    // Ссылка развёрнута до ника: в базе лежит ник, а не кусок адреса.
    assert.equal(insert.values[3], "NewGuy");
    assert.equal(insert.values[4], "newguy");
    assert.equal(insert.values[5], PARTICIPANT_CONTACT_SOURCE);
  });

  it("не заводит никого, когда опознать человека нечем", async () => {
    // Участник без телефона и ника: контакт не пройдёт проверку признаков, а найти его потом
    // всё равно не выйдет. Оставить связь пустой честнее, чем плодить карточки-пустышки.
    const connection = new FakeConnection({ selectReturns: null });

    const contactId = await resolveParticipantContact(connection, {
      contactId: SEED_ID,
      displayName: "Гость без контактов",
      phoneE164: null,
      telegram: null,
      adminId: ADMIN_ID,
      source: PARTICIPANT_CONTACT_SOURCE
    });

    assert.equal(contactId, null);
    assert.equal(connection.queries.length, 0, "в базу ходить незачем");
  });

  it("перечитывает контакт, если его завели параллельно", async () => {
    // Вставка ничего не вернула — значит между поиском и вставкой человека завёл кто-то ещё.
    // Потерять связь из-за гонки хуже, чем сделать лишний запрос на редком пути.
    const connection = new FakeConnection({
      selectReturns: null,
      insertReturns: null,
      raceReturns: EXISTING_ID
    });

    const contactId = await resolveParticipantContact(connection, {
      contactId: SEED_ID,
      displayName: "Мария",
      phoneE164: "+79991112233",
      telegram: null,
      adminId: ADMIN_ID,
      source: PARTICIPANT_CONTACT_SOURCE
    });

    assert.equal(contactId, EXISTING_ID);
    assert.equal(connection.queries.length, 3);
  });
});

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  private selects = 0;

  constructor(
    private readonly plan: {
      readonly selectReturns: string | null;
      readonly insertReturns?: string | null;
      readonly raceReturns?: string | null;
    }
  ) {}

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    if (text.includes("insert into")) {
      const id = this.plan.insertReturns ?? null;
      return id === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id } as TRow], rowCount: 1 };
    }
    this.selects += 1;
    const id = this.selects === 1
      ? this.plan.selectReturns
      : this.plan.raceReturns ?? null;
    return id === null
      ? { rows: [], rowCount: 0 }
      : { rows: [{ id } as TRow], rowCount: 1 };
  }

  release(): void {}
}
