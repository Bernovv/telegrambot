/**
 * Разовый вход аккаунта компании в Telegram.
 *
 *   pnpm account:login            — войти, если ещё не вошли
 *   pnpm account:login --forget   — выйти и забыть сессию (нужен новый код при следующем входе)
 *
 * Запускается руками и **на том же сервере**, где аккаунт будет работать. Это не формальность:
 * Telegram смотрит, откуда вошли, и вход с ноутбука в Москве с последующей работой из
 * Амстердама — это ровно та смена места, из-за которой аккаунт просят подтвердить себя, а в
 * плохом случае блокируют. Один адрес на вход и на работу.
 *
 * Сессия — каталог из `TELEGRAM_ACCOUNT_SESSION_DIR`, а не строка в `.env`: так устроен TDLib.
 * Каталог и есть авторизация, поэтому он не в репозитории и обязан попадать в резервную копию.
 */
import { rm } from "node:fs/promises";
import type { Client } from "tdl";
import {
  readAccountIdentity,
  readAuthorizationState,
  sessionPaths,
  type TelegramAccountIdentity
} from "@ticket-platform/messenger-telegram-account";
import { openAccount, reportConnection } from "./bootstrap.js";
import { confirmYes, promptLine, promptSecret } from "./prompts.js";

async function main(): Promise<void> {
  const forget = process.argv.includes("--forget");
  const { client, config } = await openAccount();

  try {
    const state = await readAuthorizationState(client);

    if (state === "authorizationStateReady") {
      if (!forget) {
        console.log("Аккаунт уже авторизован, входить заново не нужно.");
        describe(await readAccountIdentity(client));
        console.log(
          "\nЧтобы войти под другим номером — pnpm account:login --forget."
          + " Это завершит текущую сессию и потребует нового кода."
        );

        return;
      }

      await forgetSession(client, config.sessionDirectory);

      return;
    }

    if (forget) {
      console.log("Забывать нечего: сессии нет, идём обычным входом.");
    }

    console.log(`Состояние авторизации: ${state}`);
    await reportConnection(client);

    console.log(`\nВходим под номером ${config.phone}.`);
    await client.login({
      getPhoneNumber: (retry) => retry === true
        ? Promise.reject(new Error(
            `Telegram не принял номер ${config.phone}.`
            + " Исправьте TELEGRAM_ACCOUNT_PHONE в .env и запустите снова."
          ))
        : Promise.resolve(config.phone),
      getAuthCode: async (retry) => {
        if (retry === true) {
          console.log("Код не подошёл. Обратите внимание: у кода короткий срок жизни.");
        }

        return await promptLine(
          "Код подтверждения (придёт в Telegram на этот номер, при отсутствии сессий — по SMS): "
        );
      },
      getPassword: async (hint, retry) => {
        if (retry === true) {
          console.log("Пароль не подошёл.");
        }
        const suffix = hint === "" ? "" : ` (подсказка: ${hint})`;

        return await promptSecret(`Облачный пароль (двухфакторная защита)${suffix}: `);
      },
      // Регистрация означала бы, что на этом номере аккаунта нет и Telegram предлагает
      // завести новый. Заводить его молча нельзя: скорее всего, в .env просто чужой номер.
      getName: () => Promise.reject(new Error(
        `На номере ${config.phone} нет аккаунта Telegram — вместо входа предложена`
        + " регистрация. Проверьте TELEGRAM_ACCOUNT_PHONE: скорее всего, номер не тот."
      ))
    });

    const identity = await readAccountIdentity(client);
    verifyPhone(identity, config.phone);
    console.log("\nВход выполнен.");
    describe(identity);
    console.log(
      `\nСессия лежит в ${sessionPaths(config.sessionDirectory).databaseDirectory}.`
      + " Этот каталог и есть авторизация: потеряется — понадобится новый код."
    );
    console.log(
      "Дальше по плану: заполнить профиль (имя, аватар, описание) до первого сообщения"
      + " клиенту и не входить с этого номера с телефонов менеджеров."
    );
  } finally {
    if (!client.isClosed()) {
      await client.close();
    }
  }
}

/**
 * Номер, под которым вошли, должен совпасть с настроенным.
 *
 * Перепутанный номер — это не опечатка в конфиге, а разговор клиента с посторонним
 * аккаунтом: панель будет писать от имени одного, а человек увидит другого.
 */
function verifyPhone(identity: TelegramAccountIdentity, expected: string): void {
  const wanted = expected.replace(/^\+/, "");
  if (identity.phone === wanted) {
    return;
  }

  throw new Error(
    `Вошли под номером +${identity.phone}, а в .env указан ${expected}.`
    + " Выйдите (pnpm account:login --forget) и войдите под правильным номером."
  );
}

/**
 * Выход и удаление сессии.
 *
 * Сначала `logOut` и только потом удаление каталога. Наоборот нельзя: удалённый каталог
 * оставляет сессию живой на стороне Telegram, и в списке устройств аккаунта навсегда
 * повисает вход, который никто уже не может завершить.
 */
async function forgetSession(client: Client, sessionDirectory: string): Promise<void> {
  const identity = await readAccountIdentity(client);
  describe(identity);
  console.log(
    `\nБудет выполнен выход и удалён каталог сессии ${sessionDirectory}.`
    + "\nПосле этого войти можно только с кодом на номер, а вся история диалогов,"
    + " уже записанная в нашу базу, останется на месте."
  );
  if (!await confirmYes("Продолжить?")) {
    console.log("Отменено, ничего не изменилось.");

    return;
  }

  await client.invoke({ _: "logOut" });
  await client.close();
  await rm(sessionDirectory, { recursive: true, force: true });
  console.log("Выход выполнен, каталог сессии удалён.");
}

function describe(identity: TelegramAccountIdentity): void {
  const name = [identity.firstName, identity.lastName].filter((part) => part !== "").join(" ");
  console.log(`  аккаунт: ${name === "" ? "без имени" : name}`);
  console.log(`  номер:   +${identity.phone}`);
  console.log(`  ник:     ${identity.username === null ? "не задан" : `@${identity.username}`}`);
  console.log(`  id:      ${identity.userId}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
