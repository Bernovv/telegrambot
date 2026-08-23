/**
 * Что сейчас с аккаунтом компании в MAX: есть ли вход, есть ли связь, кто мы для них.
 *
 *   pnpm max:status
 *
 * Нужен ровно для одного вопроса — «канал живой?». По журналам ответа на него нет: вебсокет
 * рвётся молча, и тишина в переписке выглядит одинаково при обрыве и при отсутствии писем.
 */
import { describeState, openAccount, requireAccountConfig } from "./bootstrap.js";

async function main(): Promise<void> {
  const config = requireAccountConfig();
  if (config.token === null) {
    console.log("Вход не выполнен: в .env нет MAX_ACCOUNT_TOKEN.");
    console.log("Войти: pnpm max:login на этом же сервере, с телефоном под рукой.");
    process.exitCode = 1;

    return;
  }

  const { client } = await openAccount();
  try {
    const state = client.currentState();
    const profile = client.currentProfile();

    console.log(`Состояние: ${describeState(state)}`);
    console.log(`Аккаунт: ${profile?.displayName ?? "без имени"}, +${profile?.phone ?? "?"}`);
    console.log(`Идентификатор: ${profile?.userId ?? "неизвестен"}`);
    console.log(`Устройство: ${config.deviceName} (${config.deviceId})`);
    console.log(`Адрес: ${config.wsUrl}`);

    if (state !== "ready") {
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
