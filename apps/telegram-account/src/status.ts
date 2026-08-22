/**
 * Что сейчас с аккаунтом компании: авторизован ли, через какой прокси ходит, есть ли связь.
 *
 *   pnpm account:status
 *
 * Нужен ровно для одного вопроса — «канал живой?». Ответ на него по журналам не получить:
 * TDLib об ошибках прокси не сообщает, а молча пробует соединиться снова, и снаружи это
 * выглядит как тишина. Тишина при этом бывает двух видов: никто не писал и мы отрезаны от
 * Telegram, — и различить их можно только состоянием соединения.
 */
import {
  readAccountIdentity,
  readAuthorizationState
} from "@ticket-platform/messenger-telegram-account";
import { openAccount, reportConnection } from "./bootstrap.js";

async function main(): Promise<void> {
  const { client, config } = await openAccount();

  try {
    const state = await readAuthorizationState(client);
    console.log(`Состояние авторизации: ${state}`);

    if (state !== "authorizationStateReady") {
      console.log(
        "Аккаунт не авторизован. Вход — pnpm account:login, на том же сервере и с телефоном"
        + " под рукой."
      );
      await reportConnection(client, 15_000);

      return;
    }

    const connection = await reportConnection(client);
    const identity = await readAccountIdentity(client);
    const name = [identity.firstName, identity.lastName]
      .filter((part) => part !== "")
      .join(" ");

    console.log(`Аккаунт: ${name === "" ? "без имени" : name}, +${identity.phone}`);
    console.log(`Ник: ${identity.username === null ? "не задан" : `@${identity.username}`}`);
    console.log(`Каталог сессии: ${config.sessionDirectory}`);

    if (connection !== "ready") {
      process.exitCode = 1;
    }
  } finally {
    if (!client.isClosed()) {
      await client.close();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
