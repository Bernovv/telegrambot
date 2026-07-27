import type { AdminRequestActor } from "@ticket-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParticipantExportRow {
  readonly orderNumber: string;
  readonly paidAt: string;
  readonly ticketNumber: string;
  readonly ticketStatus: string;
  readonly userDisplayName: string | null;
  readonly telegramUsername: string | null;
  readonly phone: string | null;
  readonly questionnaire: {
    readonly name: string;
    readonly city: string;
    readonly niche: string;
    readonly stage: string;
    readonly wish: string;
    readonly focusArea: string;
    readonly joinChat: boolean;
  } | null;
}

export interface ParticipantsExportRepository {
  listPaidParticipants(
    eventId: string
  ): Promise<readonly ParticipantExportRow[]>;
}

export interface ExportParticipantsCsvResult {
  readonly csv: string;
  readonly rowCount: number;
  readonly filename: string;
}

const CSV_HEADER = [
  "Order",
  "Paid at",
  "Ticket",
  "Ticket status",
  "Name",
  "Telegram",
  "Phone",
  "City",
  "Niche",
  "Stage",
  "Wish",
  "Focus area",
  "Join chat",
  "Questionnaire completed"
];

export class ExportParticipantsCsvService {
  constructor(private readonly repository: ParticipantsExportRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<ExportParticipantsCsvResult> {
    requireExportPermission(input.actor);
    requireUuid(input.eventId, "Administrator participants export request is invalid");

    const rows = await this.repository.listPaidParticipants(input.eventId);
    const csv = toCsv(rows);

    return {
      csv,
      rowCount: rows.length,
      filename: `participants-${input.eventId}.csv`
    };
  }
}

function toCsv(rows: readonly ParticipantExportRow[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.orderNumber,
        row.paidAt,
        row.ticketNumber,
        row.ticketStatus,
        row.questionnaire?.name ?? row.userDisplayName ?? "",
        row.telegramUsername ?? "",
        row.phone ?? "",
        row.questionnaire?.city ?? "",
        row.questionnaire?.niche ?? "",
        row.questionnaire?.stage ?? "",
        row.questionnaire?.wish ?? "",
        row.questionnaire?.focusArea ?? "",
        row.questionnaire ? (row.questionnaire.joinChat ? "yes" : "no") : "",
        row.questionnaire ? "yes" : "no"
      ]
        .map(csvCell)
        .join(",")
    );
  }
  // CRLF line endings, per RFC 4180.
  return lines.join("\r\n") + "\r\n";
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function requireExportPermission(actor: AdminRequestActor): void {
  if (actor.permission !== "participants.export" || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator export permission is invalid");
  }
}

function requireUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(message);
  }
}
