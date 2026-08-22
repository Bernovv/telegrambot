import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  attachmentRelativePath,
  type AttachmentStorage,
  type StoredAttachment
} from "@ticket-platform/application";

/**
 * Вложения переписки на диске — та же папка, что у воркера и api.
 *
 * Третья копия этого класса, и она такая же намеренная, как вторая у api: писать в папку
 * приходится трём процессам — воркер кладёт входящие бота, api кладёт то, что менеджер
 * отправил из панели, а этот процесс кладёт входящие аккаунта. Класс на двадцать строк,
 * и вытаскивать его в общий пакет значит завести зависимость приложений от ещё одного
 * пакета ради конструктора с одним полем.
 *
 * **Раскладку при этом задаёт общая функция `attachmentRelativePath` из `application`** —
 * вот её дублировать нельзя. Три правила для одной папки означали бы, что посчитать её
 * объём по месяцам больше невозможно, а владелец просил за этим смотреть.
 */
export class FileSystemAttachmentStorage implements AttachmentStorage {
  constructor(private readonly rootDir: string) {}

  async save(input: {
    readonly attachmentId: string;
    readonly bytes: Uint8Array;
    readonly fileName: string | null;
    readonly mimeType: string | null;
  }): Promise<StoredAttachment> {
    const relativePath = attachmentRelativePath(
      input.attachmentId,
      { fileName: input.fileName, mimeType: input.mimeType },
      new Date()
    );
    await mkdir(join(this.rootDir, dirname(relativePath)), { recursive: true });
    await writeFile(join(this.rootDir, relativePath), input.bytes);

    return {
      // В базе хранится путь внутри папки вложений, а не полный: папку переносят, и
      // абсолютный путь пережил бы такой переезд ровно до первого открытия файла.
      storagePath: relativePath,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      sizeBytes: input.bytes.byteLength
    };
  }
}
