import type { OutreachImportRow } from "@ticket-platform/contracts/admin-outreach";

export interface OutreachCsvParseResult {
  readonly rows: readonly OutreachImportRow[];
  /** Номера строк файла без телефона, Telegram и MAX — импортировать из них нечего. */
  readonly skippedLines: readonly number[];
}

export function parseOutreachCsv(text: string): OutreachCsvParseResult {
  const cleaned = text.replace(/^\uFEFF/, "");
  const firstLine = cleaned.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = count(firstLine, ";") > count(firstLine, ",") ? ";" : ",";
  const table = parseTable(cleaned, delimiter)
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  const header = table[0]?.map((cell) => cell.trim().toLowerCase());
  if (!header) {
    throw new Error("CSV-файл пуст");
  }
  const fields = header.map(resolveHeader);
  if (!fields.some((field) => field === "phone" || field === "telegram" || field === "max")) {
    throw new Error("Нужна хотя бы одна колонка: phone, telegram или max");
  }
  // Одна пустая строка не должна ронять импорт целиком: в выгрузке на восемь тысяч
  // контактов такая найдётся почти наверняка. Пропускаем её и говорим, сколько пропустили.
  const rows: OutreachImportRow[] = [];
  const skippedLines: number[] = [];
  table.slice(1).forEach((cells, rowIndex) => {
    const row: Record<string, string> = {};
    fields.forEach((field, index) => {
      if (field) {
        row[field] = cells[index]?.trim() ?? "";
      }
    });
    if (!row.phone && !row.telegram && !row.max) {
      skippedLines.push(rowIndex + 2);
      return;
    }
    rows.push(compact(row));
  });
  if (rows.length < 1) {
    throw new Error("В CSV нет строк с контактами");
  }
  return { rows, skippedLines };
}

function parseTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) {
    throw new Error("В CSV не закрыта кавычка");
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function resolveHeader(value: string): string | null {
  const headers: Record<string, string> = {
    name: "name",
    "имя": "name",
    phone: "phone",
    "телефон": "phone",
    telegram: "telegram",
    "телеграм": "telegram",
    tg: "telegram",
    max: "max",
    "макс": "max",
    source: "source",
    "источник": "source",
    note: "note",
    "комментарий": "note"
  };
  return headers[value] ?? null;
}

function compact(row: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== "")
  );
}

function count(value: string, character: string): number {
  return [...value].filter((candidate) => candidate === character).length;
}
