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

describe("outreach CSV parser — выгрузка Timepad", () => {
  // «Фамилия и имя» одной колонкой, точка с запятой, почта у всех, а телефона у части
  // нет. Без распознавания почты такой контакт вообще некуда положить.
  it("reads the Timepad export the way it comes", () => {
    const csv = [
      '"Фамилия и имя";"Телефон";"Email";"Кол-во событий"',
      '"Гречневкина Ольга";"+7 (962) 708-47-43";"lily_foxy@vk.com";"1"',
      '"Без телефона Иван";"";"ivan@example.com";"2"'
    ].join("\r\n");

    const result = parseOutreachCsv(csv);

    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0]?.name, "Гречневкина Ольга");
    assert.equal(result.rows[0]?.email, "lily_foxy@vk.com");
    assert.equal(result.rows[1]?.phone, undefined);
    assert.equal(result.rows[1]?.email, "ivan@example.com");
    assert.deepEqual(result.skippedLines, []);
  });

  it("takes a row with only an email, because that is enough to find a person", () => {
    const result = parseOutreachCsv("Имя,Почта\nИван,ivan@example.com");

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.email, "ivan@example.com");
  });

  it("still refuses a file with no way to identify anyone", () => {
    assert.throws(
      () => parseOutreachCsv("Имя,Кол-во событий\nИван,3"),
      /хотя бы одна колонка/
    );
  });
});
