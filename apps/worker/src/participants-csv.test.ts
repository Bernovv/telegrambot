import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseParticipantsCsv } from "./participants-csv.js";

const HEADER = "row,name,phone,telegram,adults,children,sleeping,amount_rub,source,note";

describe("parseParticipantsCsv", () => {
  it("reads a row the way the august sheet exported it", () => {
    const rows = parseParticipantsCsv(
      `${HEADER}\n14,Надежда,+79001234567,@Nadinka88,1,0,3,6490,direct,`
    );

    assert.deepEqual(rows, [{
      row: "14",
      name: "Надежда",
      phone: "+79001234567",
      telegram: "@Nadinka88",
      adults: "1",
      children: "0",
      sleeping: "3",
      amountRubles: "6490",
      source: "direct",
      note: ""
    }]);
  });

  // В заметках попадаются запятые — «Должна 3к, стул». Наивное разрезание по запятой
  // сдвинуло бы все колонки правее и записало бы чужие числа не тому человеку.
  it("keeps a quoted note with commas in one field", () => {
    const rows = parseParticipantsCsv(
      `${HEADER}\n61,Наталья,,,1,0,2,2000,direct,"Должна 3к на месте, стул"`
    );

    assert.equal(rows[0]?.note, "Должна 3к на месте, стул");
    assert.equal(rows[0]?.amountRubles, "2000");
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
    assert.equal(rows[0]?.amountRubles, "0");

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
