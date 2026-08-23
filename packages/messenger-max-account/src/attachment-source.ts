import type {
  AttachmentBytes,
  AttachmentSource,
  PendingAttachment
} from "@ticket-platform/application";
import { MaxOpcode } from "./protocol.js";
import type { MaxAccountInvoker } from "./directory.js";

/**
 * Скачивание вложений аккаунта.
 *
 * У MAX два разных вложения с точки зрения скачивания, и это видно прямо в опознавателе:
 *
 * - **ссылка** — картинки и часть аудио приезжают с готовым адресом. Забираем обычным
 *   запросом, как это делает воркер для бота;
 * - **`max-file:чат:сообщение:файл`** — у файла адреса нет вовсе, его нужно спросить, и
 *   спросить может только тот, у кого открыта сессия аккаунта. Отсюда своя очередь
 *   скачивания, отобранная по каналу, и этот загрузчик.
 *
 * Вложение, для которого адреса не добыть, честно возвращает `null`: служба пометит его
 * неудачей с причиной. Это правильнее, чем тихо считать файл сохранённым — в базе
 * останется строка, по которой видно, что забрать не удалось.
 */
export function createMaxAccountAttachmentSource(
  client: MaxAccountInvoker,
  options: { readonly timeoutMs?: number } = {}
): AttachmentSource {
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    async download(attachment: PendingAttachment): Promise<AttachmentBytes | null> {
      const reference = attachment.externalFileId;
      if (reference === null || reference === "") {
        return null;
      }

      const url = reference.startsWith("max-file:")
        ? await requestFileUrl(client, reference)
        : reference;
      if (url === null || !/^https?:\/\//.test(url)) {
        return null;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`MAX отдал файл с кодом ${String(response.status)}`);
        }

        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          fileName: attachment.fileName
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

/**
 * Ссылка на файл живёт недолго и выдаётся по трём числам сразу: чат, сообщение и файл.
 * Поэтому она и спрашивается в момент скачивания, а не записывается при приёме — записанная
 * вчера, сегодня она уже никуда не ведёт.
 */
async function requestFileUrl(
  client: MaxAccountInvoker,
  reference: string
): Promise<string | null> {
  const [, chatId, messageId, fileId] = reference.split(":");
  if (chatId === undefined || messageId === undefined || fileId === undefined) {
    return null;
  }

  const frame = await client.invoke(MaxOpcode.fileDownload, {
    chatId: Number(chatId),
    messageId,
    fileId: Number(fileId)
  });
  const url = frame.payload?.["url"];

  return typeof url === "string" && url !== "" ? url : null;
}
