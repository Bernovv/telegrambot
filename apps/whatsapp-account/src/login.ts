/**
 * Разовая привязка аккаунта компании в WhatsApp.
 *
 *   pnpm wa:login   — получить код и ввести его на телефоне
 *
 * Запускается руками и **на том же сервере**, где канал будет работать: сессия привязывается
 * к тому адресу, с которого её открыли, и вход с ноутбука с последующей работой из
 * Амстердама — лишний повод для их антифрода приглядеться к аккаунту.
 *
 * Кодом, а не QR. WhatsApp умеет оба способа, но QR пришлось бы рисовать в терминале и
 * сканировать с экрана по ssh; код из восьми символов вводится на телефоне и работает
 * одинаково откуда угодно.
 *
 * Сессия остаётся в каталоге `WHATSAPP_ACCOUNT_SESSION_DIR`. Это не строка в `.env`, как у
 * MAX: там лежат сигнальные ключи, они меняются после каждого сообщения, и **каталог надо
 * резервировать** — его потеря означает новую привязку с телефоном в руках.
 */
import { describeState, openAccount, requireAccountConfig, waitForState } from "./bootstrap.js";

/** Сколько ждать соединения, прежде чем признать, что дело в прокси. */
const CONNECT_TIMEOUT_MS = 60_000;

/** Код живёт недолго; после этого запускают скрипт заново. */
const PAIRING_WINDOW_MS = 5 * 60_000;

async function main(): Promise<void> {
  const config = requireAccountConfig();
  console.log(`Каталог сессии: ${config.sessionDir}`);
  console.log(`Прокси: ${config.proxyUrl === null ? "не задан — идём напрямую" : "задан"}`);

  const { client } = await openAccount();
  try {
    if (client.isRegistered()) {
      const state = await waitForState(client, ["ready", "logged_out"], CONNECT_TIMEOUT_MS);
      console.log(`\nПривязка уже есть: ${describeState(state.state)}.`);
      const self = client.self();
      if (self !== null) {
        console.log(`  номер: +${self.phone}`);
      }
      console.log(
        "\nЧтобы привязать другой номер: остановить процесс, удалить каталог сессии"
        + " и запустить вход заново."
      );

      return;
    }

    // Код запрашивается после того, как соединение поднялось: до этого запрашивать нечего,
    // и ошибка выглядела бы как отказ WhatsApp, а не как неподнявшийся прокси.
    const connected = await waitForState(client, ["connecting"], CONNECT_TIMEOUT_MS);
    if (connected.state !== "connecting") {
      throw new Error(
        `Соединиться не удалось: ${connected.reason ?? "нет ответа"}.`
        + " Первым делом проверьте прокси: curl -x <WHATSAPP_ACCOUNT_PROXY> https://api.ipify.org"
      );
    }

    const code = await client.requestPairingCode();
    console.log(`\nКод привязки: ${format(code)}`);
    console.log("\nНа телефоне с этим номером:");
    console.log("  WhatsApp → Настройки → Связанные устройства → Привязка устройства");
    console.log("  → «Привязать по номеру телефона» → ввести код.");
    console.log("\nЖдём подтверждения…");

    const linked = await waitForState(client, ["ready", "logged_out"], PAIRING_WINDOW_MS);
    if (linked.state !== "ready") {
      throw new Error(
        `Привязка не состоялась: ${describeState(linked.state)}.`
        + " Код живёт несколько минут — запустите вход заново."
      );
    }

    const self = client.self();
    console.log("\nГотово.");
    console.log(`  номер: +${self?.phone ?? "неизвестен"}`);
    console.log(`  адрес: ${self?.jid ?? "неизвестен"}`);
    console.log(
      "\nДальше: заполнить профиль (имя, аватар) до первого сообщения клиенту,"
      + " сделать резервную копию каталога сессии и запустить процесс:"
      + "\n  pm2 start deploy/run-whatsapp-account.sh --name whatsapp-account --cwd ~/telegrambot"
    );
    console.log(
      "\nИ правило эксплуатации, которое легко забыть: телефон с этим номером должен"
      + " выходить в сеть хотя бы раз в неделю. Связанное устройство живёт без него около"
      + " двух недель, дальше отвязывается — и всё это придётся повторить."
    );
  } finally {
    await client.close();
  }
}

/** Код читают с экрана и набирают на телефоне: половинками ошибиться труднее. */
function format(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
