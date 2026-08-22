const encodedUuidPattern = "[A-Za-z0-9_-]{22}";
const callbackPattern = new RegExp(
  `^scenario:(${encodedUuidPattern}):(${encodedUuidPattern})$`
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ScenarioCallbackReference {
  readonly sessionId: string;
  readonly edgeId: string;
}

export function encodeScenarioCallback(
  sessionId: string,
  edgeId: string
): string {
  const value = `scenario:${encodeUuid(sessionId)}:${encodeUuid(edgeId)}`;
  if (Buffer.byteLength(value, "utf8") > 64) {
    throw new Error("Scenario callback exceeds Telegram limit");
  }
  return value;
}

export function decodeScenarioCallback(
  value: string
): ScenarioCallbackReference | null {
  const match = callbackPattern.exec(value);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const sessionId = decodeUuid(match[1]);
  const edgeId = decodeUuid(match[2]);
  return sessionId && edgeId ? { sessionId, edgeId } : null;
}

function encodeUuid(value: string): string {
  if (!uuidPattern.test(value)) {
    throw new Error("Scenario callback requires UUID identifiers");
  }
  return Buffer.from(value.replaceAll("-", ""), "hex").toString("base64url");
}

function decodeUuid(value: string): string | null {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 16) {
    return null;
  }
  const hex = bytes.toString("hex");
  const uuid = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
  return uuidPattern.test(uuid) ? uuid : null;
}
