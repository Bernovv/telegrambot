/**
 * Подписка бота MAX на наш вебхук.
 *
 * Запускается руками при выкладке, а не при каждом старте процесса: подписка живёт на их
 * стороне и переживает перезапуски, а вызов на старте означал бы, что случайно поднятая
 * копия приложения перенаправит боевые обновления на себя.
 *
 *   node --env-file=.env --import tsx scripts/max-subscribe.ts
 *   node --env-file=.env --import tsx scripts/max-subscribe.ts --base-url https://…
 *
 * Адрес собирается из `MAX_WEBHOOK_BASE_URL` и `MAX_WEBHOOK_PATH_SECRET` — то есть путь
 * целиком является секретом и в переписку попадать не должен. Хост тот, на который nginx
 * пускает `/webhooks/max/…`, и он не обязан совпадать с адресом телеграмного вебхука:
 * у каналов свои домены, и угадывать один по другому нельзя.
 */
import { MaxApi } from "@ticket-platform/messenger-max";

async function main(): Promise<void> {
  const token = required("MAX_BOT_TOKEN");
  const pathSecret = required("MAX_WEBHOOK_PATH_SECRET");
  const baseUrl = baseUrlFromArgvOrEnv().replace(/\/$/, "");
  const headerSecret = (process.env.MAX_WEBHOOK_SECRET ?? "").trim();

  const api = new MaxApi({
    token,
    ...(process.env.MAX_API_BASE_URL ? { baseUrl: process.env.MAX_API_BASE_URL } : {})
  });
  const url = `${baseUrl}/webhooks/max/${pathSecret}`;

  await api.subscribeWebhook({
    url,
    ...(headerSecret === "" ? {} : { secret: headerSecret })
  });

  // Сам адрес не печатаем: в нём секрет, а вывод скрипта попадает в историю терминала.
  console.log(`Подписка оформлена на ${baseUrl}/webhooks/max/<секрет>`);
  if (headerSecret === "") {
    console.log(
      "MAX_WEBHOOK_SECRET не задан: обновления будут приходить без секрета в заголовке."
    );
  }
}

/**
 * Адрес, на который MAX будет слать обновления.
 *
 * Аргументом или переменной — но обязательно явно. Вывести его из чего-нибудь ещё
 * (например, из адреса телеграмного вебхука) было бы удобно ровно до того дня, когда домены
 * разъедутся и подписка молча уедет не туда.
 */
function baseUrlFromArgvOrEnv(): string {
  const index = process.argv.indexOf("--base-url");
  const fromArgv = index >= 0 ? (process.argv[index + 1] ?? "").trim() : "";
  const fromEnv = (process.env.MAX_WEBHOOK_BASE_URL ?? "").trim();
  const value = fromArgv !== "" ? fromArgv : fromEnv;
  if (!/^https:\/\/[^/]+/.test(value)) {
    throw new Error(
      "Не задан адрес вебхука: MAX_WEBHOOK_BASE_URL в .env или --base-url https://…"
      + " (тот хост, на котором nginx пускает /webhooks/max/…)"
    );
  }
  return value;
}

function required(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") {
    throw new Error(`Не задана переменная окружения ${name}`);
  }
  return value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
