import type {
  ChannelLookupOutcome,
  ChannelLookupPort
} from "@ticket-platform/application";
import { MaxChatDirectory } from "./directory.js";
import type { MaxAccountClient } from "./client.js";

/**
 * «Есть ли у этого номера MAX».
 *
 * Тот же вызов, что стоит за `pnpm max:whois`, только из очереди и по расписанию.
 * Отвечает он одинаково на два разных случая — аккаунта нет и человек закрыт настройками
 * приватности, — и различить их нельзя. Так задумано у них: иначе по ответам можно было бы
 * перебирать номера. Наружу отдаём один исход `not_found`.
 *
 * Идентификатор ищем в нескольких полях: протокол у MAX не документирован, и в ответах
 * попадались и `id`, и `contactId`, и вложенный `user`. Не нашли ни одного — считаем, что
 * не нашли человека: «нашли, но написать некуда» хуже честного «нет».
 */

const NOT_FOUND: ChannelLookupOutcome = { kind: "not_found" };

export function createMaxPhoneLookup(
  client: Pick<MaxAccountClient, "invoke">
): ChannelLookupPort {
  const directory = new MaxChatDirectory(client);

  return {
    async find(phoneE164) {
      try {
        const found = await directory.findByPhone(phoneE164);
        if (found === null) {
          return NOT_FOUND;
        }
        const id = identifierOf(found);
        if (id === null) {
          return NOT_FOUND;
        }

        return {
          kind: "found",
          externalUserId: id,
          // В MAX пишут по тому же идентификатору, по которому нашли.
          externalChatId: id,
          username: usernameOf(found)
        };
      } catch (error) {
        return {
          kind: "failed",
          reason: `MAX отказал: ${error instanceof Error ? error.message : String(error)}`,
          // Срока MAX не называет: у них нет ни заголовка, ни поля с ним. Ждём по своему
          // расписанию — оно с запасом.
          retryAfterMs: null
        };
      }
    }
  };
}

function identifierOf(contact: Readonly<Record<string, unknown>>): string | null {
  const nested = contact["user"];
  const source = isRecord(nested) ? nested : contact;
  for (const key of ["id", "contactId", "userId", "accountId"]) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

function usernameOf(contact: Readonly<Record<string, unknown>>): string | null {
  const nested = contact["user"];
  const source = isRecord(nested) ? nested : contact;
  for (const key of ["link", "username", "nickname"]) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim().replace(/^@/, "");
    }
  }

  return null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
