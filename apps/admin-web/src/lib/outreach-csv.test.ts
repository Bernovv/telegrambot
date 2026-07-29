import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOutreachCsv } from "./outreach-csv.js";

describe("outreach CSV parser", () => {
  it("parses Russian semicolon-separated Excel CSV", () => {
    const rows = parseOutreachCsv(
      "\uFEFFИмя;Телефон;Телеграм;Источник;Комментарий\r\n"
      + 'Анна;+79991234567;@anna;База 2025;"После 15:00; удобно"\r\n'
    );
    assert.deepEqual(rows, [{
      name: "Анна",
      phone: "+79991234567",
      telegram: "@anna",
      source: "База 2025",
      note: "После 15:00; удобно"
    }]);
  });

  it("rejects rows without any contact identifier", () => {
    assert.throws(
      () => parseOutreachCsv("name,phone\nИван,\n"),
      /Строка 2/
    );
  });
});
