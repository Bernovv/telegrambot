/**
 * Кто этот человек в MAX — по номеру телефона.
 *
 *   pnpm max:whois +79001234567
 *
 * Две работы сразу. Первая — проверка канала: вызов, которым аккаунт находит человека по
 * номеру, это то, чего бот не умеет вовсе, и на нём же потом встанет «написать первым» из
 * панели. Вторая, и она важнее, — **сверка идентификаторов**. Если номер человека у
 * аккаунта тот же, что у Bot API, диалог с ботом и диалог с аккаунтом склеятся в одну
 * карточку сами. Если разный — придётся склеивать по телефону, и узнать об этом лучше
 * до того, как в базе появятся сотни разъехавшихся карточек.
 *
 * Сравнивать так: найти здесь идентификатор человека, который уже писал боту, и сверить
 * его с `external_user_id` в `messenger_identities` для канала `max`.
 */
import { MaxChatDirectory } from "@ticket-platform/messenger-max-account";
import { openAccount } from "./bootstrap.js";

async function main(): Promise<void> {
  const phone = (process.argv[2] ?? "").trim();
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("Нужен номер телефона: pnpm max:whois +79001234567");
  }

  const { client } = await openAccount();
  try {
    const found = await new MaxChatDirectory(client).findByPhone(phone);
    if (found === null) {
      console.log(`По номеру ${phone} в MAX никого не нашлось.`);
      console.log(
        "Это нормальный ответ: у человека может не быть MAX либо он закрыт настройками"
        + " приватности. Написать первым такому нельзя."
      );
      process.exitCode = 1;

      return;
    }

    console.log(JSON.stringify(found, null, 2));
    console.log(
      "\nСверьте идентификатор с тем, что записал бот:"
      + "\n  select external_user_id, username from public.messenger_identities"
      + "\n   where channel = 'max' order by first_seen_at desc limit 20;"
    );
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
