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
  OutreachPersonCampaign
} from "@ticket-platform/contracts/admin-outreach";
import { ArrowLeft, Search, X } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

/**
 * Постановка задачи «с нуля» — с доски задач или из карточки клиента.
 *
 * Задача в базе висит не на человеке, а на его участии в конкретной кампании, поэтому
 * диалог ведёт по трём шагам: найти человека, выбрать кампанию, назначить шаг. Человека без
 * кампаний он не прячет и не заводит ему кампанию молча — говорит прямо, что задачу поставить
 * не на что, и уводит в карточку.
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
      // Одна кампания — выбирать не из чего, лишний экран только замедляет.
      if (active.length === 1 && active[0]) {
        await pickMembership(active[0]);
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
    if (membership) {
      setMembership(null);
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

        {picked && !person ? (
          <button className="back-link" type="button" onClick={back}>
            <ArrowLeft size={14} />
            {membership ? "Другая кампания" : "Другой человек"}
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

        {picked && !membership && !busy ? (
          activeCampaigns.length === 0 ? (
            <div className="page-warning">
              <strong>Задачу поставить не на что.</strong>{" "}
              Задача ставится по контакту в кампании, а этот человек сейчас ни в одной
              не состоит. Добавьте его в кампанию — из{" "}
              <Link href={`/base/${picked.contactId}`}>карточки</Link> или из самой
              кампании.
            </div>
          ) : (
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
            </ul>
          )
        ) : null}

        {membership ? (
          <div className="outreach-task-create">
            <p className="muted">
              Кампания: {membership.campaignName}
            </p>
            <OutreachTaskForm
              campaignContactId={membership.campaignContactId}
              openTask={contact?.openTask ?? null}
              managers={managers}
              defaultAssignedAdminId={contact?.assignedAdminId ?? null}
              onSaved={onCreated}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function messageFor(caught: unknown, fallback: string): string {
  return caught instanceof AdminApiError ? caught.message : fallback;
}
