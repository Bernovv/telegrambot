/**
 * Есть ли этот человек в WhatsApp — по номеру телефона.
 *
 *   pnpm wa:whois +79001234567
 *
 * Две работы сразу. Первая — проверка канала: вызов отвечает, значит сессия живая и прокси
 * работает. Вторая — то, ради чего аккаунт и нужен: **узнать, можно ли написать первым.**
 * Заявка с сайта и заявка из Звонобота приносят телефон, а не ник; здесь по телефону сразу
 * видно, дойдёт ли до человека сообщение.
 *
 * Сверять идентификаторы, как в MAX, здесь не нужно: адрес человека в WhatsApp и есть его
 * номер, а по номеру карточка находится сама.
 */
import { openAccount, waitForState } from "./bootstrap.js";

const TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const phone = (process.argv[2] ?? "").trim();
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
    throw new Error("Нужен номер телефона: pnpm wa:whois +79001234567");
  }

  const { client } = await openAccount();
  try {
    const { state, reason } = await waitForState(client, ["ready", "logged_out"], TIMEOUT_MS);
    if (state !== "ready") {
      throw new Error(
        `Канал не на связи${reason === null ? "" : `: ${reason}`}. Сначала pnpm wa:status.`
      );
    }

    const found = await client.lookupPhone(phone);
    if (found === null || !found.exists) {
      console.log(`По номеру ${phone} в WhatsApp никого не нашлось.`);
      console.log(
        "Это нормальный ответ: у человека может не быть WhatsApp либо номер записан с"
        + " ошибкой. Написать первым такому нельзя — остаётся звонок, Telegram или MAX."
      );
      process.exitCode = 1;

      return;
    }

    console.log(`Есть в WhatsApp: ${found.jid}`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
