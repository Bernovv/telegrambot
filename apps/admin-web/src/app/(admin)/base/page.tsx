"use client";

import { EmptyState, PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  importOutreachPeople,
  listOutreachPeople,
  listPendingOutreachImportRows,
  startOutreachImport
} from "@/lib/admin-api";
import { formatCompactDate } from "@/lib/format";
import { parseOutreachCsv } from "@/lib/outreach-csv";
import {
  type OutreachPerson,
  type OutreachPersonFilter
} from "@ticket-platform/contracts/admin-outreach";
import { ArrowRight, Bot, RefreshCw, Search, Upload } from "lucide-react";
import Link from "next/link";
import { type ChangeEvent, useCallback, useEffect, useState } from "react";

const PAGE_SIZE = 50;

/**
 * Отборы намеренно взаимоисключающие и их шесть. Набор галочек даёт больше сочетаний, но
 * каждое из них надо держать в голове, а вопросы к базе на деле звучат по одному за раз:
 * «у кого нет телефона», «кого нет ни в одной кампании».
 */
const FILTERS: readonly { readonly value: OutreachPersonFilter; readonly label: string }[] = [
  { value: "all", label: "Все" },
  { value: "without_phone", label: "Без телефона" },
  { value: "without_name", label: "Без имени" },
  { value: "without_campaign", label: "Не в кампаниях" },
  { value: "in_bot", label: "В боте" },
  { value: "archived", label: "Архив" }
];

