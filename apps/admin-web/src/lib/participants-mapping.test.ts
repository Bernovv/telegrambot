import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  guessMapping,
  mapParticipants,
  normalizePhone,
  toKopecks,
  type ColumnMapping
} from "./participants-mapping.js";

// Колонки августовской таблицы: имя, телефон, тг, сумма, ночь, заметка.
const MAPPING: ColumnMapping = {
  name: 0,
  phone: 1,
  email: null,
  telegram: 2,
  amount: 3,
  sleeping: 4,
  children: null,
  note: 5
};

const OPTIONS: { groupCompanions: boolean; headerRows: number } =
  { groupCompanions: true, headerRows: 1 };
const HEADER = ["Имя", "Телефон", "Тг", "Сумма", "Ночь", "Комментарий"];

function run(rows: readonly (readonly string[])[], options = OPTIONS) {
  return mapParticipants([HEADER, ...rows], MAPPING, options);
}

describe("mapParticipants — спутники", () => {
  // Главная ошибка первого переноса: «С +1» и «Ребенок» стали отдельными карточками
  // без имени и телефона.
  it("merges companions into the person they came with", () => {
    const result = run([
      ["Надежда", "", "@Nadinka88", "6490", "1", ""],
      ["Муж", "", "", "0", "1", ""],
      ["Ребенок", "", "", "0", "1", ""],
      ["Алина", "", "", "3990", "1", ""]
    ]);

    assert.equal(result.participants.length, 2);
    const [nadezhda, alina] = result.participants;
    assert.equal(nadezhda?.name, "Надежда");
    assert.equal(nadezhda?.adults, 2);
    assert.equal(nadezhda?.children, 1);
    assert.equal(nadezhda?.sleeping, 3);
    assert.deepEqual(nadezhda?.companions, ["Муж", "Ребенок"]);
    assert.match(nadezhda?.note ?? "", /с ним: Муж, Ребенок/);
    assert.equal(alina?.adults, 1);
  });

  it("counts the whole party as guests, losing nobody", () => {
    const result = run([
      ["Алексей", "", "", "4090", "1", ""],
      ["с +1", "", "", "0", "1", ""],
      ["ребенок", "", "", "0", "1", ""],
      ["ребенок 2", "", "", "490", "1", ""]
    ]);

    assert.equal(result.totals.cards, 1);
    assert.equal(result.totals.guests, 4);
    assert.equal(result.totals.adults, 2);
    assert.equal(result.totals.children, 2);
    assert.equal(result.totals.amountKopecks, "458000");
  });

  // «Плюс один от Олега спикера» относится к Олегу, а Олег — далеко в таблице. К соседу
  // сверху такую строку клеить нельзя.
  it("does not attach a companion to a neighbour it does not name", () => {
    const result = run([
      ["Елена Жукова", "", "", "1360", "0", ""],
      ["Плюс один от Олега спикера", "", "", "0", "1", ""]
    ]);

    assert.equal(result.participants.length, 2);
    assert.equal(result.participants[0]?.adults, 1);
  });

  it("attaches a companion that names the person right above it", () => {
    const result = run([
      ["Роман", "", "@strogov", "0", "1", ""],
      ["Плюс 1 с Романом", "", "", "0", "1", ""]
    ]);

    assert.equal(result.participants.length, 1);
    assert.equal(result.participants[0]?.adults, 2);
    assert.equal(result.participants[0]?.sleeping, 2);
  });

  it("matches a named companion through Russian declension and ё", () => {
    const alena = run([
      ["Алёна", "", "@Alena324", "0", "1", ""],
      ["Евгений Ротяков", "муж Алены", "@REvgNik", "0", "1", ""]
    ]);

    assert.equal(alena.participants.length, 1);
    assert.equal(alena.participants[0]?.adults, 2);
  });

  // В JavaScript \b знает только латиницу и против кириллицы не срабатывает никогда.
  // На этом «Евгений муж» переставал быть спутником, а правило «строка называет другого
  // человека» молча не работало — обе проверки ниже ловят именно это.
  it("recognises a companion whose role is the last Cyrillic word", () => {
    const result = run([
      ["Юлия Харитонова", "", "", "0", "0", ""],
      ["Евгений муж", "", "", "0", "0", ""],
      ["Дочка", "", "", "0", "0", ""]
    ]);

    assert.equal(result.participants.length, 1);
    assert.equal(result.participants[0]?.name, "Юлия Харитонова");
    assert.equal(result.participants[0]?.adults, 2);
    assert.equal(result.participants[0]?.children, 1);
  });

  it("still treats «Плюс один от Олега» as a companion row, just not of its neighbour", () => {
    const attached = run([
      ["Олег Кондратьев", "", "", "0", "1", ""],
      ["Плюс один от Олега спикера", "", "", "0", "1", ""]
    ]);
    const detached = run([
      ["Елена Жукова", "", "", "0", "0", ""],
      ["Плюс один от Олега спикера", "", "", "0", "1", ""]
    ]);

    assert.equal(attached.participants.length, 1);
    assert.equal(attached.participants[0]?.adults, 2);
    assert.equal(detached.participants.length, 2);
  });

  it("leaves everyone separate when grouping is switched off", () => {
    const result = run(
      [
        ["Надежда", "", "", "0", "1", ""],
        ["Муж", "", "", "0", "1", ""]
      ],
      { groupCompanions: false, headerRows: 1 }
    );

    assert.equal(result.participants.length, 2);
  });
});

