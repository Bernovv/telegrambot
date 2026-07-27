import assert from "node:assert/strict";
import test from "node:test";
import { loginErrorMessage } from "./login-error";

test("отправляет администратора туда, где чинится именно его отказ", () => {
  assert.match(
    loginErrorMessage({ code: "email_provider_disabled" }),
    /Sign In \/ Providers → Email/
  );
  assert.match(
    loginErrorMessage({ code: "email_not_confirmed" }),
    /Authentication → Users/
  );
  assert.equal(
    loginErrorMessage({ code: "invalid_credentials" }),
    "Неверная почта или пароль."
  );
  assert.match(
    loginErrorMessage({ code: "over_request_rate_limit" }),
    /Подождите пару минут/
  );
});

test("узнаёт причину по тексту, когда кода в ответе нет", () => {
  assert.match(
    loginErrorMessage({ message: "Email logins are disabled" }),
    /Sign In \/ Providers → Email/
  );
  assert.equal(
    loginErrorMessage({ message: "Invalid login credentials" }),
    "Неверная почта или пароль."
  );
});

test("на незнакомую ошибку не выдумывает причину", () => {
  const fallback = "Не удалось войти. Проверьте почту и пароль.";
  assert.equal(loginErrorMessage({ code: "weird_new_code" }), fallback);
  assert.equal(loginErrorMessage(null), fallback);
  assert.equal(loginErrorMessage("boom"), fallback);
});
