/**
 * Разбор CSV со списком участников — без внешней библиотеки, потому что формат простой,
 * а лишняя зависимость в боевом воркере не окупается.
 *
 * Поддерживает поля в кавычках: в заметках встречаются запятые («Должна 3к, стул»), и
 * наивное разрезание по запятой сдвинуло бы половину колонок.
 */

export interface ParticipantCsvRow {
  readonly row: string;
  readonly name: string;
  readonly phone: string;
  readonly telegram: string;
  readonly adults: string;
  readonly children: string;
  readonly sleeping: string;
  readonly amountRubles: string;
  readonly source: string;
  readonly note: string;
}

const REQUIRED = ["name", "adults", "children", "sleeping", "amount_rub"] as const;

export function parseParticipantsCsv(text: string): readonly ParticipantCsvRow[] {
  // Excel и Numbers сохраняют CSV с меткой порядка байтов; без неё первая колонка
  // называлась бы "\uFEFFrow" и не нашлась бы по имени.
  const records = splitRecords(text.replace(/^\uFEFF/, ""));
  const header = records[0];
  if (!header) {
    throw new Error("Файл пуст");
  }

  const columns = header.map((name) => name.trim());
  for (const name of REQUIRED) {
    if (!columns.includes(name)) {
      throw new Error(`В файле нет колонки ${name}`);
    }
  }

  const rows: ParticipantCsvRow[] = [];
  for (const [index, cells] of records.slice(1).entries()) {
    if (cells.every((cell) => cell.trim() === "")) {
      continue;
    }
    const value = (name: string): string => {
      const at = columns.indexOf(name);
      return at === -1 ? "" : (cells[at] ?? "").trim();
    };

    const name = value("name");
    if (name === "") {
      throw new Error(`Строка ${index + 2}: пустое имя`);
    }
    const phone = value("phone");
    if (phone !== "" && !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      throw new Error(`Строка ${index + 2}: телефон «${phone}» не в формате +79001234567`);
    }
    const amount = value("amount_rub") || "0";
    if (!/^\d+([.,]\d{1,2})?$/.test(amount)) {
      throw new Error(`Строка ${index + 2}: сумма «${amount}» не похожа на рубли`);
    }

    rows.push({
      row: value("row") || String(index + 2),
      name,
      phone,
      telegram: value("telegram"),
      adults: wholeNumber(value("adults"), index + 2, "adults"),
      children: wholeNumber(value("children"), index + 2, "children"),
      sleeping: wholeNumber(value("sleeping"), index + 2, "sleeping"),
      amountRubles: amount.replace(",", "."),
      source: value("source") || "direct",
      note: value("note")
    });
  }
  return rows;
}

function wholeNumber(value: string, line: number, column: string): string {
  const text = value === "" ? "0" : value;
  if (!/^\d{1,3}$/.test(text)) {
    throw new Error(`Строка ${line}: «${column}» должно быть целым числом, получено «${value}»`);
  }
  return text;
}

function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else if (char === "\n") {
      cells.push(cell);
      records.push(cells);
      cells = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell !== "" || cells.length > 0) {
    cells.push(cell);
    records.push(cells);
  }
  return records;
}
