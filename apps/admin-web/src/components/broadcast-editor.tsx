"use client";

import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  createAdminBroadcast,
  getAdminBroadcast,
  listAdminBroadcasts,
  listAdminSavedSegments,
  listAdminSegmentAudienceSnapshots,
  publishAdminBroadcastDraft,
  scheduleAdminBroadcast,
  updateAdminBroadcastDraft
} from "@/lib/admin-api";
import { formatCompactDate, formatEventDateTime } from "@/lib/format";
import type {
  AdminBroadcast,
  AdminBroadcastLinkButton,
  AdminBroadcastSummary
} from "@ticket-platform/contracts/admin-broadcasts";
import type {
  AdminSavedSegmentSummary,
  AdminSegmentAudienceSnapshotSummary
} from "@ticket-platform/contracts/admin-segments";
import {
  FilePlus2,
  FolderOpen,
  CalendarClock,
  Link2,
  Plus,
  Rocket,
  Save,
  Trash2,
  UsersRound
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface DraftButton extends AdminBroadcastLinkButton {
  readonly id: string;
}

export function BroadcastEditor() {
  const buttonSequence = useRef(1);
  const [broadcasts, setBroadcasts] =
    useState<readonly AdminBroadcastSummary[]>([]);
  const [segments, setSegments] =
    useState<readonly AdminSavedSegmentSummary[]>([]);
  const [selectedBroadcast, setSelectedBroadcast] =
    useState<AdminBroadcast | null>(null);
  const [snapshots, setSnapshots] =
    useState<readonly AdminSegmentAudienceSnapshotSummary[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [disableLinkPreview, setDisableLinkPreview] = useState(false);
  const [buttons, setButtons] = useState<readonly DraftButton[]>([]);
  const [reason, setReason] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [scheduleTimezone, setScheduleTimezone] = useState("Europe/Moscow");
  const [ratePerSecond, setRatePerSecond] = useState(10);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      listAdminBroadcasts(controller.signal),
      listAdminSavedSegments(controller.signal)
    ])
      .then(([nextBroadcasts, nextSegments]) => {
        setBroadcasts(nextBroadcasts);
        setSegments(nextSegments);
        setScheduledLocal(defaultScheduleLocal());
        setScheduleTimezone(browserTimezone());
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(message(caught));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  if (loading) {
    return <PageLoading label="Загружаем редактор рассылок" />;
  }
  if (error && broadcasts.length === 0 && segments.length === 0) {
    return (
      <PageError
        message={error}
        retry={() => window.location.reload()}
      />
    );
  }

  async function refreshBroadcasts() {
    setBroadcasts(await listAdminBroadcasts());
  }

  async function selectSegment(
    nextSegmentId: string,
    preferredSnapshotId = ""
  ) {
    setSegmentId(nextSegmentId);
    setSnapshotId("");
    setSnapshots([]);
    if (!nextSegmentId) {
      return;
    }
    const nextSnapshots = await listAdminSegmentAudienceSnapshots(
      nextSegmentId
    );
    const readySnapshots = nextSnapshots.filter(
      (snapshot) => snapshot.status === "ready"
    );
    setSnapshots(readySnapshots);
    if (
      preferredSnapshotId
      && readySnapshots.some((snapshot) => snapshot.id === preferredSnapshotId)
    ) {
      setSnapshotId(preferredSnapshotId);
    }
  }

  function applyBroadcast(broadcast: AdminBroadcast) {
    const version = broadcast.draft ?? broadcast.published;
    if (!version) {
      throw new Error("У рассылки нет доступной версии.");
    }
    setSelectedBroadcast(broadcast);
    setName(version.name);
    setText(version.content.text);
    setDisableLinkPreview(version.content.disableLinkPreview);
    setButtons(version.content.buttons.map((button) => ({
      ...button,
      id: `button-${buttonSequence.current++}`
    })));
    if (broadcast.schedule) {
      setScheduledLocal(toZonedLocalInput(
        new Date(broadcast.schedule.scheduledAt),
        broadcast.schedule.timezone
      ));
      setScheduleTimezone(broadcast.schedule.timezone);
      setRatePerSecond(broadcast.schedule.ratePerSecond);
    } else {
      setScheduledLocal(defaultScheduleLocal());
      setScheduleTimezone(browserTimezone());
    }
    return selectSegment(
      version.audienceSnapshot.segmentId,
      version.audienceSnapshot.id
    );
  }

  async function openBroadcast(broadcastId: string) {
    setBusy(true);
    setError(null);
    try {
      await applyBroadcast(await getAdminBroadcast(broadcastId));
      setReason("");
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  function startNewBroadcast() {
    setSelectedBroadcast(null);
    setSnapshots([]);
    setSegmentId("");
    setSnapshotId("");
    setName("");
    setText("");
    setDisableLinkPreview(false);
    setButtons([]);
    setReason("");
    setScheduledLocal(defaultScheduleLocal());
    setScheduleTimezone(browserTimezone());
    setRatePerSecond(10);
    setError(null);
  }

  function updateButton(id: string, patch: Partial<AdminBroadcastLinkButton>) {
    setButtons((current) => current.map((button) =>
      button.id === id ? { ...button, ...patch } : button
    ));
  }

  function addButton() {
    if (buttons.length >= 8) {
      return;
    }
    setButtons((current) => [...current, {
      id: `button-${buttonSequence.current++}`,
      label: "",
      url: ""
    }]);
  }

  function validateDraft(): boolean {
    if (!name.trim() || !text.trim() || !snapshotId || !reason.trim()) {
      setError(
        "Укажите название, текст, готовый снимок аудитории и причину изменения."
      );
      return false;
    }
    if (buttons.some((button) => !button.label.trim() || !button.url.trim())) {
      setError("Заполните название и HTTPS-адрес каждой кнопки.");
      return false;
    }
    return true;
  }

  async function saveDraft() {
    if (selectedBroadcast?.lifecycleStatus !== "draft") {
      setError("Запланированную рассылку нельзя редактировать.");
      return;
    }
    if (!validateDraft()) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const content = {
        text,
        disableLinkPreview,
        buttons: buttons.map(({ label, url }) => ({ label, url }))
      };
      const broadcast = selectedBroadcast
        ? await updateAdminBroadcastDraft(selectedBroadcast.id, {
            expectedLockVersion: selectedBroadcast.lockVersion,
            name,
            audienceSnapshotId: snapshotId,
            content,
            reason
          })
        : await createAdminBroadcast({
            name,
            audienceSnapshotId: snapshotId,
            content,
            reason
          });
      await applyBroadcast(broadcast);
      setReason("");
      await refreshBroadcasts();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function publishDraft() {
    if (!selectedBroadcast?.draft || !reason.trim()) {
      setError("Сначала сохраните черновик и укажите причину публикации.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const broadcast = await publishAdminBroadcastDraft(
        selectedBroadcast.id,
        {
          expectedLockVersion: selectedBroadcast.lockVersion,
          reason
        }
      );
      await applyBroadcast(broadcast);
      setReason("");
      await refreshBroadcasts();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function scheduleBroadcast() {
    if (
      !selectedBroadcast?.published
      || selectedBroadcast.draft
      || !scheduledLocal
      || !reason.trim()
    ) {
      setError(
        "Опубликуйте последнюю версию, выберите дату и укажите причину планирования."
      );
      return;
    }
    const scheduledAt = new Date(scheduledLocal);
    if (Number.isNaN(scheduledAt.getTime())) {
      setError("Дата планирования некорректна.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const broadcast = await scheduleAdminBroadcast(selectedBroadcast.id, {
        expectedLockVersion: selectedBroadcast.lockVersion,
        scheduledAt: scheduledAt.toISOString(),
        timezone: scheduleTimezone,
        ratePerSecond,
        reason
      });
      await applyBroadcast(broadcast);
      setReason("");
      await refreshBroadcasts();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  const selectedSnapshot = snapshots.find(
    (snapshot) => snapshot.id === snapshotId
  );
  const editorLocked = selectedBroadcast !== null
    && selectedBroadcast.lifecycleStatus !== "draft";

  return (
    <>
      {error ? <div className="inline-alert">{error}</div> : null}
      <section className="data-section broadcast-editor">
        <div className="section-title-row">
          <div>
            <h2>Версия сообщения</h2>
            <span>
              {selectedBroadcast
                ? `Версия блокировки ${selectedBroadcast.lockVersion}`
                : "Новый черновик"}
            </span>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={startNewBroadcast}
          >
            <FilePlus2 size={17} />
            Новый
          </button>
        </div>

        <div className="broadcast-form-grid">
          <label className="field field-full">
            <span>Сохранённые рассылки</span>
            <select
              value={selectedBroadcast?.id ?? ""}
              disabled={busy || broadcasts.length === 0}
              onChange={(event) => {
                if (event.target.value) {
                  void openBroadcast(event.target.value);
                }
              }}
            >
              <option value="">Выберите рассылку</option>
              {broadcasts.map((broadcast) => (
                <option key={broadcast.id} value={broadcast.id}>
                  {broadcast.name}
                  {broadcast.draftVersionNumber
                    ? ` · черновик v${broadcast.draftVersionNumber}`
                    : ""}
                  {broadcast.publishedVersionNumber
                    ? ` · опубликована v${broadcast.publishedVersionNumber}`
                    : ""}
                  {broadcast.lifecycleStatus !== "draft"
                    ? ` · ${lifecycleLabel(broadcast.lifecycleStatus)}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Название</span>
            <input
              value={name}
              maxLength={120}
              disabled={busy || editorLocked}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Причина изменения</span>
            <input
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Сегмент</span>
            <select
              value={segmentId}
              disabled={busy || editorLocked}
              onChange={(event) => {
                setBusy(true);
                setError(null);
                void selectSegment(event.target.value)
                  .catch((caught) => setError(message(caught)))
                  .finally(() => setBusy(false));
              }}
            >
              <option value="">Выберите сегмент</option>
              {segments.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Готовый снимок аудитории</span>
            <select
              value={snapshotId}
              disabled={busy || editorLocked || snapshots.length === 0}
              onChange={(event) => setSnapshotId(event.target.value)}
            >
              <option value="">Выберите снимок</option>
              {snapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  v{snapshot.segmentVersionNumber}
                  {" · "}
                  {snapshot.totalCount ?? "0"} получателей
                  {" · "}
                  {snapshot.completedAt
                    ? formatCompactDate(snapshot.completedAt)
                    : "готов"}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-full">
            <span>Текст сообщения</span>
            <textarea
              value={text}
              rows={9}
              maxLength={4000}
              disabled={busy || editorLocked}
              onChange={(event) => setText(event.target.value)}
            />
            <small>{text.length} из 4000 символов</small>
          </label>
          <label className="check-field field-full">
            <input
              type="checkbox"
              checked={disableLinkPreview}
              disabled={busy || editorLocked}
              onChange={(event) => setDisableLinkPreview(event.target.checked)}
            />
            Отключить предпросмотр ссылок Telegram
          </label>
        </div>

        <div className="broadcast-buttons-heading">
          <div>
            <strong>Кнопки-ссылки</strong>
            <span>{buttons.length} из 8</span>
          </div>
          <button
            className="secondary-button compact-button"
            type="button"
            disabled={busy || editorLocked || buttons.length >= 8}
            onClick={() => {
              if (!editorLocked) {
                addButton();
              }
            }}
          >
            <Plus size={16} />
            Добавить
          </button>
        </div>
        <div className="broadcast-buttons">
          {buttons.map((button, index) => (
            <div className="broadcast-button-row" key={button.id}>
              <Link2 size={16} />
              <label className="field">
                <span>Текст кнопки {index + 1}</span>
                <input
                  value={button.label}
                  maxLength={64}
                  disabled={busy || editorLocked}
                  onChange={(event) => updateButton(button.id, {
                    label: event.target.value
                  })}
                />
              </label>
              <label className="field">
                <span>HTTPS-адрес</span>
                <input
                  value={button.url}
                  type="url"
                  maxLength={2048}
                  placeholder="https://"
                  disabled={busy || editorLocked}
                  onChange={(event) => updateButton(button.id, {
                    url: event.target.value
                  })}
                />
              </label>
              <button
                className="icon-button"
                type="button"
                title="Удалить кнопку"
                disabled={busy || editorLocked}
                onClick={() => setButtons((current) =>
                  current.filter((item) => item.id !== button.id)
                )}
              >
                <Trash2 size={16} />
                <span className="sr-only">Удалить кнопку</span>
              </button>
            </div>
          ))}
          {buttons.length === 0 ? (
            <p className="section-empty">Кнопки не добавлены.</p>
          ) : null}
        </div>

        <div className="broadcast-summary">
          <UsersRound size={17} />
          <span>
            {selectedSnapshot
              ? `Зафиксировано получателей: ${selectedSnapshot.totalCount ?? "0"}`
              : "Выберите готовый снимок аудитории"}
          </span>
        </div>
        <div className="segment-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy || editorLocked}
            onClick={() => {
              if (!editorLocked) {
                void saveDraft();
              }
            }}
          >
            <Save size={17} />
            Сохранить черновик
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={busy || !selectedBroadcast?.draft}
            onClick={() => void publishDraft()}
          >
            <Rocket size={17} />
            Опубликовать версию
          </button>
        </div>
        {selectedBroadcast?.published ? (
          <div className="segment-version-note">
            <FolderOpen size={16} />
            Опубликована неизменяемая версия v
            {selectedBroadcast.published.versionNumber}
          </div>
        ) : null}

        <div className="broadcast-schedule">
          <div className="broadcast-buttons-heading">
            <div>
              <CalendarClock size={17} />
              <strong>Расписание подготовки</strong>
            </div>
            {selectedBroadcast ? (
              <span className="status-pill">
                {lifecycleLabel(selectedBroadcast.lifecycleStatus)}
              </span>
            ) : null}
          </div>
          <div className="broadcast-form-grid">
            <label className="field">
              <span>Дата и время ({scheduleTimezone})</span>
              <input
                type="datetime-local"
                value={scheduledLocal}
                disabled={busy || editorLocked}
                onChange={(event) => setScheduledLocal(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Лимит сообщений в секунду</span>
              <input
                type="number"
                min={1}
                max={25}
                value={ratePerSecond}
                disabled={busy || editorLocked}
                onChange={(event) => setRatePerSecond(
                  Math.max(1, Math.min(25, Number(event.target.value)))
                )}
              />
            </label>
          </div>
          {selectedBroadcast?.schedule ? (
            <div className="broadcast-schedule-facts">
              <span>
                Запланировано: {formatEventDateTime(
                  selectedBroadcast.schedule.scheduledAt,
                  selectedBroadcast.schedule.timezone
                )}
              </span>
              <span>
                Всего: {selectedBroadcast.schedule.plannedRecipientCount ?? "—"}
              </span>
              <span>
                Доступно: {selectedBroadcast.schedule.reachableRecipientCount ?? "—"}
              </span>
              <span>
                Пропущено: {selectedBroadcast.schedule.skippedRecipientCount ?? "—"}
              </span>
              <span>
                Обработано: {selectedBroadcast.schedule.attemptedRecipientCount}
              </span>
              <span>
                Отправлено: {selectedBroadcast.schedule.sentRecipientCount}
              </span>
              <span>
                Ошибки: {selectedBroadcast.schedule.failedRecipientCount}
              </span>
            </div>
          ) : null}
          <div className="segment-actions">
            <span className="section-empty">
              Планирование фиксирует версию и запускает фоновую подготовку получателей.
            </span>
            <button
              className="primary-button"
              type="button"
              disabled={
                busy
                || editorLocked
                || !selectedBroadcast?.published
                || Boolean(selectedBroadcast?.draft)
              }
              onClick={() => void scheduleBroadcast()}
            >
              <CalendarClock size={17} />
              Запланировать
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function defaultScheduleLocal(): string {
  return toLocalInput(new Date(Date.now() + 60 * 60_000));
}

function browserTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timezone === "UTC" ? "Etc/UTC" : timezone || "Europe/Moscow";
}

function toLocalInput(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function toZonedLocalInput(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}T${read("hour")}:${read("minute")}`;
}

function lifecycleLabel(status: AdminBroadcast["lifecycleStatus"]): string {
  switch (status) {
    case "draft":
      return "Черновик";
    case "scheduled":
      return "Запланирована";
    case "preparing":
      return "Подготовка";
    case "sending":
      return "Отправляется";
    case "paused":
      return "На паузе";
    case "completed":
      return "Завершена";
    case "cancelled":
      return "Отменена";
    case "failed":
      return "Ошибка";
  }
}

function message(caught: unknown): string {
  if (caught instanceof AdminApiError || caught instanceof Error) {
    return caught.message;
  }
  return "Не удалось выполнить операцию.";
}
