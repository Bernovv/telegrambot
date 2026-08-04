import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  StoreAdminBroadcastImageService,
  readImageDescriptor,
  type StoreAdminBroadcastImageInput
} from "./admin-broadcast-image.js";
import type { AdminRequestActor } from "@ticket-platform/contracts";

describe("readImageDescriptor", () => {
  it("читает стороны PNG и JPEG", () => {
    assert.deepEqual(readImageDescriptor(png(1_280, 720)), {
      mimeType: "image/png",
      width: 1_280,
      height: 720
    });
    assert.deepEqual(readImageDescriptor(jpeg(800, 600)), {
      mimeType: "image/jpeg",
      width: 800,
      height: 600
    });
  });

  it("проходит JPEG, у которого перед кадром лежит секция EXIF", () => {
    assert.deepEqual(readImageDescriptor(jpeg(640, 480, true)), {
      mimeType: "image/jpeg",
      width: 640,
      height: 480
    });
  });

  it("отвергает не картинку и картинку, которую не примет Telegram", () => {
    assert.throws(
      () => readImageDescriptor(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])),
      /image format is invalid/
    );
    // Сумма сторон больше 10000.
    assert.throws(() => readImageDescriptor(png(9_000, 9_000)), /dimensions are invalid/);
    // Соотношение круче 1:20 — Telegram такую полосу не принимает.
    assert.throws(() => readImageDescriptor(png(2_000, 50)), /dimensions are invalid/);
  });
});

describe("StoreAdminBroadcastImageService", () => {
  it("сохраняет картинку с разобранными из байтов размерами и типом", async () => {
    const stored: StoreAdminBroadcastImageInput[] = [];
    const service = new StoreAdminBroadcastImageService(
      { async storeImage(input) { stored.push(input); } },
      { newId: () => "019c0123-4567-789a-bcde-f01234567810" }
    );

    const result = await service.execute({
      actor: actor(),
      contentBase64: Buffer.from(png(1_280, 720)).toString("base64")
    });

    assert.deepEqual(result, {
      imageId: "019c0123-4567-789a-bcde-f01234567810",
      mimeType: "image/png",
      byteSize: stored[0]?.byteSize ?? 0,
      width: 1_280,
      height: 720
    });
    assert.equal(stored[0]?.uploadedByAdminId, actor().adminId);
  });

  it("не верит расширению файла: тип определяется по содержимому", async () => {
    const service = new StoreAdminBroadcastImageService(
      { async storeImage() { throw new Error("не должно вызываться"); } },
      { newId: () => "019c0123-4567-789a-bcde-f01234567810" }
    );

    await assert.rejects(
      () => service.execute({
        actor: actor(),
        contentBase64: Buffer.from("x".repeat(200)).toString("base64")
      }),
      /image format is invalid/
    );
  });

  it("отвергает пустое, слишком большое и не base64", async () => {
    const service = new StoreAdminBroadcastImageService(
      { async storeImage() {} },
      { newId: () => "019c0123-4567-789a-bcde-f01234567810" }
    );

    await assert.rejects(
      () => service.execute({ actor: actor(), contentBase64: "AAAA" }),
      /image size is invalid/
    );
    await assert.rejects(
      () => service.execute({
        actor: actor(),
        contentBase64: Buffer.alloc(1_048_577).toString("base64")
      }),
      /image size is invalid/
    );
    await assert.rejects(
      () => service.execute({ actor: actor(), contentBase64: "не base64!!" }),
      /image content is invalid/
    );
  });

  it("не принимает картинку без разрешения на рассылки", async () => {
    const service = new StoreAdminBroadcastImageService(
      { async storeImage() { throw new Error("не должно вызываться"); } },
      { newId: () => "019c0123-4567-789a-bcde-f01234567810" }
    );

    await assert.rejects(
      () => service.execute({
        actor: { ...actor(), permission: "participants.export" as never },
        contentBase64: Buffer.from(png(100, 100)).toString("base64")
      }),
      /broadcast permission is invalid/
    );
  });
});

/** Минимальный валидный по заголовку PNG: сигнатура, IHDR со сторонами и добивка до размера. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(200);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** JPEG: SOI, необязательная секция APP1, затем кадр SOF0 со сторонами. */
function jpeg(width: number, height: number, withExif = false): Uint8Array {
  const head = [0xff, 0xd8];
  const exif = withExif ? [0xff, 0xe1, 0x00, 0x10, ...new Array<number>(14).fill(0)] : [];
  const frame = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff
  ];
  const padding = new Array<number>(150).fill(0);
  return new Uint8Array([...head, ...exif, ...frame, ...padding]);
}

function actor(): AdminRequestActor {
  return {
    adminId: "019c0123-4567-789a-bcde-f01234567800",
    authSubject: "admin@example.com",
    roleCodes: ["content_manager"],
    permission: "broadcasts.send"
  };
}
