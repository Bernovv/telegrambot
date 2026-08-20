"use client";

import { OutreachNewTaskDialog } from "@/components/outreach-new-task-dialog";
import { OutreachTouchDialog } from "@/components/outreach-touch-dialog";
import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  addExistingContactsToCampaign,
  archiveOutreachPerson,
  completeOutreachTask,
  createOutreachNote,
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
import {
  formatCompactDate,
  formatDateTime,
  formatKopecks,
  orderStatusLabel,
  orderStatusTone
} from "@/lib/format";
import {
  channelLabel,
  lostReasonLabel,
  statusLabel,
  taskTypeLabel
} from "@/lib/outreach-labels";
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
  Bot,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Mail,
  Merge,
  MessageSquare,
  Pencil,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  use,
  useCallback,
  useEffect,
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

const PHONE_STATUS_LABELS: Record<string, string> = {
  unknown: "не знаем",
  imported: "из импорта, не подтверждён",
  verified: "подтверждён в боте",
  rejected: "человек отказался дать"
};

const SITE_REGISTRATION_LABELS: Record<string, string> = {
  registered: "записан на встречу",
  duplicate: "повтор заявки",
  unassigned: "встреча не нашлась"
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
  const [noteDraft, setNoteDraft] = useState("");
  const [campaigns, setCampaigns] =
    useState<readonly OutreachCampaignSummary[]>([]);

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

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = noteDraft.trim();
    if (!body) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      await createOutreachNote(id, body);
      setNoteDraft("");
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить заметку."));
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
  const timeline = buildPersonTimeline(person);
  // Кампании, где человека ещё нет. Убранного из кампании в список возвращаем: добавить
  // его обратно — обычное дело, а прятать эту кампанию значит требовать искать её в другом
  // разделе.
  const availableCampaigns = campaigns.filter((campaign) =>
    !activeCampaigns.some((item) => item.campaignId === campaign.id));

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
          <h1>{person.displayName ?? "Без имени"}</h1>
          <p>
            {activeCampaigns.length > 0
              ? `Сейчас в ${activeCampaigns.length} ${activeCampaigns.length === 1 ? "кампании" : "кампаниях"}`
              : "Ни в одной кампании не состоит"}
          </p>
        </div>
        <div className="heading-actions">
          {person.archivedAt ? (
            <StatusPill tone="neutral">В архиве</StatusPill>
          ) : null}
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
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => setEditing((current) => !current)}
          >
            <Pencil size={16} />
            {editing ? "Отменить" : "Изменить"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => void toggleArchive()}
          >
            <ArchiveRestore size={16} />
            {person.archivedAt ? "Вернуть в базу" : "Убрать из базы"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating || person.mergedIntoContactId !== null}
            onClick={() => setMerging((current) => !current)}
          >
            <Merge size={16} />
            {merging ? "Отменить" : "Это дубль"}
          </button>
          <button
            className="secondary-button danger"
            type="button"
            disabled={mutating}
            onClick={() => void remove()}
          >
            <Trash2 size={16} />
            Удалить
          </button>
        </div>
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
      {person.mergedDuplicates > 0 ? (
        <div className="page-notice">
          Сюда сведено дублей: {person.mergedDuplicates}. Их звонки, кампании и мероприятия
          показаны ниже вместе со своими.
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

      <div className="metrics-strip">
        <div>
          <span title="Заказы бота плюс оплаты, заведённые руками. Частичные возвраты не вычтены — их видно в самом заказе.">
            Принёс всего
          </span>
          <strong>{formatKopecks(person.paidTotalKopecks)}</strong>
        </div>
        <div>
          <span>Мероприятий</span>
          <strong>{person.participations.length}</strong>
        </div>
        <div>
          <span>Касаний</span>
          <strong>{person.activities.length}</strong>
        </div>
        <div>
          <span>Открытых задач</span>
          <strong>{openTasks.length}</strong>
        </div>
        <div>
          <span>В базе с</span>
          <strong>{formatCompactDate(person.createdAt)}</strong>
        </div>
      </div>

      <section className="data-section">
        <div className="section-title-row">
          <div><h2>Контакты</h2></div>
        </div>
        <dl className="person-identifiers">
          <div>
            <dt><Phone size={14} /> Телефон</dt>
            <dd>{person.phone ?? <span className="muted">не знаем</span>}</dd>
          </div>
          <div>
            <dt><MessageSquare size={14} /> Telegram</dt>
            <dd>
              {person.telegramUsername
                ? `@${person.telegramUsername}`
                : <span className="muted">не знаем</span>}
            </dd>
          </div>
          <div>
            <dt><MessageSquare size={14} /> MAX</dt>
            <dd>{person.maxIdentifier ?? <span className="muted">не знаем</span>}</dd>
          </div>
          <div>
            <dt><Mail size={14} /> Почта</dt>
            <dd>{person.email ?? <span className="muted">не знаем</span>}</dd>
          </div>
          <div>
            <dt><Bot size={14} /> В боте</dt>
            <dd>
              {person.linkedUserId ? (
                <Link href={`/users/${person.linkedUserId}`}>
                  Открыть пользователя
                </Link>
              ) : (
                <span className="muted">не заходил</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Источник</dt>
            <dd>{person.source ?? <span className="muted">неизвестен</span>}</dd>
          </div>
        </dl>
        {person.note ? <p className="person-note">{person.note}</p> : null}
        <p className="muted person-meta">
          В базе с {formatCompactDate(person.createdAt)}
          {person.createdByName ? `, завёл ${person.createdByName}` : ""}
          {person.updatedAt !== person.createdAt
            ? `, обновлён ${formatCompactDate(person.updatedAt)}`
            : ""}
        </p>
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Заметки</h2>
            <span>{person.notes.length}</span>
          </div>
          {/* Не то же, что комментарий в карточке выше: тот приезжает из импорта и
              перезаписывается целиком. Заметки копятся и подписаны именем. */}
          <span className="muted">Что менеджеры узнали о человеке</span>
        </div>
        <form className="person-note-form" onSubmit={(event) => void addNote(event)}>
          <textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="Например: просил не звонить до сентября, едет с женой"
          />
          <button
            className="secondary-button"
            type="submit"
            disabled={mutating || noteDraft.trim().length === 0}
          >
            <StickyNote size={16} />
            Записать
          </button>
        </form>
        {person.notes.length === 0 ? (
          <p className="muted">Заметок пока нет.</p>
        ) : (
          <ol className="person-timeline">
            {person.notes.map((note) => (
              <li key={note.id}>
                <div className="person-timeline-head">
                  <strong>{note.authorName}</strong>
                  <span className="muted">{formatDateTime(note.createdAt)}</span>
                  {/* Снять можно только свою: заметка подписана именем, и стирать чужую
                      подпись значит менять сказанное другим человеком. */}
                  {note.canDelete ? (
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Снять заметку"
                      title="Снять заметку"
                      disabled={mutating}
                      onClick={() => void removeNote(note.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
                <p>{note.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Задачи</h2>
            <span>
              {openTasks.length > 0
                ? `${openTasks.length} открытых`
                : "открытых нет"}
            </span>
          </div>
        </div>
        {person.tasks.length === 0 ? (
          <p className="muted">Задач по человеку не ставили.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Что сделать</th>
                  <th>Срок</th>
                  <th>Ответственный</th>
                  <th>Кампания</th>
                  <th>Состояние</th>
                  <th><span className="sr-only">Действия</span></th>
                </tr>
              </thead>
              <tbody>
                {person.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{task.text}</strong>
                        <span className="muted">{taskTypeLabel(task.type)}</span>
                      </div>
                    </td>
                    <td>{formatDateTime(task.dueAt)}</td>
                    <td>{task.assignedAdminName}</td>
                    <td>
                      {task.campaignId ? (
                        <Link
                          className="offer-link-inline"
                          href={`/outreach/${task.campaignId}?contact=${task.campaignContactId}`}
                        >
                          {task.campaignName}
                        </Link>
                      ) : (
                        <span className="muted">без кампании</span>
                      )}
                    </td>
                    <td>
                      <StatusPill
                        tone={
                          task.status === "completed"
                            ? "positive"
                            : task.status === "cancelled"
                              ? "neutral"
                              : "warning"
                        }
                      >
                        {task.status === "completed"
                          ? "Выполнена"
                          : task.status === "cancelled"
                            ? "Заменена"
                            : "Открыта"}
                      </StatusPill>
                    </td>
                    <td>
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
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
          <p className="muted">Человек ещё ни в одной кампании не участвовал.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Кампания</th>
                  <th>Стадия</th>
                  <th>Ответственный</th>
                  <th><span className="sr-only">Действия</span></th>
                </tr>
              </thead>
              <tbody>
                {person.campaigns.map((membership) => (
                  <tr key={membership.campaignContactId}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{membership.campaignName}</strong>
                        {membership.removedAt ? (
                          <span className="muted">убран из кампании</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{membership.stageLabel}</td>
                    <td>
                      {membership.assignedAdminName ?? (
                        <span className="muted">не назначен</span>
                      )}
                    </td>
                    <td>
                      <div className="outreach-row-actions">
                        {membership.removedAt ? null : (
                          <button
                            type="button"
                            disabled={mutating}
                            onClick={() => setTouchCampaign(membership)}
                          >
                            <PhoneCall size={16} />
                            Связаться
                          </button>
                        )}
                        <Link
                          className="row-link"
                          href={`/outreach/${membership.campaignId}?contact=${membership.campaignContactId}`}
                        >
                          Открыть
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {person.participations.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Мероприятия</h2>
              <span>{person.participations.length}</span>
            </div>
          </div>
          <ul className="person-events">
            {person.participations.map((participation) => (
              <li key={participation.participantId}>
                <div className="person-event-head">
                  <CalendarDays size={15} />
                  <Link href={`/events/${participation.eventId}/participants`}>
                    {participation.eventTitle}
                  </Link>
                  <span className="muted">
                    {[
                      `${participation.guests} чел.`,
                      participation.sleepingPlaces > 0
                        ? `мест: ${participation.sleepingPlaces}`
                        : null,
                      participation.ticketTitle || null,
                      participation.amountKopecks
                        ? formatKopecks(participation.amountKopecks)
                        : null
                    ].filter(Boolean).join(" · ")}
                  </span>
                  {participation.checkedInAt ? (
                    <StatusPill tone="positive">
                      Пришёл {formatCompactDate(participation.checkedInAt)}
                    </StatusPill>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {person.questionnaires.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Анкеты</h2>
              <span>{person.questionnaires.length}</span>
            </div>
            {/* Ради этого раздела карточка и нужна: чтобы вспомнить, чем человек
                занимается, не надо помнить, на какое мероприятие он ездил. */}
            <span className="muted">Ответы по всем мероприятиям</span>
          </div>
          <ul className="person-events">
            {person.questionnaires.map((questionnaire, index) => (
              <li key={`${questionnaire.source}-${questionnaire.eventId ?? index}`}>
                <div className="person-event-head">
                  <CalendarDays size={15} />
                  {questionnaire.eventId ? (
                    <Link href={`/events/${questionnaire.eventId}/questionnaire`}>
                      {questionnaire.eventTitle}
                    </Link>
                  ) : (
                    <strong>{questionnaire.eventTitle ?? "Без мероприятия"}</strong>
                  )}
                  <span className="muted">
                    {questionnaire.source === "order"
                      ? "анкета к заказу"
                      : "анкета участника"}
                    {questionnaire.filledAt
                      ? ` · ${formatCompactDate(questionnaire.filledAt)}`
                      : ""}
                  </span>
                </div>
                <dl className="person-answers">
                  {questionnaire.answers.map((answer) => (
                    <div key={answer.fieldId}>
                      <dt>{answer.label}</dt>
                      <dd>{answer.value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {person.customFields.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Дополнительные поля</h2>
              <span>{person.customFields.length}</span>
            </div>
            <span className="muted">Заводятся по кампаниям</span>
          </div>
          <dl className="person-identifiers">
            {person.customFields.map((field) => (
              <div key={`${field.fieldId}-${field.campaignName}`}>
                <dt>{field.label}</dt>
                <dd>
                  {field.value}
                  <span className="muted"> · {field.campaignName}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {person.orders.length > 0 || person.consents.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Заказы и согласия</h2>
              <span>{person.orders.length}</span>
            </div>
            <span className="muted">Из бота</span>
          </div>
          {person.orders.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Заказ</th>
                    <th>Мероприятие</th>
                    <th>Статус</th>
                    <th>Сумма</th>
                    <th>Создан</th>
                    <th><span className="sr-only">Открыть</span></th>
                  </tr>
                </thead>
                <tbody>
                  {person.orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <div className="stacked-cell">
                          <strong>{order.number}</strong>
                          {order.excludedAt ? (
                            <span className="muted">исключён из отчётов</span>
                          ) : null}
                        </div>
                      </td>
                      <td>{order.eventTitle}</td>
                      <td>
                        <StatusPill tone={orderStatusTone(order.status)}>
                          {orderStatusLabel(order.status)}
                        </StatusPill>
                      </td>
                      <td className="money-cell">{formatKopecks(order.totalKopecks)}</td>
                      <td>{formatCompactDate(order.createdAt)}</td>
                      <td>
                        <Link
                          className="row-link"
                          href={`/orders/${order.id}`}
                          aria-label={`Открыть заказ ${order.number}`}
                        >
                          <ExternalLink size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {/* Ссылка ведёт на ту редакцию оферты, с которой человек согласился, а не на
              действующую: ради этого версии и сделаны неизменяемыми. */}
          {person.consents.length > 0 ? (
            <ul className="person-events">
              {person.consents.map((consent) => (
                <li key={consent.orderId}>
                  <div className="person-event-head">
                    <strong>Оферта, редакция {consent.versionNumber}</strong>
                    <span className="muted">
                      заказ {consent.orderNumber} · {formatDateTime(consent.acceptedAt)}
                    </span>
                    <a
                      className="offer-link-inline"
                      href={consent.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Документ
                      <ExternalLink size={15} />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {person.bot ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>В боте</h2>
              <span>
                {person.bot.isBlocked ? "бот заблокирован" : "активен"}
              </span>
            </div>
            <Link className="row-link" href={`/users/${person.bot.userId}`}>
              Открыть пользователя
            </Link>
          </div>
          <dl className="person-identifiers">
            <div>
              <dt>Зарегистрировался</dt>
              <dd>{formatDateTime(person.bot.registeredAt)}</dd>
            </div>
            <div>
              <dt>Последний раз заходил</dt>
              <dd>
                {person.bot.lastSeenAt
                  ? formatDateTime(person.bot.lastSeenAt)
                  : <span className="muted">не заходил после регистрации</span>}
              </dd>
            </div>
            <div>
              <dt>Телефон</dt>
              <dd>
                {PHONE_STATUS_LABELS[person.bot.phoneStatus] ?? person.bot.phoneStatus}
              </dd>
            </div>
            <div>
              <dt>Кошелёк</dt>
              <dd>{formatKopecks(person.bot.walletAvailableKopecks)}</dd>
            </div>
          </dl>
          <div className="section-title-row">
            <div>
              <h3>Откуда пришёл</h3>
              <span>
                {person.bot.touchpoints.length > 0
                  ? "первое касание сверху"
                  : "метки источника нет"}
              </span>
            </div>
          </div>
          {person.bot.touchpoints.length === 0 ? (
            <p className="muted">
              Человек открыл бота напрямую, без метки источника и партнёрской ссылки.
            </p>
          ) : (
            <ol className="person-timeline">
              {person.bot.touchpoints.map((touchpoint) => (
                <li key={`${touchpoint.channel}-${touchpoint.occurredAt}`}>
                  <div className="person-timeline-head">
                    <strong>
                      {touchpoint.partnerCode
                        ? `Партнёр ${touchpoint.partnerCode}`
                        : touchpoint.source ?? "Прямой заход"}
                    </strong>
                    {touchpoint.isFirstTouch ? (
                      <StatusPill tone="neutral">первый переход</StatusPill>
                    ) : null}
                    <span className="muted">{formatDateTime(touchpoint.occurredAt)}</span>
                  </div>
                  {touchpoint.campaign ? (
                    <div className="person-timeline-meta muted">
                      Кампания: {touchpoint.campaign}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      {person.siteRegistrations.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Заявки с сайта</h2>
              <span>{person.siteRegistrations.length}</span>
            </div>
            <span className="muted">Найдены по телефону</span>
          </div>
          <ul className="person-events">
            {person.siteRegistrations.map((registration) => (
              <li key={registration.id}>
                <div className="person-event-head">
                  <strong>{registration.eventTitle ?? "Встреча не определена"}</strong>
                  <span className="muted">
                    {[
                      registration.page || null,
                      SITE_REGISTRATION_LABELS[registration.status]
                        ?? registration.status,
                      formatDateTime(registration.createdAt)
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>История</h2>
            <span>{timeline.length}</span>
          </div>
          {/* Ради этой ленты карточка и заведена: раньше история резалась по кампаниям,
              и что человеку уже говорили, целиком не видел никто. */}
          <span className="muted">Звонки, стадии и задачи из всех кампаний</span>
        </div>
        {timeline.length === 0 ? (
          <p className="muted">С человеком ещё ничего не происходило.</p>
        ) : (
          <ol className="person-timeline">
            {timeline.map((entry) => (
              <li key={entry.id}>
                <div className="person-timeline-head">
                  <strong>{entry.title}</strong>
                  {entry.tone ? (
                    <StatusPill tone={entry.tone}>{entry.badge}</StatusPill>
                  ) : null}
                  <span className="muted">{formatDateTime(entry.occurredAt)}</span>
                </div>
                <div className="person-timeline-meta muted">
                  {[entry.actor, entry.campaignName].filter(Boolean).join(" · ")}
                </div>
                {entry.note ? <p>{entry.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {touchCampaign ? (
        <OutreachTouchDialog
          campaignId={touchCampaign.campaignId}
          targets={[{
            campaignContactId: touchCampaign.campaignContactId,
            phone: person.phone,
            telegramUsername: person.telegramUsername,
            maxIdentifier: person.maxIdentifier
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

interface TimelineEntry {
  readonly id: string;
  readonly title: string;
  readonly badge: string | null;
  readonly tone: "positive" | "neutral" | "danger" | "warning" | null;
  readonly actor: string;
  readonly campaignName: string | null;
  readonly occurredAt: string;
  readonly note: string | null;
}

/**
 * Одна лента на всё, что с человеком происходило: звонки и сообщения, движение по стадиям и
 * задачи. По отдельности каждый из трёх списков отвечает на свой вопрос, а «что с этим
 * человеком вообще было» — только все вместе и по времени.
 */
function buildPersonTimeline(person: OutreachPersonCard): readonly TimelineEntry[] {
  const activities: readonly TimelineEntry[] = person.activities.map((activity) => ({
    id: `activity-${activity.id}`,
    title: channelLabel(activity.channel),
    badge: statusLabel(activity.result),
    tone: activity.result === "converted" || activity.result === "interested"
      ? "positive"
      : activity.result === "declined" || activity.result === "invalid"
        ? "danger"
        : "neutral",
    actor: activity.actorName,
    campaignName: activity.campaignName,
    occurredAt: activity.occurredAt,
    note: activity.note
  }));

  // Заведение карточки в ленту не идёт: первый переход в стадию — это не событие работы с
  // человеком, а строка, которую создал сам факт добавления в кампанию.
  const stages: readonly TimelineEntry[] = person.stageChanges
    .filter((change) => change.fromStage !== null)
    .map((change) => ({
      id: `stage-${change.id}`,
      title: `Этап: ${change.toLabel}`,
      badge: change.fromLabel ? `из «${change.fromLabel}»` : null,
      tone: change.fromLabel ? "neutral" : null,
      actor: change.actorName,
      campaignName: change.campaignName,
      occurredAt: change.occurredAt,
      note: change.lostReason
        ? `Причина: ${lostReasonLabel(change.lostReason)}`
        : null
    }));

  const tasks: readonly TimelineEntry[] = person.tasks.map((task) => ({
    id: `task-${task.id}`,
    title: task.status === "completed"
      ? "Задача выполнена"
      : task.status === "cancelled"
        ? "Задача заменена"
        : "Задача поставлена",
    badge: taskTypeLabel(task.type),
    tone: "neutral",
    actor: task.status === "completed"
      ? task.completedByAdminName ?? task.createdByAdminName
      : task.createdByAdminName,
    campaignName: task.campaignName,
    occurredAt: task.completedAt ?? task.createdAt,
    note: `${task.text} · срок ${formatDateTime(task.dueAt)}`
  }));

  return [...activities, ...stages, ...tasks]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}
