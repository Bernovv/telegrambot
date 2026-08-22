import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AttachmentStorage, StoredAttachment } from "@ticket-platform/application";

/**
 * Вложения переписки на диске.
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
    const now = new Date();
    const folder = join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0")
    );
    await mkdir(join(this.rootDir, folder), { recursive: true });

    const name = `${input.attachmentId}${extensionOf(input.fileName, input.mimeType)}`;
    const relativePath = join(folder, name);
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

/** Расширение из имени файла, а если его нет — из типа содержимого. */
function extensionOf(fileName: string | null, mimeType: string | null): string {
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(fileName ?? "");
  if (fromName?.[1]) {
    return `.${fromName[1].toLowerCase()}`;
  }
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "audio/ogg":
      return ".ogg";
    case "video/mp4":
      return ".mp4";
    case "application/pdf":
      return ".pdf";
    default:
      // Без расширения файл всё равно откроется — по содержимому. Придумывать ему
      // расширение наугад хуже: `.bin` у голосового сообщения только собьёт с толку.
      return "";
  }
}
