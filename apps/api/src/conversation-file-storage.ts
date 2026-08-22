import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  attachmentRelativePath,
  type AttachmentStorage,
  type StoredAttachment
} from "@ticket-platform/application";

/**
 * Вложения переписки на диске — та же папка, что у воркера.
 *
 * Копия у api своя, потому что писать в папку приходится обоим: воркер кладёт входящие,
 * api — то, что менеджер отправляет из панели. Раскладку при этом задаёт общая функция из
 * `application`, и вот её дублировать было бы нельзя: два правила для одной папки означали
 * бы, что посчитать её объём по месяцам больше невозможно.
 *
 * Прежнее описание:
 *
 * Файлы лежат рядом с ботом, как оферта, и это осознанно проще внешнего хранилища: ставить
 * зависимость от чужого сервиса ради голосовых сообщений — менять понятную папку на чужую
 * доступность.
 *
 * Раскладка по годам и месяцам (`2026/08/<id>.ogg`), а не всё в одну папку. Причина
 * житейская: в одной папке с десятками тысяч файлов перестают работать `ls` и любая ручная
 * разборка, а посчитать, сколько места ушло за месяц, становится нечем. Владелец просил
 * смотреть за расходом места — по такой раскладке это один `du -sh`.
 *
 * Имя файла — идентификатор вложения, а не то, как файл назвал отправитель. Присланное имя
 * может быть каким угодно, включая `../../etc/passwd`; расширение берётся из него, но
 * только если оно похоже на расширение.
 */
export class FileSystemAttachmentStorage implements AttachmentStorage {
  constructor(private readonly rootDir: string) {}

  async save(input: {
    readonly attachmentId: string;
    readonly bytes: Uint8Array;
    readonly fileName: string | null;
    readonly mimeType: string | null;
  }): Promise<StoredAttachment> {
    // Раскладку задаёт общая функция: ту же папку наполняет api, когда менеджер отправляет
    // файл из панели, и два правила для одной папки означали бы, что посчитать её объём
    // по месяцам больше нельзя.
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
