import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanPhoneCandidate,
  looksLikeName,
  normalizeContactInput,
  splitPhoneCandidates,
  stripHandleWrapping,
  type ContactNormalizationOptions
} from "./contact-identity.js";

/**
 * Заглушка вместо libphonenumber: пакет держится без зависимостей, поэтому разбор номера
 * приходит снаружи. Правила те же, что у настоящего разборщика для России, — их достаточно,
 * чтобы проверить именно чистку, за которую отвечает модуль.
 */
const parsePhone: ContactNormalizationOptions["parsePhone"] = (candidate) => {
  const digits = candidate.replace(/\D/g, "");
  if (/^[78]\d{10}$/.test(digits)) {
    return `+7${digits.slice(1)}`;
  }
  if (/^9\d{9}$/.test(digits)) {
    return `+7${digits}`;
  }
  if (candidate.startsWith("+") && /^\d{11,15}$/.test(digits)) {
    return `+${digits}`;
  }
  return null;
};

const options: ContactNormalizationOptions = { parsePhone };

describe("нормализация контакта", () => {
  it("приводит телефон к E.164, что бы человек ни написал в ячейке", () => {
    const variants = [
      "+7 (999) 123-45-67",
      "8 999 123 45 67",
      "тел. 89991234567",
      "89991234567 доб. 12",
      "  8-999-123-45-67  "
    ];

    for (const variant of variants) {
      const result = normalizeContactInput({ phone: variant }, options);
      assert.equal(
        result.identity.phoneE164,
        "+79991234567",
        `не разобрался вариант ${JSON.stringify(variant)}`
      );
      assert.equal(result.rejections.length, 0);
    }
  });

  it("берёт первый номер из ячейки, а остальные не теряет", () => {
    // В выгрузках из CRM два номера через запятую — обычное дело, и разборщик на них падает.
    const result = normalizeContactInput(
      { phone: "+7 999 123-45-67, 8 999 765-43-21" },
      options
    );

    assert.equal(result.identity.phoneE164, "+79991234567");
    assert.deepEqual(result.identity.extraPhones, ["+79997654321"]);
  });

  it("не считает один и тот же номер, записанный дважды, вторым телефоном", () => {
    const result = normalizeContactInput(
      { phone: "89991234567 / +7 999 123 45 67" },
      options
    );

    assert.equal(result.identity.phoneE164, "+79991234567");
    assert.deepEqual(result.identity.extraPhones, []);
  });

  it("оставляет человека, у которого телефон записан словом, но верен ник", () => {
    // Раньше такая строка пропадала целиком: разбор телефона ронял её вместе с ником.
    const result = normalizeContactInput(
      { name: "Анна", phone: "мобильный", telegram: "@anna_test" },
      options
    );

    assert.equal(result.hasIdentifier, true);
    assert.equal(result.identity.phoneE164, null);
    assert.equal(result.identity.telegramUsername, "anna_test");
    assert.deepEqual(result.rejections, [
      { field: "phone", rawValue: "мобильный", reason: "not_a_phone_number" }
    ]);
  });

  it("разворачивает ссылку на Telegram до ника", () => {
    for (const variant of [
      "https://t.me/anna_test",
      "t.me/anna_test",
      "telegram.me/anna_test",
      "tg://resolve?domain=anna_test",
      "@anna_test",
      "  anna_test  "
    ]) {
      const result = normalizeContactInput({ telegram: variant }, options);
      assert.equal(
        result.identity.telegramUsername,
        "anna_test",
        `не развернулся вариант ${JSON.stringify(variant)}`
      );
    }
  });

  it("хранит ник как есть, а искать даёт по нижнему регистру", () => {
    const result = normalizeContactInput({ telegram: "@Anna_Test" }, options);

    assert.equal(result.identity.telegramUsername, "Anna_Test");
    assert.equal(result.identity.telegramUsernameNormalized, "anna_test");
  });

  it("не пускает в ник то, что ником быть не может", () => {
    // Старая проверка принимала точки, дефисы и два символа — в колонку ника заезжали куски
    // ссылок и обрывки телефонов, занимали уникальный индекс и мешали узнать человека.
    for (const junk of ["ab", "anna.test", "anna-test", "не ник"]) {
      const result = normalizeContactInput({ telegram: junk }, options);
      assert.equal(
        result.identity.telegramUsername,
        null,
        `ник ${JSON.stringify(junk)} не должен пройти`
      );
      assert.equal(result.rejections[0]?.field, "telegram");
    }
  });

  it("забирает телефон из колонки ника, если своей колонки телефона нет", () => {
    const result = normalizeContactInput(
      { name: "Анна", telegram: "+7 999 123-45-67" },
      options
    );

    assert.equal(result.identity.phoneE164, "+79991234567");
    assert.equal(result.identity.telegramUsername, null);
    // Номер нашёл своё место, поэтому жаловаться на ник больше не на что.
    assert.deepEqual(result.rejections, []);
  });

  it("не затирает настоящий телефон номером из колонки ника", () => {
    const result = normalizeContactInput(
      { phone: "89991234567", telegram: "8 999 765-43-21" },
      options
    );

    assert.equal(result.identity.phoneE164, "+79991234567");
    assert.equal(result.rejections[0]?.field, "telegram");
  });

  it("приводит почту к нижнему регистру для поиска, показывая как ввели", () => {
    const result = normalizeContactInput(
      { email: "  Ivan@Example.COM  " },
      options
    );

    assert.equal(result.identity.email, "Ivan@Example.COM");
    assert.equal(result.identity.emailNormalized, "ivan@example.com");
    assert.equal(result.hasIdentifier, true);
  });

  it("не делает признаком мусор вместо почты", () => {
    const result = normalizeContactInput({ email: "не почта" }, options);

    assert.equal(result.identity.email, null);
    assert.equal(result.hasIdentifier, false);
    assert.equal(result.rejections[0]?.reason, "not_an_email");
  });

  it("сохраняет контакт без имени, но говорит, что имя не разобралось", () => {
    // 56 человек из amoCRM зовут «12» и «+79991234567» — терять их нельзя, но и делать вид,
    // что это имена, тоже.
    const result = normalizeContactInput(
      { name: "+7 999 123-45-67", phone: "89991234567" },
      options
    );

    assert.equal(result.identity.name, null);
    assert.equal(result.hasIdentifier, true);
    assert.equal(result.rejections[0]?.field, "name");
  });

  it("оставляет странное, но настоящее имя", () => {
    const result = normalizeContactInput(
      { name: "  a   cloud ", phone: "89991234567" },
      options
    );

    assert.equal(result.identity.name, "a cloud");
    assert.deepEqual(result.rejections, []);
  });

  it("снимает кавычки, которыми таблицы оборачивают имя", () => {
    const result = normalizeContactInput(
      { name: "«Иван Петров»", phone: "89991234567" },
      options
    );

    assert.equal(result.identity.name, "Иван Петров");
  });

  it("говорит, что признаков не осталось, когда сохранять нечего", () => {
    const result = normalizeContactInput(
      { name: "Иван", phone: "нет", telegram: "—" },
      options
    );

    assert.equal(result.hasIdentifier, false);
    assert.equal(result.rejections.length, 2);
  });

  it("пустой ввод не считает ошибкой", () => {
    const result = normalizeContactInput({}, options);

    assert.equal(result.hasIdentifier, false);
    assert.deepEqual(result.rejections, []);
  });
});

