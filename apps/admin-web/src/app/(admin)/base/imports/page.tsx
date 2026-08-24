"use client";

import { EmptyState, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  dismissOutreachImportRow,
  listOutreachImports,
  listPendingOutreachImportRows,
  retryOutreachImportRow
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import { useNotice } from "@/lib/use-notice";
import type {
  OutreachImportRow,
  OutreachImportRowRecord,
  OutreachImportRun
} from "@ticket-platform/contracts/admin-outreach";
import { ArrowLeft, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function OutreachImportsPage() {
  const [runs, setRuns] = useState<readonly OutreachImportRun[]>([]);
  const [rows, setRows] = useState<readonly OutreachImportRowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [loadedRuns, loadedRows] = await Promise.all([
        listOutreachImports(signal),
        listPendingOutreachImportRows(undefined, signal)
      ]);
      setRuns(loadedRuns);
      setRows(loadedRows);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить журнал.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function retry(record: OutreachImportRowRecord, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string): string => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    // Источник и примечание в форме не показываем — правят признаки, а не сопутствующее.
    // Но и терять их незачем, поэтому переносим из исходной строки как есть.
    const row: OutreachImportRow = {
      ...(field("name") ? { name: field("name") } : {}),
      ...(field("phone") ? { phone: field("phone") } : {}),
      ...(field("telegram") ? { telegram: field("telegram") } : {}),
      ...(field("max") ? { max: field("max") } : {}),
      ...(field("email") ? { email: field("email") } : {}),
      ...(record.raw.source ? { source: record.raw.source } : {}),
      ...(record.raw.note ? { note: record.raw.note } : {})
    };
    setBusyRowId(record.id);
    setError(null);
    setNotice(null);
    try {
      const result = await retryOutreachImportRow(record.id, row);
      if (!result.resolved) {
        setError(result.reason ?? "Строка всё ещё не разбирается.");
        return;
      }
      setNotice(`Строка ${record.lineNumber} загружена.`);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось загрузить строку.");
    } finally {
      setBusyRowId(null);
    }
  }

  async function dismiss(record: OutreachImportRowRecord) {
    if (!window.confirm(
      `Отбросить строку ${record.lineNumber}? Она исчезнет из журнала, в базу ничего не попадёт.`
    )) {
      return;
    }
    setBusyRowId(record.id);
    setError(null);
    setNotice(null);
    try {
      await dismissOutreachImportRow(record.id);
      setNotice(`Строка ${record.lineNumber} отброшена.`);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось отбросить строку.");
    } finally {
      setBusyRowId(null);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <Link className="back-link" href="/base">
              <ArrowLeft size={14} />
              База контактов
            </Link>
          </p>
          <h1>Загрузки</h1>
          <p>Строки, которые не легли: поправьте и загрузите заново.</p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button bordered"
            type="button"
            title="Обновить"
            aria-label="Обновить"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {notice ? <div className="page-notice">{notice}</div> : null}
      {error ? <div className="page-warning">{error}</div> : null}
      {loading && runs.length === 0 ? <PageLoading /> : null}

      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title="Разбирать нечего"
          description="Все строки последних загрузок легли в базу."
        />
      ) : null}

      {rows.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Не легли</h2>
              <span>{rows.length}</span>
            </div>
          </div>
          <ul className="import-rows">
            {rows.map((record) => (
              <li key={record.id}>
                <div className="import-row-head">
                  <strong>Строка {record.lineNumber}</strong>
                  {record.filename ? (
                    <span className="muted">{record.filename}</span>
                  ) : null}
                  <span className="muted">{record.reason}</span>
                </div>
                <form
                  className="import-row-form"
                  onSubmit={(event) => void retry(record, event)}
                >
                  <label>
                    <span>Имя</span>
                    <input name="name" defaultValue={record.raw.name ?? ""} maxLength={200} />
                  </label>
                  <label>
                    <span>Телефон</span>
                    <input name="phone" defaultValue={record.raw.phone ?? ""} maxLength={100} />
                  </label>
                  <label>
                    <span>Telegram</span>
                    <input
                      name="telegram"
                      defaultValue={record.raw.telegram ?? ""}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    <span>MAX</span>
                    <input name="max" defaultValue={record.raw.max ?? ""} maxLength={100} />
                  </label>
                  <label>
                    <span>Почта</span>
                    <input name="email" defaultValue={record.raw.email ?? ""} maxLength={320} />
                  </label>
                  <div className="import-row-actions">
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={busyRowId === record.id}
                    >
                      {busyRowId === record.id ? "Загружаем…" : "Загрузить"}
                    </button>
                    <button
                      className="secondary-button danger"
                      type="button"
                      disabled={busyRowId === record.id}
                      onClick={() => void dismiss(record)}
                    >
                      <Trash2 size={15} />
                      Отбросить
                    </button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {runs.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>История загрузок</h2>
              <span>{runs.length}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Файл</th>
                  <th>Куда</th>
                  <th>Кто</th>
                  <th>Заведено</th>
                  <th>Обновлено</th>
                  <th>Не легло</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td>{run.filename ?? <span className="muted">без имени</span>}</td>
                    <td>
                      {run.campaignName ?? <span className="muted">в базу</span>}
                    </td>
                    <td>{run.createdByName}</td>
                    <td>{run.createdContacts}</td>
                    <td>{run.updatedContacts}</td>
                    <td>
                      {run.pendingRows > 0 ? (
                        <strong>{run.pendingRows}</strong>
                      ) : (
                        <span className="muted">
                          {run.invalidRows + run.ambiguousRows > 0 ? "разобрано" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
