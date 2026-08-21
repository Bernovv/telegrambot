"use client";

import { OutreachNewTaskDialog } from "@/components/outreach-new-task-dialog";
import { OutreachTouchDialog } from "@/components/outreach-touch-dialog";
import { OwnBadge } from "@/components/own-badge";
import {
  PersonContactsCard,
  PersonCustomFieldsCard,
  PersonEventsCard,
  PersonFacts,
  PersonHistoryCard,
  PersonKnowledgeCard,
  PersonOrdersCard,
  PersonOriginCard,
  plural
} from "@/components/person-card";
import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  addExistingContactsToCampaign,
  archiveOutreachPerson,
  completeOutreachTask,
  createOutreachNote,
  deleteOutreachNote,
  markOutreachPersonOwn,
  deleteOutreachPerson,
  getOutreachPerson,
  listOutreachCampaigns,
  listOutreachManagers,
  listOutreachPeople,
  mergeOutreachPeople,
  restoreOutreachPerson,
  updateOutreachPerson
} from "@/lib/admin-api";
import { formatCompactDate, formatDateTime } from "@/lib/format";
import { taskTypeLabel } from "@/lib/outreach-labels";
import type {
  OutreachDeleteBlocker,
  OutreachCampaignSummary,
  OutreachManager,
  OutreachMergeBlocker,
  OutreachPerson,
  OutreachPersonCampaign,
  OutreachPersonCard
} from "@ticket-platform/contracts/admin-outreach";
import {
  ArchiveRestore,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Merge,
  MoreHorizontal,
  Pencil,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  use,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

const BLOCKER_LABELS: Record<OutreachDeleteBlocker, string> = {
  in_bot: "человек есть в боте — там его согласия и, возможно, оплаты",
  has_activity: "по нему есть звонки и сообщения, их нельзя стирать",
  has_participation: "он записан на мероприятие"
};

const MERGE_BLOCKER_LABELS: Record<OutreachMergeBlocker, string> = {
  same_contact: "Это один и тот же контакт.",
  already_merged: "Эта карточка уже объединена с другой.",
  target_already_merged:
    "Выбранный контакт сам является дублем. Выберите того, к кому его свели."
};

const CONFLICT_FIELDS: Record<string, string> = {
  phone: "Телефон",
  telegram: "Telegram",
  max: "MAX",
  email: "Почта"
};

export default function OutreachPersonPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = use(params);
  const router = useRouter();
  const [person, setPerson] = useState<OutreachPersonCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [blockers, setBlockers] = useState<readonly OutreachDeleteBlocker[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeResults, setMergeResults] = useState<readonly OutreachPerson[]>([]);
  const [mergeSearching, setMergeSearching] = useState(false);
  const [managers, setManagers] = useState<readonly OutreachManager[]>([]);
  const [touchCampaign, setTouchCampaign] =
    useState<OutreachPersonCampaign | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [campaigns, setCampaigns] =
    useState<readonly OutreachCampaignSummary[]>([]);
  const menuRef = useRef<HTMLDetailsElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setPerson(await getOutreachPerson(id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить карточку.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Менеджеры и кампании нужны только двум действиям — грузим молча: без них карточка
  // работает, просто ответственного не выбрать и в кампанию отсюда не добавить.
  useEffect(() => {
    const controller = new AbortController();
    void listOutreachManagers(controller.signal)
      .then(setManagers)
      .catch(() => setManagers([]));
    void listOutreachCampaigns(controller.signal)
      .then(setCampaigns)
      .catch(() => setCampaigns([]));
    return () => controller.abort();
  }, []);

  // <details> сам по себе закрывается только повторным кликом по кнопке. Меню действий,
  // оставшееся открытым поверх карточки, — это то, что видит менеджер после «Удалить».
  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) {
        menu.open = false;
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && menuRef.current?.open) {
        menuRef.current.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function messageFor(caught: unknown, fallback: string): string {
    return caught instanceof AdminApiError ? caught.message : fallback;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = data.get(name);
      // Пустое поле — это осознанное «стереть», а не «не менять»: правка приходит целиком.
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateOutreachPerson(id, {
        name: field("name"),
        phone: field("phone"),
        telegram: field("telegram"),
        max: field("max"),
        email: field("email"),
        source: field("source"),
        note: field("note")
      });
      if (result.status === "conflict") {
        const label = CONFLICT_FIELDS[result.conflict.field] ?? "Признак";
        const owner = result.conflict.displayName ?? "другого контакта";
        setError(
          `${label} уже занят: ${owner}. Это опечатка или тот же человек заведён дважды —`
          + " во втором случае контакты нужно объединить, а не переписывать."
        );
        return;
      }
      setEditing(false);
      setNotice("Карточка сохранена.");
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить карточку."));
    } finally {
      setMutating(false);
    }
  }

  async function toggleArchive() {
    if (!person) {
      return;
    }
    if (!person.archivedAt) {
      const reason = window.prompt(
        "Убрать человека из базы? Он исчезнет из списков и подбора в кампании,"
        + " история сохранится. Почему убираем?"
      );
      if (reason === null) {
        return;
      }
      await run(
        () => archiveOutreachPerson(id, reason.trim() || undefined),
        "Человек убран из базы."
      );
      return;
    }
    await run(() => restoreOutreachPerson(id), "Человек возвращён в базу.");
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось выполнить действие."));
    } finally {
      setMutating(false);
    }
  }

  async function toggleOwn() {
    if (!person) {
      return;
    }
    if (person.isOwn) {
      await run(
        () => markOutreachPersonOwn(id, { isOwn: false }),
        "Пометка снята."
      );
      return;
    }
    const note = window.prompt(
      "Пометить человека своим? Менеджеры увидят плашку везде, где он показан,"
      + " и обзванивать его не будут.\n\nКто это? Можно не заполнять."
    );
    if (note === null) {
      return;
    }
    await run(
      () => markOutreachPersonOwn(id, {
        isOwn: true,
        ...(note.trim() ? { note: note.trim() } : {})
      }),
      "Человек помечен своим."
    );
  }

  async function saveNote(body: string): Promise<boolean> {
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      await createOutreachNote(id, body);
      await load();
      return true;
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить заметку."));
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function removeNote(noteId: string) {
    if (!window.confirm("Снять заметку? В карточке её больше не будет.")) {
      return;
    }
    await run(() => deleteOutreachNote(noteId), "Заметка снята.");
  }

  async function addToCampaign(event: ChangeEvent<HTMLSelectElement>) {
    const campaignId = event.target.value;
    if (!campaignId) {
      return;
    }
    event.target.value = "";
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addExistingContactsToCampaign({
        campaignId,
        contactIds: [id]
      });
      // Повтор — не ошибка: менеджер мог не заметить кампанию в списке ниже. Но и молча
      // отвечать «добавлен» на «уже был» нельзя, иначе непонятно, что произошло.
      setNotice(result.added > 0
        ? "Человек добавлен в кампанию."
        : "Он уже состоит в этой кампании.");
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось добавить в кампанию."));
    } finally {
      setMutating(false);
    }
  }

  async function searchForMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = mergeQuery.trim();
    if (query.length < 2) {
      return;
    }
    setMergeSearching(true);
    setError(null);
    try {
      const page = await listOutreachPeople({ search: query, limit: 20 });
      // Себя в списке кандидатов быть не должно: объединить карточку с самой собой нельзя.
      setMergeResults(page.items.filter((item) => item.contactId !== id));
    } catch (caught) {
      setError(messageFor(caught, "Не удалось найти контакты."));
    } finally {
      setMergeSearching(false);
    }
  }

  async function merge(target: OutreachPerson) {
    const targetName = target.displayName ?? "контакт без имени";
    if (!window.confirm(
      `Признать эту карточку дублем и свести её к «${targetName}»?\n\n`
      + "История звонков, кампании и мероприятия перейдут туда. Эта карточка останется"
      + " указателем на главного — старые ссылки продолжат работать."
    )) {
      return;
    }
    const reason = window.prompt("Почему это один человек? Останется в журнале.");
    if (reason === null) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await mergeOutreachPeople(
        id,
        target.contactId,
        reason.trim() || undefined
      );
      if (!result.merged) {
        setError(
          result.blocker
            ? MERGE_BLOCKER_LABELS[result.blocker]
            : "Не удалось объединить контакты."
        );
        return;
      }
      setMerging(false);
      router.push(`/base/${target.contactId}`);
    } catch (caught) {
      setError(messageFor(caught, "Не удалось объединить контакты."));
    } finally {
      setMutating(false);
    }
  }

  async function remove() {
    if (!window.confirm(
      "Стереть человека насовсем? Это необратимо. Если нужно просто убрать его с глаз,"
      + " используйте «Убрать из базы» — оттуда можно вернуть."
    )) {
      return;
    }
    const reason = window.prompt("Почему удаляем? Останется в журнале действий.");
    if (reason === null) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    setBlockers([]);
    try {
      const result = await deleteOutreachPerson(id, reason.trim() || undefined);
      if (!result.deleted) {
        setBlockers(result.blockers);
        return;
      }
      router.push("/base");
    } catch (caught) {
      setError(messageFor(caught, "Не удалось удалить человека."));
    } finally {
      setMutating(false);
    }
  }

  if (loading && !person) {
    return <PageLoading />;
  }
  if (error) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!person) {
    return null;
  }

  const activeCampaigns = person.campaigns.filter((item) => !item.removedAt);
  const openTasks = person.tasks.filter((task) => task.status === "open");
  // Связаться можно только внутри кампании — касание записывается по ней. Когда кампания
  // одна, спрашивать нечего; когда их несколько, кнопка живёт в строке каждой.
  const singleCampaign = activeCampaigns.length === 1 ? activeCampaigns[0] : null;
  // Кампании, где человека ещё нет. Убранного из кампании в список возвращаем: добавить
  // его обратно — обычное дело, а прятать эту кампанию значит требовать искать её в другом
  // разделе.
  const availableCampaigns = campaigns.filter((campaign) =>
    !activeCampaigns.some((item) => item.campaignId === campaign.id));

  function menuAction(action: () => void) {
    return (event: MouseEvent<HTMLButtonElement>) => {
      event.currentTarget.closest("details")?.removeAttribute("open");
      action();
    };
  }

  return (
    <>
      <p className="eyebrow">
        <Link className="back-link" href="/base">
          <ArrowLeft size={14} />
          База контактов
        </Link>
      </p>

      <div className="person-head">
        <div className="person-title">
          <h1>{person.displayName ?? "Без имени"}</h1>
          {person.archivedAt ? (
            <StatusPill tone="neutral">В архиве</StatusPill>
          ) : null}
          {person.isOwn ? <OwnBadge note={person.ownNote} /> : null}
          {person.mergedDuplicates > 0 ? (
            <StatusPill tone="neutral">
              сведено дублей: {person.mergedDuplicates}
            </StatusPill>
          ) : null}
        </div>
        <div className="person-head-actions">
          {singleCampaign ? (
            <button
              className="primary-button"
              type="button"
              disabled={mutating}
              onClick={() => setTouchCampaign(singleCampaign)}
            >
              <PhoneCall size={16} />
              Связаться
            </button>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => setNewTaskOpen(true)}
          >
            <CalendarClock size={16} />
            Поставить задачу
          </button>
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
          {/* Правка, архив, дубль и удаление — редкие действия. В шапке их восемь штук
              рвались на вторую строку и отжимали имя человека. */}
          <details className="more-menu" ref={menuRef}>
            <summary
              className="icon-button bordered"
              title="Ещё действия"
              aria-label="Ещё действия"
            >
              <MoreHorizontal size={18} />
            </summary>
            <div className="more-menu-panel">
              <button
                type="button"
                disabled={mutating}
                onClick={menuAction(() => setEditing((current) => !current))}
              >
                <Pencil size={16} />
                {editing ? "Не менять карточку" : "Изменить карточку"}
              </button>
              <button
                type="button"
                disabled={mutating}
                onClick={menuAction(() => void toggleOwn())}
              >
                <ShieldCheck size={16} />
                {person.isOwn ? "Снять пометку «свои»" : "Отметить «свои»"}
              </button>
              <button
                type="button"
                disabled={mutating}
                onClick={menuAction(() => void toggleArchive())}
              >
                <ArchiveRestore size={16} />
                {person.archivedAt ? "Вернуть в базу" : "Убрать из базы"}
              </button>
              <button
                type="button"
                disabled={mutating || person.mergedIntoContactId !== null}
                onClick={menuAction(() => setMerging((current) => !current))}
              >
                <Merge size={16} />
                {merging ? "Не сводить с дублем" : "Это дубль"}
              </button>
              <hr />
              <button
                className="danger"
                type="button"
                disabled={mutating}
                onClick={menuAction(() => void remove())}
              >
                <Trash2 size={16} />
                Удалить насовсем
              </button>
            </div>
          </details>
        </div>
        <PersonFacts person={person} />
      </div>

      {notice ? <div className="page-notice">{notice}</div> : null}
      {error ? <div className="page-warning">{error}</div> : null}
      {person.mergedIntoContactId ? (
        <div className="page-warning">
          <strong>Это дубль.</strong>{" "}
          Карточка признана дублем и сведена к другому человеку. История здесь уже не ведётся —
          смотрите{" "}
          <Link href={`/base/${person.mergedIntoContactId}`}>
            {person.mergedIntoDisplayName ?? "главную карточку"}
          </Link>.
        </div>
      ) : null}
      {person.isOwn ? (
        <div className="page-notice">
          <strong>Свои.</strong>{" "}
          Обзванивать не надо.
          {person.ownNote ? ` ${person.ownNote}.` : ""}
          {person.ownMarkedByName
            ? ` Отметил ${person.ownMarkedByName}${person.ownMarkedAt
              ? ` ${formatCompactDate(person.ownMarkedAt)}`
              : ""}.`
            : ""}
        </div>
      ) : null}
      {person.archivedAt && person.archivedReason ? (
        <div className="page-notice">
          Убран из базы: {person.archivedReason}
        </div>
      ) : null}
      {blockers.length > 0 ? (
        <div className="page-warning">
          <strong>Стереть насовсем нельзя.</strong>
          <ul>
            {blockers.map((blocker) => (
              <li key={blocker}>{BLOCKER_LABELS[blocker]}</li>
            ))}
          </ul>
          Уберите его из базы — он исчезнет из списков, а история останется.
        </div>
      ) : null}

      {merging ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>С кем объединить</h2>
              <span>Найдите вторую карточку того же человека</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Закрыть"
              onClick={() => setMerging(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form className="base-search" onSubmit={(event) => void searchForMerge(event)}>
            <label className="base-search-field">
              <Search size={16} />
              <input
                value={mergeQuery}
                onChange={(event) => setMergeQuery(event.target.value)}
                placeholder="Имя, телефон, Telegram, MAX или почта"
                maxLength={100}
                autoFocus
              />
            </label>
            <button className="secondary-button" type="submit" disabled={mergeSearching}>
              {mergeSearching ? "Ищем…" : "Найти"}
            </button>
          </form>
          {mergeResults.length > 0 ? (
            <ul className="merge-candidates">
              {mergeResults.map((candidate) => (
                <li key={candidate.contactId}>
                  <div className="stacked-cell">
                    <strong>{candidate.displayName ?? "Без имени"}</strong>
                    <span className="muted">
                      {[
                        candidate.phone,
                        candidate.telegramUsername ? `@${candidate.telegramUsername}` : null,
                        candidate.email
                      ].filter(Boolean).join(" · ") || "без признаков"}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={mutating}
                    onClick={() => void merge(candidate)}
                  >
                    Свести сюда
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="muted person-meta">
            Открытая карточка станет дублем, а выбранная — главной. Ничего не пропадёт: история
            останется видна в главной карточке.
          </p>
        </section>
      ) : null}

      {editing ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Изменить карточку</h2>
              <span>Пустое поле сотрёт значение</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Закрыть"
              onClick={() => setEditing(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form className="person-edit-form" onSubmit={(event) => void save(event)}>
            <label className="person-edit-wide">
              <span>Имя</span>
              <input name="name" defaultValue={person.displayName ?? ""} maxLength={200} />
            </label>
            <label>
              <span>Телефон</span>
              <input name="phone" defaultValue={person.phone ?? ""} maxLength={100} />
            </label>
            <label>
              <span>Telegram</span>
              <input
                name="telegram"
                defaultValue={person.telegramUsername ?? ""}
                maxLength={100}
              />
            </label>
            <label>
              <span>MAX</span>
              <input name="max" defaultValue={person.maxIdentifier ?? ""} maxLength={100} />
            </label>
            <label>
              <span>Почта</span>
              <input name="email" defaultValue={person.email ?? ""} maxLength={320} />
            </label>
            <label>
              <span>Источник</span>
              <input name="source" defaultValue={person.source ?? ""} maxLength={200} />
            </label>
            <label className="person-edit-wide">
              <span>Комментарий</span>
              <textarea name="note" defaultValue={person.note ?? ""} rows={3} maxLength={2000} />
            </label>
            <button className="primary-button" type="submit" disabled={mutating}>
              {mutating ? "Сохраняем…" : "Сохранить"}
            </button>
          </form>
        </section>
      ) : null}

      <div className="person-layout">
        <div className="person-rail">
          <PersonContactsCard person={person} />
          <PersonKnowledgeCard
            person={person}
            busy={mutating}
            onSaveNote={saveNote}
            onRemoveNote={removeNote}
          />
          <PersonOriginCard person={person} />
          <PersonCustomFieldsCard person={person} />
        </div>

        <div className="person-main">

          <section className="data-section">
            <div className="section-title-row">
              <div>
                <h2>Задачи</h2>
                <span>
                  {openTasks.length > 0
                    ? `${openTasks.length} ${plural(openTasks.length, "открытая", "открытые", "открытых")}`
                    : "открытых нет"}
                </span>
              </div>
            </div>
            {person.tasks.length === 0 ? (
              <p className="muted person-empty">Задач по человеку не ставили.</p>
            ) : (
              <ul className="person-list">
                {person.tasks.map((task) => (
                  <li
                    key={task.id}
                    className={task.status === "open" ? undefined : "person-list-done"}
                  >
                    <div className="person-list-main">
                      <strong>{task.text}</strong>
                      <span className="person-list-sub">
                        {taskTypeLabel(task.type)}
                        {" · "}
                        <span
                          className={task.status === "open"
                            && new Date(task.dueAt).getTime() < Date.now()
                            ? "overdue"
                            : undefined}
                        >
                          срок {formatDateTime(task.dueAt)}
                        </span>
                        {" · "}
                        {task.assignedAdminName}
                        {task.campaignId ? " · " : ""}
                        {task.campaignId ? (
                          <Link
                            className="offer-link-inline"
                            href={`/outreach/${task.campaignId}?contact=${task.campaignContactId}`}
                          >
                            {task.campaignName}
                          </Link>
                        ) : null}
                      </span>
                    </div>
                    <div className="person-list-side">
                      {task.status === "open" ? (
                        <div className="outreach-row-actions">
                          <button
                            type="button"
                            disabled={mutating}
                            onClick={() => void run(
                              () => completeOutreachTask(task.id),
                              "Задача выполнена."
                            )}
                          >
                            <CheckCircle2 size={16} />
                            Выполнено
                          </button>
                        </div>
                      ) : (
                        <StatusPill tone={task.status === "completed" ? "positive" : "neutral"}>
                          {task.status === "completed" ? "Выполнена" : "Заменена"}
                        </StatusPill>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <PersonHistoryCard person={person} />

          <section className="data-section">
            <div className="section-title-row">
              <div>
                <h2>Кампании</h2>
                <span>{person.campaigns.length}</span>
              </div>
              {availableCampaigns.length > 0 ? (
                <label className="select-field outreach-assign">
                  <span>Добавить в кампанию</span>
                  <select
                    defaultValue=""
                    disabled={mutating}
                    onChange={(event) => void addToCampaign(event)}
                  >
                    <option value="">Выберите</option>
                    {availableCampaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {person.campaigns.length === 0 ? (
              <p className="muted person-empty">
                Человек ещё ни в одной кампании не участвовал.
              </p>
            ) : (
              <ul className="person-list">
                {person.campaigns.map((membership) => (
                  <li key={membership.campaignContactId}>
                    <div className="person-list-main">
                      <strong>{membership.campaignName}</strong>
                      <span className="person-list-sub">
                        {membership.removedAt ? "убран из кампании · " : ""}
                        {membership.stageLabel}
                        {" · "}
                        {membership.assignedAdminName ?? "ответственный не назначен"}
                      </span>
                    </div>
                    <div className="person-list-side">
                      {membership.removedAt ? null : (
                        <div className="outreach-row-actions">
                          <button
                            type="button"
                            disabled={mutating}
                            onClick={() => setTouchCampaign(membership)}
                          >
                            <PhoneCall size={16} />
                            Связаться
                          </button>
                        </div>
                      )}
                      <Link
                        className="row-link"
                        href={`/outreach/${membership.campaignId}?contact=${membership.campaignContactId}`}
                        aria-label={`Открыть кампанию ${membership.campaignName}`}
                      >
                        <ExternalLink size={17} />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <PersonEventsCard person={person} />

          <PersonOrdersCard person={person} />

        </div>
      </div>

      {touchCampaign ? (
        <OutreachTouchDialog
          campaignId={touchCampaign.campaignId}
          targets={[{
            campaignContactId: touchCampaign.campaignContactId,
            displayName: person.displayName,
            phone: person.phone,
            telegramUsername: person.telegramUsername,
            maxIdentifier: person.maxIdentifier,
            isOwn: person.isOwn
          }]}
          columns={null}
          onClose={() => setTouchCampaign(null)}
          onRecorded={async () => {
            setNotice("Касание записано.");
            setTouchCampaign(null);
            await load();
          }}
        />
      ) : null}

      {newTaskOpen ? (
        <OutreachNewTaskDialog
          person={{ contactId: person.contactId }}
          managers={managers}
          onClose={() => setNewTaskOpen(false)}
          onCreated={async () => {
            setNotice("Задача поставлена.");
            setNewTaskOpen(false);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

