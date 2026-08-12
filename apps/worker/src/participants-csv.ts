/**
 * Разбор CSV для переноса мероприятия из таблицы — участники и расходы.
 *
 * Без внешней библиотеки: формат простой, а лишняя зависимость в боевом воркере не
 * окупается. Поля в кавычках поддерживаются — в заметках встречаются запятые («Должна 3к,
 * стул»), и наивное разрезание по запятой сдвинуло бы половину колонок.
 */

export interface ParticipantCsvRow {
  readonly row: string;
  readonly name: string;
  readonly phone: string;
  readonly telegram: string;
  readonly adults: string;
  readonly children: string;
  readonly sleeping: string;
  readonly amountKopecks: string;
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
      amountKopecks: toKopecks(amount),
      source: value("source") || "direct",
      note: value("note")
    });
  }
  return rows;
}

export interface ExpenseCsvRow {
  readonly category: string;
  readonly title: string;
  readonly amountKopecks: string;
  readonly quantity: string;
  readonly unit: string;
  /** Пусто — значит «договорились», но ещё не отмечено оплаченным. */
  readonly paidAt: string;
  readonly note: string;
}

const EXPENSE_REQUIRED = ["category", "title", "amount_rub"] as const;

export function parseExpensesCsv(text: string): readonly ExpenseCsvRow[] {
  const records = splitRecords(text.replace(/^\uFEFF/, ""));
  const header = records[0];
  if (!header) {
    throw new Error("Файл пуст");
  }

  const columns = header.map((name) => name.trim());
  for (const name of EXPENSE_REQUIRED) {
    if (!columns.includes(name)) {
      throw new Error(`В файле нет колонки ${name}`);
    }
  }

  const rows: ExpenseCsvRow[] = [];
  for (const [index, cells] of records.slice(1).entries()) {
    if (cells.every((cell) => cell.trim() === "")) {
      continue;
    }
    const line = index + 2;
    const value = (name: string): string => {
      const at = columns.indexOf(name);
      return at === -1 ? "" : (cells[at] ?? "").trim();
    };

    const title = value("title");
    if (title === "") {
      throw new Error(`Строка ${line}: пустое название расхода`);
    }
    const category = value("category");
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(category)) {
      throw new Error(`Строка ${line}: статья «${category}» не похожа на код статьи`);
    }
    const amount = value("amount_rub");
    if (!/^\d+([.,]\d{1,2})?$/.test(amount)) {
      throw new Error(`Строка ${line}: сумма «${amount}» не похожа на рубли`);
    }
    const paidAt = value("paid_at");
    // Дата нужна вместе с суммой: «оплачено» без даты тихо выпадает из фактических
    // расходов и завышает прибыль, поэтому кривую дату отвергаем здесь, а не в базе.
    if (paidAt !== "" && Number.isNaN(Date.parse(paidAt))) {
      throw new Error(`Строка ${line}: дату «${paidAt}» не разобрать`);
    }

    rows.push({
      category,
      title,
      amountKopecks: toKopecks(amount),
      quantity: quantityOrOne(value("quantity"), line),
      unit: value("unit"),
      paidAt,
      note: value("note")
    });
  }
  return rows;
}

/**
 * Рубли в копейки строками, без чисел с плавающей точкой: `7317.60 * 100` даёт
 * 731759.9999999999, и на округлении копейка то теряется, то появляется. За мероприятие
 * таких строк набирается достаточно, чтобы итог перестал сходиться с бумажкой.
 */
function toKopecks(rubles: string): string {
  const [whole = "0", fraction = ""] = rubles.replace(",", ".").split(".");
  const kopecks = `${whole}${fraction.padEnd(2, "0").slice(0, 2)}`;
  return kopecks.replace(/^0+(?=\d)/, "");
}

function quantityOrOne(value: string, line: number): string {
  const text = value === "" ? "1" : value.replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(text) || Number(text) <= 0) {
    throw new Error(`Строка ${line}: количество «${value}» должно быть больше нуля`);
  }
  return text;
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