describe("разбор отдельных полей", () => {
  it("чистит номер до цифр и ведущего плюса", () => {
    assert.equal(cleanPhoneCandidate("+7 (999) 123-45-67"), "+79991234567");
    assert.equal(cleanPhoneCandidate("тел. 8 999 123 45 67"), "89991234567");
    assert.equal(cleanPhoneCandidate("89991234567 доб. 12"), "89991234567");
    assert.equal(cleanPhoneCandidate("нет номера"), "");
  });

  it("делит ячейку на номера по любому разделителю", () => {
    assert.deepEqual(
      splitPhoneCandidates("89991234567, 89997654321; 89995554433"),
      ["89991234567", "89997654321", "89995554433"]
    );
  });

  it("снимает обёртку ника, не трогая сам ник", () => {
    assert.equal(stripHandleWrapping("https://t.me/anna?start=1"), "anna");
    assert.equal(stripHandleWrapping("@@anna"), "anna");
    assert.equal(stripHandleWrapping("anna"), "anna");
  });

  it("отличает имя от не-имени", () => {
    assert.equal(looksLikeName("Иван Петров"), true);
    assert.equal(looksLikeName("a cloud"), true);
    assert.equal(looksLikeName("12"), false);
    assert.equal(looksLikeName("+7 999 123-45-67"), false);
    assert.equal(looksLikeName("ivan@example.com"), false);
    assert.equal(looksLikeName("И"), false);
  });
});
