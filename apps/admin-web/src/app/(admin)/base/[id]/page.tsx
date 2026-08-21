"use client";

import { OutreachNewTaskDialog } from "@/components/outreach-new-task-dialog";
import { OutreachTouchDialog } from "@/components/outreach-touch-dialog";
import { OwnBadge } from "@/components/own-badge";
import { PersonOwnDialog } from "@/components/person-own-dialog";
import {
  OutreachTaskRescheduleDialog,
  suggestDueAt,
  type ReschedulableTask
} from "@/components/outreach-task-reschedule-dialog";
import {
  PersonBody,
  PersonFacts,
  headlineStage
} from "@/components/person-card";
import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  addExistingContactsToCampaign,
  archiveOutreachPerson,
  completeOutreachTask,
  createOutreachNote,
  createOutreachPersonTask,
  deleteOutreachNote,
  deleteOutreachPerson,
  getOutreachPerson,
  listOutreachCampaigns,
  listOutreachManagers,
  listOutreachPeople,
  mergeOutreachPeople,
  restoreOutreachPerson,
  updateOutreachPerson
} from "@/lib/admin-api";
import { formatCompactDate } from "@/lib/format";
import type {
  OutreachDeleteBlocker,
  OutreachCampaignSummary,
  OutreachManager,
  OutreachMergeBlocker,
  OutreachPerson,
  OutreachPersonCampaign,
  OutreachPersonCard,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";
import {
  ArchiveRestore,
  ArrowLeft,
  CalendarClock,
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
  /** Текст, написанный в поле внизу ленты: уезжает в разбор касания заметкой. */
  const [touchNote, setTouchNote] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [campaigns, setCampaigns] =
    useState<readonly OutreachCampaignSummary[]>([]);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [reschedule, setReschedule] = useState<ReschedulableTask | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);

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

  async function createTask(input: {
    readonly type: string;
    readonly text: string;
    readonly dueAt: Date;
    readonly assignedAdminId: string | null;
  }): Promise<boolean> {
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      await createOutreachPersonTask(id, {
        type: input.type as OutreachTaskType,
        text: input.text,
        dueAt: input.dueAt.toISOString(),
        ...(input.assignedAdminId
          ? { assignedAdminId: input.assignedAdminId }
          : {})
      });
      setNotice("Задача поставлена.");
      await load();
      return true;
    } catch (caught) {
      setError(messageFor(caught, "Не удалось поставить задачу."));
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

  async function addToCampaign(campaignId: string) {
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
  // Связаться можно только внутри кампании — касание записывается по ней. Когда кампания
  // одна, спрашивать нечего; когда их несколько, кнопка живёт в строке каждой.
  const singleCampaign = activeCampaigns.length === 1 ? activeCampaigns[0] : null;
  // Кампании, где человека ещё нет. Убранного из кампании в список возвращаем: добавить
  // его обратно — обычное дело, а прятать эту кампанию значит требовать искать её в другом
  // разделе.
  const availableCampaigns = campaigns.filter((campaign) =>
    !activeCampaigns.some((item) => item.campaignId === campaign.id));
  const stage = headlineStage(person);

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
          {stage ? (
            <StatusPill tone="neutral">
              {stage.stageLabel}
              <span className="pill-note"> · {stage.campaignName}</span>
            </StatusPill>
          ) : null}
          {person.archivedAt ? (
            <StatusPill tone="neutral">В архиве</StatusPill>
          ) : null}
          {person.isOwn ? (
            <OwnBadge note={person.ownNote} onEdit={() => setOwnOpen(true)} />
          ) : null}
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
                onClick={menuAction(() => setOwnOpen(true))}
              >
                <ShieldCheck size={16} />
                {person.isOwn ? "Изменить пометку «свои»" : "Отметить «свои»"}
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
      {/* Дубль остаётся во весь размер: он означает «вы смотрите не ту карточку», и свернуть
          это в строку нельзя. Остальные пометки — про человека, а не про карточку, и раньше
          шли сплошняком, отодвигая содержимое на третий экран. */}
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
      {person.isOwn || person.archivedAt || blockers.length > 0 ? (
        <details className="person-flags">
          <summary>
            {[
              person.isOwn ? "свои — обзванивать не надо" : null,
              person.archivedAt ? "убран из базы" : null,
              blockers.length > 0 ? "стереть насовсем нельзя" : null
            ].filter(Boolean).join(" · ")}
          </summary>
          <div className="person-flags-body">
            {person.isOwn ? (
              <p>
                <strong>Свои.</strong>{" "}
                Обзванивать не надо.
                {person.ownNote ? ` ${person.ownNote}.` : ""}
                {person.ownMarkedByName
                  ? ` Отметил ${person.ownMarkedByName}${person.ownMarkedAt
                    ? ` ${formatCompactDate(person.ownMarkedAt)}`
                    : ""}.`
                  : ""}
                {" "}
                <button className="inline-link" type="button" onClick={() => setOwnOpen(true)}>
                  Изменить или снять
                </button>
              </p>
            ) : null}
            {person.archivedAt ? (
              <p>
                <strong>Убран из базы.</strong>
                {person.archivedReason ? ` ${person.archivedReason}.` : ""}
                {" "}
                Из списков и подбора в кампании он пропал, история осталась.
              </p>
            ) : null}
            {blockers.length > 0 ? (
              <p>
                <strong>Стереть насовсем нельзя:</strong>{" "}
                {blockers.map((blocker) => BLOCKER_LABELS[blocker]).join("; ")}.
                {" "}
                Уберите его из базы — он исчезнет из списков, а история останется.
              </p>
            ) : null}
          </div>
        </details>
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

      <PersonBody
        person={person}
        managers={managers}
        busy={mutating}
        variant="page"
        availableCampaigns={availableCampaigns}
        onAddToCampaign={(campaignId) => void addToCampaign(campaignId)}
        onSaveNote={saveNote}
        onRemoveNote={removeNote}
        onCreateTask={createTask}
        onTouch={(campaign, note) => {
          setTouchNote(note);
          setTouchCampaign(campaign);
        }}
        onCompleteTask={(taskId) => run(
          () => completeOutreachTask(taskId),
          "Задача выполнена."
        )}
        onRescheduleTask={(task) => setReschedule({
          id: task.id,
          type: task.type,
          text: task.text,
          dueAt: task.dueAt,
          assignedAdminId: task.assignedAdminId,
          campaignContactId: task.campaignContactId,
          contactId: person.contactId,
          contactName: person.displayName
        })}
      />

      {ownOpen ? (
        <PersonOwnDialog
          person={person}
          onClose={() => setOwnOpen(false)}
          onDone={async (message) => {
            setNotice(message);
            setOwnOpen(false);
            await load();
          }}
        />
      ) : null}

      {reschedule ? (
        <OutreachTaskRescheduleDialog
          task={reschedule}
          suggestedDueAt={suggestDueAt("tomorrow", new Date(reschedule.dueAt))}
          onClose={() => setReschedule(null)}
          onDone={async (message) => {
            setNotice(message);
            setReschedule(null);
            await load();
          }}
        />
      ) : null}

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
          defaultNote={touchNote}
          onClose={() => {
            setTouchCampaign(null);
            setTouchNote("");
          }}
          onRecorded={async () => {
            setNotice("Касание записано.");
            setTouchCampaign(null);
            setTouchNote("");
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

