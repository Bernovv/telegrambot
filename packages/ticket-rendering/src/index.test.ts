import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QrTicketPngRenderer } from "./index.js";

describe("QrTicketPngRenderer", () => {
  it("renders a deterministic bounded 512px PNG from an opaque ticket token", async () => {
    const renderer = new QrTicketPngRenderer();
    const first = await renderer.renderPng("a".repeat(43));
    const second = await renderer.renderPng("a".repeat(43));

    assert.equal(first.mimeType, "image/png");
    assert.equal(first.width, 512);
    assert.equal(first.height, 512);
    assert.ok(first.bytes.byteLength > 100);
    assert.ok(first.bytes.byteLength < 2 * 1_024 * 1_024);
    assert.deepEqual([...first.bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(readPngDimension(first.bytes, 16), 512);
    assert.equal(readPngDimension(first.bytes, 20), 512);
    assert.deepEqual(first.bytes, second.bytes);
  });

  it("rejects malformed or non-opaque ticket values", async () => {
    const renderer = new QrTicketPngRenderer();

    await assert.rejects(renderer.renderPng("short"), /token is invalid/);
    await assert.rejects(renderer.renderPng("!".repeat(43)), /token is invalid/);
  });
});

function readPngDimension(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000
    + (bytes[offset + 1] ?? 0) * 0x10000
    + (bytes[offset + 2] ?? 0) * 0x100
    + (bytes[offset + 3] ?? 0)
  );
}
