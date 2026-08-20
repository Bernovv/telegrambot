"use client";

import { OutreachTaskForm } from "@/components/outreach-task-form";
import { PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  getOutreachContact,
  getOutreachPerson,
  listOutreachPeople
} from "@/lib/admin-api";
import type {
  OutreachCampaignContactDetail,
  OutreachManager,
  OutreachPerson,
  OutreachPersonCard,
  OutreachPersonCampaign,
  OutreachTask
} from "@ticket-platform/contracts/admin-outreach";
import { ArrowLeft, Search, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

/**
 * Постановка задачи «с нуля» — с доски задач или из карточки клиента.
 *
 * Два шага: найти человека и назначить шаг. Кампания между ними необязательна — задача
 * принадлежит человеку, а кампания её только уточняет и ставит в свою воронку. Поэтому
 * задачу можно поставить и тому, кто ни в одной кампании не состоит.
 */
export function OutreachNewTaskDialog({
  person,
  managers,
  onClose,
  onCreated
}: {
  /** Человек уже известен — шаг поиска пропускается. */
  readonly person: { readonly contactId: string } | null;
  readonly managers: readonly OutreachManager[];
  readonly onClose: () => void;
  readonly onCreated: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly OutreachPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<OutreachPersonCard | null>(null);
  const [membership, setMembership] = useState<OutreachPersonCampaign | null>(null);
  // Задача по человеку, без кампании: либо кампаний нет вовсе, либо менеджер отказался
  // привязывать шаг к какой-то одной.
  const [personTask, setPersonTask] = useState<OutreachPersonCard | null>(null);
  const [contact, setContact] = useState<OutreachCampaignContactDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickPerson = useCallback(async (contactId: string) => {
    setBusy(true);
    setError(null);
    try {
      const card = await getOutreachPerson(contactId);
      setPicked(card);
      const active = card.campaigns.filter((item) => item.removedAt === null);
      // Одна кампания — выбирать не из чего, лишний экран только замедляет. Ни одной —
      // ставим задачу по человеку и не заставляем заводить кампанию ради звонка.
      if (active.length === 1 && active[0]) {
        await pickMembership(active[0]);
        return;
      }
      if (active.length === 0) {
        setPersonTask(card);
      }
    } catch (caught) {
      setError(messageFor(caught, "Не удалось открыть карточку человека."));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (person) {
      void pickPerson(person.contactId);
    }
  }, [person, pickPerson]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Для поиска нужно хотя бы две буквы или цифры.");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const page = await listOutreachPeople({ search: trimmed, limit: 20 });
      setResults(page.items);
      if (page.items.length === 0) {
        setError("Никого не нашлось. Проверьте написание или заведите человека в базе.");
      }
    } catch (caught) {
      setError(messageFor(caught, "Не удалось найти человека."));
    } finally {
      setSearching(false);
    }
  }

  // Открытую задачу видно только из карточки контакта кампании. Без неё диалог не смог бы
  // предупредить, что новая задача заменит прежнюю, — а она заменит её молча.
  async function pickMembership(item: OutreachPersonCampaign) {
    setMembership(item);
    setError(null);
    try {
      setContact(await getOutreachContact(item.campaignContactId));
    } catch {
      setContact(null);
    }
  }

  function back() {
    if (membership || personTask) {
      setMembership(null);
      setPersonTask(null);
      setContact(null);
      return;
    }
    setPicked(null);
    setResults([]);
  }

  const activeCampaigns = picked?.campaigns.filter((item) => item.removedAt === null)
    ?? [];

  return (
    <div className="outreach-modal-backdrop" role="presentation">
      <section
        className="outreach-modal outreach-small-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-title"
      >
        <div className="section-title-row">
          <div>
            <h2 id="new-task-title">Поставить задачу</h2>
            <span>
              {picked
                ? picked.displayName ?? "Без имени"
                : "Найдите человека в базе"}
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {picked && (!person || membership || personTask) ? (
          <button className="back-link" type="button" onClick={back}>
            <ArrowLeft size={14} />
            {membership || personTask ? "Выбрать иначе" : "Другой человек"}
          </button>
        ) : null}

        {error ? <div className="page-warning">{error}</div> : null}
        {busy ? <PageLoading label="Открываем карточку" /> : null}

        {!picked && !busy ? (
          <>
            <form className="base-search" onSubmit={(event) => void search(event)}>
              <label className="base-search-field">
                <Search size={16} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Имя, телефон, Telegram, MAX или почта"
                  maxLength={100}
                  autoFocus
                />
              </label>
              <button className="secondary-button" type="submit" disabled={searching}>
                {searching ? "Ищем…" : "Найти"}
              </button>
            </form>
            {results.length > 0 ? (
              <ul className="merge-candidates">
                {results.map((candidate) => (
                  <li key={candidate.contactId}>
                    <div className="stacked-cell">
                      <strong>{candidate.displayName ?? "Без имени"}</strong>
                      <span className="muted">
                        {[
                          candidate.phone,
                          candidate.telegramUsername
                            ? `@${candidate.telegramUsername}`
                            : null,
                          candidate.campaignCount > 0
                            ? `в ${candidate.campaignCount} кампаниях`
                            : "нигде не задействован"
                        ].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void pickPerson(candidate.contactId)}
                    >
                      Выбрать
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {picked && !membership && !personTask && !busy ? (
          <>
            <p className="muted">
              К какой кампании отнести задачу? Это влияет только на то, в чьей воронке она
              будет видна.
            </p>
            <ul className="merge-candidates">
              {activeCampaigns.map((item) => (
                <li key={item.campaignContactId}>
                  <div className="stacked-cell">
                    <strong>{item.campaignName}</strong>
                    <span className="muted">
                      {item.stageLabel}
                      {item.assignedAdminName ? ` · ${item.assignedAdminName}` : ""}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void pickMembership(item)}
                  >
                    Выбрать
                  </button>
                </li>
              ))}
              <li>
                <div className="stacked-cell">
                  <strong>Без кампании</strong>
                  <span className="muted">задача про человека вообще</span>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setPersonTask(picked)}
                >
                  Выбрать
                </button>
              </li>
            </ul>
          </>
        ) : null}

        {membership ? (
          <div className="outreach-task-create">
            <p className="muted">
              Кампания: {membership.campaignName}
            </p>
            <OutreachTaskForm
              target={{
                kind: "campaign",
                campaignContactId: membership.campaignContactId
              }}
              openTask={contact?.openTask ?? null}
              managers={managers}
              defaultAssignedAdminId={contact?.assignedAdminId ?? null}
              onSaved={onCreated}
            />
          </div>
        ) : null}

        {personTask ? (
          <div className="outreach-task-create">
            <p className="muted">Без кампании — задача про человека вообще</p>
            <OutreachTaskForm
              target={{ kind: "person", contactId: personTask.contactId }}
              openTask={openPersonTask(personTask)}
              managers={managers}
              defaultAssignedAdminId={null}
              onSaved={onCreated}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Открытая задача про человека вообще. Именно её заменит новая — о чём форма и скажет. */
function openPersonTask(person: OutreachPersonCard): OutreachTask | null {
  return person.tasks.find(
    (task) => task.status === "open" && task.campaignContactId === null
  ) ?? null;
}

function messageFor(caught: unknown, fallback: string): string {
  return caught instanceof AdminApiError ? caught.message : fallback;
}