export default function OutreachBasePage() {
  const [items, setItems] = useState<readonly OutreachPerson[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<OutreachPersonFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImportRows, setPendingImportRows] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listOutreachPeople(
        {
          ...(search.length >= 2 ? { search } : {}),
          filter,
          page,
          limit: PAGE_SIZE
        },
        signal
      );
      setItems(result.items);
      setTotal(result.total);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить базу.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [search, filter, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Счётчик неразобранных строк грузим молча: без него страница работает, просто без
  // напоминания о том, что осталось в журнале.
  useEffect(() => {
    const controller = new AbortController();
    void listPendingOutreachImportRows(undefined, controller.signal)
      .then((items) => setPendingImportRows(items.length))
      .catch(() => setPendingImportRows(0));
    return () => controller.abort();
  }, []);

  // Поиск по короткой строке сервер не примет, и это правильно: «ан» найдёт пол-базы.
  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = searchInput.trim();
    if (value.length === 1) {
      return;
    }
    setPage(1);
    setSearch(value);
  }

  function pick(value: OutreachPersonFilter) {
    setPage(1);
    setFilter(value);
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Поле сбрасываем сразу: иначе тот же файл нельзя выбрать второй раз после ошибки.
    event.target.value = "";
    if (!file) {
      return;
    }
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const { rows, lines, skippedLines } = parseOutreachCsv(await file.text());
      const skippedNote = skippedLines.length > 0
        ? ` Пропущено строк без контакта: ${skippedLines.length}.`
        : "";
      if (!window.confirm(
        `Загрузить в базу ${rows.length} контактов?${skippedNote}\n\n`
        + "Кто уже есть — обновится, ни в какую кампанию никто не попадёт."
      )) {
        return;
      }
      let created = 0;
      let updated = 0;
      let pending = 0;
      // Загрузка заводится в журнале до первой пачки: тогда строки, которые не лягут,
      // найдутся и после закрытия вкладки, а не только в этом сообщении.
      const { importId } = await startOutreachImport({ filename: file.name });
      // Пачками: сервер принимает не больше 500 строк за запрос, а на восьми тысячах
      // контактов это полсотни запросов — показываем, докуда дошли.
      for (let offset = 0; offset < rows.length; offset += 150) {
        const result = await importOutreachPeople(
          rows.slice(offset, offset + 150),
          { importId, lines: lines.slice(offset, offset + 150) }
        );
        created += result.createdContacts;
        updated += result.updatedContacts;
        pending += (result.invalidRowIndexes ?? []).length
          + (result.ambiguousRowIndexes ?? []).length;
        setNotice(
          `Загружаем: ${Math.min(offset + 150, rows.length)} из ${rows.length}…`
        );
      }
      const pendingNote = pending > 0
        ? ` Не легло строк: ${pending} — они ждут в журнале загрузок.`
        : "";
      setNotice(
        `Готово. Заведено: ${created}, обновлено: ${updated}.${pendingNote}`
      );
      setPendingImportRows(pending);
      setPage(1);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : caught instanceof Error
          ? caught.message
          : "Не удалось загрузить файл.");
    } finally {
      setImporting(false);
    }
  }

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Продажи</p>
          <h1>База контактов</h1>
          <p>Все люди, которых мы знаем, — независимо от кампаний.</p>
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
          <label className="primary-button base-import">
            <Upload size={17} />
            {importing ? "Загружаем…" : "Загрузить CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              onChange={(event) => void importCsv(event)}
            />
          </label>
        </div>
      </div>

      {notice ? <div className="page-notice">{notice}</div> : null}
      {pendingImportRows > 0 ? (
        <div className="page-warning">
          Строк из загрузок ждёт разбора: {pendingImportRows}.{" "}
          <Link href="/base/imports">Открыть журнал загрузок</Link>
        </div>
      ) : null}

      <section className="data-section">
        <form className="base-search" onSubmit={submitSearch}>
          <label className="base-search-field">
            <Search size={16} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Имя, телефон, Telegram, MAX или почта"
              maxLength={100}
            />
          </label>
          <button className="secondary-button" type="submit">Найти</button>
          {search ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setPage(1);
              }}
            >
              Сбросить
            </button>
          ) : null}
        </form>

        <div className="base-filters">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === filter ? "base-chip active" : "base-chip"}
              onClick={() => pick(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {loading && items.length === 0 ? <PageLoading /> : null}
      {error ? <PageError message={error} retry={() => void load()} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title="Здесь пусто"
          description={
            search || filter !== "all"
              ? "По этому запросу никого нет. Попробуйте другой отбор."
              : "В базе пока нет контактов. Загрузите их через кампанию."
          }
        />
      ) : null}

      {!error && items.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Контакты</h2>
              <span>{total}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Человек</th>
                  <th>Телефон</th>
                  <th>Мессенджеры</th>
                  <th>Почта</th>
                  <th>Кампании</th>
                  <th>Последний контакт</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((person) => (
                  <tr key={person.contactId}>
                    <td>
                      <div className="stacked-cell">
                        <strong>
                          {person.displayName ?? (
                            <span className="muted">Без имени</span>
                          )}
                        </strong>
                        {person.source ? (
                          <span className="muted">{person.source}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {person.phone ?? <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="stacked-cell">
                        {person.telegramUsername ? (
                          <span>@{person.telegramUsername}</span>
                        ) : null}
                        {person.maxIdentifier ? (
                          <span className="muted">MAX: {person.maxIdentifier}</span>
                        ) : null}
                        {!person.telegramUsername && !person.maxIdentifier ? (
                          <span className="muted">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{person.email ?? <span className="muted">—</span>}</td>
                    <td>
                      <div className="base-campaign-cell">
                        <span>{person.campaignCount}</span>
                        {person.linkedUserId ? (
                          <span className="base-bot-badge" title="Есть в боте">
                            <Bot size={13} />
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {person.lastActivityAt
                        ? formatCompactDate(person.lastActivityAt)
                        : <span className="muted">не связывались</span>}
                    </td>
                    <td>
                      <Link className="row-link" href={`/base/${person.contactId}`}>
                        <ArrowRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lastPage > 1 ? (
            <div className="base-pager">
              <button
                className="secondary-button"
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Назад
              </button>
              <span className="muted">Страница {page} из {lastPage}</span>
              <button
                className="secondary-button"
                type="button"
                disabled={page >= lastPage || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Дальше
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
