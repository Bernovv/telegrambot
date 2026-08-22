/// <reference types="@prebuilt-tdlib/types" />
import { readFile } from "node:fs/promises";
import type {
  AttachmentBytes,
  AttachmentSource,
  PendingAttachment
} from "@ticket-platform/application";
import type { Client } from "tdl";

/**
 * Скачивание вложений аккаунта.
 *
 * У бота файл забирают по ссылке Bot API, и это делает воркер. Здесь так нельзя:
 * идентификатор файла у TDLib — **число, живущее внутри сессии**, а не строка, по которой
 * можно постучаться со стороны. Забрать такой файл может только тот процесс, у которого эта
 * сессия открыта, — то есть сам аккаунт. Отсюда своя очередь скачивания, отобранная по
 * транспорту, и этот загрузчик.
 *
 * TDLib кладёт скачанное к себе в каталог сессии. Мы копируем файл в общее хранилище
 * переписки — туда же, куда складывает вложения бот, — и просим TDLib свою копию убрать.
 * Иначе каждое голосовое лежало бы на диске дважды, и вторая копия росла бы молча.
 */
export function createTdlibAttachmentSource(
  client: Pick<Client, "invoke">,
  options: { readonly onCleanupFailure?: (error: unknown) => void } = {}
): AttachmentSource {
  return {
    async download(attachment: PendingAttachment): Promise<AttachmentBytes | null> {
      const fileId = Number(attachment.externalFileId);
      if (!Number.isSafeInteger(fileId) || fileId <= 0) {
        return null;
      }

      const file = await client.invoke({
        _: "downloadFile",
        file_id: fileId,
        priority: 1,
        offset: 0,
        limit: 0,
        // Ждём, пока файл дойдёт целиком. Без этого TDLib отвечает сразу, ещё до
        // скачивания, и мы бы прочитали с диска пустоту, приняв её за файл.
        synchronous: true
      });

      if (!file.local.is_downloading_completed || file.local.path === "") {
        return null;
      }

      const bytes = await readFile(file.local.path);

      // Уборка — не главное дело этого метода. Не вышло убрать — файл всё равно у нас,
      // и терять из-за этого вложение нельзя.
      try {
        await client.invoke({ _: "deleteFile", file_id: fileId });
      } catch (error) {
        options.onCleanupFailure?.(error);
      }

      return { bytes, fileName: attachment.fileName };
    }
  };
}
