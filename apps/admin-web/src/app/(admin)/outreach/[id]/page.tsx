"use client";

import {
  OutreachTouchDialog,
  type OutreachTouchTarget
} from "@/components/outreach-touch-dialog";
import { OutreachTaskForm } from "@/components/outreach-task-form";
import { OutreachTaskRules } from "@/components/outreach-task-rules";
import {
  OutreachNextStepDialog,
  type OutreachNextStepValue
} from "@/components/outreach-next-step-dialog";
import {
  OutreachTaskRescheduleDialog,
  suggestDueAt,
  type ReschedulableTask
} from "@/components/outreach-task-reschedule-dialog";
import { OwnBadge } from "@/components/own-badge";
import { PersonOwnDialog } from "@/components/person-own-dialog";
import { PersonBody, PersonFacts, plural } from "@/components/person-card";
import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  addEventParticipant,
  assignOutreachContacts,
  completeOutreachTask,
  createOutreachContact,
  createOutreachCustomFieldDefinition,
  deleteOutreachCustomFieldDefinition,
  exportOutreachCampaign,
  getOutreachCampaign,
  getOutreachContact,
  getOutreachPerson,
  createOutreachNote,
  createOutreachPersonTask,
  deleteOutreachNote,
  setOutreachPersonField,
  updateOutreachCampaignSettings,
  updateOutreachPerson,
  addExistingContactsToCampaign,
  importEventParticipantsIntoCampaign,
  listEvents,
  listOutreachBaseContacts,
  importOutreachContacts,
  listOutreachCampaigns,
  moveOutreachContacts,
  removeOutreachContacts,
  listOutreachContacts,
  listOutreachCustomFieldDefinitions,
  listOutreachTaskRules,
  listOutreachManagers,
  listOutreachPipelineColumns,
  setOutreachCustomFieldValue,
  updateOutreachCampaign,
  updateOutreachContactStage,
  updateOutreachPipelineColumns,
  type OutreachContactFilters,
  type OutreachPipelineColumnDraft
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import {
  LOST_REASONS,
  lostReasonLabel,
  stageLabel,
  stageTone,
  statusLabel
} from "@/lib/outreach-labels";
import { parseOutreachCsv } from "@/lib/outreach-csv";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";
import type {
  OutreachBaseContact,
  OutreachPersonCard,
  OutreachCampaignContactDetail,
  OutreachCampaignContactPage,
  OutreachCampaignContactSummary,
  OutreachCampaignSummary,
  OutreachCustomFieldDefinition,
  OutreachCustomFieldType,
  OutreachLostReason,
  OutreachManager,
  OutreachPipelineColumn,
  OutreachPipelineColumnOutcome,
  OutreachPipelineStage,
  OutreachTask,
  OutreachTaskRule,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileUp,
  GripVertical,
  LayoutGrid,
  List,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  ShieldCheck,
  Users,
  Trash2,
  UserRoundCheck,
  X
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

interface StageTarget {
  readonly contactId: string;
  readonly stage: OutreachPipelineStage;
  /** Причина отказа, уже названная: перенос повторяют вместе со следующим шагом. */
  readonly lostReason?: OutreachLostReason;
}

type ViewMode = "board" | "table";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function OutreachCampaignPage() {
  const { id: routeId } = useParams<{ id: string }>();
  // Постоянная воронка направления открывается по короткому адресу — `/outreach/sreda`.
  // Пункт меню должен пережить пересоздание воронки, а её идентификатор этого не обещает.
  const alias = UUID_PATTERN.test(routeId) ? null : routeId;
  const [aliasId, setAliasId] = useState<string | null>(null);
  const id = alias === null ? routeId : aliasId ?? "";
  const fileInput = useRef<HTMLInputElement>(null);
  const [campaign, setCampaign] = useState<OutreachCampaignSummary | null>(null);
  const [contacts, setContacts] = useState<OutreachCampaignContactPage | null>(null);
  const [managers, setManagers] = useState<readonly OutreachManager[]>([]);
  const [pipelineColumns, setPipelineColumns] =
    useState<readonly OutreachPipelineColumn[]>(DEFAULT_PIPELINE_COLUMNS);
  const [pipelineDraft, setPipelineDraft] =
    useState<readonly OutreachPipelineColumnDraft[]>(
      toPipelineDraft(DEFAULT_PIPELINE_COLUMNS)
    );
  const [customFields, setCustomFields] =
    useState<readonly OutreachCustomFieldDefinition[]>([]);
  const [fieldFormOpen, setFieldFormOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [pipelineSettingsOpen, setPipelineSettingsOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("board");
  const [filters, setFilters] = useState<OutreachContactFilters>({
    page: 1,
    limit: 500
  });
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [action, setAction] = useState<readonly string[] | null>(null);
  const [stageTarget, setStageTarget] = useState<StageTarget | null>(null);
  /** Перенос, который ждёт следующего шага: воронка требует задачу. */
  const [nextStep, setNextStep] = useState<StageTarget | null>(null);
  const [onlyWithoutTask, setOnlyWithoutTask] = useState(false);
  const [taskRules, setTaskRules] = useState<readonly OutreachTaskRule[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  /**
   * Сводка и отбор свёрнуты.
   *
   * Пять плиток и строка отбора занимали двести пикселей над доской каждый день ради того,
   * чем пользуются несколько раз в день. Развернул — посмотрел — свернул. Когда отбор
   * включён, об этом сказано отдельной строкой: доска, показывающая не всех, обязана
   * объяснять почему, даже когда сам отбор убран с глаз.
   */
  const [toolsOpen, setToolsOpen] = useState(false);

  /**
   * Доску возят мышкой за пустое место.
   *
   * Полосу прокрутки теперь видно всегда, но целиться в неё всё равно неудобно: доска
   * широкая, а полоса тонкая. Хват за фон — то, как это устроено везде, где есть доски.
   *
   * Тянуть можно только за пустое место: карточку таскают по этапам, и перехватив на ней
   * нажатие, мы бы отняли у неё перетаскивание. Мышкой и только ей — на телефоне доска и
   * так листается пальцем, и второй обработчик там мешал бы родному прокручиванию.
   */
  const panFrom = useRef<{ readonly x: number; readonly left: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest(".outreach-lead-card, button, a, input, select, label")) {
      return;
    }
    panFrom.current = { x: event.clientX, left: event.currentTarget.scrollLeft };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    const from = panFrom.current;
    if (from === null) {
      return;
    }
    event.currentTarget.scrollLeft = from.left - (event.clientX - from.x);
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (panFrom.current === null) {
      return;
    }
    panFrom.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  /**
   * Доска занимает то, что осталось от окна.
   *
   * Считается по месту, а не константой в стилях: над доской стоят заголовок, настройка,
   * плитки, подсказка и отбор, и высота этой шапки меняется — от длины названия кампании до
   * того, есть ли жёлтая полоса про карточки без следующего шага. Константа промахнулась бы
   * на любой из них, а промах здесь означает ровно ту беду, ради которой всё затевалось:
   * полоса прокрутки снова уезжает под экран.
   */
  const fitBoard = useCallback(() => {
    const board = boardRef.current;
    if (board === null) {
      return;
    }
    // Положение доски в странице, а не в окне: считаем так, будто страница не прокручена, —
    // иначе высота зависела бы от того, где человек стоял в момент замера.
    const top = board.getBoundingClientRect().top + window.scrollY;
    const room = window.innerHeight - top - BOARD_BOTTOM_GAP;
    board.style.maxHeight = `${Math.max(room, BOARD_MIN_HEIGHT)}px`;
  }, []);

  // Без списка зависимостей — после каждой отрисовки. Всё, что стоит над доской, меняет её
  // положение: развернули настройку, появилась жёлтая полоса, сменилось число колонок.
  // Перечислять эти поводы значит однажды один забыть, а замер стоит одного вызова.
  useEffect(fitBoard);

  useEffect(() => {
    window.addEventListener("resize", fitBoard);
    return () => window.removeEventListener("resize", fitBoard);
  }, [fitBoard]);
  const [detail, setDetail] = useState<OutreachCampaignContactDetail | null>(null);
  // Полная карточка человека — та же, что на своей странице в базе. Раньше в панели была
  // своя урезанная версия, и менеджер звонил, не видя ни денег, ни заметок, ни истории по
  // другим кампаниям.
  const [detailPerson, setDetailPerson] = useState<OutreachPersonCard | null>(null);
  const [reschedule, setReschedule] = useState<ReschedulableTask | null>(null);
  const [detailPersonError, setDetailPersonError] = useState<string | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [otherCampaigns, setOtherCampaigns] =
    useState<readonly OutreachCampaignSummary[]>([]);
  const [events, setEvents] = useState<readonly AdminEventSummary[]>([]);
  const [baseOpen, setBaseOpen] = useState(false);
  const [baseContacts, setBaseContacts] =
    useState<readonly OutreachBaseContact[]>([]);
  const [baseSelected, setBaseSelected] = useState<readonly string[]>([]);
  const [baseLoading, setBaseLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!id) {
      // Короткий адрес ещё не превратился в идентификатор: грузить нечего, и экран
      // остаётся в состоянии загрузки.
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [
        campaignResult,
        contactResult,
        managerResult,
        pipelineResult
      ] = await Promise.all([
        getOutreachCampaign(id, signal),
        listOutreachContacts(id, filters, signal),
        listOutreachManagers(signal),
        listOutreachPipelineColumns(id, signal)
      ]);
      setCampaign(campaignResult);
      setContacts(contactResult);
      setManagers(managerResult);
      const resolvedPipeline = pipelineResult.length > 0
        ? pipelineResult
        : DEFAULT_PIPELINE_COLUMNS;
      setPipelineColumns(resolvedPipeline);
      setPipelineDraft(toPipelineDraft(resolvedPipeline));
      setSelected([]);
      // Правила автозадач — надстройка: без них воронка работает, просто следующий шаг
      // придётся ставить руками. Их отказ не должен ронять всю страницу.
      void listOutreachTaskRules(id, signal)
        .then(setTaskRules)
        .catch(() => setTaskRules([]));
      try {
        setCustomFields(await listOutreachCustomFieldDefinitions(id, signal));
      } catch {
        // Custom fields are an enhancement; a failure here should not block
        // the rest of the campaign from loading.
      }
    } catch (caught) {
      if (!signal?.aborted) {
        setError(messageFor(caught, "Не удалось загрузить кампанию."));
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [filters, id]);

  useEffect(() => {
    if (alias === null) {
      return;
    }
    const controller = new AbortController();
    void listOutreachCampaigns(controller.signal)
      .then((all) => {
        const standing = all.find((item) => item.eventSlugPrefix === alias);
        if (standing) {
          setAliasId(standing.id);
          return;
        }
        setError(`Воронка «${alias}» не заведена.`);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Не удалось найти воронку.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [alias]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Приход с доски задач: `?contact=…` открывает шторку сразу, без поиска нужной карточки
  // глазами по всей воронке. Адрес читается из окна, а не через useSearchParams, чтобы
  // страница не тянула за собой Suspense ради одного необязательного параметра.
  useEffect(() => {
    const contactId = new URLSearchParams(window.location.search).get("contact");
    if (contactId) {
      void openDetail(contactId);
    }
    // Открываем один раз на заход: дальше шторкой распоряжается менеджер.
  }, []);

  // Списки кампаний и мероприятий нужны для переноса и привязки — грузим молча:
  // без них страница работает, просто без этих двух возможностей.
  useEffect(() => {
    const controller = new AbortController();
    void listOutreachCampaigns(controller.signal)
      .then((all) => setOtherCampaigns(all.filter((item) => item.id !== id)))
      .catch(() => setOtherCampaigns([]));
    void listEvents({ limit: 50 }, controller.signal)
      .then((page) => setEvents(page.items))
      .catch(() => setEvents([]));
    return () => controller.abort();
  }, [id]);

  // Карточка человека приезжает отдельным запросом: воронка знает про контакт только то,
  // что относится к этой кампании.
  const detailContactId = detail?.contactId ?? null;

  const loadDetailPerson = useCallback(async (signal?: AbortSignal) => {
    if (!detailContactId) {
      setDetailPerson(null);
      setDetailPersonError(null);
      return;
    }
    try {
      setDetailPerson(await getOutreachPerson(detailContactId, signal));
      setDetailPersonError(null);
    } catch (caught) {
      if (!signal?.aborted) {
        setDetailPerson(null);
        setDetailPersonError(messageFor(caught, "Не удалось загрузить карточку человека."));
      }
    }
  }, [detailContactId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDetailPerson(controller.signal);
    return () => controller.abort();
  }, [loadDetailPerson]);

  const pageIds = useMemo(
    () => contacts?.items.map((contact) => contact.id) ?? [],
    [contacts]
  );
  const allSelected = pageIds.length > 0
    && pageIds.every((contactId) => selected.includes(contactId));
  const boardGroups = useMemo(
    () => pipelineColumns.reduce<Record<
      OutreachPipelineStage,
      readonly OutreachCampaignContactSummary[]
    >>(
      (groups, column) => ({
        ...groups,
        [column.stage]: (contacts?.items ?? []).filter(
          (contact) => contact.stage === column.stage
            && (!onlyWithoutTask || contact.openTask === null)
        )
      }),
      {}
    ),
    [contacts, pipelineColumns, onlyWithoutTask]
  );

  /**
   * Карточки без следующего шага.
   *
   * Правило «без задачи нельзя» задним числом не применить: включив его, мы получили бы
   * заблокированную воронку и ничего больше. Поэтому старые карточки просто видно — их
   * разбирают руками, а счётчик показывает, сколько осталось.
   */
  const withoutTask = useMemo(
    () => (contacts?.items ?? []).filter((contact) =>
      contact.openTask === null
      && outcomeFor(contact.stage) !== "lost").length,
    [contacts, pipelineColumns]
  );

  function columnLabel(stage: OutreachPipelineStage): string {
    return pipelineColumns.find((column) => column.stage === stage)?.label
      ?? stageLabel(stage);
  }

  function outcomeFor(stage: OutreachPipelineStage): OutreachPipelineColumnOutcome {
    return pipelineColumns.find((column) => column.stage === stage)?.outcome
      ?? "open";
  }

  const filtersActive = filters.search !== undefined
    || filters.stage !== undefined
    || filters.assignedAdminId !== undefined
    || filters.mine === true
    || onlyWithoutTask;

  function resetFilters() {
    setOnlyWithoutTask(false);
    setFilters({ page: 1, limit: view === "board" ? 500 : 50 });
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const search = formText(data, "search").trim();
    const stage = formText(data, "stage");
    const assignedAdminId = formText(data, "assignedAdminId");
    setFilters({
      page: 1,
      limit: view === "board" ? 500 : 50,
      ...(search ? { search } : {}),
      ...(stage ? { stage } : {}),
      ...(assignedAdminId === "mine"
        ? { mine: true }
        : assignedAdminId
          ? { assignedAdminId }
          : {})
    });
  }

  function switchView(nextView: ViewMode) {
    setView(nextView);
    setFilters((current) => ({
      ...current,
      page: 1,
      limit: nextView === "board" ? 500 : 50
    }));
    setSelected([]);
  }

  async function addParticipantFromContact(
    event: FormEvent<HTMLFormElement>,
    contact: OutreachCampaignContactDetail
  ) {
    event.preventDefault();
    if (!campaign?.eventId) {
      return;
    }
    const data = new FormData(event.currentTarget);
    const number = (name: string) =>
      Number.parseInt(formText(data, name) || "0", 10);
    const ticketTitle = formText(data, "ticketTitle").trim();

    setMutating(true);
    setError(null);
    try {
      await addEventParticipant(campaign.eventId, {
        displayName: contact.displayName ?? "Без имени",
        source: "direct",
        adults: number("adults"),
        children: number("children"),
        sleepingPlaces: number("sleepingPlaces"),
        outreachContactId: contact.contactId,
        ...(contact.phone ? { phone: contact.phone } : {}),
        ...(ticketTitle ? { ticketTitle } : {})
      });
      setNotice("Контакт добавлен в участники мероприятия.");
      await openDetail(contact.id);
    } catch (caught) {
      setError(messageFor(caught, "Не удалось добавить участника."));
    } finally {
      setMutating(false);
    }
  }

  function toggleAll() {
    setSelected(allSelected ? [] : pageIds);
  }

  function toggleOne(contactId: string) {
    setSelected((current) =>
      current.includes(contactId)
        ? current.filter((idValue) => idValue !== contactId)
        : [...current, contactId]
    );
  }

  // Одна кнопка «Связаться» вместо двух: канал — это подробность разговора, а не отдельное
  // действие, и менеджеру всё равно приходилось уточнять его в форме. Диалогу нужны признаки
  // контактов — по ним он предлагает канал и предупреждает, кому этим каналом писать нечем.
  function touchTargets(
    ids: readonly string[]
  ): readonly OutreachTouchTarget[] {
    const byId = new Map<string, OutreachCampaignContactSummary>();
    for (const contact of contacts?.items ?? []) {
      byId.set(contact.id, contact);
    }
    if (detail) {
      byId.set(detail.id, detail);
    }
    return ids.map((targetId) => {
      const found = byId.get(targetId);
      // Не нашли — контакт всё равно в пачке: выкинуть его значило бы молча не записать
      // касание по тому, кого менеджер выбрал.
      return {
        campaignContactId: targetId,
        displayName: found?.displayName ?? null,
        phone: found?.phone ?? null,
        telegramUsername: found?.telegramUsername ?? null,
        maxIdentifier: found?.maxIdentifier ?? null,
        isOwn: found?.isOwn ?? false
      };
    });
  }

  async function saveDetailNote(body: string): Promise<boolean> {
    if (!detailContactId) {
      return false;
    }
    setMutating(true);
    setError(null);
    try {
      await createOutreachNote(detailContactId, body);
      await loadDetailPerson();
      return true;
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить заметку."));
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function removeDetailNote(noteId: string) {
    if (!window.confirm("Снять заметку? В карточке её больше не будет.")) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      await deleteOutreachNote(noteId);
      await loadDetailPerson();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось снять заметку."));
    } finally {
      setMutating(false);
    }
  }

  async function assignSelected(event: ChangeEvent<HTMLSelectElement>) {
    const assignedAdminId = event.target.value;
    if (!assignedAdminId || selected.length === 0) {
      return;
    }
    await assignIds(selected, assignedAdminId);
    event.target.value = "";
  }

  async function assignIds(ids: readonly string[], assignedAdminId: string) {
    setMutating(true);
    setError(null);
    try {
      const response = await assignOutreachContacts({
        campaignContactIds: ids,
        assignedAdminId
      });
      setNotice(`Назначено контактов: ${response.updated}`);
      await load();
      if (detail && ids.includes(detail.id)) {
        setDetail(await getOutreachContact(detail.id));
      }
    } catch (caught) {
      setError(messageFor(caught, "Не удалось назначить менеджера."));
    } finally {
      setMutating(false);
    }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (file.size > 5_000_000) {
      setError("CSV-файл должен быть не больше 5 МБ.");
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const { rows, lines, skippedLines } = parseOutreachCsv(await file.text());
      const skippedNote = skippedLines.length > 0
        ? ` Пропущено строк без контакта: ${skippedLines.length}.`
        : "";
      if (!window.confirm(
        `Добавить в кампанию ${rows.length} контактов?${skippedNote}`
      )) {
        return;
      }
      let added = 0;
      let duplicates = 0;
      const badLines: number[] = [];
      const mergeLines: number[] = [];
      // Импорт идёт пачками: сервер принимает не больше 500 строк за запрос, а на
      // восьми тысячах контактов это полсотни запросов — показываем, докуда дошли.
      for (let offset = 0; offset < rows.length; offset += 150) {
        const result = await importOutreachContacts(id, {
          rows: rows.slice(offset, offset + 150)
        });
        added += result.addedToCampaign;
        duplicates += result.alreadyInCampaign;
        // Панель и API перезапускаются по отдельности: если API на полшага позади и
        // ещё не отдаёт эти поля, импорт должен идти дальше, а не падать на чтении.
        for (const index of result.invalidRowIndexes ?? []) {
          const line = lines[offset + index];
          if (line !== undefined) {
            badLines.push(line);
          }
        }
        for (const index of result.ambiguousRowIndexes ?? []) {
          const line = lines[offset + index];
          if (line !== undefined) {
            mergeLines.push(line);
          }
        }
        setNotice(
          `Импортируем: ${Math.min(offset + 150, rows.length)} из ${rows.length}…`
        );
      }
      const badNote = badLines.length > 0
        ? ` Не удалось разобрать телефон в строках: ${badLines.slice(0, 15).join(", ")}`
          + `${badLines.length > 15 ? ` и ещё ${badLines.length - 15}` : ""}.`
        : "";
      const mergeNote = mergeLines.length > 0
        ? ` Телефон и Telegram указывают на разные контакты в строках: `
          + `${mergeLines.slice(0, 15).join(", ")}`
          + `${mergeLines.length > 15 ? ` и ещё ${mergeLines.length - 15}` : ""}`
          + ` — объедините эти контакты вручную.`
        : "";
      setNotice(
        `Добавлено: ${added}. Уже были в кампании: ${duplicates}.`
        + `${skippedNote}${badNote}${mergeNote}`
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось импортировать CSV.");
    } finally {
      setMutating(false);
    }
  }

  async function changeEvent(eventId: string) {
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      await updateOutreachCampaign(id, { eventId: eventId === "" ? null : eventId });
      setNotice(eventId === ""
        ? "Привязка к мероприятию снята."
        : "Кампания привязана к мероприятию.");
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось изменить мероприятие."));
    } finally {
      setMutating(false);
    }
  }

  async function loadBaseContacts(search: string) {
    setBaseLoading(true);
    try {
      setBaseContacts(await listOutreachBaseContacts({
        campaignId: id,
        onlyMissing: true,
        limit: 200,
        ...(search.trim().length >= 2 ? { search: search.trim() } : {})
      }));
    } catch (caught) {
      setError(messageFor(caught, "Не удалось загрузить контакты базы."));
    } finally {
      setBaseLoading(false);
    }
  }

  async function addFromBase() {
    if (baseSelected.length === 0) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addExistingContactsToCampaign({
        campaignId: id,
        contactIds: baseSelected
      });
      setNotice(
        `Добавлено из базы: ${result.added}.`
        + (result.alreadyInCampaign > 0
          ? ` Уже были в кампании: ${result.alreadyInCampaign}.`
          : "")
      );
      setBaseSelected([]);
      setBaseOpen(false);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось добавить контакты."));
    } finally {
      setMutating(false);
    }
  }

  async function importParticipants() {
    if (!window.confirm(
      "Загрузить участников мероприятия в кампанию? Кого нет в базе — заведём автоматически по телефону и нику."
    )) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await importEventParticipantsIntoCampaign(id);
      setNotice(
        `Участников обработано: ${result.received}. Заведено новых контактов: `
        + `${result.createdContacts}. Добавлено в кампанию: ${result.addedToCampaign}. `
        + `Уже были: ${result.alreadyInCampaign}.`
      );
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось загрузить участников."));
    } finally {
      setMutating(false);
    }
  }

  /**
   * Убрать одного человека — из шторки контакта.
   *
   * До этого убрать из кампании можно было только пачкой, отметив галочки, а галочки есть
   * только в таблице: с доски человека было не убрать вовсе.
   */
  async function removeFromCampaign(contact: OutreachCampaignContactDetail) {
    if (!window.confirm(
      `Убрать ${contact.displayName ?? "контакт"} из кампании? Человек останется в общей `
      + "базе, история звонков сохранится."
    )) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await removeOutreachContacts({
        campaignId: id,
        campaignContactIds: [contact.id]
      });
      if (result.removed === 0) {
        setError("Контакт уже убран из кампании.");
        return;
      }
      setNotice("Человек убран из кампании.");
      setDetail(null);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось убрать контакт из кампании."));
    } finally {
      setMutating(false);
    }
  }

  async function removeSelected() {
    if (selected.length === 0 || !window.confirm(
      `Убрать ${selected.length} контактов из кампании? Человек останется в общей базе, `
      + "история звонков сохранится."
    )) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await removeOutreachContacts({
        campaignId: id,
        campaignContactIds: selected
      });
      setNotice(`Убрано из кампании: ${result.removed}.`);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось убрать контакты."));
    } finally {
      setMutating(false);
    }
  }

  async function moveSelected(event: ChangeEvent<HTMLSelectElement>) {
    const targetCampaignId = event.target.value;
    event.target.value = "";
    if (!targetCampaignId || selected.length === 0) {
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await moveOutreachContacts({
        campaignContactIds: selected,
        targetCampaignId
      });
      setNotice(
        `Перенесено: ${result.moved}.`
        + (result.alreadyThere > 0
          ? ` Уже были в той кампании: ${result.alreadyThere}.`
          : "")
      );
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось перенести контакты."));
    } finally {
      setMutating(false);
    }
  }

  async function downloadExport() {
    setMutating(true);
    setError(null);
    try {
      const result = await exportOutreachCampaign(id);
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(messageFor(caught, "Не удалось подготовить экспорт."));
    } finally {
      setMutating(false);
    }
  }

  async function openDetail(contactId: string) {
    setMutating(true);
    setError(null);
    try {
      setDetail(await getOutreachContact(contactId));
    } catch (caught) {
      setError(messageFor(caught, "Не удалось открыть карточку."));
    } finally {
      setMutating(false);
    }
  }

  async function moveStage(
    contactId: string,
    stage: OutreachPipelineStage,
    lostReason?: OutreachLostReason,
    task?: OutreachNextStepValue
  ) {
    if (outcomeFor(stage) === "lost" && !lostReason) {
      setStageTarget({ contactId, stage });
      return;
    }
    setMutating(true);
    setError(null);
    try {
      const result = await updateOutreachContactStage(contactId, {
        stage,
        ...(lostReason ? { lostReason } : {}),
        ...(task ? { task } : {})
      });
      // Воронка не отпускает карточку без следующего шага. Спрашиваем его и повторяем
      // перенос вместе с задачей — одной операцией, чтобы карточка не успела полежать в
      // запрещённом состоянии.
      if (!result.updated && result.taskRequired) {
        setNextStep({
          contactId,
          stage,
          ...(lostReason ? { lostReason } : {})
        });
        return;
      }
      setNotice(`Контакт перемещён: ${columnLabel(stage)}`);
      setStageTarget(null);
      setNextStep(null);
      await load();
      if (detail?.id === contactId) {
        setDetail(await getOutreachContact(contactId));
      }
    } catch (caught) {
      setError(messageFor(caught, "Не удалось изменить этап."));
    } finally {
      setMutating(false);
      setDraggedId(null);
    }
  }

  function dropOnStage(
    event: DragEvent<HTMLDivElement>,
    stage: OutreachPipelineStage
  ) {
    event.preventDefault();
    if (draggedId) {
      void moveStage(draggedId, stage);
    }
  }

  async function submitLostReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stageTarget) {
      return;
    }
    const reason = formText(
      new FormData(event.currentTarget),
      "lostReason"
    ) as OutreachLostReason;
    await moveStage(stageTarget.contactId, stageTarget.stage, reason);
  }

  async function completeTask(task: OutreachTask) {
    await completeTaskById(task.id);
  }

  /** Задача из ленты карточки: там у строки есть только её идентификатор. */
  async function completeTaskById(taskId: string) {
    setMutating(true);
    setError(null);
    try {
      await completeOutreachTask(taskId);
      setNotice("Задача выполнена.");
      await load();
      if (detail) {
        setDetail(await getOutreachContact(detail.id));
      }
    } catch (caught) {
      setError(messageFor(caught, "Не удалось завершить задачу."));
    } finally {
      setMutating(false);
    }
  }

  /**
   * Задача из поля внизу ленты. Она про человека, а не про его работу в этой воронке:
   * задачи воронки ставит панель следующего шага выше, и смешивать их значило бы тихо
   * отменять чужой запланированный звонок — новая задача гасит открытую по своей линии.
   */
  async function createPersonTask(input: {
    readonly type: string;
    readonly text: string;
    readonly dueAt: Date;
    readonly assignedAdminId: string | null;
  }): Promise<boolean> {
    if (!detailPerson) {
      return false;
    }
    setMutating(true);
    setError(null);
    try {
      await createOutreachPersonTask(detailPerson.contactId, {
        type: input.type as OutreachTaskType,
        text: input.text,
        dueAt: input.dueAt.toISOString(),
        ...(input.assignedAdminId
          ? { assignedAdminId: input.assignedAdminId }
          : {})
      });
      setNotice("Задача поставлена.");
      await refreshDetailPerson();
      return true;
    } catch (caught) {
      setError(messageFor(caught, "Не удалось поставить задачу."));
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function savePersonFields(changes: {
    readonly source?: string | null;
    readonly assignedAdminId?: string | null;
    readonly nextMeetingAt?: string | null;
  }): Promise<boolean> {
    if (!detailPerson) {
      return false;
    }
    setMutating(true);
    setError(null);
    try {
      const result = await updateOutreachPerson(detailPerson.contactId, changes);
      if (result.status === "conflict") {
        setError("Значение уже занято другим контактом.");
        return false;
      }
      await refreshDetailPerson();
      return true;
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить поле."));
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function savePersonField(
    fieldId: string,
    value: string | null
  ): Promise<boolean> {
    if (!detailPerson) {
      return false;
    }
    setMutating(true);
    setError(null);
    try {
      await setOutreachPersonField(detailPerson.contactId, fieldId, value);
      await refreshDetailPerson();
      return true;
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить поле."));
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function refreshDetailPerson() {
    if (!detailPerson) {
      return;
    }
    setDetailPerson(await getOutreachPerson(detailPerson.contactId));
  }

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const assignedAdminId = formText(data, "assignedAdminId");
    if (
      !formText(data, "phone")
      && !formText(data, "telegram")
      && !formText(data, "max")
      && !formText(data, "email")
    ) {
      setError("Укажите телефон, Telegram, MAX или почту.");
      return;
    }
    setMutating(true);
    setError(null);
    try {
      const result = await createOutreachContact(id, {
        ...(formText(data, "name") ? { name: formText(data, "name") } : {}),
        ...(formText(data, "phone") ? { phone: formText(data, "phone") } : {}),
        ...(formText(data, "telegram")
          ? { telegram: formText(data, "telegram") }
          : {}),
        ...(formText(data, "max") ? { max: formText(data, "max") } : {}),
        ...(formText(data, "email") ? { email: formText(data, "email") } : {}),
        ...(formText(data, "source") ? { source: formText(data, "source") } : {}),
        ...(formText(data, "note") ? { note: formText(data, "note") } : {}),
        ...(assignedAdminId ? { assignedAdminId } : {})
      });
      setNotice(
        result.addedToCampaign > 0
          ? "Контакт добавлен в кампанию."
          : "Такой контакт уже есть в кампании."
      );
      setContactFormOpen(false);
      form.reset();
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось добавить контакт."));
    } finally {
      setMutating(false);
    }
  }

  function movePipelineColumn(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= pipelineDraft.length) {
      return;
    }
    const next = [...pipelineDraft];
    const current = next[index];
    const sibling = next[nextIndex];
    if (!current || !sibling) {
      return;
    }
    next[index] = sibling;
    next[nextIndex] = current;
    setPipelineDraft(next);
  }

  function addPipelineColumn() {
    if (pipelineDraft.length >= 20) {
      setNotice("Максимум 20 колонок в одной воронке.");
      return;
    }
    setPipelineDraft((current) => [
      ...current,
      { label: "Новая колонка", outcome: "open" }
    ]);
  }

  function removePipelineColumn(index: number) {
    if (pipelineDraft.length <= 1) {
      return;
    }
    setPipelineDraft((current) => current.filter((_, position) => position !== index));
  }

  function renamePipelineColumn(index: number, label: string) {
    setPipelineDraft((current) => current.map((column, position) =>
      position === index ? { ...column, label } : column
    ));
  }

  function setPipelineColumnOutcome(
    index: number,
    outcome: OutreachPipelineColumnOutcome
  ) {
    setPipelineDraft((current) => current.map((column, position) =>
      position === index ? { ...column, outcome } : column
    ));
  }

  async function submitPipelineSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMutating(true);
    setError(null);
    try {
      await updateOutreachPipelineColumns(id, pipelineDraft);
      await load();
      setPipelineSettingsOpen(false);
      setNotice("Настройки воронки сохранены.");
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить воронку. Если колонка ещё занята контактами, сначала переместите их."));
    } finally {
      setMutating(false);
    }
  }

  async function submitCampaignRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const start = Number(formText(data, "callWindowStart"));
    const end = Number(formText(data, "callWindowEnd"));
    if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) {
      setError("Окно обзвона задаётся часами, и начало должно быть раньше конца.");
      return;
    }
    setMutating(true);
    setError(null);
    try {
      setCampaign(await updateOutreachCampaignSettings(id, {
        requireOpenTask: data.get("requireOpenTask") !== null,
        callWindowStart: start,
        callWindowEnd: end
      }));
      setNotice("Правила воронки сохранены.");
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить правила."));
    } finally {
      setMutating(false);
    }
  }

  async function submitNewField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const label = formText(data, "label").trim();
    const type = formText(data, "type") as OutreachCustomFieldType;
    const scope = formText(data, "scope");
    const options = type === "select"
      ? formText(data, "options")
          .split(",")
          .map((option) => option.trim())
          .filter((option) => option.length > 0)
      : undefined;
    if (!label) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      const created = await createOutreachCustomFieldDefinition({
        ...(scope === "campaign" ? { campaignId: id } : {}),
        label,
        type,
        ...(options ? { options } : {})
      });
      setCustomFields((current) => [...current, created]);
      setFieldFormOpen(false);
      setNotice("Поле добавлено.");
    } catch (caught) {
      setError(messageFor(caught, "Не удалось добавить поле."));
    } finally {
      setMutating(false);
    }
  }

  async function removeField(fieldId: string) {
    if (!window.confirm("Удалить поле? Значения на всех карточках будут потеряны.")) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      await deleteOutreachCustomFieldDefinition(fieldId);
      setCustomFields((current) => current.filter((field) => field.id !== fieldId));
      setNotice("Поле удалено.");
    } catch (caught) {
      setError(messageFor(caught, "Не удалось удалить поле."));
    } finally {
      setMutating(false);
    }
  }

  async function updateDetailFieldValue(fieldId: string, value: string) {
    if (!detail) {
      return;
    }
    setError(null);
    try {
      await setOutreachCustomFieldValue(detail.id, fieldId, value.trim() || null);
      setDetail(await getOutreachContact(detail.id));
    } catch (caught) {
      setError(messageFor(caught, "Не удалось сохранить значение поля."));
    }
  }

  async function completeCampaign() {
    if (!campaign || !window.confirm("Завершить кампанию? Импорт после этого будет закрыт.")) {
      return;
    }
    setMutating(true);
    try {
      setCampaign(await updateOutreachCampaign(id, { status: "completed" }));
      setNotice("Кампания завершена.");
    } catch (caught) {
      setError(messageFor(caught, "Не удалось завершить кампанию."));
    } finally {
      setMutating(false);
    }
  }

  if (loading && !campaign) {
    return <PageLoading label="Загружаем кампанию" />;
  }
  if (error && !campaign) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!campaign) {
    return <PageError message="Кампания не найдена." retry={() => void load()} />;
  }

  const processed = campaign.totalContacts - campaign.untouchedContacts;

  return (
    <>
      {/* Назад — туда, откуда пришли. У воронки мероприятия это само мероприятие:
          отдельного раздела «Кампании» в меню больше нет, и возвращать в него человека,
          который открыл воронку из пикника, значит терять его на полпути. */}
      <Link
        className="back-link"
        href={campaign.eventId === null ? "/base" : `/events/${campaign.eventId}`}
      >
        <ArrowLeft size={16} />
        {campaign.eventId === null
          ? "Работа с базой"
          : campaign.eventTitle ?? "Мероприятие"}
      </Link>
      <div className="page-heading outreach-heading">
        <div>
          <p className="eyebrow">
            {campaign.eventId === null ? "Постоянная воронка" : "Воронка мероприятия"}
          </p>
          <div className="title-with-status">
            <h1>{campaign.name}</h1>
            <StatusPill tone={campaign.status === "completed" ? "neutral" : "positive"}>
              {campaign.status === "completed" ? "Завершена" : "Активна"}
            </StatusPill>
          </div>
          <p>{campaign.description ?? "Без описания"}</p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button bordered"
            type="button"
            aria-label="Обновить"
            title="Обновить"
            disabled={loading || mutating}
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="secondary-button"
            type="button"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((current) => !current)}
          >
            <SlidersHorizontal size={16} />
            {toolsOpen ? "Свернуть отбор" : "Отбор и сводка"}
          </button>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void importCsv(event)}
          />
          <button
            className="primary-button"
            type="button"
            disabled={mutating || campaign.status === "completed"}
            onClick={() => setContactFormOpen(true)}
          >
            <Plus size={16} />
            Добавить контакт
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating || campaign.status === "completed"}
            onClick={() => {
              setBaseOpen(true);
              setBaseSelected([]);
              void loadBaseContacts("");
            }}
          >
            <Users size={16} />
            Добавить из базы
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating || campaign.status === "completed"}
            onClick={() => fileInput.current?.click()}
          >
            <FileUp size={16} />
            Импорт CSV
          </button>
          {campaign.eventId ? (
            <button
              className="secondary-button"
              type="button"
              disabled={mutating}
              onClick={() => void importParticipants()}
            >
              <Users size={16} />
              Загрузить участников
            </button>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => void downloadExport()}
          >
            <Download size={16} />
            Экспорт
          </button>
          {campaign.status !== "completed" ? (
            <button
              className="secondary-button"
              type="button"
              disabled={mutating}
              onClick={() => void completeCampaign()}
            >
              <Check size={16} />
              Завершить
            </button>
          ) : null}
        </div>
      </div>

      {toolsOpen ? (
      <div className="metrics-strip">
        <div><span>Всего контактов</span><strong>{campaign.totalContacts}</strong></div>
        <div><span>Обработано</span><strong>{processed}</strong></div>
        <div><span>Заинтересованы</span><strong>{campaign.interestedContacts}</strong></div>
        <div><span>Оплатили / зарегистрировались</span><strong>{campaign.convertedContacts}</strong></div>
        {campaign.requireOpenTask ? (
          <div className={withoutTask > 0 ? "metric-attention" : undefined}>
            <span>Без следующего шага</span>
            <strong>{withoutTask}</strong>
          </div>
        ) : null}
      </div>
      ) : null}

      {campaign.requireOpenTask && withoutTask > 0 ? (
        <div className="outreach-notice">
          {withoutTask}
          {" "}
          {plural(withoutTask, "карточка", "карточки", "карточек")}
          {" "}
          {plural(withoutTask, "лежит", "лежат", "лежат")}
          {" без следующего шага — их завели до того, как воронка стала его требовать."}
          {" "}
          <button
            className="inline-link"
            type="button"
            onClick={() => setOnlyWithoutTask((current) => !current)}
          >
            {onlyWithoutTask ? "Показать все" : "Показать только их"}
          </button>
        </div>
      ) : null}

      {notice ? <div className="outreach-notice">{notice}</div> : null}
      {error ? <PageError message={error} retry={() => void load()} /> : null}

      {!toolsOpen && filtersActive ? (
        <div className="outreach-filter-hint">
          Показаны не все: включён отбор.
          {" "}
          <button className="inline-link" type="button" onClick={resetFilters}>
            Показать всех
          </button>
        </div>
      ) : null}

      {toolsOpen ? (
      <form className="filter-bar outreach-filters" onSubmit={applyFilters}>
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input name="search" type="search" placeholder="Имя, телефон, Telegram или MAX" />
        </label>
        <label className="select-field">
          <span>Этап</span>
          <select name="stage" defaultValue="">
            <option value="">Все этапы</option>
            {pipelineColumns.map((column) => (
              <option key={column.stage} value={column.stage}>{column.label}</option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <span>Ответственный</span>
          <select name="assignedAdminId" defaultValue="">
            <option value="">Все</option>
            <option value="mine">Только мои</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>{manager.displayName}</option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="submit">
          <Search size={16} />
          Показать
        </button>
      </form>
      ) : null}

      {selected.length > 0 ? (
        <div className="outreach-bulk-bar">
          <strong>Выбрано: {selected.length}</strong>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => setAction(selected)}
          >
            <PhoneCall size={16} />
            Связаться
          </button>
          {otherCampaigns.length > 0 ? (
            <label className="select-field outreach-assign">
              <span>Перенести в кампанию</span>
              <select defaultValue="" onChange={(event) => void moveSelected(event)} disabled={mutating}>
                <option value="">Выберите</option>
                {otherCampaigns.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="select-field outreach-assign">
            <span>Назначить менеджера</span>
            <select
              defaultValue=""
              onChange={(event) => void assignSelected(event)}
              disabled={mutating}
            >
              <option value="">Выберите</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.displayName}</option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => void removeSelected()}
          >
            <Trash2 size={16} />
            Убрать из кампании
          </button>
          <button className="icon-button" type="button" aria-label="Снять выделение" onClick={() => setSelected([])}>
            <X size={18} />
          </button>
        </div>
      ) : null}

      <section className="data-section outreach-leads" aria-label="Контакты кампании">
        <div className="section-title-row outreach-leads-title">
          <div>
            <h2>{view === "board" ? "Воронка продаж" : "Контакты"}</h2>
            <span>{contacts ? `${contacts.total} в кампании` : "—"}</span>
          </div>
          <div className="outreach-toolbar-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setPipelineDraft(toPipelineDraft(pipelineColumns));
                setPipelineSettingsOpen(true);
              }}
            >
              <Settings2 size={16} />
              Настроить воронку
            </button>
            <div className="outreach-view-toggle" aria-label="Вид контактов">
              <button
                type="button"
                className={view === "board" ? "active" : ""}
                aria-pressed={view === "board"}
                onClick={() => switchView("board")}
              >
                <LayoutGrid size={16} />
                Воронка
              </button>
              <button
                type="button"
                className={view === "table" ? "active" : ""}
                aria-pressed={view === "table"}
                onClick={() => switchView("table")}
              >
                <List size={16} />
                Список
              </button>
            </div>
          </div>
        </div>
        {loading && !contacts ? <PageLoading /> : null}
        {contacts?.items.length === 0 ? (
          <div className="outreach-empty">
            <strong>Контактов не найдено</strong>
            <span>Измените фильтры или импортируйте CSV.</span>
          </div>
        ) : null}
        {view === "board" && contacts && contacts.items.length > 0 ? (
          <>
            {contacts.total > contacts.items.length ? (
              <div className="outreach-board-limit">
                Показаны первые {contacts.items.length} контактов. Уточните фильтр для полной выборки.
              </div>
            ) : null}
            <div
              ref={boardRef}
              className={boardClassName(loading, panning)}
              onPointerDown={startPan}
              onPointerMove={pan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
            >
              {pipelineColumns.map((column) => (
                <div
                  className={`outreach-column outreach-column-${column.stage}`}
                  key={column.stage}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropOnStage(event, column.stage)}
                >
                  <header>
                    <span>{column.label}</span>
                    <strong>{(boardGroups[column.stage] ?? []).length}</strong>
                  </header>
                  <div className="outreach-column-cards">
                    {(boardGroups[column.stage] ?? []).map((contact) => (
                      <article
                        className="outreach-lead-card"
                        key={contact.id}
                        draggable={!mutating}
                        onDragStart={() => setDraggedId(contact.id)}
                        onDragEnd={() => setDraggedId(null)}
                      >
                        {/* Имя всюду ведёт в карточку клиента: одна дверь к человеку,
                            а не сокращённый показ в одном месте и полный в другом. */}
                        <Link
                          className="outreach-card-main"
                          href={`/base/${contact.contactId}`}
                          // Ссылку браузер тащит сам, и перетаскивание карточки по
                          // воронке начиналось бы с перетаскивания адреса.
                          draggable={false}
                        >
                          <span className="outreach-card-title">
                            <GripVertical size={15} aria-hidden="true" />
                            <strong>{contact.displayName ?? "Без имени"}</strong>
                          </span>
                          <span>{primaryContact(contact)}</span>
                        </Link>
                        {contact.isOwn ? <OwnBadge compact /> : null}
                        <div className="outreach-card-facts">
                          <span>{contact.assignedAdminName ?? "Без ответственного"}</span>
                          {contact.source ? <span>{contact.source}</span> : null}
                        </div>
                        <TaskBadge task={contact.openTask} />
                        <div className="outreach-card-actions">
                          <button
                            type="button"
                            aria-label="Связаться"
                            title="Связаться"
                            onClick={() => setAction([contact.id])}
                          >
                            <PhoneCall size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label="Работа по кампании"
                            title="Этап, ответственный, задача"
                            onClick={() => void openDetail(contact.id)}
                          >
                            <Settings2 size={15} />
                          </button>
                          {contact.linkedUserId ? (
                            <span title="Пользователь уже в боте">
                              <UserRoundCheck size={15} />
                            </span>
                          ) : null}
                        </div>
                      </article>
                    ))}
                    {(boardGroups[column.stage] ?? []).length === 0 ? (
                      <div className="outreach-column-empty">Перетащите контакт сюда</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {view === "table" && contacts && contacts.items.length > 0 ? (
          <>
            <div className={loading ? "table-wrap table-refreshing" : "table-wrap"}>
              <table className="outreach-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Выбрать всю страницу"
                      />
                    </th>
                    <th>Контакт</th>
                    <th>Этап</th>
                    <th>Ответственный</th>
                    <th>Следующая задача</th>
                    <th>Последнее касание</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.items.map((contact) => (
                    <tr key={contact.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(contact.id)}
                          onChange={() => toggleOne(contact.id)}
                          aria-label={`Выбрать ${contact.displayName ?? "контакт"}`}
                        />
                      </td>
                      <td>
                        <Link
                          className="outreach-contact-link"
                          href={`/base/${contact.contactId}`}
                        >
                          <strong>{contact.displayName ?? "Без имени"}</strong>
                          <span>{primaryContact(contact)}</span>
                        </Link>
                        {contact.isOwn ? <OwnBadge compact /> : null}
                        {contact.linkedUserId ? (
                          <span className="outreach-linked">
                            <UserRoundCheck size={13} /> В боте
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <StatusPill tone={stageTone(outcomeFor(contact.stage))}>
                          {columnLabel(contact.stage)}
                        </StatusPill>
                      </td>
                      <td>{contact.assignedAdminName ?? "Не назначен"}</td>
                      <td><TaskBadge task={contact.openTask} /></td>
                      <td>
                        {contact.lastActivityAt ? (
                          <div className="stacked-cell">
                            <strong>{contact.lastResult ? statusLabel(contact.lastResult) : "—"}</strong>
                            <span>{formatDateTime(contact.lastActivityAt)}</span>
                          </div>
                        ) : <span className="muted">Не обрабатывали</span>}
                      </td>
                      <td>
                        <div className="outreach-row-actions">
                          <button type="button" onClick={() => setAction([contact.id])}>
                            <PhoneCall size={16} />
                            Связаться
                          </button>
                          <button type="button" onClick={() => void openDetail(contact.id)}>
                            <Settings2 size={16} />
                            В воронке
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button
                className="secondary-button"
                type="button"
                disabled={(contacts.page ?? 1) <= 1 || loading}
                onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) - 1 }))}
              >
                Назад
              </button>
              <span>Страница {contacts.page}</span>
              <button
                className="secondary-button"
                type="button"
                disabled={contacts.page * contacts.limit >= contacts.total || loading}
                onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}
              >
                Далее
              </button>
            </div>
          </>
        ) : null}
      </section>

      {contactFormOpen ? (
        <div className="outreach-modal-backdrop" role="presentation">
          <section
            className="outreach-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-form-title"
          >
            <div className="section-title-row">
              <div>
                <h2 id="contact-form-title">Новый контакт</h2>
                <span>Укажите телефон, Telegram или MAX — достаточно одного.</span>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Закрыть"
                onClick={() => setContactFormOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="outreach-action-form outreach-contact-form"
              onSubmit={(event) => void submitContact(event)}
            >
              <label className="outreach-form-wide">
                <span>Имя</span>
                <input name="name" maxLength={200} autoFocus />
              </label>
              <label>
                <span>Телефон</span>
                <input name="phone" type="tel" maxLength={100} placeholder="+7 999 123-45-67" />
              </label>
              <label>
                <span>Telegram</span>
                <input name="telegram" maxLength={100} placeholder="@username" />
              </label>
              <label>
                <span>MAX</span>
                <input name="max" maxLength={100} placeholder="Идентификатор" />
              </label>
              <label>
                <span>Почта</span>
                <input name="email" type="email" maxLength={320} placeholder="name@example.com" />
              </label>
              <label>
                <span>Источник</span>
                <input name="source" maxLength={200} placeholder="Например, звонок с сайта" />
              </label>
              <label className="outreach-form-wide">
                <span>Ответственный</span>
                <select name="assignedAdminId" defaultValue="">
                  <option value="">Назначить меня</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>{manager.displayName}</option>
                  ))}
                </select>
              </label>
              <label className="outreach-form-wide">
                <span>Комментарий</span>
                <textarea name="note" rows={3} maxLength={2000} />
              </label>
              <button className="primary-button" type="submit" disabled={mutating}>
                {mutating ? "Добавляем…" : "Добавить контакт"}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {pipelineSettingsOpen ? (
        <div className="outreach-modal-backdrop" role="presentation">
          <section
            className="outreach-modal outreach-pipeline-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pipeline-settings-title"
          >
            <div className="section-title-row">
              <div>
                <h2 id="pipeline-settings-title">Настройка воронки</h2>
                <span>Добавляйте, удаляйте, переименовывайте колонки и меняйте их порядок.</span>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Закрыть"
                onClick={() => setPipelineSettingsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="outreach-pipeline-form"
              onSubmit={(event) => void submitPipelineSettings(event)}
            >
              {/* Привязка к мероприятию стояла над доской и отнимала строку каждый день
                  ради настройки, которую меняют один раз. Её место здесь — рядом с
                  колонками, где и решают, чем эта воронка занята. */}
              <label className="select-field outreach-pipeline-event">
                <span>Мероприятие воронки</span>
                <select
                  value={campaign.eventId ?? ""}
                  disabled={mutating}
                  onChange={(event) => void changeEvent(event.target.value)}
                >
                  <option value="">Без привязки</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>{event.title}</option>
                  ))}
                </select>
                <small>
                  {campaign.eventTitle
                    ? "Доехал до колонки с результатом «выигран» — участник заводится сам."
                    : "Привяжите мероприятие — и доехавшие до «выигран» попадут в участников сами."}
                </small>
              </label>
              <div className="outreach-pipeline-list">
                {pipelineDraft.map((column, index) => (
                  <div key={column.stage ?? `draft-${index}`}>
                    <span>{index + 1}</span>
                    <input
                      aria-label={`Название колонки ${index + 1}`}
                      value={column.label}
                      maxLength={60}
                      required
                      onChange={(event) => renamePipelineColumn(index, event.target.value)}
                    />
                    <select
                      aria-label={`Результат колонки ${index + 1}`}
                      value={column.outcome}
                      onChange={(event) => setPipelineColumnOutcome(
                        index,
                        event.target.value as OutreachPipelineColumnOutcome
                      )}
                    >
                      <option value="open">В работе</option>
                      <option value="won">Выигран</option>
                      <option value="lost">Проигран</option>
                    </select>
                    <div>
                      <button
                        type="button"
                        aria-label="Поднять колонку"
                        disabled={index === 0}
                        onClick={() => movePipelineColumn(index, -1)}
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label="Опустить колонку"
                        disabled={index === pipelineDraft.length - 1}
                        onClick={() => movePipelineColumn(index, 1)}
                      >
                        <ChevronDown size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label="Удалить колонку"
                        disabled={pipelineDraft.length <= 1}
                        onClick={() => removePipelineColumn(index)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={addPipelineColumn}
                disabled={pipelineDraft.length >= 20}
              >
                <Plus size={16} /> Добавить колонку
              </button>
              <p>
                Переименование не меняет историю и статистику. Отметьте «Выигран»/«Проигран»
                на колонках, где сделка закрывается — на этом основана аналитика конверсии,
                а для «Проигран» потребуется указать причину.
              </p>
              <button className="primary-button" type="submit" disabled={mutating}>
                {mutating ? "Сохраняем…" : "Сохранить воронку"}
              </button>
            </form>

            <div className="section-title-row">
              <div>
                <h3>Автозадачи</h3>
                <span>
                  Следующий шаг ставится сам. Открытую задачу автоматика не трогает —
                  запланированное менеджером главнее.
                </span>
              </div>
            </div>
            <OutreachTaskRules
              campaignId={id}
              rules={taskRules}
              columns={pipelineColumns}
              busy={mutating}
              onSaved={(saved) => {
                setTaskRules((current) => current.map((rule) =>
                  rule.id === saved.id ? saved : rule));
                setNotice("Правило сохранено.");
              }}
              onChanged={async (message) => {
                setTaskRules(await listOutreachTaskRules(id));
                setNotice(message);
              }}
              onError={setError}
            />

            <div className="section-title-row">
              <div>
                <h3>Правила воронки</h3>
                <span>Чем воронка отличается от остальных.</span>
              </div>
            </div>
            <form
              className="outreach-field-form"
              onSubmit={(event) => void submitCampaignRules(event)}
            >
              <label className="outreach-rule-check">
                <input
                  name="requireOpenTask"
                  type="checkbox"
                  defaultValue="on"
                  defaultChecked={campaign.requireOpenTask}
                />
                <span>
                  Не отпускать карточку без следующего шага.
                  {" "}
                  Колонок с исходом «проигран» правило не касается: там работа кончилась.
                </span>
              </label>
              <label>
                <span>Обзвон с</span>
                <input
                  name="callWindowStart"
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={campaign.callWindowStart}
                />
              </label>
              <label>
                <span>Обзвон до</span>
                <input
                  name="callWindowEnd"
                  type="number"
                  min={1}
                  max={24}
                  defaultValue={campaign.callWindowEnd}
                />
              </label>
              <p className="muted">
                В эти часы автоматика назначает звонки — по времени
                {" "}
                {campaign.callWindowTimezone}. Менеджер срок правит как обычно.
              </p>
              <button className="primary-button" type="submit" disabled={mutating}>
                Сохранить правила
              </button>
            </form>

            <div className="section-title-row">
              <div>
                <h3>Дополнительные поля карточки</h3>
                <span>Свои поля для клиентов — как в amoCRM.</span>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setFieldFormOpen((current) => !current)}
              >
                <Plus size={16} /> Добавить поле
              </button>
            </div>
            {fieldFormOpen ? (
              <form className="outreach-field-form" onSubmit={(event) => void submitNewField(event)}>
                <label>
                  <span>Название поля</span>
                  <input name="label" maxLength={80} required />
                </label>
                <label>
                  <span>Тип</span>
                  <select name="type" defaultValue="text">
                    <option value="text">Текст</option>
                    <option value="number">Число</option>
                    <option value="date">Дата</option>
                    <option value="select">Список</option>
                  </select>
                </label>
                <label>
                  <span>Варианты (через запятую, только для списка)</span>
                  <input name="options" placeholder="Instagram, Сайт, Рекомендация" />
                </label>
                <label>
                  <span>Область действия</span>
                  <select name="scope" defaultValue="campaign">
                    <option value="campaign">Только эта кампания</option>
                    <option value="global">Все кампании</option>
                  </select>
                </label>
                <button className="primary-button" type="submit" disabled={mutating}>
                  {mutating ? "Добавляем…" : "Добавить поле"}
                </button>
              </form>
            ) : null}
            <ul className="outreach-field-list">
              {customFields.map((field) => (
                <li key={field.id}>
                  <span>{field.label}</span>
                  <span className="outreach-field-type">{fieldTypeLabel(field.type)}</span>
                  <span className="outreach-field-scope">
                    {field.campaignId ? "эта кампания" : "все кампании"}
                  </span>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Удалить поле ${field.label}`}
                    onClick={() => void removeField(field.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
              {customFields.length === 0 ? <li>Пока нет ни одного поля.</li> : null}
            </ul>
          </section>
        </div>
      ) : null}

      {action ? (
        <OutreachTouchDialog
          campaignId={id}
          targets={touchTargets(action)}
          columns={pipelineColumns}
          onClose={() => setAction(null)}
          onRecorded={async (recorded) => {
            setNotice(`Касаний записано: ${recorded}`);
            setAction(null);
            await load();
            if (detail && action.includes(detail.id)) {
              setDetail(await getOutreachContact(detail.id));
            }
          }}
        />
      ) : null}

      {nextStep ? (
        <OutreachNextStepDialog
          title="Что дальше по этому контакту?"
          hint="Эта воронка не отпускает карточку без следующего шага"
          managers={managers}
          defaultAssignedAdminId={
            contacts?.items.find((item) => item.id === nextStep.contactId)
              ?.assignedAdminId ?? null
          }
          busy={mutating}
          onClose={() => setNextStep(null)}
          onSubmit={(task) => {
            const target = nextStep;
            setNextStep(null);
            void moveStage(
              target.contactId,
              target.stage,
              target.lostReason,
              task
            );
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
            await refreshDetailPerson();
          }}
        />
      ) : null}

      {ownOpen && detailPerson ? (
        <PersonOwnDialog
          person={detailPerson}
          onClose={() => setOwnOpen(false)}
          onDone={async (message) => {
            setNotice(message);
            setOwnOpen(false);
            await loadDetailPerson();
            await load();
            if (detail) {
              setDetail(await getOutreachContact(detail.id));
            }
          }}
        />
      ) : null}

      {stageTarget ? (
        <div className="outreach-modal-backdrop" role="presentation">
          <section className="outreach-modal outreach-small-modal" role="dialog" aria-modal="true" aria-labelledby="lost-title">
            <div className="section-title-row">
              <div>
                <h2 id="lost-title">Закрыть без результата</h2>
                <span>Укажите причину — она сохранится в истории.</span>
              </div>
              <button className="icon-button" type="button" aria-label="Закрыть" onClick={() => setStageTarget(null)}>
                <X size={18} />
              </button>
            </div>
            <form className="outreach-action-form" onSubmit={(event) => void submitLostReason(event)}>
              <label>
                <span>Причина</span>
                <select name="lostReason" required defaultValue="declined">
                  {LOST_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{lostReasonLabel(reason)}</option>
                  ))}
                </select>
              </label>
              <button className="primary-button" type="submit" disabled={mutating}>
                Закрыть контакт
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {baseOpen ? (
        <div className="outreach-modal-backdrop" role="presentation">
          <section
            className="outreach-modal outreach-pipeline-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="base-contacts-title"
          >
            <div className="section-title-row">
              <div>
                <h2 id="base-contacts-title">Добавить из общей базы</h2>
                <span>
                  Показаны те, кого ещё нет в этой кампании. Человек остаётся в базе и в
                  других кампаниях — здесь он просто добавляется в работу.
                </span>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Закрыть"
                onClick={() => setBaseOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="outreach-field-form"
              onSubmit={(event) => {
                event.preventDefault();
                void loadBaseContacts(formText(new FormData(event.currentTarget), "search"));
              }}
            >
              <label>
                <span>Поиск по имени, телефону или нику</span>
                <input name="search" maxLength={100} placeholder="Минимум две буквы" />
              </label>
              <button className="secondary-button" type="submit" disabled={baseLoading}>
                <Search size={16} />
                Найти
              </button>
            </form>
            {baseLoading ? <PageLoading label="Ищем в базе" /> : null}
            {!baseLoading && baseContacts.length === 0 ? (
              <div className="outreach-empty">
                <strong>Никого не нашлось</strong>
                <span>Либо все уже в кампании, либо уточните поиск.</span>
              </div>
            ) : null}
            {!baseLoading && baseContacts.length > 0 ? (
              <ul className="outreach-field-list base-contact-list">
                {baseContacts.map((contact) => (
                  <li key={contact.contactId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={baseSelected.includes(contact.contactId)}
                        onChange={() => setBaseSelected((current) =>
                          current.includes(contact.contactId)
                            ? current.filter((item) => item !== contact.contactId)
                            : [...current, contact.contactId])}
                      />
                      <strong>{contact.displayName ?? "Без имени"}</strong>
                    </label>
                    {contact.isOwn ? <OwnBadge compact /> : null}
                    <span className="outreach-field-type">
                      {contact.phone ?? contact.telegramUsername ?? contact.maxIdentifier ?? "—"}
                    </span>
                    <span className="outreach-field-scope">
                      {contact.campaignCount > 0
                        ? `в ${contact.campaignCount} кампаниях`
                        : "нигде не задействован"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="outreach-field-form">
              <button
                className="primary-button"
                type="button"
                disabled={mutating || baseSelected.length === 0}
                onClick={() => void addFromBase()}
              >
                Добавить выбранные ({baseSelected.length})
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {detail ? (
        <div
          className="outreach-drawer-backdrop"
          role="presentation"
          onMouseDown={() => setDetail(null)}
        >
          <aside
            className="outreach-drawer person-drawer"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {/* Шапка не уезжает вверх вместе с историей: закрыть панель и увидеть, чья она,
                нужно на любой глубине прокрутки. */}
            <div className="person-drawer-head">
              <div className="person-drawer-title">
                <div>
                  <h2>
                    <Link href={`/base/${detail.contactId}`}>
                      {detail.displayName ?? "Без имени"}
                    </Link>
                  </h2>
                  <span className="person-drawer-phone">{primaryContact(detail)}</span>
                </div>
                {detail.isOwn ? (
                  <OwnBadge
                    note={detailPerson?.ownNote ?? null}
                    compact
                    // Пока карточка человека не приехала, менять нечего: диалогу нужен
                    // её текущий текст, иначе он сотрёт объяснение пустым полем.
                    {...(detailPerson ? { onEdit: () => setOwnOpen(true) } : {})}
                  />
                ) : null}
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Закрыть"
                  onClick={() => setDetail(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="person-drawer-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={mutating}
                  onClick={() => setAction([detail.id])}
                >
                  <PhoneCall size={16} />
                  Связаться
                </button>
                <Link className="secondary-button" href={`/base/${detail.contactId}`}>
                  Открыть карточку
                  <ExternalLink size={15} />
                </Link>
              </div>
            </div>

            <div className="person-drawer-campaign">
              <p className="person-zone">Работа по кампании</p>

              <div className="outreach-lead-fields">
                <label>
                  <span>Этап воронки</span>
                  <select
                    value={detail.stage}
                    disabled={mutating}
                    onChange={(event) => void moveStage(detail.id, event.target.value)}
                  >
                    {pipelineColumns.map((column) => (
                      <option key={column.stage} value={column.stage}>{column.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Ответственный</span>
                  <select
                    value={detail.assignedAdminId ?? ""}
                    disabled={mutating}
                    onChange={(event) => void assignIds([detail.id], event.target.value)}
                  >
                    <option value="" disabled>Не назначен</option>
                    {managers.map((manager) => (
                      <option key={manager.id} value={manager.id}>{manager.displayName}</option>
                    ))}
                  </select>
                </label>
              </div>

              {detail.participations.length > 0 ? (
                <div className="accommodation-note">
                  <UserRoundCheck size={16} />
                  <span>
                    Едет на:{" "}
                    {detail.participations
                      .map((participation) =>
                        `${participation.eventTitle} — ${participation.guests} гост.`)
                      .join("; ")}
                  </span>
                </div>
              ) : null}

              {campaign.eventId && detail.participations.length === 0 ? (
                <details className="participant-from-contact">
                  <summary>Добавить в «{campaign.eventTitle}»</summary>
                  <form onSubmit={(event) => void addParticipantFromContact(event, detail)}>
                    <p className="muted">
                      Стадия «Оплатил» не знает, сколько человек едет и нужна ли палатка —
                      уточните здесь.
                    </p>
                    <label className="field">
                      <span>Взрослых</span>
                      <input name="adults" type="number" min={0} max={100} defaultValue={1} required />
                    </label>
                    <label className="field">
                      <span>Детей</span>
                      <input name="children" type="number" min={0} max={100} defaultValue={0} required />
                    </label>
                    <label className="field">
                      <span>Спальных мест</span>
                      <input name="sleepingPlaces" type="number" min={0} max={200} defaultValue={0} required />
                    </label>
                    <label className="field">
                      <span>Тариф</span>
                      <input name="ticketTitle" maxLength={200} placeholder="Все включено" />
                    </label>
                    <button className="primary-button" type="submit" disabled={mutating}>
                      Добавить участником
                    </button>
                  </form>
                </details>
              ) : null}

              {detail.customFields.length > 0 ? (
                <div className="outreach-custom-fields">
                  <h3>Дополнительные поля кампании</h3>
                  {detail.customFields.map((field) => (
                    <label key={field.fieldId}>
                      <span>{field.label}</span>
                      {field.type === "select" ? (
                        <select
                          defaultValue={field.value ?? ""}
                          onBlur={(event) => void updateDetailFieldValue(field.fieldId, event.target.value)}
                        >
                          <option value="">Не выбрано</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                          defaultValue={field.value ?? ""}
                          onBlur={(event) => void updateDetailFieldValue(field.fieldId, event.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              ) : null}

              <section className="outreach-task-panel">
                <div className="outreach-task-heading">
                  <div>
                    <CalendarClock size={18} />
                    <h3>Следующая задача</h3>
                  </div>
                  {detail.openTask ? (
                    <button
                      className="outreach-complete-task"
                      type="button"
                      disabled={mutating}
                      onClick={() => void completeTask(detail.openTask as OutreachTask)}
                    >
                      <CheckCircle2 size={16} />
                      Выполнено
                    </button>
                  ) : null}
                </div>
                {detail.openTask ? (
                  <div className="outreach-current-task">
                    <TaskBadge task={detail.openTask} />
                    <strong>{detail.openTask.text}</strong>
                    <span>{detail.openTask.assignedAdminName}</span>
                  </div>
                ) : (
                  <p className="muted">
                    Открытой задачи нет. Поставьте следующий шаг, чтобы контакт не потерялся.
                  </p>
                )}
                <details className="outreach-task-create" open={!detail.openTask}>
                  <summary>{detail.openTask ? "Заменить задачу" : "Поставить задачу"}</summary>
                  <OutreachTaskForm
                    target={{ kind: "campaign", campaignContactId: detail.id }}
                    openTask={detail.openTask}
                    managers={managers}
                    defaultAssignedAdminId={detail.assignedAdminId}
                    onSaved={async () => {
                      setNotice("Задача поставлена.");
                      await load();
                      setDetail(await getOutreachContact(detail.id));
                    }}
                  />
                </details>
              </section>

              <div className="person-drawer-campaign-footer">
                <button
                  className="secondary-button danger"
                  type="button"
                  disabled={mutating}
                  onClick={() => void removeFromCampaign(detail)}
                >
                  <Trash2 size={16} />
                  Убрать из кампании
                </button>
                <span className="muted">
                  Человек останется в базе, история звонков сохранится
                </span>
              </div>
            </div>

            {/* Дальше — та же карточка, что открывается на своей странице: деньги, заметки,
                анкеты и история по всем кампаниям, а не только по этой. */}
            <div className="person-flow">
              <p className="person-zone">
                Карточка клиента
                {detailPerson ? (
                  <button
                    className="person-zone-action"
                    type="button"
                    onClick={() => setOwnOpen(true)}
                  >
                    <ShieldCheck size={14} />
                    {detailPerson.isOwn ? "Изменить «свои»" : "Отметить «свои»"}
                  </button>
                ) : null}
              </p>
              {detailPersonError ? (
                <p className="muted person-empty">{detailPersonError}</p>
              ) : !detailPerson ? (
                <p className="muted person-empty">Загружаем карточку…</p>
              ) : (
                <>
                  <PersonFacts
                    person={detailPerson}
                    managers={managers}
                    busy={mutating}
                    onMoved={async (message) => {
                      setNotice(message);
                      // Карточка уехала в другую колонку — доску надо перечитать целиком,
                      // иначе она показывает человека там, где его уже нет.
                      await load();
                      await refreshDetailPerson();
                    }}
                    onError={setError}
                  />
                  <PersonBody
                    person={detailPerson}
                    managers={managers}
                    busy={mutating}
                    variant="drawer"
                    availableCampaigns={[]}
                    onAddToCampaign={null}
                    onSaveNote={saveDetailNote}
                    onRemoveNote={removeDetailNote}
                    onSaveContact={savePersonFields}
                    onSaveField={savePersonField}
                    onReload={refreshDetailPerson}
                    onCreateTask={createPersonTask}
                    /* Касание в воронке записывают её собственной кнопкой «Связаться»:
                       там уже выбраны и контакт, и колонки. Второй вход в тот же разбор
                       из ленты только путал бы, по какой строке пишется результат. */
                    onTouch={null}
                    onCompleteTask={async (taskId) => {
                      await completeTaskById(taskId);
                    }}
                    onRescheduleTask={(task) => setReschedule({
                      id: task.id,
                      type: task.type,
                      text: task.text,
                      dueAt: task.dueAt,
                      assignedAdminId: task.assignedAdminId,
                      campaignContactId: task.campaignContactId,
                      contactId: detailPerson.contactId,
                      contactName: detailPerson.displayName
                    })}
                  />
                </>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function TaskBadge({ task }: { readonly task: OutreachTask | null }) {
  if (!task) {
    return <span className="outreach-task-badge outreach-task-none">Нет задачи</span>;
  }
  const state = taskState(task.dueAt);
  return (
    <span className={`outreach-task-badge outreach-task-${state}`}>
      <CalendarClock size={13} />
      {state === "overdue"
        ? `Просрочено · ${formatDateTime(task.dueAt)}`
        : state === "today"
          ? `Сегодня · ${formatDateTime(task.dueAt)}`
          : formatDateTime(task.dueAt)}
    </span>
  );
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}

function primaryContact(contact: OutreachCampaignContactSummary): string {
  return contact.phone
    ?? (contact.telegramUsername ? `@${contact.telegramUsername}` : null)
    ?? contact.maxIdentifier
    ?? "Контакт не указан";
}





function fieldTypeLabel(type: OutreachCustomFieldType): string {
  return {
    text: "Текст",
    number: "Число",
    date: "Дата",
    select: "Список"
  }[type];
}





function taskState(dueAt: string): "overdue" | "today" | "future" {
  const due = new Date(dueAt);
  const now = new Date();
  if (due.getTime() < now.getTime()) {
    return "overdue";
  }
  return due.toDateString() === now.toDateString() ? "today" : "future";
}

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

// The update endpoint accepts stage/label/outcome only (position is derived
// from array order server-side and .strict() rejects unknown keys), so any
// column loaded from the API — which includes position — has to be stripped
// down before it goes back into the editable draft.
function toPipelineDraft(
  columns: readonly OutreachPipelineColumn[]
): readonly OutreachPipelineColumnDraft[] {
  return columns.map(({ stage, label, outcome }) => ({ stage, label, outcome }));
}

/** Сколько оставить под доской, чтобы полоса прокрутки не липла к нижнему краю окна. */
const BOARD_BOTTOM_GAP = 20;
/** Ниже этого доска не сжимается: на низком окне лучше прокрутка страницы, чем щель. */
const BOARD_MIN_HEIGHT = 320;

/** Три состояния доски в одном месте: обычная, обновляемая, возимая мышкой. */
function boardClassName(loading: boolean, panning: boolean): string {
  return [
    "outreach-board",
    loading ? "table-refreshing" : "",
    panning ? "outreach-board-dragging" : ""
  ].filter((name) => name !== "").join(" ");
}

const DEFAULT_PIPELINE_COLUMNS: readonly OutreachPipelineColumn[] = [
  { stage: "new", label: "Новые", position: 1, outcome: "open" },
  { stage: "first_contact", label: "Первичный контакт", position: 2, outcome: "open" },
  { stage: "dialogue", label: "В диалоге", position: 3, outcome: "open" },
  { stage: "follow_up", label: "Думает / перезвонить", position: 4, outcome: "open" },
  { stage: "interested", label: "Заинтересован", position: 5, outcome: "open" },
  { stage: "won", label: "Оплатил / зарегистрировался", position: 6, outcome: "won" },
  { stage: "lost", label: "Закрыто без результата", position: 7, outcome: "lost" }
];

