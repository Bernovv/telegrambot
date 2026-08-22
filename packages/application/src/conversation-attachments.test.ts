import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DownloadConversationAttachmentsBatchService,
  type AttachmentDownloadRepository,
  type AttachmentSource,
  type AttachmentStorage,
  type PendingAttachment,
  type StoredAttachment
} from "./conversation-attachments.js";

const options = { maxAttempts: 3, retryDelayMs: 60_000, maxBytes: 1_000 };
const at = new Date("2026-08-23T12:00:00.000Z");

function pending(overrides: Partial<PendingAttachment> = {}): PendingAttachment {
  return {
    id: "attachment-1",
    channel: "telegram",
    kind: "voice",
    fileName: null,
    mimeType: "audio/ogg",
    externalFileId: "AgAD-voice",
    attempts: 0,
    ...overrides
  };
}

class Repository implements AttachmentDownloadRepository {
  stored: { readonly attachmentId: string; readonly stored: StoredAttachment }[] = [];
  failures: {
    readonly attachmentId: string;
    readonly reason: string;
    readonly retryAt: Date | null;
  }[] = [];

  constructor(private readonly queue: readonly PendingAttachment[]) {}

  async claimPending() {
    return this.queue;
  }

  async markStored(input: { readonly attachmentId: string; readonly stored: StoredAttachment }) {
    this.stored.push({ attachmentId: input.attachmentId, stored: input.stored });
  }

  async markAttemptFailed(input: {
    readonly attachmentId: string;
    readonly reason: string;
    readonly retryAt: Date | null;
  }) {
    this.failures.push({
      attachmentId: input.attachmentId,
      reason: input.reason,
      retryAt: input.retryAt
    });
  }
}

const storage: AttachmentStorage = {
  async save(input) {
    return {
      storagePath: `2026/08/${input.attachmentId}.ogg`,
      sha256: "a".repeat(64),
      sizeBytes: input.bytes.byteLength
    };
  }
};

function source(
  download: AttachmentSource["download"]
): Partial<Record<PendingAttachment["channel"], AttachmentSource>> {
  return { telegram: { download } };
}

describe("скачивание вложений", () => {
  it("кладёт файл к себе и запоминает путь, размер и контрольную сумму", async () => {
    const repository = new Repository([pending()]);
    const service = new DownloadConversationAttachmentsBatchService(
      repository,
      source(async () => ({ bytes: new Uint8Array([1, 2, 3]), fileName: "file_1.ogg" })),
      storage,
      options
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.deepEqual(result, { claimed: 1, stored: 1, retried: 0, failed: 0 });
    assert.equal(repository.stored[0]?.stored.sizeBytes, 3);
  });

  it("сетевая заминка — это повтор с растущей паузой, а не крест на файле", async () => {
    // Первая попытка: пауза базовая. Вторая: вдвое больше. Ломиться в моргнувший
    // мессенджер с прежней частотой — верный способ получить блокировку бота.
    const first = new Repository([pending({ attempts: 0 })]);
    const second = new Repository([pending({ attempts: 1 })]);
    const failing: AttachmentSource["download"] = () => {
      throw new Error("сеть недоступна");
    };

    await new DownloadConversationAttachmentsBatchService(
      first, source(failing), storage, options
    ).execute({ at, batchSize: 10 });
    await new DownloadConversationAttachmentsBatchService(
      second, source(failing), storage, options
    ).execute({ at, batchSize: 10 });

    assert.equal(
      first.failures[0]?.retryAt?.getTime(),
      at.getTime() + 60_000
    );
    assert.equal(
      second.failures[0]?.retryAt?.getTime(),
      at.getTime() + 120_000
    );
  });

  it("на последней попытке ставит крест — и записывает, почему", async () => {
    // Файл остаётся человеку: по строке с причиной видно, что забирать руками, пока он
    // ещё жив у мессенджера.
    const repository = new Repository([pending({ attempts: 2 })]);
    const service = new DownloadConversationAttachmentsBatchService(
      repository,
      source(() => {
        throw new Error("сеть недоступна");
      }),
      storage,
      options
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.equal(result.failed, 1);
    assert.equal(repository.failures[0]?.retryAt, null);
    assert.equal(repository.failures[0]?.reason, "сеть недоступна");
  });

  it("файл, которого канал не отдаёт, повторять не пытается", async () => {
    // `null` от загрузчика — это не сбой сети: у Telegram истёк путь, у MAX вложение
    // приехало без ссылки. Повтор дал бы ровно тот же ответ.
    const repository = new Repository([pending()]);
    const service = new DownloadConversationAttachmentsBatchService(
      repository, source(async () => null), storage, options
    );

    await service.execute({ at, batchSize: 10 });

    assert.equal(repository.failures[0]?.retryAt, null);
    assert.match(repository.failures[0]?.reason ?? "", /не отдаёт/);
  });

  it("слишком большой файл на диск не пускает", async () => {
    const repository = new Repository([pending()]);
    const service = new DownloadConversationAttachmentsBatchService(
      repository,
      source(async () => ({ bytes: new Uint8Array(2_000), fileName: null })),
      storage,
      options
    );

    await service.execute({ at, batchSize: 10 });

    assert.equal(repository.stored.length, 0);
    assert.match(repository.failures[0]?.reason ?? "", /больше предела/);
  });

  it("канал без загрузчика — наша ненастроенность, и повторять её бессмысленно", async () => {
    const repository = new Repository([pending({ channel: "max" })]);
    const service = new DownloadConversationAttachmentsBatchService(
      repository,
      source(async () => ({ bytes: new Uint8Array([1]), fileName: null })),
      storage,
      options
    );

    await service.execute({ at, batchSize: 10 });

    assert.equal(repository.failures[0]?.retryAt, null);
    assert.match(repository.failures[0]?.reason ?? "", /нет загрузчика/);
  });

  it("неудача одного вложения не отменяет остальные", async () => {
    const repository = new Repository([
      pending({ id: "a" }),
      pending({ id: "b", externalFileId: null }),
      pending({ id: "c" })
    ]);
    const service = new DownloadConversationAttachmentsBatchService(
      repository,
      source(async () => ({ bytes: new Uint8Array([1]), fileName: null })),
      storage,
      options
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.deepEqual(result, { claimed: 3, stored: 2, retried: 0, failed: 1 });
  });
});
