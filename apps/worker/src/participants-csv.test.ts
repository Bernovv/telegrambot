import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExpensesCsv, parseParticipantsCsv } from "./participants-csv.js";

const HEADER = "row,name,phone,telegram,adults,children,sleeping,amount_rub,source,note";

describe("parseParticipantsCsv", () => {
  it("reads a row the way the august sheet exported it", () => {
    const rows = parseParticipantsCsv(
      `${HEADER}\n14,Надежда,+79001234567,@Nadinka88,1,0,1,6490,direct,`
    );

    assert.deepEqual(rows, [{
      row: "14",
      name: "Надежда",
      phone: "+79001234567",
      telegram: "@Nadinka88",
      adults: "1",
      children: "0",
      sleeping: "1",
      amountKopecks: "649000",
      source: "direct",
      note: ""
    }]);
  });

  // В заметках попадаются запятые — «Должна 3к, стул». Наивное разрезание по запятой
  // сдвинуло бы все колонки правее и записало бы чужие числа не тому человеку.
  it("keeps a quoted note with commas in one field", () => {
    const rows = parseParticipantsCsv(
      `${HEADER}\n61,Наталья,,,1,0,1,2000,direct,"Должна 3к на месте, стул"`
    );

    assert.equal(rows[0]?.note, "Должна 3к на месте, стул");
    assert.equal(rows[0]?.amountKopecks, "200000");
  });

  it("survives the byte order mark Excel writes in front of the header", () => {
    const rows = parseParticipantsCsv(
      `\uFEFF${HEADER}\n2,Маша,,,1,0,0,0,direct,`
    );

    assert.equal(rows[0]?.name, "Маша");
  });

  it("treats empty numeric cells as zero but refuses junk in them", () => {
    const rows = parseParticipantsCsv(`${HEADER}\n2,Маша,,,1,,,,direct,`);
    assert.equal(rows[0]?.children, "0");
    assert.equal(rows[0]?.amountKopecks, "0");

    assert.throws(
      () => parseParticipantsCsv(`${HEADER}\n2,Маша,,,один,0,0,0,direct,`),
      /должно быть целым числом/
    );
  });

  // Кривой телефон молча уехал бы в базу и сорвал бы сверку с покупателями бота.
  it("refuses a phone that is not in the +7 form", () => {
    assert.throws(
      () => parseParticipantsCsv(`${HEADER}\n2,Маша,89001234567,,1,0,0,0,direct,`),
      /не в формате/
    );
    assert.throws(
      () => parseParticipantsCsv(`${HEADER}\n2,Маша,муж Алены,,1,0,0,0,direct,`),
      /не в формате/
    );
  });

  // В таблицах спальные места пишут на того, кто бронировал палатку, за всю компанию —
  // и тогда у него одного оказывается два места при одном человеке. База такую строку
  // отвергает; ловим раньше, чтобы не падать на середине вставки.
  it("refuses more sleeping places than there are people in the row", () => {
    assert.throws(
      () => parseParticipantsCsv(`${HEADER}\n38,Наталия,,,1,0,2,4800,direct,`),
      /мест не может быть больше/
    );
    assert.doesNotThrow(
      () => parseParticipantsCsv(`${HEADER}\n14,Надежда,,,1,2,3,6490,direct,`)
    );
  });

  it("refuses a nameless row rather than creating an unnamed participant", () => {
    assert.throws(
      () => parseParticipantsCsv(`${HEADER}\n2,,,,1,0,0,0,direct,`),
      /пустое имя/
    );
  });

  it("skips fully blank lines, including the trailing newline", () => {
    const rows = parseParticipantsCsv(
      `${HEADER}\n2,Маша,,,1,0,0,0,direct,\n,,,,,,,,,\n3,Ирина,,,1,0,0,0,direct,\n`
    );

    assert.deepEqual(rows.map((row) => row.name), ["Маша", "Ирина"]);
  });

  it("refuses a file whose header is missing a column it needs", () => {
    assert.throws(
      () => parseParticipantsCsv("name,phone\nМаша,+79001234567"),
      /нет колонки adults/
    );
  });
});

const EXPENSE_HEADER = "category,title,amount_rub,quantity,unit,paid_at,note";

describe("parseExpensesCsv", () => {
  it("reads a line the way the august sheet recorded it", () => {
    const rows = parseExpensesCsv(
      `${EXPENSE_HEADER}\nrent,Аренда бани,17500,1,,2026-08-09,`
    );

    assert.deepEqual(rows, [{
      category: "rent",
      title: "Аренда бани",
      amountKopecks: "1750000",
      quantity: "1",
      unit: "",
      paidAt: "2026-08-09",
      note: ""
    }]);
  });

  it("keeps the kopecks of a tax line intact", () => {
    const rows = parseExpensesCsv(`${EXPENSE_HEADER}\nother,Налог,7317.60,1,,,`);

    assert.equal(rows[0]?.amountKopecks, "731760");
    assert.equal(rows[0]?.paidAt, "");
  });

  it("accepts a comma as the decimal separator, the way Excel exports it", () => {
    const rows = parseExpensesCsv(`${EXPENSE_HEADER}\nother,Налог,"7317,60",1,,,`);

    assert.equal(rows[0]?.amountKopecks, "731760");
  });

  // «Оплачено» без даты тихо выпадает из фактических расходов и завышает прибыль,
  // поэтому неразбираемую дату отвергаем здесь, а не в базе.
  it("refuses a date it cannot read", () => {
    assert.throws(
      () => parseExpensesCsv(`${EXPENSE_HEADER}\nrent,Баня,100,1,,вчера,`),
      /не разобрать/
    );
  });

  it("refuses a nameless line and a junk category", () => {
    assert.throws(
      () => parseExpensesCsv(`${EXPENSE_HEADER}\nrent,,100,1,,,`),
      /пустое название/
    );
    assert.throws(
      () => parseExpensesCsv(`${EXPENSE_HEADER}\nАренда,Баня,100,1,,,`),
      /не похожа на код статьи/
    );
  });

  it("defaults a missing quantity to one but refuses zero", () => {
    assert.equal(
      parseExpensesCsv(`${EXPENSE_HEADER}\nrent,Баня,100,,,,`)[0]?.quantity,
      "1"
    );
    assert.throws(
      () => parseExpensesCsv(`${EXPENSE_HEADER}\nrent,Баня,100,0,,,`),
      /должно быть больше нуля/
    );
  });
});

// 7317.60 * 100 в плавающей точке даёт 731759.9999999999. За мероприятие таких строк
// набирается достаточно, чтобы итог перестал сходиться с бумажкой.
describe("перевод рублей в копейки", () => {
  it("keeps the kopecks of amounts that floating point would spoil", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["7317.60", "731760"],
      ["7317,60", "731760"],
      ["6000", "600000"],
      ["2490.5", "249050"],
      ["0.5", "50"],
      ["0", "0"]
    ];

    for (const [rubles, expected] of cases) {
      const rows = parseExpensesCsv(
        `${EXPENSE_HEADER}\nother,Строка,${rubles.includes(",") ? `"${rubles}"` : rubles},1,,,`
      );
      assert.equal(rows[0]?.amountKopecks, expected, rubles);
    }
  });
});
