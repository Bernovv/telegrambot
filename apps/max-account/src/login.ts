/**
 * Разовый вход аккаунта компании в MAX.
 *
 *   pnpm max:login            — привязать этот сервер как устройство по QR
 *   pnpm max:login --sms      — старый путь, вход по коду на номер
 *   pnpm max:login --forget   — завершить сессию (после этого нужен новый вход)
 *
 * **Почему по умолчанию QR, а не код.** Вход по коду их антифрод от нашего клиента не
 * принимает: на первый же запрос он отвечает `Captcha validation failed`, то есть
 * отказывается считать нас настоящим клиентом ещё до отправки SMS. Обходить эту проверку мы
 * не будем. Привязка по QR — другой, штатный способ MAX добавить устройство: разрешение
 * даёт человек, который видит в приложении, какое устройство просится, и подтверждает его
 * сам. Путь по коду оставлен под флагом: вдруг у них поменяется.
 *
 * Запускается руками и **на том же сервере**, где аккаунт будет работать: их антифрод
 * смотрит, откуда входили, и вход с одного места с работой из другого — повод попросить
 * аккаунт подтвердить себя.
 *
 * Результат — строка токена. Она и есть авторизация: в отличие от Telegram, где сессия это
 * каталог на диске, здесь всё помещается в одну переменную `.env`.
 */
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { MaxOpcode, type MaxAccountLogin } from "@ticket-platform/messenger-max-account";
import { openAccount, requireAccountConfig } from "./bootstrap.js";
import { confirmYes, promptLine } from "./prompts.js";

const run = promisify(execFile);

async function main(): Promise<void> {
  if (process.argv.includes("--forget")) {
    await forgetSession();

    return;
  }

  const config = requireAccountConfig();
  if (config.token !== null) {
    await describeCurrent();

    return;
  }

  const { client } = await openAccount({ withToken: false });
  try {
    const login = process.argv.includes("--sms")
      ? await loginBySms(client, config.phone)
      : await loginByQr(client);

    console.log("\nВход выполнен.");
    console.log(`  номер: +${login.profile?.phone ?? "неизвестен"}`);
    console.log(`  имя:   ${login.profile?.displayName ?? "не задано"}`);
    console.log(`  id:    ${login.profile?.userId ?? "неизвестен"}`);
    console.log("\nДобавьте в .env одной строкой и поднимите процесс:");
    console.log(`MAX_ACCOUNT_TOKEN=${login.token}`);
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
 * Привязка устройства по QR.
 *
 * Человеку нужно показать ссылку кодом — камера в приложении читает именно код, а не текст.
 * Рисуем его тут же в терминале через `qrencode`, если он есть на машине; нет — печатаем
 * ссылку и говорим, чем её превратить в код. Ссылку никуда наружу не отправляем: это
 * одноразовый ключ к аккаунту, и чужому сервису его показывать нельзя.
 */
async function loginByQr(
  client: Awaited<ReturnType<typeof openAccount>>["client"]
): Promise<MaxAccountLogin> {
  const request = await client.requestQr();

  console.log("Откройте MAX на телефоне: Настройки → Устройства → Привязать устройство.");
  console.log("Затем считайте код:\n");
  console.log(await renderQr(request.link));
  console.log(`Если код не читается, ссылка целиком:\n  ${request.link}\n`);

  const deadline = request.expiresAt > Date.now()
    ? request.expiresAt
    : Date.now() + 120_000;
  process.stdout.write("Ждём подтверждения в приложении");
  while (Date.now() < deadline) {
    if (await client.qrConfirmed(request.trackId)) {
      process.stdout.write("\n");

      return await client.confirmQr(request.trackId);
    }
    process.stdout.write(".");
    await delay(Math.max(request.pollIntervalMs, 1_000));
  }
  process.stdout.write("\n");

  throw new Error(
    "Код истёк, подтверждения не было. Запустите pnpm max:login снова —"
    + " код живёт около двух минут."
  );
}

/**
 * Старый путь: код на номер. Сегодня их антифрод его от нас не принимает, и сообщение об
 * этом должно быть внятным — иначе следующий человек будет искать поломку у нас.
 */
async function loginBySms(
  client: Awaited<ReturnType<typeof openAccount>>["client"],
  phone: string
): Promise<MaxAccountLogin> {
  console.log(`Входим по коду под номером ${phone}.`);
  try {
    const codeToken = await client.requestCode(phone);
    console.log("Код отправлен. Приходит в приложение MAX, а при его отсутствии — по SMS.");
    const code = await promptLine("Код подтверждения: ");

    return await client.submitCode(codeToken, code);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("captcha")) {
      throw new Error(
        "MAX требует капчу и вход по коду не принимает — это их защита от"
        + " автоматических клиентов, а не поломка у нас. Обходить её мы не будем;"
        + " войдите привязкой устройства: pnpm max:login (без --sms)."
      );
    }
    throw error;
  }
}

async function describeCurrent(): Promise<void> {
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
      + " на месте; чтобы принимать новые, понадобится новая привязка устройства."
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

/** Код в терминал. Рисует `qrencode`; нет его — обходимся ссылкой, это не повод падать. */
async function renderQr(link: string): Promise<string> {
  try {
    const { stdout } = await run("qrencode", ["-t", "ANSIUTF8", "-o", "-", link]);

    return stdout;
  } catch {
    return "  (нарисовать код нечем — поставьте qrencode: apt install -y qrencode)";
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