describe("mapParticipants — проверки", () => {
  // То же правило, что в базе. Ловим здесь, чтобы человек увидел причину до записи.
  it("reports a party with more sleeping places than people, and skips it", () => {
    const result = run([["Наталия", "", "", "4800", "2", ""]]);

    assert.equal(result.participants.length, 0);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0]?.message ?? "", /мест 2, а людей 1/);
    assert.equal(result.problems[0]?.name, "Наталия");
  });

  it("reports a row that has data but no name", () => {
    const result = run([["", "+79001234567", "", "2490", "1", ""]]);

    assert.equal(result.participants.length, 0);
    assert.match(result.problems[0]?.message ?? "", /нет имени/);
  });

  it("stays silent about entirely empty rows", () => {
    const result = run([
      ["Иван", "", "", "0", "0", ""],
      ["", "", "", "", "", ""]
    ]);

    assert.equal(result.participants.length, 1);
    assert.deepEqual(result.problems, []);
  });

  it("skips the header rows it is told to skip", () => {
    const result = mapParticipants(
      [HEADER, ["Имя", "Телефон", "Тг", "Сумма", "Ночь", ""], ["Иван", "", "", "0", "0", ""]],
      MAPPING,
      { groupCompanions: true, headerRows: 2 }
    );

    assert.deepEqual(result.participants.map((row) => row.name), ["Иван"]);
  });
});

describe("normalizePhone", () => {
  // Excel хранит длинный номер как 7.9667700088E10 — без разворачивания он приедет
  // обрезанным и сверка с покупателями бота развалится.
  it("expands the scientific notation Excel writes for long numbers", () => {
    assert.equal(normalizePhone("7.9667700088E10").phone, "+79667700088");
  });

  it("accepts the shapes people actually type", () => {
    for (const raw of [
      "+7 921 940 9330",
      "7 (921) 940-93-30",
      "89219409330",
      "9219409330",
      "‪79219409330‬"
    ]) {
      assert.equal(normalizePhone(raw).phone, "+79219409330", raw);
    }
  });

  it("keeps what is not a phone as a note instead of dropping it", () => {
    const result = normalizePhone("муж Алены");

    assert.equal(result.phone, "");
    assert.equal(result.leftover, "муж Алены");
  });
});

describe("toKopecks", () => {
  it("keeps the kopecks that floating point would spoil", () => {
    assert.equal(toKopecks("7317.60"), "731760");
    assert.equal(toKopecks("7317,60"), "731760");
    assert.equal(toKopecks("6000"), "600000");
    assert.equal(toKopecks("2 490"), "249000");
    assert.equal(toKopecks("0.5"), "50");
  });

  it("treats anything unreadable as zero rather than guessing", () => {
    assert.equal(toKopecks("бесплатно"), "0");
    assert.equal(toKopecks(""), "0");
  });
});

describe("guessMapping", () => {
  it("recognises the usual Russian headings", () => {
    const mapping = guessMapping(["Имя", "Номер телефона", "Тг", "Сумма", "Ночь"]);

    assert.equal(mapping.name, 0);
    assert.equal(mapping.phone, 1);
    assert.equal(mapping.telegram, 2);
    assert.equal(mapping.amount, 3);
    assert.equal(mapping.sleeping, 4);
  });

  // «Спальников» в августовской таблице — арендованные мешки, а не места. Угадывание
  // этой колонки один раз уже стоило неудачного импорта, поэтому её не подставляем.
  it("refuses to guess sleeping places from a sleeping-bag column", () => {
    const mapping = guessMapping(["Имя", "Спальников"]);

    assert.equal(mapping.sleeping, null);
  });

  it("leaves a field unset when nothing matches", () => {
    const mapping = guessMapping(["Колонка 1", "Колонка 2"]);

    assert.equal(mapping.name, null);
    assert.equal(mapping.note, null);
  });
});
