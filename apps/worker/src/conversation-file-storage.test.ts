import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FileSystemAttachmentStorage } from "./conversation-file-storage.js";

async function storage(): Promise<{
  readonly root: string;
  readonly instance: FileSystemAttachmentStorage;
}> {
  const root = await mkdtemp(join(tmpdir(), "conversation-files-"));
  return { root, instance: new FileSystemAttachmentStorage(root) };
}

describe("вложения на диске", () => {
  it("раскладывает по годам и месяцам и возвращает путь внутри папки", async () => {
    // Путь в базе относительный: папку переносят, а абсолютный путь пережил бы переезд
    // ровно до первого открытия файла.
    const { root, instance } = await storage();

    const saved = await instance.save({
      attachmentId: "11111111-1111-4111-8111-111111111111",
      bytes: new Uint8Array([1, 2, 3, 4]),
      fileName: "voice.ogg",
      mimeType: "audio/ogg"
    });

    assert.match(saved.storagePath, /^\d{4}\/\d{2}\/11111111-1111-4111-8111-111111111111\.ogg$/);
    assert.equal(saved.sizeBytes, 4);
    assert.deepEqual(
      new Uint8Array(await readFile(join(root, saved.storagePath))),
      new Uint8Array([1, 2, 3, 4])
    );
  });

  it("именем файла считает наш идентификатор, а не присланное отправителем", async () => {
    // Присланное имя может быть каким угодно, включая путь наружу из папки.
    const { instance } = await storage();

    const saved = await instance.save({
      attachmentId: "22222222-2222-4222-8222-222222222222",
      bytes: new Uint8Array([1]),
      fileName: "../../etc/passwd",
      mimeType: null
    });

    assert.match(saved.storagePath, /22222222-2222-4222-8222-222222222222$/);
    assert.doesNotMatch(saved.storagePath, /\.\./);
  });

  it("расширение берёт из типа содержимого, когда имени нет", async () => {
    const { instance } = await storage();

    const saved = await instance.save({
      attachmentId: "33333333-3333-4333-8333-333333333333",
      bytes: new Uint8Array([1]),
      fileName: null,
      mimeType: "image/jpeg"
    });

    assert.match(saved.storagePath, /\.jpg$/);
  });

  it("считает контрольную сумму содержимого", async () => {
    // Пустой sha256 — известная константа, и по ней видно, что считается именно содержимое.
    const { instance } = await storage();

    const saved = await instance.save({
      attachmentId: "44444444-4444-4444-8444-444444444444",
      bytes: new Uint8Array(),
      fileName: null,
      mimeType: null
    });

    assert.equal(
      saved.sha256,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});
