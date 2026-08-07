"use client";

import { EventPublicationPanel } from "@/components/event-publication-panel";
import { useEventWorkspace } from "@/components/event-workspace";
import { ParticipantsExportButton } from "@/components/participants-export-button";
import { StatusPill } from "@/components/status-pill";
import {
  formatEventDateTime,
  formatKopecks,
  productTypeLabel
} from "@/lib/format";
import { ExternalLink } from "lucide-react";

export default function EventOverviewPage() {
  const { event, reload } = useEventWorkspace();

  const occupied = event.reservedInventoryUnits + event.consumedInventoryUnits;
  const utilization = event.capacity > 0
    ? Math.min(100, Math.round((occupied / event.capacity) * 100))
    : 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Обзор</p>
          <h1>Как идут продажи</h1>
        </div>
        <div className="heading-actions">
          <ParticipantsExportButton
            eventId={event.id}
            eventSlug={event.slug}
          />
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
              onPublished={() => reload()}
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
