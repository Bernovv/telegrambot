import type {
  ChannelLookupOutcome,
  ChannelLookupPort
} from "@ticket-platform/application";
import type { WhatsAppLookup } from "./socket.js";

/**
 * «Есть ли у этого номера WhatsApp».
 *
 * Самый простой из трёх каналов и самый полезный: адрес человека в WhatsApp — это его
 * телефон, поэтому найденный ответ сразу склеивается и с заявкой с сайта, и с импортом, и
 * со звонком, без всякой ручной работы. Ников здесь нет, и заполнять в карточке нечего.
 *
 * `exists: false` — тот же `not_found`: номер существует как строка, но аккаунта за ним нет.
 */

const NOT_FOUND: ChannelLookupOutcome = { kind: "not_found" };

export function createWhatsAppPhoneLookup(
  client: { lookupPhone(phone: string): Promise<WhatsAppLookup | null> }
): ChannelLookupPort {
  return {
    async find(phoneE164) {
      try {
        const found = await client.lookupPhone(phoneE164);
        if (found === null || !found.exists) {
          return NOT_FOUND;
        }

        return {
          kind: "found",
          // Идентификатор и адрес здесь одно и то же — адрес вида `79001234567@s.whatsapp.net`.
          externalUserId: found.jid,
          externalChatId: found.jid,
          username: null
        };
      } catch (error) {
        return {
          kind: "failed",
          reason: `WhatsApp отказал: ${
            error instanceof Error ? error.message : String(error)
          }`,
          // Срока WhatsApp не называет; ждём по своему расписанию.
          retryAfterMs: null
        };
      }
    }
  };
}
