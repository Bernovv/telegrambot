/// <reference types="@prebuilt-tdlib/types" />
import type { Client } from "tdl";
import { TDLibError } from "tdl";

/**
 * «Есть ли у этого номера Telegram» — тот же вопрос, что задаёт клиент, когда номер в чате
 * зажимают пальцем и смотрят, предложит ли он написать.
 *
 * Метод у TDLib ровно один: `searchUserByPhoneNumber`. Он либо возвращает пользователя,
 * либо отвечает 404, и **в этом 404 слиты два разных случая** — у номера нет Telegram и у
 * номера Telegram есть, но человек закрылся настройкой «кто может найти меня по номеру».
 * Слиты они не по недосмотру: различай Telegram эти случаи, по ответам можно было бы
 * перебирать номера и узнавать, у кого аккаунт есть. Поэтому наружу мы отдаём один исход
 * `not_found` с обоими объяснениями, а не выдумываем третий.
 *
 * Отдельно от него стоит `failed`: это когда до Telegram не дошёл сам запрос — прокси лёг,
 * упёрлись в лимит. Про человека это не говорит ничего, и повторить имеет смысл.
 */

export type TelegramPhoneLookupOutcome =
  | { readonly kind: "found"; readonly telegramUserId: string }
  | { readonly kind: "not_found" }
  | {
    readonly kind: "failed";
    readonly reason: string;
    /**
     * Через сколько Telegram сам разрешил повторить. Приходит при лимите и означает
     * буквально «раньше не спрашивай»: попытка раньше срока продлевает запрет.
     */
    readonly retryAfterMs: number | null;
  };

export interface TelegramPhoneLookup {
  find(phoneE164: string): Promise<TelegramPhoneLookupOutcome>;
}

/** «Too Many Requests: retry after 42» — единственное место, где Telegram называет срок. */
const FLOOD_WAIT = /retry after (\d+)/i;

export function createTdlibPhoneLookup(client: Pick<Client, "invoke">): TelegramPhoneLookup {
  return {
    async find(phoneE164) {
      try {
        const user = await client.invoke({
          _: "searchUserByPhoneNumber",
          phone_number: phoneE164,
          // Локального ответа мало: в базе TDLib лежат только те, кого мы уже видели, а
          // спрашиваем мы как раз про незнакомых.
          only_local: false
        });

        return { kind: "found", telegramUserId: String(user.id) };
      } catch (error) {
        if (!(error instanceof TDLibError)) {
          throw error;
        }
        if (error.code === 404) {
          return { kind: "not_found" };
        }
        const wait = FLOOD_WAIT.exec(error.message);

        return {
          kind: "failed",
          reason: `Telegram отказал: ${error.message}`,
          retryAfterMs: wait?.[1] === undefined ? null : Number(wait[1]) * 1_000
        };
      }
    }
  };
}
