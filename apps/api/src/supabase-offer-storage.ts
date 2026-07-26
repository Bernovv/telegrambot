import { createClient } from "@supabase/supabase-js";
import type {
  ImmutableOfferSnapshot,
  OfferSnapshotStorage
} from "@ticket-platform/application";

interface StorageBucketClient {
  upload(
    path: string,
    body: Uint8Array,
    options: {
      readonly contentType: string;
      readonly cacheControl: string;
      readonly upsert: boolean;
    }
  ): Promise<{ readonly error: { readonly message: string } | null }>;
  getPublicUrl(path: string): {
    readonly data: { readonly publicUrl: string };
  };
}

interface OfferStorageClient {
  readonly storage: {
    from(bucket: string): StorageBucketClient;
  };
}

export class SupabaseOfferSnapshotStorage implements OfferSnapshotStorage {
  private readonly client: OfferStorageClient;

  constructor(
    private readonly config: {
      readonly supabaseUrl: string;
      readonly serviceRoleKey: string;
      readonly bucket: string;
    },
    client?: OfferStorageClient
  ) {
    this.client = client ?? createClient(
      config.supabaseUrl,
      config.serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }
    );
  }

  async storeImmutable(
    snapshot: ImmutableOfferSnapshot
  ): Promise<{ readonly publicUrl: string }> {
    if (
      !/^offers\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.html$/i.test(
        snapshot.storagePath
      )
      || snapshot.contentType !== "text/html"
      || snapshot.bytes.byteLength < 1
      || snapshot.bytes.byteLength > 100_000
    ) {
      throw new Error("Offer snapshot is invalid");
    }
    const bucket = this.client.storage.from(this.config.bucket);
    const { error } = await bucket.upload(
      snapshot.storagePath,
      snapshot.bytes,
      {
        contentType: snapshot.contentType,
        cacheControl: "31536000",
        upsert: false
      }
    );
    if (error) {
      throw new Error("Offer snapshot upload failed");
    }
    return {
      publicUrl: bucket.getPublicUrl(snapshot.storagePath).data.publicUrl
    };
  }
}

export class DisabledOfferSnapshotStorage implements OfferSnapshotStorage {
  storeImmutable(): Promise<never> {
    return Promise.reject(new Error("Offer snapshot storage is disabled"));
  }
}
