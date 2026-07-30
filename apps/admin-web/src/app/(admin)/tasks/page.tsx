"use client";

import { EmptyState, PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  completeOutreachTask,
  listOutreachTaskBoard
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import type {
  OutreachTaskBoardItem,
  OutreachTaskUrgency
} from "@ticket-platform/contracts/admin-outreach";
import {
  Check,
  MessageCircle,
  Phone,
  RefreshCw,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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
  const [onlyMine, setOnlyMine] = useState(true);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      {loading && tasks.length === 0 ? <PageLoading /> : null}
      {error ? <PageError message={error} retry={() => void load()} /> : null}
      {!loading && !error && tasks.length === 0 ? (
        <EmptyState
          title="Задач нет"
          description="Как только менеджеры назначат себе задачи по контактам, они появятся здесь."
        />
      ) : null}

      {!error && tasks.length > 0 ? (
        <div className={loading ? "outreach-board table-refreshing" : "outreach-board"}>
          {columns.map((column) => (
            <div className={`outreach-column outreach-task-column-${column.key}`} key={column.key}>
              <header>
                <span>{column.label}</span>
                <strong>{column.items.length}</strong>
              </header>
              <div className="outreach-column-cards">
                {column.items.map((task) => (
                  <article className="outreach-lead-card outreach-task-card" key={task.id}>
                    <Link
                      className="outreach-card-main"
                      href={`/outreach/${task.campaignId}`}
                    >
                      <span className="outreach-card-title">
                        {task.type === "call" ? <Phone size={15} aria-hidden="true" /> : null}
                        {task.type === "message" ? <MessageCircle size={15} aria-hidden="true" /> : null}
                        {task.type === "other" ? <Sparkles size={15} aria-hidden="true" /> : null}
                        <strong>{task.contactName ?? "Без имени"}</strong>
                      </span>
                      <span>{task.contactPhone ?? task.campaignName}</span>
                    </Link>
                    <div className="outreach-card-facts">
                      <span>{task.text}</span>
                    </div>
                    <div className="outreach-card-facts">
                      <span>{task.assignedAdminName}</span>
                      <span>{formatDateTime(task.dueAt)}</span>
                    </div>
                    {task.status === "open" ? (
                      <div className="outreach-card-actions">
                        <button
                          type="button"
                          aria-label="Отметить выполненной"
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
                  <div className="outreach-column-empty">Пусто</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
