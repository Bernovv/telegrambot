import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAttachmentPath } from "./admin-conversations-api.js";

describe("путь к файлу вложения", () => {
  it("собирает путь внутри папки вложений", () => {
    assert.equal(
      resolveAttachmentPath("/var/lib/telegrambot/conversation-files", "2026/08/abc.ogg"),
      "/var/lib/telegrambot/conversation-files/2026/08/abc.ogg"
    );
  });

  it("не выпускает за папку — даже если такой путь пришёл из базы", () => {
    // Путь кладём в базу мы сами, и сегодня он безопасен. Проверка нужна на день, когда
    // туда попадёт то, чего мы не ждали: тогда она — единственное, что стоит между
    // панелью и файлами сервера.
    for (const evil of [
      "../../../etc/passwd",
      "2026/../../etc/passwd",
      "/etc/passwd",
      "2026/08/../../../../root/.ssh/id_rsa"
    ]) {
      assert.equal(
        resolveAttachmentPath("/var/lib/telegrambot/conversation-files", evil),
        null,
        `путь ${evil} не должен выходить за папку`
      );
    }
  });

  it("без настроенной папки не отдаёт ничего", () => {
    // Скачивание выключено — файлов нет, и собирать путь от корня диска нельзя.
    assert.equal(resolveAttachmentPath("", "2026/08/abc.ogg"), null);
    assert.equal(resolveAttachmentPath("   ", "2026/08/abc.ogg"), null);
  });

  it("сама папка — не файл вложения", () => {
    assert.equal(
      resolveAttachmentPath("/var/lib/telegrambot/conversation-files", ""),
      null
    );
  });
});
