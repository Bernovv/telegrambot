import type {
  AdminBroadcastContent,
  AdminBroadcastPersonalization,
  AdminBroadcastPersonalizationToken
} from "@ticket-platform/contracts";

export const BROADCAST_PERSONALIZATION_TOKENS:
readonly AdminBroadcastPersonalizationToken[] = [
  "first_name",
  "last_name",
  "display_name",
  "telegram_username"
];

const TOKEN_PATTERN = /\{\{([a-z_]+)\}\}/g;
const DEFAULT_FALLBACK = "гость";

export interface BroadcastPersonalizationContext {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly displayName: string | null;
  readonly telegramUsername: string | null;
}

export class InvalidBroadcastPersonalizationError extends Error {
  constructor(readonly reason: "invalid_template" | "output_too_long") {
    super(`Broadcast personalization is invalid: ${reason}`);
    this.name = "InvalidBroadcastPersonalizationError";
  }
}

export function normalizeBroadcastPersonalization(
  content: AdminBroadcastContent
): AdminBroadcastPersonalization {
  const fallback = (content.personalization?.fallback ?? DEFAULT_FALLBACK)
    .trim();
  if (fallback.length < 1 || fallback.length > 64) {
    throw new InvalidBroadcastPersonalizationError("invalid_template");
  }
  assertKnownTokens(content.text);
  return { fallback };
}

export function renderBroadcastContent(
  content: AdminBroadcastContent,
  schemaVersion: 1 | 2 | 3,
  context: BroadcastPersonalizationContext
): AdminBroadcastContent {
  if (schemaVersion === 1) {
    return content;
  }
  const personalization = normalizeBroadcastPersonalization(content);
  const values: Readonly<Record<AdminBroadcastPersonalizationToken, string>> = {
    first_name: profileValue(context.firstName, personalization.fallback),
    last_name: profileValue(context.lastName, personalization.fallback),
    display_name: profileValue(context.displayName, personalization.fallback),
    telegram_username: telegramUsername(
      context.telegramUsername,
      personalization.fallback
    )
  };
  const text = content.text.replace(
    TOKEN_PATTERN,
    (_token, name: string) =>
      values[name as AdminBroadcastPersonalizationToken]
  );
  const textLimit = content.media ? 1_024 : 4_096;
  if (text.length < 1 || text.length > textLimit) {
    throw new InvalidBroadcastPersonalizationError("output_too_long");
  }
  return {
    ...content,
    text,
    personalization
  };
}

function assertKnownTokens(text: string): void {
  const known = new Set<string>(BROADCAST_PERSONALIZATION_TOKENS);
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    if (!match[1] || !known.has(match[1])) {
      throw new InvalidBroadcastPersonalizationError("invalid_template");
    }
  }
  const withoutKnownTokens = text.replace(TOKEN_PATTERN, "");
  if (
    withoutKnownTokens.includes("{{")
    || withoutKnownTokens.includes("}}")
  ) {
    throw new InvalidBroadcastPersonalizationError("invalid_template");
  }
}

function profileValue(value: string | null, fallback: string): string {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 1 && normalized.length <= 200
    ? normalized
    : fallback;
}

function telegramUsername(value: string | null, fallback: string): string {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_]{5,32}$/.test(normalized)
    ? `@${normalized}`
    : fallback;
}
