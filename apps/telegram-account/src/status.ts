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
  const message = error instanceof Error ? error.message : String(error);
  // Сессию держит работающий tg-account: TDLib пускает к ней ровно одну программу. Это не
  // поломка, и второй копии при этом не случилось — проверка упёрлась в замок до соединения.
  if (message.includes("Can't lock file")) {
    console.error(
      "Сессию сейчас держит работающий процесс tg-account, и проверка с ним одновременно не"
      + " откроется — это не поломка.\n"
      + "Как дела у работающего процесса: pm2 logs tg-account --lines 40 --nostream"
      + " (ищите «account ready» и «listening»).\n"
      + "Полная проверка соединения: pm2 stop tg-account && pnpm account:status"
      + " && pm2 start tg-account"
    );
  } else {
    console.error(message);
  }
  process.exitCode = 1;
});
