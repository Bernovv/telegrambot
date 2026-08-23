/**
 * Разовый вход аккаунта компании в MAX.
 *
 *   pnpm max:login            — войти по коду и получить постоянный токен
 *   pnpm max:login --forget   — завершить сессию (после этого нужен новый вход)
 *
 * Запускается руками и **на том же сервере**, где аккаунт будет работать. Это не
 * формальность: их антифрод смотрит, откуда входили, и вход с ноутбука с последующей
 * работой из другого места — ровно тот признак, из-за которого аккаунт просят подтвердить
 * себя, а в плохом случае ограничивают.
 *
 * Результат входа — строка токена. Она и есть авторизация: в отличие от Telegram, где
 * сессия это каталог на диске, здесь всё помещается в одну переменную `.env`. Отсюда и
 * обращение с ней как с паролем: на экран печатается один раз, в журналы не попадает.
 */
import { MaxOpcode } from "@ticket-platform/messenger-max-account";
import { openAccount, requireAccountConfig } from "./bootstrap.js";
import { confirmYes, promptLine } from "./prompts.js";

async function main(): Promise<void> {
  const forget = process.argv.includes("--forget");
  const config = requireAccountConfig();

  if (forget) {
    await forgetSession();

    return;
  }

  if (config.token !== null) {
    const { client } = await openAccount();
    try {
      const profile = client.currentProfile();
      console.log("Аккаунт уже авторизован, входить заново не нужно.");
      console.log(`  номер: +${profile?.phone ?? "неизвестен"}`);
      console.log(`  имя:   ${profile?.displayName ?? "не задано"}`);
      console.log(`  id:    ${profile?.userId ?? "неизвестен"}`);
      console.log(
        "\nЧтобы войти под другим номером — pnpm max:login --forget,"
        + " затем убрать MAX_ACCOUNT_TOKEN из .env и войти заново."
      );
    } finally {
      await client.close();
    }

    return;
  }

  const { client } = await openAccount({ withToken: false });
  try {
    console.log(`Входим под номером ${config.phone}.`);
    const codeToken = await client.requestCode(config.phone);
    console.log("Код отправлен. Он приходит в приложение MAX, а при его отсутствии — по SMS.");

    const code = await promptLine("Код подтверждения: ");
    const { token, profile } = await client.submitCode(codeToken, code);

    console.log("\nВход выполнен.");
    console.log(`  номер: +${profile?.phone ?? "неизвестен"}`);
    console.log(`  имя:   ${profile?.displayName ?? "не задано"}`);
    console.log(`  id:    ${profile?.userId ?? "неизвестен"}`);
    console.log("\nДобавьте в .env одной строкой и перезапустите процесс:");
    console.log(`MAX_ACCOUNT_TOKEN=${token}`);
    console.log(
      "\nЭто полный доступ к переписке: хранить только в .env, в журналы и в переписку"
      + " не копировать. Дальше по плану — заполнить профиль (имя, аватар) до первого"
      + " сообщения клиенту и не входить с этого номера с телефонов менеджеров."
    );
  } finally {
    await client.close();
  }
}

/**
 * Завершение сессии.
 *
 * Сначала выход на их стороне и только потом чистка `.env` руками. Наоборот нельзя:
 * забытый токен оставляет сессию живой, и в списке устройств аккаунта навсегда повисает
 * вход, который никто уже не может завершить.
 */
async function forgetSession(): Promise<void> {
  const { client } = await openAccount();
  try {
    const profile = client.currentProfile();
    console.log(`Сейчас вошли под +${profile?.phone ?? "неизвестно"}.`);
    console.log(
      "Будет выполнен выход. Вся история диалогов, уже записанная в нашу базу, останется"
      + " на месте; чтобы принимать новые, понадобится новый вход по коду."
    );
    if (!await confirmYes("Продолжить?")) {
      console.log("Отменено, ничего не изменилось.");

      return;
    }

    await client.invoke(MaxOpcode.logout, {});
    console.log("Выход выполнен. Уберите MAX_ACCOUNT_TOKEN из .env.");
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
