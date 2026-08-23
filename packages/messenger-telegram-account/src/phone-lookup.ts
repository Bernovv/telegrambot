/// <reference types="@prebuilt-tdlib/types" />
import type {
  ChannelLookupOutcome,
  ChannelLookupPort
} from "@ticket-platform/application";
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

/**
 * Исход общий на три канала — он же `ChannelLookupOutcome` в прикладном слое. Свой тип
 * здесь не заводится намеренно: пакет мессенджера и так зависит от прикладного, а два
 * одинаковых типа расходятся на первом же новом поле.
 *
 * `retryAfterMs` — через сколько Telegram сам разрешил повторить. Приходит при лимите и
 * означает буквально «раньше не спрашивай»: попытка раньше срока продлевает запрет.
 */
export type TelegramPhoneLookupOutcome = ChannelLookupOutcome;

export type TelegramPhoneLookup = ChannelLookupPort;

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

        const username = user.usernames?.editable_username
          ?? user.usernames?.active_usernames?.[0]
          ?? null;

        return {
          kind: "found",
          externalUserId: String(user.id),
          // В Telegram писать можно по тому же идентификатору, по которому нашли.
          externalChatId: String(user.id),
          username
        };
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
