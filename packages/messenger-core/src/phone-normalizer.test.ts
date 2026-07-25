import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidPhoneNumberError, LibPhoneNumberNormalizer } from "./phone-normalizer.js";

describe("LibPhoneNumberNormalizer", () => {
  it("normalizes a Russian national number to E.164", () => {
    const normalizer = new LibPhoneNumberNormalizer("RU");

    assert.equal(normalizer.normalize("8 (800) 555-35-35"), "+78005553535");
  });

  it("keeps a valid international number independent of the default country", () => {
    const normalizer = new LibPhoneNumberNormalizer("RU");

    assert.equal(normalizer.normalize("+1 213 373 4253"), "+12133734253");
  });

  it("rejects invalid input without exposing it in the error", () => {
    const normalizer = new LibPhoneNumberNormalizer("RU");

    assert.throws(
      () => normalizer.normalize("private raw value 123"),
      (error: unknown) => {
        assert.ok(error instanceof InvalidPhoneNumberError);
        assert.equal(error.message, "Phone number is invalid");
        return true;
      }
    );
  });
});
