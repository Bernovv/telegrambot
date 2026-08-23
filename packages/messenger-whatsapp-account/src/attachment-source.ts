import type { AttachmentSource } from "@ticket-platform/application";
import type { WhatsAppSocket } from "./socket.js";

/**
 * Откуда берётся файл из переписки.
 *
 * Отличие от двух других каналов принципиальное, и оно вытекает из шифрования. У Telegram и
 * MAX файл лежит у мессенджера и выдаётся по идентификатору: кто спросил, тот и получил. У
 * WhatsApp файл лежит там же, но зашифрованным, а ключ пришёл внутри сообщения и больше
 * нигде не хранится — ни у них, ни у нас, кроме как в `payload` реплики.
 *
 * Поэтому загрузчик читает не идентификатор, а сохранённое сообщение целиком. Это ровно то,
 * ради чего колонка `payload` заводилась: «разбор — второй проход, и он читает эту же
 * строку». Первый случай, когда второй проход ей и воспользовался.
 */
export function createWhatsAppAccountAttachmentSource(
  socket: WhatsAppSocket
): AttachmentSource {
  return {
    async download(attachment) {
      if (attachment.payload === null || attachment.payload === undefined) {
        // Реплики без сохранённого тела быть не может: запись кладёт его всегда. Если она
        // всё-таки пуста — файл потерян навсегда, и честнее сказать это сразу, чем пять раз
        // повторить попытку, которая не может кончиться иначе.
        return null;
      }

      const bytes = await socket.downloadMedia(attachment.payload);

      return { bytes, fileName: attachment.fileName };
    }
  };
}
