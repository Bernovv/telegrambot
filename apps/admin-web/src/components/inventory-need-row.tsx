"use client";

import { StatusPill } from "@/components/status-pill";
import { AdminApiError, updateEventInventoryNeed } from "@/lib/admin-api";
import type {
  EventInventoryNeed,
  InventoryNeedStatus,
  InventorySource
} from "@ticket-platform/contracts/admin-inventory";
import { CircleAlert, Package } from "lucide-react";
import { useState } from "react";

const STATUS_ORDER: readonly InventoryNeedStatus[] = [
  "needed",
  "ordered",
  "ready",
  "loaded",
  "returned"
];

/**
 * Строка погрузки. Статус двигается вперёд одной кнопкой: у машины некогда выбирать из
 * списка, нужно нажать «загружено» и идти дальше.
 */
export function InventoryNeedRow({
  eventId,
  need,
  canManage,
  onChanged
}: {
  readonly eventId: string;
  readonly need: EventInventoryNeed;
  readonly canManage: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const short = need.source === "stock"
    && need.quantityOwned !== null
    && Number(need.quantityOwned) < Number(need.quantityNeeded);
  const nextStatus = STATUS_ORDER[STATUS_ORDER.indexOf(need.status) + 1];

  async function move(status: InventoryNeedStatus) {
    setSaving(true);
    setError(null);
    try {
      await updateEventInventoryNeed(eventId, { needId: need.id, status });
      await onChanged();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось изменить состояние.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="expense-row">
      <div className="expense-row-head">
        <div className="expense-row-title">
          <div className="title-with-status">
            <strong>{need.title}</strong>
            <StatusPill tone={statusTone(need.status)}>
              {statusLabel(need.status)}
            </StatusPill>
            <StatusPill tone="neutral">{sourceLabel(need.source)}</StatusPill>
          </div>
          <span className="muted">
            нужно {need.quantityNeeded} {need.unit}
            {need.quantityOwned !== null
              ? ` · на складе ${need.quantityOwned} ${need.unit}`
              : ""}
          </span>
          {need.unfolds.length > 0 ? (
            <span className="channel-cell muted">
              <Package size={13} aria-hidden="true" />
              комплект тянет:{" "}
              {need.unfolds
                .map((component) =>
                  `${component.title} ${component.quantityPerParent} ${component.unit}`)
                .join(", ")}
            </span>
          ) : null}
          {short ? (
            <span className="channel-cell accommodation-short">
              <CircleAlert size={13} aria-hidden="true" />
              на складе меньше, чем нужно
            </span>
          ) : null}
          {need.note ? <span className="muted">{need.note}</span> : null}
        </div>

        {canManage ? (
          <div className="expense-row-actions">
            {nextStatus ? (
              <button
                className="secondary-button"
                type="button"
                disabled={saving}
                onClick={() => void move(nextStatus)}
              >
                {statusLabel(nextStatus)}
              </button>
            ) : null}
            {need.status !== "needed" ? (
              <button
                className="secondary-button"
                type="button"
                disabled={saving}
                onClick={() => void move("needed")}
              >
                Сбросить
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <div className="accommodation-warning"><span>{error}</span></div> : null}
    </article>
  );
}

function statusLabel(status: InventoryNeedStatus): string {
  switch (status) {
    case "ordered":
      return "Заказано";
    case "ready":
      return "Готово";
    case "loaded":
      return "Загружено";
    case "returned":
      return "Вернулось";
    default:
      return "Нужно";
  }
}

function statusTone(
  status: InventoryNeedStatus
): "positive" | "neutral" | "warning" {
  switch (status) {
    case "loaded":
    case "returned":
      return "positive";
    case "ordered":
    case "ready":
      return "warning";
    default:
      return "neutral";
  }
}

function sourceLabel(source: InventorySource): string {
  switch (source) {
    case "buy":
      return "Купить";
    case "rent":
      return "Аренда";
    default:
      return "Со склада";
  }
}
