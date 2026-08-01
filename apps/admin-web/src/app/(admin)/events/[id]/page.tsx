"use client";

import { PageError, PageLoading } from "@/components/page-state";
import { EventPublicationPanel } from "@/components/event-publication-panel";
import { ParticipantsExportButton } from "@/components/participants-export-button";
import { StatusPill } from "@/components/status-pill";
import { AdminApiError, getEvent } from "@/lib/admin-api";
import {
  eventStatusLabel,
  eventStatusTone,
  formatEventDateTime,
  formatKopecks,
  productTypeLabel
} from "@/lib/format";
import type { AdminEventDetail } from "@ticket-platform/contracts/admin-events";
import {
  ArrowLeft,
  ExternalLink,
  FileCheck2,
  FileText,
  PackageOpen,
  Pencil,
  Tent,
  Workflow
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<AdminEventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setEvent(await getEvent(id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(
          caught instanceof AdminApiError
            ? caught.message
            : "Сервис временно недоступен."
        );
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

  if (loading && !event) {
    return <PageLoading />;
  }
  if (error || !event) {
    return (
      <PageError
        message={error ?? "Мероприятие не найдено."}
        retry={() => void load()}
      />
    );
  }

  const occupied = event.reservedInventoryUnits + event.consumedInventoryUnits;
  const utilization = event.capacity > 0
    ? Math.min(100, Math.round((occupied / event.capacity) * 100))
    : 0;

  return (
    <>
      <Link className="back-link" href="/events">
        <ArrowLeft size={17} />
        Все мероприятия
      </Link>

      <div className="detail-heading order-heading">
        <div>
          <div className="title-with-status">
            <h1>{event.title}</h1>
            <StatusPill tone={eventStatusTone(event.status)}>
              {eventStatusLabel(event.status)}
            </StatusPill>
          </div>
          <p>
            {formatEventDateTime(event.startsAt, event.timezone)}
            {" · "}
            {event.locationName ?? "Площадка не указана"}
          </p>
        </div>
        {/* Выгрузка участников и «Что везём» нужны и после публикации: это отчёты
            по продажам. Редактирование остаётся у черновика. */}
        <div className="heading-actions">
          <ParticipantsExportButton
            eventId={event.id}
            eventSlug={event.slug}
          />
          <Link className="secondary-button" href={`/events/${event.id}/accommodation`}>
            <Tent size={16} />
            Что везём
          </Link>
          {event.status === "draft" ? (
            <>
              <Link className="secondary-button" href={`/events/${event.id}/scenario`}>
                <Workflow size={16} />
                Сценарий
              </Link>
              <Link className="secondary-button" href={`/events/${event.id}/offer`}>
                <FileCheck2 size={16} />
                Оферта
              </Link>
              <Link className="secondary-button" href={`/events/${event.id}/content`}>
                <FileText size={16} />
                Контент
              </Link>
              <Link className="secondary-button" href={`/events/${event.id}/catalog`}>
                <PackageOpen size={16} />
                Продукты и тарифы
              </Link>
              <Link className="primary-button" href={`/events/${event.id}/edit`}>
                <Pencil size={16} />
                Редактировать
              </Link>
            </>
          ) : (
            <span className="readonly-badge">Только просмотр</span>
          )}
        </div>
      </div>

      <section className="metrics-strip" aria-label="Показатели мероприятия">
        <div>
          <span>Заполнено мест</span>
          <strong>{occupied} / {event.capacity}</strong>
          <div
            className="capacity-track"
            role="progressbar"
            aria-label="Заполнение емкости"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={utilization}
          >
            <span style={{ width: `${utilization}%` }} />
          </div>
        </div>
        <div>
          <span>Билеты</span>
          <strong>{event.ticketCount}</strong>
        </div>
        <div>
          <span>Оплаченные заказы</span>
          <strong>{event.paidOrderCount} / {event.orderCount}</strong>
        </div>
        <div>
          <span>Активные продукты</span>
          <strong>{event.activeProductCount} / {event.productCount}</strong>
        </div>
      </section>

      <div className="detail-grid">
        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h2>Основное</h2>
              <span>Версия {event.lockVersion}</span>
            </div>
          </div>
          <div className="definition-list">
            <div><span>Slug</span><strong>{event.slug}</strong></div>
            <div>
              <span>Период</span>
              <strong>{formatEventDateTime(event.startsAt, event.timezone)}</strong>
              <small>{formatEventDateTime(event.endsAt, event.timezone)}</small>
            </div>
            <div>
              <span>Продажи</span>
              <strong>{formatEventDateTime(event.salesStartsAt, event.timezone)}</strong>
              <small>{formatEventDateTime(event.salesEndsAt, event.timezone)}</small>
            </div>
            <div>
              <span>Адрес</span>
              <strong>{event.locationAddress ?? "—"}</strong>
              <small>{event.locationName ?? "—"}</small>
            </div>
            <div><span>Поддержка</span><strong>{event.supportContact ?? "—"}</strong></div>
            <div><span>Резерв</span><strong>{event.reservationTtlMinutes} мин.</strong></div>
          </div>
        </section>

        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h2>Публикация</h2>
              <span>{event.publishedAt ? "Публичная версия" : "Не опубликовано"}</span>
            </div>
          </div>
          <div className="definition-list">
            <div>
              <span>Сценарий</span>
              <strong>{shortId(event.publishedScenarioVersionId)}</strong>
            </div>
            <div>
              <span>Оферта</span>
              <strong>{event.offerRequired ? "Обязательна" : "Не обязательна"}</strong>
              <small>{shortId(event.activeOfferVersionId)}</small>
            </div>
            <div>
              <span>Телефон</span>
              <strong>{event.phoneRequiredForPurchase ? "Обязателен" : "Не обязателен"}</strong>
            </div>
            <div>
              <span>Опубликовано</span>
              <strong>{formatEventDateTime(event.publishedAt, event.timezone)}</strong>
            </div>
          </div>
          {event.activeOffer ? (
            <a
              className="offer-link"
              href={event.activeOffer.publicUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <strong>{event.activeOffer.documentTitle}</strong>
                <small>Версия {event.activeOffer.versionNumber}</small>
              </span>
              <ExternalLink size={17} />
            </a>
          ) : null}
          {event.status === "draft" ? (
            <EventPublicationPanel
              event={event}
              onPublished={() => load()}
            />
          ) : null}
        </section>
      </div>

      <section className="detail-section">
        <div className="section-title-row">
          <div>
            <h2>Продукты и цены</h2>
            <span>{event.products.length} продуктов</span>
          </div>
        </div>
        {event.products.length === 0 ? (
          <p className="section-empty">Продукты пока не добавлены.</p>
        ) : (
          <div className="product-list">
            {event.products.map((product) => (
              <article className="product-row" key={product.id}>
                <div className="product-summary">
                  <div>
                    <div className="title-with-status">
                      <h3>{product.title}</h3>
                      <StatusPill tone={product.isActive ? "positive" : "neutral"}>
                        {product.isActive ? "Активен" : "Отключен"}
                      </StatusPill>
                    </div>
                    <span>
                      {productTypeLabel(product.productType)} · {product.code}
                    </span>
                  </div>
                  <dl>
                    <div><dt>Емкость</dt><dd>{product.capacity ?? "Общая"}</dd></div>
                    <div><dt>На единицу</dt><dd>{product.inventoryUnitsPerItem}</dd></div>
                    <div><dt>Лимит заказа</dt><dd>{product.maximumQuantityPerOrder}</dd></div>
                    <div>
                      <dt>Занято</dt>
                      <dd>{product.reservedInventoryUnits + product.consumedInventoryUnits}</dd>
                    </div>
                  </dl>
                </div>
                {product.pricingRules.length === 0 ? (
                  <p className="product-empty">Активные ценовые правила отсутствуют.</p>
                ) : (
                  <div className="price-table-wrap">
                    <table className="price-table">
                      <thead>
                        <tr>
                          <th>Цена</th>
                          <th>Количество</th>
                          <th>Период действия</th>
                          <th>Приоритет</th>
                        </tr>
                      </thead>
                      <tbody>
                        {product.pricingRules.map((rule) => (
                          <tr key={rule.id}>
                            <td className="money-cell">
                              {formatKopecks(rule.unitPriceKopecks)}
                            </td>
                            <td>
                              {rule.minimumQuantity}
                              {rule.maximumQuantity
                                ? `–${rule.maximumQuantity}`
                                : "+"}
                            </td>
                            <td>
                              {formatEventDateTime(rule.validFrom, event.timezone)}
                              {" — "}
                              {formatEventDateTime(rule.validUntil, event.timezone)}
                            </td>
                            <td>{rule.priority}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="detail-section">
        <div className="section-title-row">
          <div>
            <h2>Контент</h2>
            <span>{event.contentBlocks.length} блоков</span>
          </div>
        </div>
        {event.contentBlocks.length === 0 ? (
          <p className="section-empty">Контентные блоки не добавлены.</p>
        ) : (
          <div className="content-block-list">
            {event.contentBlocks.map((block) => (
              <div key={block.id}>
                <span>{block.sortOrder}</span>
                <div>
                  <strong>{block.title ?? block.blockType}</strong>
                  <small>
                    {block.blockType} · схема {block.contentSchemaVersion}
                    {!block.isVisible ? " · скрыт" : ""}
                  </small>
                </div>
                <code>{contentPreview(block.content)}</code>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function shortId(value: string | null): string {
  return value ? value.slice(0, 8) : "—";
}

function contentPreview(content: Readonly<Record<string, unknown>>): string {
  const preview = JSON.stringify(content);
  return preview.length > 140 ? `${preview.slice(0, 137)}...` : preview;
}
