"use client";

import { AdminApiError, importEventParticipants } from "@/lib/admin-api";
import { formatKopecks } from "@/lib/format";
import {
  guessMapping,
  mapParticipants,
  PARTICIPANT_FIELDS,
  type ColumnMapping,
  type MappingResult,
  type ParticipantField
} from "@/lib/participants-mapping";
import { readWorkbook, type Workbook } from "@/lib/spreadsheet";
import { CircleAlert, FileSpreadsheet, Upload, X } from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";

const FIELD_LABELS: Readonly<Record<ParticipantField, string>> = {
  name: "Имя",
  phone: "Телефон",
  telegram: "Telegram",
  amount: "Сумма, ₽",
  sleeping: "Ночует (спальное место)",
  children: "Детей",
  note: "Заметка"
};

const FIELD_HINTS: Readonly<Record<ParticipantField, string>> = {
  name: "Обязательно. Строки без имени пропускаются.",
  phone: "По нему сверяем с покупателями бота, чтобы не завести человека дважды.",
  telegram: "Тоже участвует в сверке с ботом.",
  amount: "Сколько человек заплатил. Пусто — ноль.",
  sleeping: "Кто остаётся ночевать: 1 или пусто. Не путайте с числом арендованных спальников.",
  children: "Если детей считают числом в отдельной колонке. Обычно не нужно.",
  note: "Свободный текст: он попадёт в карточку."
};

/**
 * Перенос списка участников из таблицы.
 *
 * Колонки назначает человек, а не догадка: в августовской таблице «Спальников» означало
 * арендованные мешки, а спальные места — колонку «Ночь». Одна такая догадка уже стоила
 * неудачного импорта, поэтому шаг с сопоставлением обязателен, а предпросмотр показывает
 * итоги до записи.
 */
