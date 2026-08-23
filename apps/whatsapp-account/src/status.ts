/**
 * Что сейчас с аккаунтом компании в WhatsApp: есть ли привязка, есть ли связь, кто мы.
 *
 *   pnpm wa:status
 *
 * Нужен ровно для одного вопроса — «канал живой?». По журналам ответа на него нет: соединение
 * рвётся молча, и тишина в переписке выглядит одинаково при обрыве и при отсутствии писем.
 *
 * **Запускать только при остановленном процессе.** Скрипт открывает своё соединение по тому
 * же каталогу сессии, а две программы, пишущие одни и те же сигнальные ключи, портят их.
 */
import { openAccount, waitForOutcome } from "./bootstrap.js";

const TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const { client, config } = await openAccount();
  try {
    // Ответ даёт соединение, а не каталог. По файлам сессии «привязаны ли» не понять:
    // после привязки картинкой WhatsApp не помечает её зарегистрированной, и рабочий
    // аккаунт выглядел бы непривязанным.
    const outcome = await waitForOutcome(client, TIMEOUT_MS);
    const self = client.self();

    console.log(`Номер: +${self?.phone ?? config.phone}`);
    console.log(`Устройство: ${config.deviceName}`);
    console.log(`Каталог сессии: ${config.sessionDir}`);
    console.log(`Прокси: ${config.proxyUrl === null ? "не задан" : "задан"}`);

    if (outcome.kind === "linked") {
      console.log("Состояние: на связи");

      return;
    }

    if (outcome.kind === "pairing") {
      console.log("Состояние: привязки нет — WhatsApp предлагает привязать устройство");
      console.log("Привязать: pnpm wa:login на этом же сервере, с телефоном под рукой.");
      process.exitCode = 1;

      return;
    }

    console.log(
      `Состояние: связи нет${outcome.reason === null ? "" : ` (${outcome.reason})`}`
    );
    if (outcome.state === "logged_out") {
      console.log(
        "Сессию отвергли — устройство отвязали со стороны телефона либо она испорчена."
        + " Привязаться заново: pnpm wa:login --reset."
      );
    } else {
      // Первое, что стоит проверить при любом «связи нет»: до WhatsApp с этого сервера
      // напрямую хода нет, и молчание чаще всего означает именно прокси.
      console.log(
        "Проверьте прокси: curl -x <WHATSAPP_ACCOUNT_PROXY> https://api.ipify.org"
        + " — должен ответить адресом амстердамской машины."
      );
    }
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
