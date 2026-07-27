import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExportParticipantsCsvService } from "./participants-export.js";
import type {
  ParticipantExportRow,
  ParticipantsExportRepository
} from "./participants-export.js";
import type { AdminRequestActor } from "@ticket-platform/contracts";

describe("ExportParticipantsCsvService", () => {
  it("builds a CSV with a header row and one row per paid ticket", async () => {
    const repository = new FakeRepository([
      row({ ticketNumber: "BP-0001-T001" }),
      row({
        ticketNumber: "BP-0001-T002",
        questionnaire: null,
        userDisplayName: "Second Buyer",
        telegramUsername: null,
        phone: null
      })
    ]);
    const service = new ExportParticipantsCsvService(repository);

    const result = await service.execute({ actor: exportActor(), eventId });

    assert.equal(result.rowCount, 2);
    assert.equal(result.filename, `participants-${eventId}.csv`);
    const lines = result.csv.split("\r\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 3);
    assert.equal(
      lines[0],
      "Order,Paid at,Ticket,Ticket status,Name,Telegram,Phone,City,Niche,Stage,Wish,Focus area,Join chat,Questionnaire completed"
    );
    assert.match(lines[1] ?? "", /^BP-0001,.*,BP-0001-T001,issued,Ivan,ivanov,\+79001234567,Moscow,coaching,want_more_sales,More clients,sales,yes,yes$/);
    assert.match(lines[2] ?? "", /^BP-0001,.*,BP-0001-T002,issued,Second Buyer,,,,,,,,,no$/);
  });

  it("quotes fields containing commas, quotes, or newlines", async () => {
    const repository = new FakeRepository([
      row({
        questionnaire: {
          name: "Ivan",
          city: "Moscow",
          niche: 'coaching, "premium"',
          stage: "want_more_sales",
          wish: "Line one\nLine two",
          focusArea: "sales",
          joinChat: true
        }
      })
    ]);
    const service = new ExportParticipantsCsvService(repository);

    const result = await service.execute({ actor: exportActor(), eventId });

    assert.ok(result.csv.includes('"coaching, ""premium"""'));
    assert.ok(result.csv.includes('"Line one\nLine two"'));
  });

  it("rejects an actor without the participants.export permission", async () => {
    const repository = new FakeRepository([]);
    const service = new ExportParticipantsCsvService(repository);

    await assert.rejects(
      () => service.execute({ actor: { ...exportActor(), permission: "orders.read" as never }, eventId }),
      /export permission is invalid/
    );
  });

  it("rejects a non-UUID event id", async () => {
    const repository = new FakeRepository([]);
    const service = new ExportParticipantsCsvService(repository);

    await assert.rejects(
      () => service.execute({ actor: exportActor(), eventId: "not-a-uuid" }),
      /export request is invalid/
    );
  });
});

class FakeRepository implements ParticipantsExportRepository {
  constructor(private readonly rows: readonly ParticipantExportRow[]) {}

  async listPaidParticipants(): Promise<readonly ParticipantExportRow[]> {
    return this.rows;
  }
}

function exportActor(): AdminRequestActor {
  return {
    adminId: "019c0123-4567-789a-bcde-f01234567800",
    authSubject: "admin@example.com",
    roleCodes: ["sales_manager"],
    permission: "participants.export"
  };
}

function row(overrides: Partial<ParticipantExportRow> = {}): ParticipantExportRow {
  return {
    orderNumber: "BP-0001",
    paidAt: "2026-07-20T10:00:00.000Z",
    ticketNumber: "BP-0001-T001",
    ticketStatus: "issued",
    userDisplayName: "Ivan Ivanov",
    telegramUsername: "ivanov",
    phone: "+79001234567",
    questionnaire: {
      name: "Ivan",
      city: "Moscow",
      niche: "coaching",
      stage: "want_more_sales",
      wish: "More clients",
      focusArea: "sales",
      joinChat: true
    },
    ...overrides
  };
}

const eventId = "019c0123-4567-789a-bcde-f01234567801";
