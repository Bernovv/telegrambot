import type { AttachmentKind, ConversationReplySender } from "@ticket-platform/application";
import type { WhatsAppSocket } from "./socket.js";

/**
 * Ответ менеджера, ушедший от имени аккаунта компании.
 *
 * Единственный канал из трёх, где **отправляется всё**: и картинка, и документ, и голосовое.
 * У бота MAX документов нет вовсе, у аккаунта MAX загрузка файла требует ждать отдельного
 * события «файл готов» и потому отложена; здесь же всё это умеет библиотека, и притворяться
 * ограниченными незачем.
 *
 * Порядок и паузы — забота очереди, а не отправителя: она шлёт по одному и с разбросом.
 * Прямой вызов отсюда из панели был бы первым же массовым порывом менеджера, который для
 * антиспама выглядит как рассылка.
 */

/** Предел текста у WhatsApp. Тот же, что стоит в панели. */
const TEXT_LIMIT = 4_000;

export function createWhatsAppAccountReplySender(
  socket: WhatsAppSocket
): ConversationReplySender {
  return {
    async sendText(recipientId, text) {
      return await socket.sendText(recipientId, text.slice(0, TEXT_LIMIT));
    },

    async sendFile(input) {
      return await socket.sendFile({
        jid: input.recipientId,
        bytes: input.bytes,
        fileName: input.fileName,
        mimeType: input.mimeType,
        kind: input.kind,
        caption: input.caption.slice(0, TEXT_LIMIT)
      });
    },

    /**
     * Контакт и геопозицию из панели не отправляют: это не файлы, а собственные виды
     * сообщений со своей структурой. Менеджеру честнее отказать сразу, чем показать
     * доставку, которой не будет.
     */
    supportsFileKind(kind: AttachmentKind): boolean {
      return kind !== "contact" && kind !== "location";
    }
  };
}
