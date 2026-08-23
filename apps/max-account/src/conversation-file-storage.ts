import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  attachmentRelativePath,
  type AttachmentReader,
  type AttachmentStorage,
  type StoredAttachment
} from "@ticket-platform/application";

/**
 * Вложения переписки на диске — та же папка, что у воркера и api.
 *
 * Четвёртая копия этого класса, и она такая же намеренная, как предыдущие: писать в папку
 * приходится четырём процессам — воркер кладёт входящие ботов, api кладёт то, что менеджер
 * отправил из панели, а два процесса аккаунтов кладут свои входящие. Класс на двадцать
 * строк, и вытаскивать его в общий пакет значит завести зависимость приложений от ещё
 * одного пакета ради конструктора с одним полем.
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

/**
 * Чтение файла из папки вложений — для отправки того, что менеджер приложил в панели.
 *
 * Путь берётся из базы и приходит относительным; выход за папку отвергается той же
 * проверкой, что у воркера и api. Строку в базу кладём мы сами, но проверка стоит на день,
 * когда туда попадёт то, чего мы не ждали.
 */
export class FileSystemAttachmentReader implements AttachmentReader {
  constructor(private readonly rootDir: string) {}

  async read(storagePath: string): Promise<Uint8Array> {
    const root = resolve(this.rootDir);
    if (storagePath.trim() === "" || isAbsolute(storagePath)) {
      throw new Error("Путь вложения недопустим");
    }
    const full = resolve(root, storagePath);
    if (full !== root && !full.startsWith(`${root}${sep}`)) {
      throw new Error("Путь вложения ведёт за пределы папки");
    }

    return await readFile(full);
  }
}
