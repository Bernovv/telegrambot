import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidBroadcastPersonalizationError,
  normalizeBroadcastPersonalization,
  renderBroadcastContent
} from "./broadcast-personalization.js";

describe("broadcast personalization", () => {
  it("renders supported tokens from a fixed recipient context", () => {
    const result = renderBroadcastContent({
      text: "Привет, {{first_name}}! Профиль: {{telegram_username}}",
      disableLinkPreview: true,
      buttons: [],
      personalization: { fallback: "участник" }
    }, 2, {
      firstName: " Иван ",
      lastName: null,
      displayName: "Иван Петров",
      telegramUsername: "ivan_petrov"
    });

    assert.equal(result.text, "Привет, Иван! Профиль: @ivan_petrov");
  });

  it("uses one bounded fallback for missing profile values", () => {
    const result = renderBroadcastContent({
      text: "{{first_name}}, {{last_name}}, {{display_name}}, {{telegram_username}}",
      disableLinkPreview: false,
      buttons: [],
      personalization: { fallback: "гость" }
    }, 2, {
      firstName: null,
      lastName: " ",
      displayName: null,
      telegramUsername: "bad name"
    });

    assert.equal(result.text, "гость, гость, гость, гость");
  });

  it("keeps schema v1 templates literal", () => {
    const content = {
      text: "Привет, {{first_name}}",
      disableLinkPreview: false,
      buttons: []
    };

    assert.equal(
      renderBroadcastContent(content, 1, {
        firstName: "Иван",
        lastName: null,
        displayName: null,
        telegramUsername: null
      }).text,
      content.text
    );
  });

  it("rejects unknown or malformed placeholders", () => {
    for (const text of ["{{phone}}", "{{first_name}", "{{FIRST_NAME}}"]) {
      assert.throws(
        () => normalizeBroadcastPersonalization({
          text,
          disableLinkPreview: false,
          buttons: [],
          personalization: { fallback: "гость" }
        }),
        InvalidBroadcastPersonalizationError
      );
    }
  });

  it("enforces the Telegram caption limit after personalization", () => {
    assert.throws(
      () => renderBroadcastContent({
        text: `${"а".repeat(1_020)}{{first_name}}`,
        disableLinkPreview: false,
        buttons: [],
        personalization: { fallback: "гость" },
        media: {
          kind: "photo",
          url: "https://cdn.example.com/broadcasts/program.jpg"
        }
      }, 3, {
        firstName: "Иван Петров",
        lastName: null,
        displayName: null,
        telegramUsername: null
      }),
      (error: unknown) =>
        error instanceof InvalidBroadcastPersonalizationError
        && error.reason === "output_too_long"
    );
  });
});
