import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv } from "./spreadsheet.js";

// Разбор .xlsx (zip и XML) опирается на браузерные DecompressionStream и DOMParser,
// которых в Node нет, поэтому здесь проверяется путь CSV. Чтение Excel проверяется
// вживую загрузкой файла — оно механическое, вся содержательная логика в mapParticipants.
describe("parseCsv", () => {
  it("reads a comma-separated file the way Google Sheets exports it", () => {
    const rows = parseCsv("Имя,Телефон\nИван,+79001234567\n");

    assert.deepEqual(rows, [["Имя", "Телефон"], ["Иван", "+79001234567"]]);
  });

  // Русский Excel разделяет точкой с запятой — иначе вся строка приедет одной ячейкой.
  it("recognises the semicolon Excel uses in the Russian locale", () => {
    const rows = parseCsv("Имя;Телефон\nИван;+79001234567");

    assert.deepEqual(rows[1], ["Иван", "+79001234567"]);
  });

  it("keeps a quoted value with a comma inside one cell", () => {
    const rows = parseCsv('Имя,Заметка\nИван,"Должен 3к, стул"');

    assert.deepEqual(rows[1], ["Иван", "Должен 3к, стул"]);
  });

  it("understands doubled quotes inside a quoted value", () => {
    const rows = parseCsv('Имя\n"Иван ""Рыжий"""');

    assert.deepEqual(rows[1], ['Иван "Рыжий"']);
  });

  it("strips the byte order mark Excel writes in front of the header", () => {
    const rows = parseCsv("\uFEFFИмя,Телефон\nИван,");

    assert.equal(rows[0]?.[0], "Имя");
  });

  it("handles Windows line endings", () => {
    const rows = parseCsv("Имя,Телефон\r\nИван,+79001234567\r\n");

    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], ["Иван", "+79001234567"]);
  });

  // Excel охотно дописывает сотни пустых строк в конец — в предпросмотре они не нужны.
  it("drops the empty rows trailing at the end of the file", () => {
    const rows = parseCsv("Имя\nИван\n,\n,\n\n");

    assert.deepEqual(rows, [["Имя"], ["Иван"]]);
  });

  it("keeps an empty row in the middle, because it may separate blocks", () => {
    const rows = parseCsv("Имя\nИван\n\nМария");

    assert.equal(rows.length, 4);
    assert.deepEqual(rows[3], ["Мария"]);
  });

  it("refuses a file with an unclosed quote instead of guessing", () => {
    assert.throws(() => parseCsv('Имя\n"Иван'), /не закрыта кавычка/);
  });
});
