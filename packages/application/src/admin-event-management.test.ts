import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminEventNotDraftError,
  AdminEventPublicationRequirementsError,
  AdminEventSlugConflictError,
  AdminEventVersionConflictError,
  CreateAdminEventDraftService,
  InvalidAdminEventMutationError,
  PublishAdminEventService,
  UpdateAdminEventGeneralService,
  type AdminEventManagementRepository
} from "./admin-event-management.js";

describe("administrator event draft management", () => {
  it("normalizes and creates an audited draft", async () => {
    const repository = repositoryStub();
    const captured: unknown[] = [];
    repository.createDraft = async (input) => {
      captured.push(input);
      return "created";
    };
    const service = new CreateAdminEventDraftService(
      repository,
      idGenerator(EVENT_ID, AUDIT_ID, CAMPAIGN_ID)
    );

    const result = await service.execute({
      actor,
      event: { ...eventInput, slug: "  Business-Picnic  " },
      reason: " Initial event setup ",
      metadata
    });

    assert.equal(result.eventId, EVENT_ID);
    assert.equal(result.lockVersion, 1);
    const command = captured[0] as {
      readonly event: { readonly slug: string; readonly startsAt: Date };
      readonly audit: { readonly reason: string; readonly actorRole: string };
    };
    assert.equal(command.event.slug, "business-picnic");
    assert.equal(command.event.startsAt.toISOString(), eventInput.startsAt);
    assert.equal(command.audit.reason, "Initial event setup");
    assert.equal(command.audit.actorRole, "content_manager");
  });

  it("maps repository conflicts and stale versions", async () => {
    const createRepository = repositoryStub();
    createRepository.createDraft = async () => "slug_conflict";
    const create = new CreateAdminEventDraftService(
      createRepository,
      idGenerator(EVENT_ID, AUDIT_ID, CAMPAIGN_ID)
    );
    await assert.rejects(
      create.execute({ actor, event: eventInput, reason: "Create", metadata }),
      AdminEventSlugConflictError
    );

    const updateRepository = repositoryStub();
    updateRepository.updateDraft = async () => ({ status: "version_conflict" });
    const update = new UpdateAdminEventGeneralService(
      updateRepository,
      idGenerator(AUDIT_ID)
    );
    await assert.rejects(
      update.execute({
        actor,
        eventId: EVENT_ID,
        expectedLockVersion: 2,
        event: eventInput,
        reason: "Update schedule",
        metadata
      }),
      AdminEventVersionConflictError
    );
  });

  it("rejects non-draft updates and invalid boundaries", async () => {
    const repository = repositoryStub();
    repository.updateDraft = async () => ({ status: "not_draft" });
    const update = new UpdateAdminEventGeneralService(
      repository,
      idGenerator(AUDIT_ID, AUDIT_ID)
    );
    await assert.rejects(
      update.execute({
        actor,
        eventId: EVENT_ID,
        expectedLockVersion: 1,
        event: eventInput,
        reason: "Update schedule",
        metadata
      }),
      AdminEventNotDraftError
    );
    await assert.rejects(
      update.execute({
        actor: { ...actor, permission: "events.read" },
        eventId: EVENT_ID,
        expectedLockVersion: 1,
        event: eventInput,
        reason: "Update schedule",
        metadata
      }),
      InvalidAdminEventMutationError
    );
    await assert.rejects(
      update.execute({
        actor,
        eventId: EVENT_ID,
        expectedLockVersion: 1,
        event: { ...eventInput, endsAt: "2026-08-19T08:00:00.000Z" },
        reason: "Update schedule",
        metadata
      }),
      InvalidAdminEventMutationError
    );
  });

  it("publishes a complete draft with an events.publish actor", async () => {
    const repository = repositoryStub();
    const captured: unknown[] = [];
    repository.publishDraft = async (input) => {
      captured.push(input);
      return { status: "published", lockVersion: 5 };
    };
    const service = new PublishAdminEventService(
      repository,
      idGenerator(AUDIT_ID)
    );

    const result = await service.execute({
      actor: { ...actor, permission: "events.publish" },
      eventId: EVENT_ID,
      expectedLockVersion: 4,
      reason: "Открываем продажи",
      metadata
    });

    assert.deepEqual(result, {
      eventId: EVENT_ID,
      status: "published",
      lockVersion: 5,
      publishedAt: metadata.occurredAt.toISOString()
    });
    const command = captured[0] as {
      readonly expectedLockVersion: number;
      readonly audit: { readonly reason: string };
    };
    assert.equal(command.expectedLockVersion, 4);
    assert.equal(command.audit.reason, "Открываем продажи");
  });

  it("reports publication requirements and rejects the wrong permission", async () => {
    const repository = repositoryStub();
    repository.publishDraft = async () => ({
      status: "requirements_failed",
      issues: ["missing_support_contact", "missing_published_scenario"]
    });
    const service = new PublishAdminEventService(
      repository,
      idGenerator(AUDIT_ID)
    );

    await assert.rejects(
      service.execute({
        actor: { ...actor, permission: "events.publish" },
        eventId: EVENT_ID,
        expectedLockVersion: 2,
        reason: "Проверка готовности",
        metadata
      }),
      (error: unknown) => {
        assert.ok(error instanceof AdminEventPublicationRequirementsError);
        assert.deepEqual(error.issues, [
          "missing_support_contact",
          "missing_published_scenario"
        ]);
        return true;
      }
    );
    await assert.rejects(
      service.execute({
        actor,
        eventId: EVENT_ID,
        expectedLockVersion: 2,
        reason: "Проверка готовности",
        metadata
      }),
      InvalidAdminEventMutationError
    );
  });
});

function repositoryStub(): AdminEventManagementRepository {
  return {
    async createDraft() {
      return "created";
    },
    async updateDraft() {
      return { status: "updated", lockVersion: 2 };
    },
    async publishDraft() {
      return { status: "published", lockVersion: 2 };
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

const eventInput = {
  slug: "business-picnic",
  title: "Business Picnic",
  description: "Annual event",
  format: "offsite" as const,
  isFree: false,
  timezone: "Europe/Moscow",
  startsAt: "2026-08-20T08:00:00.000Z",
  endsAt: "2026-08-20T18:00:00.000Z",
  salesStartsAt: "2026-07-01T00:00:00.000Z",
  salesEndsAt: "2026-08-19T21:00:00.000Z",
  locationName: "Park",
  locationAddress: "Moscow",
  supportContact: "@support",
  capacity: 500,
  reservationTtlMinutes: 30,
  phoneRequiredForPurchase: true,
  offerRequired: true
};

const metadata = {
  requestId: "request-1",
  ipAddress: "127.0.0.1",
  userAgent: "admin-web-test",
  occurredAt: new Date("2026-07-26T10:00:00.000Z")
};

const EVENT_ID = "00000000-0000-4000-8000-000000000101";
const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000401";
const AUDIT_ID = "00000000-0000-4000-8000-000000000901";
