import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseOutreachCsv } from "./outreach-csv.js";

describe("outreach CSV parser", () => {
  it("parses Russian semicolon-separated Excel CSV", () => {
    const result = parseOutreachCsv(
      "﻿Имя;Телефон;Телеграм;Источник;Комментарий\r\n"
      + 'Анна;+79991234567;@anna;База 2025;"После 15:00; удобно"\r\n'
    );
    assert.deepEqual(result.rows, [{
      name: "Анна",
      phone: "+79991234567",
      telegram: "@anna",
      source: "База 2025",
      note: "После 15:00; удобно"
    }]);
    assert.deepEqual(result.skippedLines, []);
    assert.deepEqual(result.lines, [2]);
  });

  it("skips a row without any contact instead of failing the whole file", () => {
    // Восемь тысяч строк из выгрузки — пустая строка среди них найдётся почти наверняка,
    // и ронять из-за неё весь импорт нельзя.
    const result = parseOutreachCsv(
      "name,phone\nИван,\nАнна,+79991234567\nПётр,\n"
    );

    assert.deepEqual(result.rows, [{ name: "Анна", phone: "+79991234567" }]);
    assert.deepEqual(result.skippedLines, [2, 4]);
    // Номер строки файла сохраняется, иначе ошибку не на что повесить.
    assert.deepEqual(result.lines, [3]);
  });

  it("still refuses a file where nothing at all can be imported", () => {
    assert.throws(
      () => parseOutreachCsv("name,phone\nИван,\n"),
      /нет строк с контактами/
    );
  });

  it("refuses a file without a contact column", () => {
    assert.throws(
      () => parseOutreachCsv("name,city\nИван,Москва\n"),
      /хотя бы одна колонка/
    );
  });
});
