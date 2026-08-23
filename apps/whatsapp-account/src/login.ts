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
import {
  describeState,
  openAccount,
  requireAccountConfig,
  waitForPairingReady,
  waitForState
} from "./bootstrap.js";

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
    // Состояние вслух: привязка идёт минуту-другую, и всё это время человек у терминала
    // должен видеть, что происходит, а не гадать, живо ли ещё соединение.
    client.onState((state, reason) => {
      console.log(`  · ${describeState(state)}${reason === null ? "" : `: ${reason}`}`);
    });

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

    // Ждём, пока сервер сам предложит привязаться. Именно этот момент, а не «сокет открыт»:
    // до него рукопожатие ещё идёт, и запрос кода падает с «Connection Closed» — так и
    // случилось при первой попытке.
    console.log("\nСоединяемся с WhatsApp через прокси…");
    const pairing = await waitForPairingReady(client, CONNECT_TIMEOUT_MS);
    if (!pairing.ready) {
      throw new Error(
        `Соединение не дошло до привязки${pairing.reason === null ? "" : `: ${pairing.reason}`}.`
        + "\n\nЧто посмотреть по порядку:"
        + "\n  1. Прокси пускает до WhatsApp:"
        + "\n     curl -x <WHATSAPP_ACCOUNT_PROXY> -o /dev/null -sS -w '%{http_code}\\n'"
        + " https://web.whatsapp.com"
        + "\n  2. Подробности протокола — там видно, на чём именно сервер закрывает связь:"
        + "\n     WHATSAPP_ACCOUNT_DEBUG=1 pnpm wa:login"
        + "\n  3. Имя устройства латиницей: WHATSAPP_ACCOUNT_DEVICE_NAME=Chrome в .env."
        + " Кириллица в имени — известный подозреваемый, проверяется одной правкой."
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
