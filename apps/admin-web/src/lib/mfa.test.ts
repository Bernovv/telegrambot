import assert from "node:assert/strict";
import test from "node:test";
import {
  adminDestinationForAssurance,
  isValidTotpCode,
  normalizeTotpCode,
  totpQrDataUrl
} from "./mfa";

test("requires the MFA route until the session reaches aal2", () => {
  assert.equal(adminDestinationForAssurance(null), "/mfa");
  assert.equal(adminDestinationForAssurance("aal1"), "/mfa");
  assert.equal(adminDestinationForAssurance("aal2"), "/users");
});

test("ведёт сразу в панель, когда второй фактор выключен", () => {
  assert.equal(adminDestinationForAssurance(null, false), "/users");
  assert.equal(adminDestinationForAssurance("aal1", false), "/users");
  assert.equal(adminDestinationForAssurance("aal2", false), "/users");
});

test("normalizes a bounded six-digit TOTP code", () => {
  assert.equal(normalizeTotpCode("12 34-5678"), "123456");
  assert.equal(isValidTotpCode("123456"), true);
  assert.equal(isValidTotpCode("12345"), false);
});

test("encodes the Supabase SVG without injecting it into the document", () => {
  const url = totpQrDataUrl("<svg><text>&</text></svg>");
  assert.match(url, /^data:image\/svg\+xml;utf-8,/);
  assert.equal(url.includes("<svg>"), false);
});
