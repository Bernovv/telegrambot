import type { AdminRequestActor } from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ADMIN_BROADCAST_IMAGE_MIN_BYTES = 100;
export const ADMIN_BROADCAST_IMAGE_MAX_BYTES = 1_048_576;

export type AdminBroadcastImageMimeType = "image/png" | "image/jpeg";

export interface AdminBroadcastImageDescriptor {
  readonly mimeType: AdminBroadcastImageMimeType;
  readonly width: number;
  readonly height: number;
}

export interface StoreAdminBroadcastImageInput extends AdminBroadcastImageDescriptor {
  readonly id: string;
  readonly uploadedByAdminId: string;
  readonly byteSize: number;
  readonly bytes: Uint8Array;
}

export interface AdminBroadcastImageRepository {
  storeImage(input: StoreAdminBroadcastImageInput): Promise<void>;
}

export interface StoreAdminBroadcastImageResult extends AdminBroadcastImageDescriptor {
  readonly imageId: string;
  readonly byteSize: number;
}

export class StoreAdminBroadcastImageService {
  constructor(
    private readonly repository: AdminBroadcastImageRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly contentBase64: string;
  }): Promise<StoreAdminBroadcastImageResult> {
    if (
      input.actor.permission !== "broadcasts.send"
      || !UUID_PATTERN.test(input.actor.adminId)
    ) {
      throw new Error("Administrator broadcast permission is invalid");
    }

    const bytes = decodeBase64(input.contentBase64);
    if (
      bytes.byteLength < ADMIN_BROADCAST_IMAGE_MIN_BYTES
      || bytes.byteLength > ADMIN_BROADCAST_IMAGE_MAX_BYTES
    ) {
      throw new Error("Broadcast image size is invalid");
    }

    // Формат читаем из самих байтов, а не из имени файла и не из того, что сказал браузер:
    // и то и другое присылает клиент, а Telegram получит именно эти байты.
    const descriptor = readImageDescriptor(bytes);
    const imageId = this.idGenerator.newId();
    await this.repository.storeImage({
      id: imageId,
      uploadedByAdminId: input.actor.adminId,
      byteSize: bytes.byteLength,
      bytes,
      ...descriptor
    });

    return { imageId, byteSize: bytes.byteLength, ...descriptor };
  }
}

/**
 * Разбирает заголовок PNG или JPEG. Размеры нужны не для отправки — Telegram их не спрашивает —
 * а чтобы отказать сразу: картинку, которая не пройдёт его требования к сторонам, иначе мы бы
 * обнаружили на первом получателе, а до тех пор считали кампанию нормальной.
 */
export function readImageDescriptor(bytes: Uint8Array): AdminBroadcastImageDescriptor {
  const descriptor = readPngDescriptor(bytes) ?? readJpegDescriptor(bytes);
  if (!descriptor) {
    throw new Error("Broadcast image format is invalid");
  }
  const { width, height } = descriptor;
  if (
    width < 1
    || height < 1
    || width + height > 10_000
    || width > height * 20
    || height > width * 20
  ) {
    throw new Error("Broadcast image dimensions are invalid");
  }
  return descriptor;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPngDescriptor(bytes: Uint8Array): AdminBroadcastImageDescriptor | null {
  if (bytes.byteLength < 24 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return null;
  }
  // Первый блок PNG всегда IHDR: его длина и тип занимают байты 8..15, дальше стороны.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    mimeType: "image/png",
    width: view.getUint32(16),
    height: view.getUint32(20)
  };
}

function readJpegDescriptor(bytes: Uint8Array): AdminBroadcastImageDescriptor | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  // Стороны JPEG лежат в маркере кадра (SOF), а до него идёт неизвестное число секций
  // произвольной длины, поэтому файл приходится проходить по цепочке маркеров.
  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      return null;
    }
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2) {
      return null;
    }
    if (isStartOfFrame(marker)) {
      if (offset + 9 >= bytes.byteLength) {
        return null;
      }
      return {
        mimeType: "image/jpeg",
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7)
      };
    }
    offset += 2 + segmentLength;
  }

  return null;
}

function isStartOfFrame(marker: number): boolean {
  // SOF0..SOF15, кроме 0xc4 (таблицы Хаффмана), 0xc8 и 0xcc — те кадром не являются.
  return marker >= 0xc0
    && marker <= 0xcf
    && marker !== 0xc4
    && marker !== 0xc8
    && marker !== 0xcc;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Broadcast image content is invalid");
  }
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch {
    throw new Error("Broadcast image content is invalid");
  }
}
