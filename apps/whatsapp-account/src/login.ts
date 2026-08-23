/**
 * Разовая привязка аккаунта компании в WhatsApp.
 *
 *   pnpm wa:login            — получить код и ввести его на телефоне
 *   pnpm wa:login --reset    — стереть сессию и привязаться заново, с нуля
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
import type {
  WhatsAppAccountClient,
  WhatsAppConnectionState
} from "@ticket-platform/messenger-whatsapp-account";
import {
  describeState,
  openAccount,
  requireAccountConfig,
  resetSession,
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

  if (process.argv.includes("--reset")) {
    const removed = await resetSession(config.sessionDir);
    console.log(`Сессия стёрта: убрано файлов — ${String(removed)}.`);
  }

  const opened = await openAccount();
  let client = opened.client;
  try {
    client.onState(printState);

    if (client.isRegistered()) {
      await describeExistingSession(client);

      return;
    }

    // Ждём, пока сервер сам предложит привязаться. Именно этот момент, а не «сокет открыт»:
    // до него рукопожатие ещё идёт, и запрос кода падает с «Connection Closed».
    console.log("\nСоединяемся с WhatsApp через прокси…");
    let pairing = await waitForPairingReady(client, CONNECT_TIMEOUT_MS);

    // Отказ «сессия недействительна» на непривязанном аккаунте означает ровно одно: в
    // каталоге лежат ключи от прошлой неудачной попытки, и WhatsApp их больше не признаёт.
    // Терять там нечего — привязка так и не состоялась, — поэтому стираем и пробуем ещё раз
    // с чистой личностью. Спрашивать об этом человека незачем: другого выхода всё равно нет,
    // а на второй попытке он уже будет с телефоном в руках.
    if (!pairing.ready && pairing.state === "logged_out") {
      console.log(
        "\nWhatsApp отверг сессию из каталога — она осталась от прошлой попытки."
        + " Стираем и соединяемся с чистой."
      );
      await client.close();
      console.log(`  убрано файлов: ${String(await resetSession(config.sessionDir))}`);

      client = (await openAccount()).client;
      client.onState(printState);
      pairing = await waitForPairingReady(client, CONNECT_TIMEOUT_MS);
    }

    if (!pairing.ready) {
      throw new Error(refusalHelp(pairing.reason));
    }

    await pair(client);
  } finally {
    await client.close();
  }
}

/** Привязка: код на экран, подтверждение на телефоне, ожидание. */
async function pair(client: WhatsAppAccountClient): Promise<void> {
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
}

async function describeExistingSession(client: WhatsAppAccountClient): Promise<void> {
  const state = await waitForState(client, ["ready", "logged_out"], CONNECT_TIMEOUT_MS);
  console.log(`\nПривязка уже есть: ${describeState(state.state)}.`);
  const self = client.self();
  if (self !== null) {
    console.log(`  номер: +${self.phone}`);
  }
  if (state.state === "ready") {
    console.log("\nЧтобы привязать другой номер: pnpm wa:login --reset.");

    return;
  }
  console.log(
    "\nСессия больше не годится — устройство отвязали со стороны телефона либо её отверг"
    + " WhatsApp. Привязаться заново: pnpm wa:login --reset."
  );
}

function printState(state: WhatsAppConnectionState, reason: string | null): void {
  console.log(`  · ${describeState(state)}${reason === null ? "" : ` — ${reason}`}`);
}

function refusalHelp(reason: string | null): string {
  return `Соединение не дошло до привязки${reason === null ? "" : `: ${reason}`}.`
    + "\n\nЧто посмотреть по порядку:"
    + "\n  1. Прокси пускает до WhatsApp:"
    + "\n     curl -x <WHATSAPP_ACCOUNT_PROXY> -o /dev/null -sS -w '%{http_code}\\n'"
    + " https://web.whatsapp.com"
    + "\n  2. Подробности протокола — там видно, на чём именно сервер закрывает связь:"
    + "\n     WHATSAPP_ACCOUNT_DEBUG=1 pnpm wa:login"
    + "\n  3. Имя устройства латиницей: WHATSAPP_ACCOUNT_DEVICE_NAME=Chrome в .env."
    + " Кириллица в имени — известный подозреваемый, проверяется одной правкой.";
}

/** Код читают с экрана и набирают на телефоне: половинками ошибиться труднее. */
function format(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
