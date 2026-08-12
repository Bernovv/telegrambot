/**
 * Чтение таблицы, которую менеджер приносит из Excel или Google Sheets.
 *
 * Читаем .xlsx напрямую, а не просим сохранить в CSV: русский Excel сохраняет CSV в
 * windows-1251, и имена приезжают кракозябрами. Внутри .xlsx — обычный zip с XML в UTF-8,
 * и распаковать его умеет сам браузер (`DecompressionStream`), так что зависимость не
 * нужна.
 *
 * CSV тоже принимаем — из Google Sheets он выгружается в UTF-8 и проблем не создаёт.
 */

export interface Sheet {
  readonly name: string;
  /** Строки таблицы как есть, включая заголовок. Пустые хвосты обрезаны. */
  readonly rows: readonly (readonly string[])[];
}

export interface Workbook {
  readonly sheets: readonly Sheet[];
}

export async function readWorkbook(file: File): Promise<Workbook> {
  if (/\.csv$/i.test(file.name)) {
    return { sheets: [{ name: file.name, rows: parseCsv(await file.text()) }] };
  }
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error("Поддерживаются файлы .xlsx и .csv");
  }
  return readXlsx(await file.arrayBuffer());
}

/* ------------------------------------------------------------------ CSV -- */

export function parseCsv(text: string): readonly (readonly string[])[] {
  const cleaned = text.replace(/^\uFEFF/, "");
  const firstLine = cleaned.split(/\r?\n/, 1)[0] ?? "";
  // Excel в русской локали разделяет точкой с запятой, Google Sheets — запятой.
  const delimiter = countOf(firstLine, ";") > countOf(firstLine, ",") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (character === '"') {
      if (quoted && cleaned[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && cleaned[index + 1] === "\n") {
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
    throw new Error("В файле не закрыта кавычка");
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return trimEmpty(rows);
}

/* ----------------------------------------------------------------- XLSX -- */

async function readXlsx(buffer: ArrayBuffer): Promise<Workbook> {
  const files = await unzip(new Uint8Array(buffer));

  const workbookXml = files.get("xl/workbook.xml");
  if (!workbookXml) {
    throw new Error("Это не похоже на файл Excel: внутри нет xl/workbook.xml");
  }
  const decoder = new TextDecoder();
  const shared = parseSharedStrings(
    files.has("xl/sharedStrings.xml")
      ? decoder.decode(files.get("xl/sharedStrings.xml"))
      : ""
  );

  const relations = parseRelations(
    decoder.decode(files.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array())
  );
  const document = new DOMParser()
    .parseFromString(decoder.decode(workbookXml), "application/xml");

  const sheets: Sheet[] = [];
  for (const node of [...document.getElementsByTagName("sheet")]) {
    const name = node.getAttribute("name") ?? "Лист";
    const relationId = node.getAttribute("r:id")
      ?? node.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id"
      );
    const target = relationId === null ? undefined : relations.get(relationId);
    const content = target === undefined
      ? undefined
      : files.get(`xl/${target.replace(/^\/?xl\//, "")}`);
    if (!content) {
      continue;
    }
    sheets.push({ name, rows: parseSheetXml(decoder.decode(content), shared) });
  }

  if (sheets.length === 0) {
    throw new Error("В файле нет ни одного листа");
  }
  return { sheets };
}

export function parseSharedStrings(xml: string): readonly string[] {
  if (xml.trim() === "") {
    return [];
  }
  const document = new DOMParser().parseFromString(xml, "application/xml");
  return [...document.getElementsByTagName("si")].map((node) =>
    [...node.getElementsByTagName("t")]
      .map((text) => text.textContent ?? "")
      .join(""));
}

/**
 * Разбор листа. Ячейки приходят с адресами (A1, C14), причём пустые пропущены совсем —
 * поэтому раскладываем по индексу колонки, а не подряд: иначе всё правее первой дырки
 * уехало бы на колонку влево.
 */
export function parseSheetXml(
  xml: string,
  shared: readonly string[]
): readonly (readonly string[])[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const rows: string[][] = [];

  for (const rowNode of [...document.getElementsByTagName("row")]) {
    const cells: string[] = [];
    for (const cellNode of [...rowNode.getElementsByTagName("c")]) {
      const reference = cellNode.getAttribute("r") ?? "";
      const column = columnIndex(reference.replace(/\d+$/, ""));
      const type = cellNode.getAttribute("t");
      let value = "";

      if (type === "inlineStr") {
        value = [...cellNode.getElementsByTagName("t")]
          .map((text) => text.textContent ?? "")
          .join("");
      } else {
        const node = cellNode.getElementsByTagName("v")[0];
        const raw = node?.textContent ?? "";
        value = type === "s" ? shared[Number(raw)] ?? "" : raw;
      }

      while (cells.length < column) {
        cells.push("");
      }
      cells[column] = value.trim();
    }
    const index = Number(rowNode.getAttribute("r") ?? rows.length + 1) - 1;
    while (rows.length < index) {
      rows.push([]);
    }
    rows[index] = cells;
  }

  return trimEmpty(rows);
}

/** «A» → 0, «B» → 1, «AA» → 26. */
function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

function parseRelations(xml: string): ReadonlyMap<string, string> {
  if (xml.trim() === "") {
    return new Map();
  }
  const document = new DOMParser().parseFromString(xml, "application/xml");
  return new Map(
    [...document.getElementsByTagName("Relationship")]
      .map((node) => [node.getAttribute("Id") ?? "", node.getAttribute("Target") ?? ""])
  );
}

/* ------------------------------------------------------------------ zip -- */

/**
 * Распаковка zip средствами браузера, через центральный каталог в конце файла.
 *
 * Идти по локальным заголовкам подряд нельзя: Excel пишет их с нулевым размером, а
 * настоящий кладёт в «дескриптор» после сжатых данных. Искать его перебором сигнатуры
 * ненадёжно — те же четыре байта встречаются внутри самих данных, и на файле «Тайминги»
 * разбор обрывался на первой же записи. В центральном каталоге размеры и смещения
 * записаны точно.
 */
async function unzip(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const directory = findCentralDirectory(data, view);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();

  let entry = directory.offset;
  for (let index = 0; index < directory.count; index += 1) {
    if (entry + 46 > data.length || view.getUint32(entry, true) !== 0x02014b50) {
      break;
    }
    const method = view.getUint16(entry + 10, true);
    const compressed = view.getUint32(entry + 20, true);
    const nameLength = view.getUint16(entry + 28, true);
    const extraLength = view.getUint16(entry + 30, true);
    const commentLength = view.getUint16(entry + 32, true);
    const localOffset = view.getUint32(entry + 42, true);
    const name = decoder.decode(data.subarray(entry + 46, entry + 46 + nameLength));

    // Длина «extra» у локального заголовка своя и с каталогом не совпадает — читаем её
    // на месте, иначе данные поедут на несколько байт.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const bodyStart = localOffset + 30 + localNameLength + localExtraLength;
    const body = data.subarray(bodyStart, bodyStart + compressed);

    files.set(name, method === 0 ? body : await inflateRaw(body));
    entry += 46 + nameLength + extraLength + commentLength;
  }

  if (files.size === 0) {
    throw new Error("Файл не удалось распаковать — похоже, он повреждён");
  }
  return files;
}

/** Хвостовая запись каталога лежит в конце и может иметь комментарий — ищем с конца. */
function findCentralDirectory(
  data: Uint8Array,
  view: DataView
): { readonly offset: number; readonly count: number } {
  const earliest = Math.max(0, data.length - 22 - 65_535);
  for (let at = data.length - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      return {
        count: view.getUint16(at + 10, true),
        offset: view.getUint32(at + 16, true)
      };
    }
  }
  throw new Error("Файл не похож на .xlsx — не найден конец zip-архива");
}

async function inflateRaw(body: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([body as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* --------------------------------------------------------------- общее -- */

function trimEmpty(rows: readonly (readonly string[])[]): readonly (readonly string[])[] {
  let last = rows.length;
  while (last > 0 && (rows[last - 1] ?? []).every((cell) => cell.trim() === "")) {
    last -= 1;
  }
  return rows.slice(0, last);
}

function countOf(value: string, character: string): number {
  return [...value].filter((candidate) => candidate === character).length;
}