export function ParticipantsImport({
  eventId,
  onImported,
  onClose
}: {
  readonly eventId: string;
  readonly onImported: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRows, setHeaderRows] = useState(1);
  const [groupCompanions, setGroupCompanions] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const sheet = workbook?.sheets[sheetIndex];
  const header = sheet?.rows[0] ?? [];

  const result: MappingResult | null = useMemo(() => {
    if (!sheet || !mapping || mapping.name === null) {
      return null;
    }
    return mapParticipants(sheet.rows, mapping, { groupCompanions, headerRows });
  }, [sheet, mapping, groupCompanions, headerRows]);

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (file.size > 10_000_000) {
      setError("Файл должен быть не больше 10 МБ.");
      return;
    }
    setError(null);
    setDone(null);
    try {
      const read = await readWorkbook(file);
      setWorkbook(read);
      setFileName(file.name);
      setSheetIndex(0);
      setHeaderRows(1);
      setMapping(guessMapping(read.sheets[0]?.rows[0] ?? []));
    } catch (caught) {
      setWorkbook(null);
      setError(caught instanceof Error ? caught.message : "Не удалось прочитать файл.");
    }
  }

  function chooseSheet(index: number) {
    setSheetIndex(index);
    setHeaderRows(1);
    setMapping(guessMapping(workbook?.sheets[index]?.rows[0] ?? []));
  }

  async function save() {
    if (!result || result.participants.length === 0) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let added = 0;
      const skipped: string[] = [];
      // Пачками по 200: сервер принимает не больше пятисот за запрос.
      for (let offset = 0; offset < result.participants.length; offset += 200) {
        const batch = result.participants.slice(offset, offset + 200);
        const answer = await importEventParticipants(eventId, {
          rows: batch.map((row) => ({
            name: row.name,
            adults: row.adults,
            children: row.children,
            sleeping: row.sleeping,
            amountKopecks: row.amountKopecks,
            ...(row.phone === "" ? {} : { phone: row.phone }),
            ...(row.telegram === "" ? {} : { telegram: row.telegram }),
            ...(row.note === "" ? {} : { note: row.note })
          }))
        });
        added += answer.added;
        skipped.push(...answer.skipped.map((entry) =>
          `${entry.name} — ${entry.reason === "bot_buyer"
            ? "уже купил через бота"
            : "уже заведён"}`));
      }
      await onImported();
      setDone(
        `Заведено ${added}.`
        + (skipped.length > 0 ? ` Пропущено ${skipped.length}: ${skipped.join("; ")}` : "")
      );
      setWorkbook(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось перенести список.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Перенести список из таблицы</h2>
          <span>.xlsx или .csv — колонки назначите сами</span>
        </div>
        <button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      {error ? (
        <div className="accommodation-warning"><span>{error}</span></div>
      ) : null}
      {done ? <div className="outreach-notice">{done}</div> : null}

      <label className="import-drop">
        <input
          type="file"
          className="sr-only"
          accept=".xlsx,.csv"
          onChange={(event) => void pickFile(event)}
        />
        <FileSpreadsheet size={20} aria-hidden="true" />
        <span>
          <strong>{fileName === "" ? "Выберите файл" : fileName}</strong>
          <small>
            Excel читается напрямую — переводить в CSV не нужно, имена не поломаются.
          </small>
        </span>
      </label>

      {workbook && sheet && mapping ? (
        <>
          {workbook.sheets.length > 1 ? (
            <label className="field">
              <span>Лист</span>
              <select
                value={sheetIndex}
                onChange={(event) => chooseSheet(Number(event.target.value))}
              >
                {workbook.sheets.map((item, index) => (
                  <option key={item.name} value={index}>
                    {item.name} ({item.rows.length} строк)
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="section-title-row">
            <div>
              <h2>Какая колонка что означает</h2>
              <span>подставлено по заголовкам — проверьте</span>
            </div>
          </div>

          <div className="participant-form">
            {PARTICIPANT_FIELDS.map((field) => (
              <label className="field" key={field}>
                <span>
                  {FIELD_LABELS[field]}
                  {field === "name" ? " *" : ""}
                </span>
                <select
                  value={mapping[field] ?? ""}
                  onChange={(event) => setMapping({
                    ...mapping,
                    [field]: event.target.value === "" ? null : Number(event.target.value)
                  })}
                >
                  <option value="">— не переносить —</option>
                  {header.map((title, index) => (
                    <option key={`${title}:${index}`} value={index}>
                      {title.trim() === "" ? `Колонка ${index + 1}` : title}
                    </option>
                  ))}
                </select>
                <small className="muted">{FIELD_HINTS[field]}</small>
              </label>
            ))}
            <label className="field">
              <span>Строк заголовка</span>
              <input
                type="number"
                min={0}
                max={10}
                value={headerRows}
                onChange={(event) => setHeaderRows(Number(event.target.value))}
              />
              <small className="muted">Сколько верхних строк пропустить.</small>
            </label>
          </div>

          <label className="checkbox-field import-toggle">
            <input
              type="checkbox"
              checked={groupCompanions}
              onChange={(event) => setGroupCompanions(event.target.checked)}
            />
            <span>
              Строки «С +1», «Муж», «Ребенок» — это спутники предыдущего человека
            </span>
          </label>

          {mapping.name === null ? (
            <div className="accommodation-note">
              <CircleAlert size={16} />
              <span>Укажите колонку с именем — без неё переносить нечего.</span>
            </div>
          ) : null}

          {result ? <Preview result={result} /> : null}

          {result && result.participants.length > 0 ? (
            <button
              className="primary-button"
              type="button"
              disabled={saving}
              onClick={() => void save()}
            >
              <Upload size={16} />
              {saving
                ? "Переношу…"
                : `Перенести ${result.participants.length} карточек`}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Preview({ result }: Readonly<{ result: MappingResult }>) {
  const withCompanions = result.participants.filter((row) => row.companions.length > 0);

  return (
    <>
      <div className="metrics-strip">
        <div>
          <span>Карточек</span>
          <strong>{result.totals.cards}</strong>
          <small className="muted">
            {withCompanions.length > 0
              ? `${withCompanions.length} с спутниками`
              : "все по одному"}
          </small>
        </div>
        <div>
          <span>Гостей</span>
          <strong>{result.totals.guests}</strong>
          <small className="muted">
            {result.totals.adults} взрослых, {result.totals.children} детей
          </small>
        </div>
        <div>
          <span>Ночуют</span>
          <strong>{result.totals.sleeping}</strong>
          <small className="muted">спальных мест</small>
        </div>
        <div>
          <span>Сумма</span>
          <strong>{formatKopecks(result.totals.amountKopecks)}</strong>
          <small className="muted">сверьте со своей таблицей</small>
        </div>
      </div>

      {result.problems.length > 0 ? (
        <div className="accommodation-warning">
          <CircleAlert size={16} />
          <span>
            Не перенесу {result.problems.length} строк:{" "}
            {result.problems
              .slice(0, 5)
              .map((problem) => `${problem.line} ${problem.name} — ${problem.message}`)
              .join("; ")}
            {result.problems.length > 5 ? " и другие" : ""}
          </span>
        </div>
      ) : null}

      <div className="table-wrap import-preview">
        <table>
          <thead>
            <tr>
              <th>Строка</th>
              <th>Имя</th>
              <th>Телефон</th>
              <th>Гостей</th>
              <th>Мест</th>
              <th>Сумма</th>
              <th>С кем</th>
            </tr>
          </thead>
          <tbody>
            {result.participants.map((row) => (
              <tr key={`${row.line}:${row.name}`}>
                <td className="muted">{row.line}</td>
                <td><strong>{row.name}</strong></td>
                <td className="muted">{row.phone === "" ? "—" : row.phone}</td>
                <td>
                  {row.adults + row.children}
                  {row.children > 0 ? (
                    <span className="muted"> · детей {row.children}</span>
                  ) : null}
                </td>
                <td>{row.sleeping === 0 ? "—" : row.sleeping}</td>
                <td className="money-cell">{formatKopecks(row.amountKopecks)}</td>
                <td className="muted">
                  {row.companions.length === 0 ? "—" : row.companions.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
