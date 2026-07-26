import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminEventOfferNotActiveError,
  AdminOfferSnapshotStorageUnavailableError,
  DeactivateAdminEventOfferService,
  PublishAdminEventOfferVersionService,
  type AdminEventOfferManagementRepository,
  type ImmutableOfferSnapshot,
  type OfferSnapshotStorage
} from "./admin-event-offer-management.js";
import { InvalidAdminEventMutationError } from "./admin-event-management.js";

describe("administrator event offer management", () => {
  it("renders, hashes, stores, and publishes an escaped immutable HTML snapshot", async () => {
    let stored: ImmutableOfferSnapshot | undefined;
    let published: Parameters<
      AdminEventOfferManagementRepository["publishOfferVersion"]
    >[0] | undefined;
    const repository = repositoryStub();
    repository.publishOfferVersion = async (input) => {
      published = input;
      return { status: "published", lockVersion: 4 };
    };
    const storage: OfferSnapshotStorage = {
      async storeImmutable(snapshot) {
        stored = snapshot;
        return {
          publicUrl:
            "https://project.supabase.co/storage/v1/object/public/offers/test.html"
        };
      }
    };
    const service = new PublishAdminEventOfferVersionService(
      repository,
      storage,
      idGenerator(OFFER_VERSION_ID, AUDIT_ID)
    );

    const result = await service.execute(command);

    assert.equal(result.resourceId, OFFER_VERSION_ID);
    assert.equal(result.lockVersion, 4);
    assert.equal(stored?.storagePath, `offers/${EVENT_ID}/${OFFER_VERSION_ID}.html`);
    const html = new TextDecoder().decode(stored?.bytes);
    assert.match(html, /&lt;условия&gt;/);
    assert.doesNotMatch(html, /<условия>/);
    assert.equal(published?.version.contentType, "text/html");
    assert.match(published?.version.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(published?.offerDocumentId, OFFER_DOCUMENT_ID);
  });

  it("creates a document ID when the event has no offer document", async () => {
    const repository = repositoryStub();
    repository.prepareOfferVersion = async () => ({
      status: "ready",
      offerDocumentId: null
    });
    let publishedDocumentId: string | undefined;
    repository.publishOfferVersion = async (input) => {
      publishedDocumentId = input.offerDocumentId;
      return { status: "published", lockVersion: 4 };
    };
    const service = new PublishAdminEventOfferVersionService(
      repository,
      storageStub(),
      idGenerator(OFFER_DOCUMENT_ID, OFFER_VERSION_ID, AUDIT_ID)
    );

    await service.execute(command);

    assert.equal(publishedDocumentId, OFFER_DOCUMENT_ID);
  });

  it("fails closed for invalid source data and unavailable storage", async () => {
    const service = new PublishAdminEventOfferVersionService(
      repositoryStub(),
      {
        async storeImmutable() {
          throw new Error("network");
        }
      },
      idGenerator(OFFER_VERSION_ID)
    );
    await assert.rejects(
      service.execute(command),
      AdminOfferSnapshotStorageUnavailableError
    );
    await assert.rejects(
      service.execute({
        ...command,
        offer: { ...command.offer, sourceUrl: "http://example.com/offer" }
      }),
      InvalidAdminEventMutationError
    );
  });

  it("deactivates only the current offer and maps an absent active version", async () => {
    const successful = new DeactivateAdminEventOfferService(
      repositoryStub(),
      idGenerator(AUDIT_ID)
    );
    const result = await successful.execute({
      actor,
      eventId: EVENT_ID,
      expectedLockVersion: 3,
      reason: "Снять оферту",
      metadata
    });
    assert.equal(result.resourceId, OFFER_VERSION_ID);
    assert.equal(result.lockVersion, 4);

    const missing = new DeactivateAdminEventOfferService(
      {
        ...repositoryStub(),
        async deactivateOffer() {
          return { status: "offer_not_active" };
        }
      },
      idGenerator(AUDIT_ID)
    );
    await assert.rejects(
      missing.execute({
        actor,
        eventId: EVENT_ID,
        expectedLockVersion: 3,
        reason: "Снять оферту",
        metadata
      }),
      AdminEventOfferNotActiveError
    );
  });
});

function repositoryStub(): AdminEventOfferManagementRepository {
  return {
    async prepareOfferVersion() {
      return { status: "ready", offerDocumentId: OFFER_DOCUMENT_ID };
    },
    async publishOfferVersion() {
      return { status: "published", lockVersion: 4 };
    },
    async deactivateOffer() {
      return {
        status: "deactivated",
        offerVersionId: OFFER_VERSION_ID,
        lockVersion: 4
      };
    }
  };
}

function storageStub(): OfferSnapshotStorage {
  return {
    async storeImmutable() {
      return {
        publicUrl:
          "https://project.supabase.co/storage/v1/object/public/offers/test.html"
      };
    }
  };
}

function idGenerator(...ids: string[]) {
  let index = 0;
  return {
    newId() {
      const id = ids[index];
      index += 1;
      assert.ok(id);
      return id;
    }
  };
}

const actor: AdminRequestActor = {
  adminId: "00000000-0000-4000-8000-000000000010",
  authSubject: "auth-1",
  roleCodes: ["content_manager"],
  permission: "events.write"
};

const metadata = {
  requestId: "request-offer-1",
  ipAddress: "127.0.0.1",
  userAgent: "admin-web-test",
  occurredAt: new Date("2026-07-26T13:00:00.000Z")
};

const EVENT_ID = "00000000-0000-4000-8000-000000000101";
const OFFER_DOCUMENT_ID = "00000000-0000-4000-8000-000000000301";
const OFFER_VERSION_ID = "00000000-0000-4000-8000-000000000302";
const AUDIT_ID = "00000000-0000-4000-8000-000000000901";
const command = {
  actor,
  eventId: EVENT_ID,
  expectedLockVersion: 3,
  offer: {
    documentTitle: "Договор оферты",
    sourceType: "google_docs" as const,
    sourceUrl: "https://docs.google.com/document/d/test",
    sourceRevisionId: "revision-7",
    displayTextSnapshot: "Текст <условия> & обязательства"
  },
  reason: "Опубликовать согласованную редакцию",
  metadata
};
