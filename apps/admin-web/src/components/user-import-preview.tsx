"use client";

import {
  AdminApiError,
  analyzeAdminUserImport,
  decideAdminUserImportRow,
  listAdminUserImportRows,
  previewAdminUserImport
} from "@/lib/admin-api";
import { formatCompactDate } from "@/lib/format";
import type {
  AdminUserImportBatch,
  AdminUserImportDecisionAction,
  AdminUserImportMatchAnalysis,
  AdminUserImportMatchKind,
  AdminUserImportMatchRow
} from "@ticket-platform/contracts/admin-imports";
import { Check, ChevronDown, FileCheck2, Upload } from "lucide-react";
import { useState } from "react";

const MAX_FILE_BYTES = 512 * 1_024;

export function UserImportPreview() {
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [batch, setBatch] = useState<AdminUserImportBatch | null>(null);
  const [analysis, setAnalysis] =
    useState<AdminUserImportMatchAnalysis | null>(null);
  const [reusedExisting, setReusedExisting] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [savingRowNumber, setSavingRowNumber] =
    useState<number | null>(null);
  const [nextAfterRowNumber, setNextAfterRowNumber] =
    useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function preview() {
    if (!file || !reason.trim()) {
      setError("Выберите CSV-файл и укажите причину.");
      return;
    }
    if (
      file.size < 1
      || file.size > MAX_FILE_BYTES
      || !file.name.toLowerCase().endsWith(".csv")
    ) {
      setError("CSV-файл должен быть размером от 1 байта до 512 КиБ.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await previewAdminUserImport({
        fileName: file.name,
        contentBase64: await fileToBase64(file),
        reason
      });
      setBatch(result.batch);
      const matched = await analyzeAdminUserImport(
        result.batch.id,
        { reason }
      );
      setAnalysis(matched.analysis);
      setNextAfterRowNumber(
        matched.analysis.previewRows.length < matched.analysis.totalRowCount
          ? matched.analysis.previewRows.at(-1)?.rowNumber ?? null
          : null
      );
      setReusedExisting(
        result.reusedExisting || matched.reusedExisting
      );
      setReason("");
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveDecision(
    row: AdminUserImportMatchRow,
    action: AdminUserImportDecisionAction,
    targetUserId: string | null
  ) {
    if (!analysis || !decisionReason.trim()) {
      setError("Укажите причину решения по строке.");
      return;
    }
    setSavingRowNumber(row.rowNumber);
    setError(null);
    try {
      const result = await decideAdminUserImportRow(
        analysis.id,
        row.rowNumber,
        {
          action,
          targetUserId,
          expectedDecisionVersion: row.decision?.version ?? 0,
          reason: decisionReason
        }
      );
      setAnalysis((current) => current
        ? {
            ...current,
            previewRows: current.previewRows.map((currentRow) =>
              currentRow.rowNumber === row.rowNumber
                ? { ...currentRow, decision: result.decision }
                : currentRow
            )
          }
        : current);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSavingRowNumber(null);
    }
  }

  async function loadMoreRows() {
    if (!analysis || nextAfterRowNumber === null) {
      return;
    }
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listAdminUserImportRows(
        analysis.id,
        nextAfterRowNumber
      );
      setAnalysis((current) => current
        ? {
            ...current,
            previewRows: [
              ...current.previewRows,
              ...page.rows
            ]
          }
        : current);
      setNextAfterRowNumber(page.nextAfterRowNumber);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      {error ? <div className="inline-alert">{error}</div> : null}
      <section className="data-section import-upload-section">
        <div className="section-title-row">
          <div>
            <h2>CSV-файл пользователей</h2>
            <span>UTF-8 · до 512 КиБ · до 5000 строк</span>
          </div>
        </div>
        <div className="broadcast-form-grid">
          <label className="field field-full">
            <span>Файл</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setBatch(null);
                setAnalysis(null);
                setDecisionReason("");
                setNextAfterRowNumber(null);
                setError(null);
              }}
            />
          </label>
          <label className="field field-full">
            <span>Причина загрузки</span>
            <input
              value={reason}
              maxLength={500}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            className="primary-button"
            type="button"
            disabled={busy || !file || !reason.trim()}
            onClick={() => void preview()}
          >
            <Upload size={17} />
            {busy ? "Сопоставляем" : "Подготовить предпросмотр"}
          </button>
        </div>
      </section>

      {batch && analysis ? (
        <section className="data-section import-preview-section">
          <div className="section-title-row">
            <div>
              <h2>Предпросмотр</h2>
              <span>
                {batch.fileName} · {formatCompactDate(batch.createdAt)}
              </span>
            </div>
            <span className="status-pill">
              <FileCheck2 size={15} />
              {reusedExisting ? "Ранее сопоставлен" : "Сопоставлен"}
            </span>
          </div>
          <div className="import-summary">
            <Summary label="Всего" value={analysis.totalRowCount} />
            <Summary label="Новые" value={analysis.newRowCount} />
            <Summary
              label="Без изменений"
              value={analysis.exactMatchNoChangeRowCount}
            />
            <Summary
              label="Дополнить"
              value={analysis.mergeNewFieldsRowCount}
            />
            <Summary
              label="Возможные"
              value={analysis.possibleMatchRowCount}
            />
            <Summary label="Конфликты" value={analysis.conflictRowCount} />
            <Summary label="Ошибки" value={analysis.invalidRowCount} />
            <Summary label="Пропущены" value={analysis.ignoredRowCount} />
          </div>
          {analysis.possibleMatchRowCount + analysis.conflictRowCount > 0 ? (
            <div className="import-decision-bar">
              <label className="field">
                <span>Причина решений</span>
                <input
                  value={decisionReason}
                  maxLength={500}
                  disabled={savingRowNumber !== null}
                  onChange={(event) =>
                    setDecisionReason(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="data-table import-preview-table">
              <thead>
                <tr>
                  <th>Строка</th>
                  <th>Статус</th>
                  <th>Пользователь</th>
                  <th>Идентификаторы</th>
                  <th>Совпадение</th>
                  <th>Проверки</th>
                  <th>Решение</th>
                </tr>
              </thead>
              <tbody>
                {analysis.previewRows.map((row) => (
                  <ImportRow
                    key={row.rowNumber}
                    row={row}
                    reasonReady={Boolean(decisionReason.trim())}
                    saving={savingRowNumber === row.rowNumber}
                    onSave={(action, targetUserId) =>
                      void saveDecision(row, action, targetUserId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {nextAfterRowNumber !== null ? (
            <div className="import-load-more">
              <button
                type="button"
                className="secondary-button"
                disabled={loadingMore}
                onClick={() => void loadMoreRows()}
              >
                <ChevronDown size={16} />
                {loadingMore ? "Загружаем" : "Показать ещё"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function Summary({ label, value }: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ImportRow({ row, reasonReady, saving, onSave }: {
  readonly row: AdminUserImportMatchRow;
  readonly reasonReady: boolean;
  readonly saving: boolean;
  readonly onSave: (
    action: AdminUserImportDecisionAction,
    targetUserId: string | null
  ) => void;
}) {
  const normalized = row.normalized;
  const name = [
    normalized?.firstName,
    normalized?.lastName
  ].filter(Boolean).join(" ") || "—";
  const identities = [
    normalized?.telegramUserId
      ? `TG ${normalized.telegramUserId}`
      : null,
    normalized?.telegramUsername
      ? `@${normalized.telegramUsername}`
      : null,
    normalized?.phone,
    normalized?.externalCrmId
      ? `CRM ${normalized.externalCrmId}`
      : null
  ].filter(Boolean).join(" · ") || "—";
  const match = row.matchedUserId
    ? `Пользователь ${shortId(row.matchedUserId)}`
    : row.candidateUserIds.length > 0
      ? `Кандидаты: ${row.candidateUserIds.map(shortId).join(", ")}`
      : "—";
  const matchKinds = row.matchKinds.map(matchKindLabel).join(", ");
  return (
    <tr>
      <td>{row.rowNumber}</td>
      <td>
        <span className={`status-pill import-status-${row.status.toLowerCase()}`}>
          {statusLabel(row.status)}
        </span>
      </td>
      <td>{name}</td>
      <td>{identities}</td>
      <td>
        {match}
        {matchKinds ? <small className="table-note">{matchKinds}</small> : null}
      </td>
      <td>{row.issueCodes.map(issueLabel).join(", ") || "—"}</td>
      <td>
        {row.status === "POSSIBLE_MATCH" || row.status === "CONFLICT" ? (
          <DecisionControl
            row={row}
            reasonReady={reasonReady}
            saving={saving}
            onSave={onSave}
          />
        ) : "—"}
      </td>
    </tr>
  );
}

function DecisionControl({
  row,
  reasonReady,
  saving,
  onSave
}: {
  readonly row: AdminUserImportMatchRow;
  readonly reasonReady: boolean;
  readonly saving: boolean;
  readonly onSave: (
    action: AdminUserImportDecisionAction,
    targetUserId: string | null
  ) => void;
}) {
  const canCreate = row.status === "POSSIBLE_MATCH"
    && !row.matchKinds.includes("imported_phone");
  const initialAction = row.decision?.action
    ?? "MERGE_SAFE_FIELDS";
  const [action, setAction] =
    useState<AdminUserImportDecisionAction>(initialAction);
  const [targetUserId, setTargetUserId] = useState(
    row.decision?.targetUserId
      ?? row.candidateUserIds[0]
      ?? ""
  );
  return (
    <div className="import-decision-control">
      {row.decision ? (
        <span className="decision-version">
          {decisionLabel(row.decision.action)} · v{row.decision.version}
        </span>
      ) : null}
      <select
        aria-label={`Решение для строки ${row.rowNumber}`}
        value={action}
        disabled={saving}
        onChange={(event) =>
          setAction(event.target.value as AdminUserImportDecisionAction)}
      >
        <option value="MERGE_SAFE_FIELDS">Дополнить кандидата</option>
        {canCreate ? (
          <option value="CREATE_NEW_USER">Создать отдельно</option>
        ) : null}
        <option value="IGNORE_ROW">Пропустить строку</option>
      </select>
      {action === "MERGE_SAFE_FIELDS" ? (
        <select
          aria-label={`Кандидат для строки ${row.rowNumber}`}
          value={targetUserId}
          disabled={saving}
          onChange={(event) => setTargetUserId(event.target.value)}
        >
          {row.candidateUserIds.map((userId) => (
            <option key={userId} value={userId}>
              Пользователь {shortId(userId)}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        className="icon-button decision-save-button"
        title="Сохранить решение"
        disabled={
          saving
          || !reasonReady
          || (action === "MERGE_SAFE_FIELDS" && !targetUserId)
        }
        onClick={() =>
          onSave(
            action,
            action === "MERGE_SAFE_FIELDS" ? targetUserId : null
          )}
      >
        <Check size={16} />
      </button>
    </div>
  );
}

function decisionLabel(action: AdminUserImportDecisionAction): string {
  switch (action) {
    case "CREATE_NEW_USER":
      return "Создать отдельно";
    case "MERGE_SAFE_FIELDS":
      return "Дополнить кандидата";
    case "IGNORE_ROW":
      return "Пропустить";
  }
}

function statusLabel(status: AdminUserImportMatchRow["status"]): string {
  switch (status) {
    case "NEW":
      return "Новая";
    case "EXACT_MATCH_NO_CHANGE":
      return "Без изменений";
    case "MERGE_NEW_FIELDS":
      return "Можно дополнить";
    case "POSSIBLE_MATCH":
      return "Возможное совпадение";
    case "CONFLICT":
      return "Конфликт";
    case "INVALID":
      return "Ошибка";
    case "IGNORED":
      return "Пропущена";
  }
}

function issueLabel(code: string): string {
  const labels: Readonly<Record<string, string>> = {
    duplicate_in_file: "дубликат в файле",
    identity_required: "нет идентификатора",
    invalid_telegram_id: "неверный Telegram ID",
    invalid_telegram_username: "неверное имя Telegram",
    invalid_phone: "неверный телефон",
    invalid_external_crm_id: "неверный CRM ID",
    invalid_first_name: "неверное имя",
    invalid_last_name: "неверная фамилия",
    identity_conflict: "идентификаторы ведут к разным людям",
    username_requires_confirmation: "username требует подтверждения",
    imported_phone_requires_confirmation: "импортированный телефон требует подтверждения",
    provisional_identity_conflict: "предварительные признаки противоречат друг другу",
    verified_phone_conflict: "подтверждённый телефон отличается",
    existing_username_preserved: "существующий username будет сохранён",
    existing_first_name_preserved: "существующее имя будет сохранено",
    existing_last_name_preserved: "существующая фамилия будет сохранена"
  };
  return labels[code] ?? code;
}

function matchKindLabel(kind: AdminUserImportMatchKind): string {
  const labels: Readonly<Record<AdminUserImportMatchKind, string>> = {
    telegram_id: "Telegram ID",
    verified_phone: "подтверждённый телефон",
    imported_phone: "импортированный телефон",
    external_crm_id: "CRM ID",
    telegram_username: "Telegram username"
  };
  return labels[kind];
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return window.btoa(binary);
}

function message(caught: unknown): string {
  if (caught instanceof AdminApiError || caught instanceof Error) {
    return caught.message;
  }
  return "Не удалось подготовить предпросмотр импорта.";
}
