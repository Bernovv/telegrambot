/**
 * Что сейчас с аккаунтом компании в WhatsApp: есть ли привязка, есть ли связь, кто мы.
 *
 *   pnpm wa:status
 *
 * Нужен ровно для одного вопроса — «канал живой?». По журналам ответа на него нет: соединение
 * рвётся молча, и тишина в переписке выглядит одинаково при обрыве и при отсутствии писем.
 */
import { describeState, openAccount, waitForState } from "./bootstrap.js";

const TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const { client, config } = await openAccount();
  try {
    if (!client.isRegistered()) {
      console.log("Привязки нет: каталог сессии пуст.");
      console.log("Привязать: pnpm wa:login на этом же сервере, с телефоном под рукой.");
      process.exitCode = 1;

      return;
    }

    const { state, reason } = await waitForState(client, ["ready", "logged_out"], TIMEOUT_MS);
    const self = client.self();

    console.log(`Состояние: ${describeState(state)}${reason === null ? "" : ` (${reason})`}`);
    console.log(`Номер: +${self?.phone ?? config.phone}`);
    console.log(`Устройство: ${config.deviceName}`);
    console.log(`Каталог сессии: ${config.sessionDir}`);
    console.log(`Прокси: ${config.proxyUrl === null ? "не задан" : "задан"}`);

    if (state !== "ready") {
      // Первое, что стоит проверить при любом «связи нет»: до WhatsApp с этого сервера
      // напрямую хода нет, и молчание чаще всего означает именно прокси.
      console.log(
        "\nПроверьте прокси: curl -x <WHATSAPP_ACCOUNT_PROXY> https://api.ipify.org"
        + " — должен ответить адресом амстердамской машины."
      );
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
