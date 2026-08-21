"use client";

import { OutreachNewTaskDialog } from "@/components/outreach-new-task-dialog";
import {
  OutreachTaskRescheduleDialog,
  suggestDueAt,
  type ReschedulableTask
} from "@/components/outreach-task-reschedule-dialog";
import {
  OutreachTouchDialog,
  type OutreachTouchTarget
} from "@/components/outreach-touch-dialog";
import { EmptyState, PageError, PageLoading } from "@/components/page-state";
import { OwnBadge } from "@/components/own-badge";
import {
  AdminApiError,
  completeOutreachTask,
  listOutreachManagers,
  listOutreachTaskBoard
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import type {
  OutreachManager,
  OutreachTaskBoardItem,
  OutreachTaskUrgency
} from "@ticket-platform/contracts/admin-outreach";
import {
  CalendarClock,
  Check,
  GripVertical,
  MessageCircle,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import { type DragEvent, useCallback, useEffect, useState } from "react";

/**
 * Цель касания для задачи. Пусто у задачи про человека вообще: касание записывается по
 * строке участия в кампании, а её здесь нет — связаться можно из карточки клиента, выбрав
 * кампанию явно.
 */
function touchTargetFor(task: OutreachTaskBoardItem): {
  readonly campaignId: string;
  readonly target: OutreachTouchTarget;
} | null {
  if (task.campaignId === null || task.campaignContactId === null) {
    return null;
  }
  return {
    campaignId: task.campaignId,
    target: {
      campaignContactId: task.campaignContactId,
      displayName: task.contactName,
      phone: task.contactPhone,
      telegramUsername: task.contactTelegramUsername,
      maxIdentifier: task.contactMaxIdentifier,
      isOwn: task.contactIsOwn
    }
  };
}

const URGENCY_COLUMNS: readonly {
  readonly key: OutreachTaskUrgency;
  readonly label: string;
}[] = [
  { key: "overdue", label: "Просрочено" },
  { key: "today", label: "Сегодня" },
  { key: "tomorrow", label: "Завтра" },
  { key: "this_week", label: "На неделе" },
  { key: "later", label: "Позже" },
  { key: "completed", label: "Выполнено" }
];

export default function OutreachTasksPage() {
  const [tasks, setTasks] = useState<readonly OutreachTaskBoardItem[]>([]);
  const [managers, setManagers] = useState<readonly OutreachManager[]>([]);
  const [onlyMine, setOnlyMine] = useState(true);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Касание записывается по строке участия в кампании — у задачи про человека вообще её
  // нет, и связаться с доски по такой задаче не выйдет. Поэтому храним не саму задачу, а
  // уже разобранную цель: так у диалога нет пустых полей, которые он не знает чем закрыть.
  const [touch, setTouch] = useState<{
    readonly campaignId: string;
    readonly target: OutreachTouchTarget;
  } | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // Что переносим и куда предлагаем перенести. Колонка задаёт день, время дня остаётся
  // прежним — и то и другое менеджер ещё увидит и сможет поправить.
  const [reschedule, setReschedule] = useState<{
    readonly task: ReschedulableTask;
    readonly suggestedDueAt: Date;
  } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await listOutreachTaskBoard(onlyMine, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить задачи.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [onlyMine]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Список менеджеров нужен только формам постановки задачи — грузим молча: без него
  // доска работает, просто ответственного нельзя будет сменить вручную.
  useEffect(() => {
    const controller = new AbortController();
    void listOutreachManagers(controller.signal)
      .then(setManagers)
      .catch(() => setManagers([]));
    return () => controller.abort();
  }, []);

  async function complete(taskId: string) {
    setMutating(true);
    setError(null);
    try {
      await completeOutreachTask(taskId);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось отметить задачу выполненной.");
    } finally {
      setMutating(false);
    }
  }

  /**
   * Колонки доски — это сроки, а не состояния: перетащить карточку значит назначить новый
   * срок. Поэтому бросок открывает диалог с подставленной датой, а не переносит молча:
   * «на неделе» — это не конкретный день, и угадывать за менеджера тут нечего.
   */
  function dropOnColumn(event: DragEvent<HTMLDivElement>, urgency: OutreachTaskUrgency) {
    event.preventDefault();
    const dropped = tasks.find((item) => item.id === draggedId);
    setDraggedId(null);
    if (!dropped || dropped.status !== "open" || dropped.urgency === urgency) {
      return;
    }
    if (urgency === "completed") {
      void complete(dropped.id);
      return;
    }
    if (urgency === "overdue") {
      return;
    }
    setReschedule({
      task: {
        id: dropped.id,
        type: dropped.type,
        text: dropped.text,
        dueAt: dropped.dueAt,
        assignedAdminId: dropped.assignedAdminId,
        campaignContactId: dropped.campaignContactId,
        contactId: dropped.contactId,
        contactName: dropped.contactName
      },
      suggestedDueAt: suggestDueAt(urgency, new Date(dropped.dueAt))
    });
  }

  // В «Просрочено» ничего не назначают нарочно, а из своей колонки карточка никуда не
  // едет. Не разрешаем бросок — курсор скажет об этом раньше, чем менеджер отпустит кнопку.
  function droppable(urgency: OutreachTaskUrgency): boolean {
    const dragged = tasks.find((item) => item.id === draggedId);
    return dragged !== undefined
      && dragged.status === "open"
      && urgency !== "overdue"
      && dragged.urgency !== urgency;
  }

  const columns = URGENCY_COLUMNS.map((column) => ({
    ...column,
    items: tasks.filter((task) => task.urgency === column.key)
  }));

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Продажи</p>
          <h1>Задачи</h1>
          <p>Все звонки и сообщения менеджеров по всем кампаниям в одном месте.</p>
        </div>
        <div className="heading-actions">
          <label className="outreach-mine-toggle">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(event) => setOnlyMine(event.target.checked)}
            />
            <span>Только мои</span>
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={() => setNewTaskOpen(true)}
          >
            <Plus size={16} />
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
        </div>
      </div>

      {notice ? <div className="page-notice">{notice}</div> : null}

      {loading && tasks.length === 0 ? <PageLoading /> : null}
      {error ? <PageError message={error} retry={() => void load()} /> : null}
      {!loading && !error && tasks.length === 0 ? (
        <EmptyState
          title="Задач нет"
          description="Поставьте первую сами или свяжитесь с контактом в кампании — следующий шаг появится здесь."
        />
      ) : null}

      {!error && tasks.length > 0 ? (
        <div className={loading ? "outreach-board table-refreshing" : "outreach-board"}>
          {columns.map((column) => (
            <div
              className={[
                "outreach-column",
                `outreach-task-column-${column.key}`,
                droppable(column.key) ? "outreach-column-droppable" : ""
              ].filter(Boolean).join(" ")}
              key={column.key}
              onDragOver={(event) => {
                if (droppable(column.key)) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => dropOnColumn(event, column.key)}
            >
              <header>
                <span>{column.label}</span>
                <strong>{column.items.length}</strong>
              </header>
              <div className="outreach-column-cards">
                {column.items.map((task) => (
                  <article
                    className="outreach-lead-card outreach-task-card"
                    key={task.id}
                    draggable={task.status === "open" && !mutating}
                    onDragStart={() => setDraggedId(task.id)}
                    onDragEnd={() => setDraggedId(null)}
                  >
                    {/* Имя всюду ведёт в карточку клиента. Работа по кампании — отдельной
                        ссылкой ниже: там своя воронка, а здесь нужен человек. */}
                    <Link
                      className="outreach-card-main"
                      href={`/base/${task.contactId}`}
                      // Ссылку браузер тащит сам, и перетаскивание карточки началось бы с
                      // перетаскивания адреса.
                      draggable={false}
                    >
                      <span className="outreach-card-title">
                        {task.status === "open" ? (
                          <GripVertical size={15} aria-hidden="true" />
                        ) : null}
                        {task.type === "call" ? <Phone size={15} aria-hidden="true" /> : null}
                        {task.type === "message" ? <MessageCircle size={15} aria-hidden="true" /> : null}
                        {task.type === "other" ? <Sparkles size={15} aria-hidden="true" /> : null}
                        <strong>{task.contactName ?? "Без имени"}</strong>
                      </span>
                      <span>
                        {task.contactPhone ?? task.campaignName ?? "Контакт не указан"}
                      </span>
                    </Link>
                    {task.contactIsOwn ? <OwnBadge compact /> : null}
                    <div className="outreach-card-facts">
                      <span>{task.text}</span>
                    </div>
                    <div className="outreach-card-facts">
                      <span>{task.assignedAdminName}</span>
                      <span>{formatDateTime(task.dueAt)}</span>
                    </div>
                    <div className="outreach-card-facts">
                      {task.campaignId ? (
                        <Link
                          href={`/outreach/${task.campaignId}?contact=${task.campaignContactId}`}
                        >
                          {task.campaignName}
                        </Link>
                      ) : (
                        <span>Без кампании</span>
                      )}
                    </div>
                    {task.status === "open" ? (
                      <div className="outreach-card-actions">
                        {touchTargetFor(task) ? (
                          <button
                            type="button"
                            aria-label="Связаться"
                            title="Связаться"
                            disabled={mutating}
                            onClick={() => setTouch(touchTargetFor(task))}
                          >
                            <PhoneCall size={15} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label="Перенести срок"
                          title="Перенести срок"
                          disabled={mutating}
                          onClick={() => setReschedule({
                            task: {
                              id: task.id,
                              type: task.type,
                              text: task.text,
                              dueAt: task.dueAt,
                              assignedAdminId: task.assignedAdminId,
                              campaignContactId: task.campaignContactId,
                              contactId: task.contactId,
                              contactName: task.contactName
                            },
                            suggestedDueAt: suggestDueAt("tomorrow", new Date(task.dueAt))
                          })}
                        >
                          <CalendarClock size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label="Отметить выполненной"
                          title="Отметить выполненной"
                          disabled={mutating}
                          onClick={() => void complete(task.id)}
                        >
                          <Check size={15} />
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
                {column.items.length === 0 ? (
                  <div className="outreach-column-empty">
                    {draggedId && droppable(column.key)
                      ? (column.key === "completed"
                        ? "Отпустите — задача закроется"
                        : "Отпустите — назначим новый срок")
                      : "Пусто"}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {touch ? (
        <OutreachTouchDialog
          campaignId={touch.campaignId}
          targets={[touch.target]}
          columns={null}
          onClose={() => setTouch(null)}
          onRecorded={async () => {
            setNotice("Касание записано, задача закрыта.");
            setTouch(null);
            await load();
          }}
        />
      ) : null}

      {reschedule ? (
        <OutreachTaskRescheduleDialog
          task={reschedule.task}
          suggestedDueAt={reschedule.suggestedDueAt}
          onClose={() => setReschedule(null)}
          onDone={async (message) => {
            setNotice(message);
            setReschedule(null);
            await load();
          }}
        />
      ) : null}

      {newTaskOpen ? (
        <OutreachNewTaskDialog
          person={null}
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
