import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SupabaseOfferSnapshotStorage } from "./supabase-offer-storage.js";

describe("SupabaseOfferSnapshotStorage", () => {
  it("uploads once without upsert and returns the public immutable URL", async () => {
    const uploads: unknown[][] = [];
    const storage = new SupabaseOfferSnapshotStorage(
      {
        supabaseUrl: "https://project.supabase.co",
        serviceRoleKey: "s".repeat(48),
        bucket: "offer-snapshots"
      },
      {
        storage: {
          from(bucket) {
            assert.equal(bucket, "offer-snapshots");
            return {
              async upload(...input) {
                uploads.push(input);
                return { error: null };
              },
              getPublicUrl(path) {
                return {
                  data: {
                    publicUrl:
                      `https://project.supabase.co/storage/v1/object/public/offer-snapshots/${path}`
                  }
                };
              }
            };
          }
        }
      }
    );
    const path =
      "offers/00000000-0000-4000-8000-000000000101/"
      + "00000000-0000-4000-8000-000000000302.html";

    const result = await storage.storeImmutable({
      storagePath: path,
      contentType: "text/html",
      bytes: new TextEncoder().encode("<!doctype html><p>Offer</p>")
    });

    assert.match(result.publicUrl, /offer-snapshots\/offers\//);
    assert.equal(uploads.length, 1);
    assert.deepEqual(uploads[0]?.[2], {
      contentType: "text/html",
      cacheControl: "31536000",
      upsert: false
    });
  });

  it("fails closed for unsafe paths and storage errors", async () => {
    const storage = new SupabaseOfferSnapshotStorage(
      {
        supabaseUrl: "https://project.supabase.co",
        serviceRoleKey: "s".repeat(48),
        bucket: "offer-snapshots"
      },
      {
        storage: {
          from() {
            return {
              async upload() {
                return { error: { message: "exists" } };
              },
              getPublicUrl() {
                return { data: { publicUrl: "https://example.com" } };
              }
            };
          }
        }
      }
    );
    await assert.rejects(
      storage.storeImmutable({
        storagePath: "../offer.html",
        contentType: "text/html",
        bytes: new Uint8Array([1])
      }),
      /invalid/
    );
    await assert.rejects(
      storage.storeImmutable({
        storagePath:
          "offers/00000000-0000-4000-8000-000000000101/"
          + "00000000-0000-4000-8000-000000000302.html",
        contentType: "text/html",
        bytes: new Uint8Array([1])
      }),
      /upload failed/
    );
  });
});
