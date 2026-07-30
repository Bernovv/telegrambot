"use client";

import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  assignOutreachContacts,
  completeOutreachTask,
  createOutreachContact,
  createOutreachCustomFieldDefinition,
  createOutreachTask,
  deleteOutreachCustomFieldDefinition,
  exportOutreachCampaign,
  getOutreachCampaign,
  getOutreachContact,
  importOutreachContacts,
  listOutreachContacts,
  listOutreachCustomFieldDefinitions,
  listOutreachManagers,
  listOutreachPipelineColumns,
  recordOutreachActivities,
  setOutreachCustomFieldValue,
  updateOutreachCampaign,
  updateOutreachContactStage,
  updateOutreachPipelineColumns,
  type OutreachContactFilters,
  type OutreachPipelineColumnDraft
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import { parseOutreachCsv } from "@/lib/outreach-csv";
import type {
  OutreachCampaignContactDetail,
  OutreachCampaignContactPage,
  OutreachCampaignContactSummary,
  OutreachCampaignSummary,
  OutreachChannel,
  OutreachContactStatus,
  OutreachCustomFieldDefinition,
  OutreachCustomFieldType,
  OutreachLostReason,
  OutreachManager,
  OutreachPipelineColumn,
  OutreachPipelineColumnOutcome,
  OutreachPipelineStage,
  OutreachTask,
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
  FileUp,
  GripVertical,
  LayoutGrid,
  List,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings2,
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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

interface ActionTarget {
  readonly ids: readonly string[];
  readonly channel: OutreachChannel;
}

interface StageTarget {
  readonly contactId: string;
  readonly stage: OutreachPipelineStage;
}

type ViewMode = "board" | "table";

export default function OutreachCampaignPage() {
  const { id } = useParams<{ id: string }>();
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
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [activityResult, setActivityResult] =
    useState<Exclude<OutreachContactStatus, "new">>("sent");
  const [activityStage, setActivityStage] =
    useState<OutreachPipelineStage>("first_contact");
  const [stageTarget, setStageTarget] = useState<StageTarget | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OutreachCampaignContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
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
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

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
        [column.stage]: contacts?.items.filter(
          (contact) => contact.stage === column.stage
        ) ?? []
      }),
      {}
    ),
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

  // Suggests where a touch result should move the card. This only guesses
  // for the campaign's original default stage ids or by outcome flag
  // (won/lost); once a manager renames or removes those, the suggestion
  // simply falls back to leaving the card in its current column, and the
  // manager drags it manually.
  function stageForResult(
    result: Exclude<OutreachContactStatus, "new">
  ): OutreachPipelineStage {
    const byId = (stage: string) =>
      pipelineColumns.find((column) => column.stage === stage)?.stage;
    const byOutcome = (outcome: OutreachPipelineColumnOutcome) =>
      pipelineColumns.find((column) => column.outcome === outcome)?.stage;
    const suggestion: Partial<Record<typeof result, string | undefined>> = {
      sent: byId("first_contact"),
      no_answer: byId("first_contact"),
      answered: byId("dialogue"),
      callback: byId("follow_up"),
      interested: byId("interested"),
      declined: byOutcome("lost"),
      converted: byOutcome("won"),
      invalid: byOutcome("lost")
    };
    return suggestion[result] ?? pipelineColumns[0]?.stage ?? "new";
  }

  function beginAction(ids: readonly string[], channel: OutreachChannel) {
    const result = channel === "phone" ? "no_answer" : "sent";
    setActivityResult(result);
    setActivityStage(stageForResult(result));
    setAction({ ids, channel });
  }

  async function submitActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) {
      return;
    }
    const data = new FormData(event.currentTarget);
    const note = formText(data, "note").trim();
    const nextContactValue = formText(data, "nextContactAt");
    const lostReason = formText(data, "lostReason") as OutreachLostReason | "";
    setMutating(true);
    setError(null);
    try {
      const response = await recordOutreachActivities({
        campaignContactIds: action.ids,
        channel: action.channel,
        result: activityResult,
        stage: activityStage,
        ...(outcomeFor(activityStage) === "lost" && lostReason ? { lostReason } : {}),
        ...(note ? { note } : {}),
        ...(nextContactValue
          ? { nextContactAt: new Date(nextContactValue).toISOString() }
          : {})
      });
      setNotice(`Касаний записано: ${response.recorded}`);
      setAction(null);
      await load();
      if (detail && action.ids.includes(detail.id)) {
        setDetail(await getOutreachContact(detail.id));
      }
    } catch (caught) {
      setError(messageFor(caught, "Не удалось записать действие."));
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
      const rows = parseOutreachCsv(await file.text());
      if (!window.confirm(`Добавить в кампанию ${rows.length} контактов?`)) {
        return;
      }
      let added = 0;
      let duplicates = 0;
      for (let offset = 0; offset < rows.length; offset += 150) {
        const result = await importOutreachContacts(id, {
          rows: rows.slice(offset, offset + 150)
        });
        added += result.addedToCampaign;
        duplicates += result.alreadyInCampaign;
      }
      setNotice(`Добавлено: ${added}. Уже были в кампании: ${duplicates}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось импортировать CSV.");
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
    lostReason?: OutreachLostReason
  ) {
    if (outcomeFor(stage) === "lost" && !lostReason) {
      setStageTarget({ contactId, stage });
      return;
    }
    setMutating(true);
    setError(null);
    try {
      await updateOutreachContactStage(contactId, {
        stage,
        ...(lostReason ? { lostReason } : {})
      });
      setNotice(`Контакт перемещён: ${columnLabel(stage)}`);
      setStageTarget(null);
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

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) {
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const dueAt = formText(data, "dueAt");
    const assignedAdminId = formText(data, "assignedAdminId");
    setMutating(true);
    setError(null);
    try {
      await createOutreachTask(detail.id, {
        type: formText(data, "type") as OutreachTaskType,
        text: formText(data, "text"),
        dueAt: new Date(dueAt).toISOString(),
        ...(assignedAdminId ? { assignedAdminId } : {})
      });
      setNotice("Задача поставлена.");
      await load();
      setDetail(await getOutreachContact(detail.id));
      form.reset();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось поставить задачу."));
    } finally {
      setMutating(false);
    }
  }

  async function completeTask(task: OutreachTask) {
    setMutating(true);
    setError(null);
    try {
      await completeOutreachTask(task.id);
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

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const assignedAdminId = formText(data, "assignedAdminId");
    if (
      !formText(data, "phone")
      && !formText(data, "telegram")
      && !formText(data, "max")
    ) {
      setError("Укажите телефон, Telegram или MAX.");
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
      <Link className="back-link" href="/outreach">
        <ArrowLeft size={16} />
        Работа с базой
      </Link>
      <div className="page-heading outreach-heading">
        <div>
          <p className="eyebrow">Кампания</p>
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
            onClick={() => fileInput.current?.click()}
          >
            <FileUp size={16} />
            Импорт CSV
          </button>
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

      <div className="metrics-strip">
        <div><span>Всего контактов</span><strong>{campaign.totalContacts}</strong></div>
        <div><span>Обработано</span><strong>{processed}</strong></div>
        <div><span>Заинтересованы</span><strong>{campaign.interestedContacts}</strong></div>
        <div><span>Оплатили / зарегистрировались</span><strong>{campaign.convertedContacts}</strong></div>
      </div>

      {notice ? <div className="outreach-notice">{notice}</div> : null}
      {error ? <PageError message={error} retry={() => void load()} /> : null}

      <div className="outreach-toolbar">
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
            Настроить
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

      {selected.length > 0 ? (
        <div className="outreach-bulk-bar">
          <strong>Выбрано: {selected.length}</strong>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => beginAction(selected, "telegram")}
          >
            <MessageCircle size={16} />
            Отметить сообщения
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => beginAction(selected, "phone")}
          >
            <Phone size={16} />
            Отметить звонки
          </button>
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
          <button className="icon-button" type="button" aria-label="Снять выделение" onClick={() => setSelected([])}>
            <X size={18} />
          </button>
        </div>
      ) : null}

      <section className="data-section outreach-leads" aria-label="Контакты кампании">
        <div className="section-title-row">
          <div>
            <h2>{view === "board" ? "Воронка продаж" : "Контакты"}</h2>
            <span>{contacts ? `${contacts.total} в кампании` : "—"}</span>
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
            <div className={loading ? "outreach-board table-refreshing" : "outreach-board"}>
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
                        <button
                          className="outreach-card-main"
                          type="button"
                          onClick={() => void openDetail(contact.id)}
                        >
                          <span className="outreach-card-title">
                            <GripVertical size={15} aria-hidden="true" />
                            <strong>{contact.displayName ?? "Без имени"}</strong>
                          </span>
                          <span>{primaryContact(contact)}</span>
                        </button>
                        <div className="outreach-card-facts">
                          <span>{contact.assignedAdminName ?? "Без ответственного"}</span>
                          {contact.source ? <span>{contact.source}</span> : null}
                        </div>
                        <TaskBadge task={contact.openTask} />
                        <div className="outreach-card-actions">
                          <button
                            type="button"
                            aria-label="Отметить сообщение"
                            onClick={() => beginAction([contact.id], "telegram")}
                          >
                            <MessageCircle size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label="Отметить звонок"
                            onClick={() => beginAction([contact.id], "phone")}
                          >
                            <Phone size={15} />
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
                        <button
                          className="outreach-contact-link"
                          type="button"
                          onClick={() => void openDetail(contact.id)}
                        >
                          <strong>{contact.displayName ?? "Без имени"}</strong>
                          <span>{primaryContact(contact)}</span>
                        </button>
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
                          <button type="button" onClick={() => beginAction([contact.id], "telegram")}>
                            <MessageCircle size={16} />
                            Написал
                          </button>
                          <button type="button" onClick={() => beginAction([contact.id], "phone")}>
                            <Phone size={16} />
                            Позвонил
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
        <div className="outreach-modal-backdrop" role="presentation">
          <section className="outreach-modal" role="dialog" aria-modal="true" aria-labelledby="activity-title">
            <div className="section-title-row">
              <div>
                <h2 id="activity-title">
                  {action.channel === "phone" ? "Результат звонка" : "Результат сообщения"}
                </h2>
                <span>Контактов: {action.ids.length}</span>
              </div>
              <button className="icon-button" type="button" aria-label="Закрыть" onClick={() => setAction(null)}>
                <X size={18} />
              </button>
            </div>
            <form className="outreach-action-form" onSubmit={(event) => void submitActivity(event)}>
              {action.channel !== "phone" ? (
                <label>
                  <span>Канал</span>
                  <select
                    value={action.channel}
                    onChange={(event) => {
                      const nextChannel = event.target.value as OutreachChannel;
                      const nextResult = nextChannel === "phone" ? "no_answer" : "sent";
                      setAction({ ...action, channel: nextChannel });
                      setActivityResult(nextResult);
                      setActivityStage(stageForResult(nextResult));
                    }}
                  >
                    <option value="telegram">Telegram</option>
                    <option value="max">MAX</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="sms">SMS</option>
                    <option value="other">Другое</option>
                  </select>
                </label>
              ) : null}
              <label>
                <span>Результат касания</span>
                <select
                  required
                  value={activityResult}
                  onChange={(event) => {
                    const result = event.target.value as Exclude<OutreachContactStatus, "new">;
                    setActivityResult(result);
                    setActivityStage(stageForResult(result));
                  }}
                >
                  {resultsFor(action.channel).map((result) => (
                    <option key={result} value={result}>{statusLabel(result)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Переместить в этап</span>
                <select
                  value={activityStage}
                  onChange={(event) => setActivityStage(event.target.value)}
                >
                  {pipelineColumns.map((column) => (
                    <option key={column.stage} value={column.stage}>{column.label}</option>
                  ))}
                </select>
              </label>
              {outcomeFor(activityStage) === "lost" ? (
                <label>
                  <span>Причина закрытия</span>
                  <select name="lostReason" required defaultValue="declined">
                    {LOST_REASONS.map((reason) => (
                      <option key={reason} value={reason}>{lostReasonLabel(reason)}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span>{activityResult === "callback" ? "Когда связаться" : "Следующая задача (необязательно)"}</span>
                <input
                  name="nextContactAt"
                  type="datetime-local"
                  required={activityResult === "callback"}
                />
              </label>
              <label>
                <span>Комментарий</span>
                <textarea name="note" rows={3} maxLength={2000} />
              </label>
              <button className="primary-button" type="submit" disabled={mutating}>
                {mutating ? "Сохраняем…" : "Записать касание"}
              </button>
            </form>
          </section>
        </div>
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

      {detail ? (
        <div className="outreach-drawer-backdrop" role="presentation" onMouseDown={() => setDetail(null)}>
          <aside className="outreach-drawer outreach-lead-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <div>
                <h2>{detail.displayName ?? "Без имени"}</h2>
                <span>{primaryContact(detail)}</span>
              </div>
              <button className="icon-button" type="button" aria-label="Закрыть" onClick={() => setDetail(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="outreach-drawer-actions">
              <button type="button" onClick={() => beginAction([detail.id], "phone")}>
                <Phone size={16} /> Звонок
              </button>
              <button type="button" onClick={() => beginAction([detail.id], "telegram")}>
                <MessageCircle size={16} /> Сообщение
              </button>
            </div>

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

            <div className="outreach-contact-meta">
              <span>Источник</span><strong>{detail.source ?? "Не указан"}</strong>
              <span>Заметка из импорта</span><strong>{detail.note ?? "Нет"}</strong>
              <span>Последний результат</span><strong>{statusLabel(detail.status)}</strong>
              <span>Регистрация в боте</span><strong>{detail.linkedUserId ? "Да" : "Нет"}</strong>
            </div>

            {detail.customFields.length > 0 ? (
              <div className="outreach-custom-fields">
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
                <p className="muted">Открытой задачи нет. Поставьте следующий шаг, чтобы контакт не потерялся.</p>
              )}
              <details className="outreach-task-create" open={!detail.openTask}>
                <summary>{detail.openTask ? "Заменить задачу" : "Поставить задачу"}</summary>
                <form onSubmit={(event) => void submitTask(event)}>
                  <label>
                    <span>Тип</span>
                    <select name="type" defaultValue="call">
                      <option value="call">Позвонить</option>
                      <option value="message">Написать</option>
                      <option value="other">Другое</option>
                    </select>
                  </label>
                  <label>
                    <span>Срок</span>
                    <input name="dueAt" type="datetime-local" required />
                  </label>
                  <label className="outreach-task-text">
                    <span>Что сделать</span>
                    <input name="text" maxLength={500} required defaultValue="Связаться с клиентом" />
                  </label>
                  <label className="outreach-task-text">
                    <span>Ответственный</span>
                    <select name="assignedAdminId" defaultValue={detail.assignedAdminId ?? ""}>
                      <option value="">Текущий менеджер</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>{manager.displayName}</option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button" type="submit" disabled={mutating}>
                    Сохранить задачу
                  </button>
                </form>
              </details>
            </section>

            <div className="outreach-history">
              <h3>История</h3>
              {detail.activities.length === 0 && detail.stageHistory.length <= 1 ? (
                <p className="muted">Касаний пока нет.</p>
              ) : null}
              {buildTimeline(detail, pipelineColumns).map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.meta}</span>
                  </div>
                  <p>{item.actor} · {formatDateTime(item.occurredAt)}</p>
                  {item.note ? <small>{item.note}</small> : null}
                </article>
              ))}
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

function buildTimeline(
  detail: OutreachCampaignContactDetail,
  columns: readonly OutreachPipelineColumn[]
) {
  const columnName = (stage: OutreachPipelineStage) =>
    columns.find((column) => column.stage === stage)?.label ?? stageLabel(stage);
  const activities = detail.activities.map((activity) => ({
    id: `activity-${activity.id}`,
    title: statusLabel(activity.result),
    meta: channelLabel(activity.channel),
    actor: activity.actorName,
    occurredAt: activity.occurredAt,
    note: activity.note
  }));
  const stages = detail.stageHistory
    .filter((entry) => entry.fromStage !== null)
    .map((entry) => ({
      id: `stage-${entry.id}`,
      title: `Этап: ${columnName(entry.toStage)}`,
      meta: entry.fromStage ? `из «${columnName(entry.fromStage)}»` : "Создан",
      actor: entry.actorName,
      occurredAt: entry.occurredAt,
      note: entry.lostReason ? `Причина: ${lostReasonLabel(entry.lostReason)}` : null
    }));
  const tasks = detail.tasks.map((task) => ({
    id: `task-${task.id}`,
    title: task.status === "completed" ? "Задача выполнена" : task.status === "cancelled" ? "Задача заменена" : "Задача поставлена",
    meta: taskTypeLabel(task.type),
    actor: task.createdByAdminName,
    occurredAt: task.completedAt ?? task.createdAt,
    note: `${task.text} · срок ${formatDateTime(task.dueAt)}`
  }));
  return [...activities, ...stages, ...tasks]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
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

function resultsFor(
  channel: OutreachChannel
): readonly Exclude<OutreachContactStatus, "new">[] {
  return channel === "phone"
    ? ["no_answer", "answered", "callback", "interested", "declined", "converted", "invalid"]
    : ["sent", "answered", "callback", "interested", "declined", "converted", "invalid"];
}

function statusLabel(status: OutreachContactStatus): string {
  return {
    new: "Не обрабатывали",
    sent: "Отправлено",
    no_answer: "Не ответил",
    answered: "Ответил",
    callback: "Перезвонить",
    interested: "Заинтересован",
    declined: "Отказ",
    converted: "Оплатил",
    invalid: "Неверный контакт"
  }[status];
}

function stageLabel(stage: OutreachPipelineStage): string {
  return (({
    new: "Новые",
    first_contact: "Первичный контакт",
    dialogue: "В диалоге",
    follow_up: "Думает / перезвонить",
    interested: "Заинтересован",
    won: "Оплатил / зарегистрировался",
    lost: "Закрыто без результата"
  }) as Record<string, string>)[stage] ?? stage;
}

function fieldTypeLabel(type: OutreachCustomFieldType): string {
  return {
    text: "Текст",
    number: "Число",
    date: "Дата",
    select: "Список"
  }[type];
}

function lostReasonLabel(reason: OutreachLostReason): string {
  return {
    declined: "Отказался",
    not_relevant: "Неактуально",
    invalid_contact: "Неверный контакт",
    duplicate: "Дубль",
    other: "Другое"
  }[reason];
}

function taskTypeLabel(type: OutreachTaskType): string {
  return {
    call: "Позвонить",
    message: "Написать",
    other: "Другое"
  }[type];
}

function channelLabel(channel: OutreachChannel): string {
  return {
    phone: "Звонок",
    telegram: "Telegram",
    max: "MAX",
    whatsapp: "WhatsApp",
    sms: "SMS",
    other: "Другое"
  }[channel];
}

// Individual mid-pipeline stages no longer have fixed meaning once managers
// can add/remove/rename them, so tone now follows the outcome flag only.
function stageTone(
  outcome: OutreachPipelineColumnOutcome
): "positive" | "warning" | "neutral" | "danger" {
  if (outcome === "won") {
    return "positive";
  }
  if (outcome === "lost") {
    return "danger";
  }
  return "neutral";
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

const DEFAULT_PIPELINE_COLUMNS: readonly OutreachPipelineColumn[] = [
  { stage: "new", label: "Новые", position: 1, outcome: "open" },
  { stage: "first_contact", label: "Первичный контакт", position: 2, outcome: "open" },
  { stage: "dialogue", label: "В диалоге", position: 3, outcome: "open" },
  { stage: "follow_up", label: "Думает / перезвонить", position: 4, outcome: "open" },
  { stage: "interested", label: "Заинтересован", position: 5, outcome: "open" },
  { stage: "won", label: "Оплатил / зарегистрировался", position: 6, outcome: "won" },
  { stage: "lost", label: "Закрыто без результата", position: 7, outcome: "lost" }
];

const LOST_REASONS: readonly OutreachLostReason[] = [
  "declined",
  "not_relevant",
  "invalid_contact",
  "duplicate",
  "other"
];
