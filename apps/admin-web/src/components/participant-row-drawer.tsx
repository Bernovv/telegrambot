"use client";

import { AnswerFields } from "@/components/answer-fields";
import { formatDateTime, formatKopecks } from "@/lib/format";
import type { EventParticipantFieldDefinition } from "@ticket-platform/contracts/admin-accommodation";
import type {
  EventParticipantRow,
  ParticipantChannel
} from "@ticket-platform/contracts/admin-participants";
import { ExternalLink, X } from "lucide-react";
import Link from "next/link";

const CHANNEL_LABELS: Record<ParticipantChannel, string> = {
  telegram: "Telegram",
  max: "MAX",
  site: "Сайт",
  timepad: "Timepad",
  direct: "Договорились напрямую",
  other: "Другое"
};

/**
 * Карточка участника из общего списка.
 *
 * Показывает и покупателя бота, и заведённого руками, но правит только ответы анкеты.
 * Всё остальное принадлежит своему источнику: состав и деньги заказа — заказу, карточка
 * ручного участника — экрану логистики. Дублировать здесь редактор значило бы завести
 * второе место, где те же цифры можно поменять по-разному.
 */
export function ParticipantRowDrawer({
  eventId,
  row,
  fields,
  canManage,
  onClose,
  onSaved
}: {
  readonly eventId: string;
  readonly row: EventParticipantRow;
  readonly fields: readonly EventParticipantFieldDefinition[];
  readonly canManage: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => Promise<void>;
}) {
  return (
    <div className="outreach-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="outreach-drawer outreach-lead-drawer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="section-title-row">
          <div>
            <h2>{row.displayName}</h2>
            <span>
              {CHANNEL_LABELS[row.channel]}
              {row.amountKopecks ? ` · ${formatKopecks(row.amountKopecks)}` : ""}
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

        <div className="outreach-drawer-actions">
          {row.orderId ? (
            <Link className="secondary-button" href={`/orders/${row.orderId}`}>
              Заказ {row.orderNumber}
              <ExternalLink size={15} />
            </Link>
          ) : (
            <Link
              className="secondary-button"
              href={`/events/${eventId}/accommodation`}
            >
              Править в логистике
              <ExternalLink size={15} />
            </Link>
          )}
        </div>

        <div className="definition-list">
          <div>
            <span>Телефон</span>
            <strong>{row.phone ?? "—"}</strong>
            {row.telegramUsername ? <small>@{row.telegramUsername}</small> : null}
          </div>
          <div>
            <span>Тариф</span>
            <strong>{row.ticketTitle || "—"}</strong>
          </div>
          <div>
            <span>Гостей</span>
            <strong>{row.adults + row.children}</strong>
            <small>
              {row.adults} взрослых, {row.children} детей
            </small>
          </div>
          <div>
            <span>Спальных мест</span>
            <strong>{row.sleepingPlaces > 0 ? row.sleepingPlaces : "—"}</strong>
          </div>
          <div>
            <span>Оплачено</span>
            <strong>{formatDateTime(row.paidAt)}</strong>
            {row.paymentMethod ? <small>{row.paymentMethod}</small> : null}
          </div>
          {row.note ? (
            <div>
              <span>Заметка</span>
              <strong>{row.note}</strong>
            </div>
          ) : null}
        </div>

        <div className="section-title-row">
          <div>
            <h2>Анкета</h2>
            <span>
              {fields.length === 0
                ? "вопросы не заданы"
                : canManage
                  ? "сохраняется по полю"
                  : "только просмотр"}
            </span>
          </div>
        </div>

        {fields.length === 0 ? (
          <p className="section-empty">
            Вопросы анкеты задаются на вкладке «Анкеты».
          </p>
        ) : (
          <AnswerFields
            eventId={eventId}
            row={row}
            fields={fields}
            readOnly={!canManage}
            onSaved={onSaved}
          />
        )}
      </aside>
    </div>
  );
}
