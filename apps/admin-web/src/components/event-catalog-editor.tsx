"use client";

import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  createEventPricingRule,
  createEventProduct,
  updateEventPricingRule,
  updateEventProduct
} from "@/lib/admin-api";
import {
  formatEventDateTime,
  formatKopecks,
  kopecksToRublesInput,
  productTypeLabel,
  rublesInputToKopecks
} from "@/lib/format";
import {
  ADMIN_PRODUCT_TYPES,
  type AdminEventDetail,
  type AdminEventPricingRule,
  type AdminEventPricingRuleInput,
  type AdminEventProduct,
  type AdminEventProductInput,
  type AdminProductType
} from "@ticket-platform/contracts/admin-events";
import { Pencil, Plus, Save, X } from "lucide-react";
import { type FormEvent, useState } from "react";

type CatalogEditor =
  | { readonly kind: "product"; readonly product: AdminEventProduct | null }
  | {
      readonly kind: "pricing";
      readonly product: AdminEventProduct;
      readonly rule: AdminEventPricingRule | null;
    };

export function EventCatalogEditor({
  event,
  reload
}: {
  readonly event: AdminEventDetail;
  readonly reload: () => Promise<void>;
}) {
  const [editor, setEditor] = useState<CatalogEditor | null>(null);

  async function saved() {
    await reload();
    setEditor(null);
  }

  return (
    <>
      {editor?.kind === "product" ? (
        <ProductForm
          event={event}
          product={editor.product}
          cancel={() => setEditor(null)}
          saved={saved}
        />
      ) : null}
      {editor?.kind === "pricing" ? (
        <PricingRuleForm
          event={event}
          product={editor.product}
          rule={editor.rule}
          cancel={() => setEditor(null)}
          saved={saved}
        />
      ) : null}

      <section className="detail-section catalog-editor-section">
        <div className="section-title-row">
          <div>
            <h2>Продукты</h2>
            <span>{event.products.length} в черновике</span>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditor({ kind: "product", product: null })}
          >
            <Plus size={16} />
            Добавить продукт
          </button>
        </div>

        {event.products.length === 0 ? (
          <p className="section-empty">Продукты пока не добавлены.</p>
        ) : (
          <div className="catalog-product-list">
            {event.products.map((product) => (
              <article className="catalog-product" key={product.id}>
                <div className="catalog-product-heading">
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
                  <button
                    className="icon-button bordered"
                    type="button"
                    title="Редактировать продукт"
                    aria-label={`Редактировать продукт ${product.title}`}
                    onClick={() => setEditor({ kind: "product", product })}
                  >
                    <Pencil size={16} />
                  </button>
                </div>

                <dl className="catalog-facts">
                  <div><dt>Валюта</dt><dd>{product.currency}</dd></div>
                  <div><dt>Емкость</dt><dd>{product.capacity ?? "Общая"}</dd></div>
                  <div><dt>Единиц места</dt><dd>{product.inventoryUnitsPerItem}</dd></div>
                  <div><dt>Лимит заказа</dt><dd>{product.maximumQuantityPerOrder}</dd></div>
                </dl>

                <div className="catalog-pricing-heading">
                  <strong>Тарифы</strong>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() =>
                      setEditor({ kind: "pricing", product, rule: null })
                    }
                  >
                    <Plus size={15} />
                    Добавить
                  </button>
                </div>

                {product.pricingRules.length === 0 ? (
                  <p className="product-empty">Тарифы не добавлены.</p>
                ) : (
                  <div className="price-table-wrap">
                    <table className="price-table">
                      <thead>
                        <tr>
                          <th>Цена</th>
                          <th>Количество</th>
                          <th>Период</th>
                          <th>Приоритет</th>
                          <th>Статус</th>
                          <th><span className="sr-only">Изменить</span></th>
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
                            <td>
                              <StatusPill tone={rule.isActive ? "positive" : "neutral"}>
                                {rule.isActive ? "Активен" : "Отключен"}
                              </StatusPill>
                            </td>
                            <td>
                              <button
                                className="row-link"
                                type="button"
                                title="Редактировать тариф"
                                aria-label={`Редактировать тариф ${rule.explanation}`}
                                onClick={() =>
                                  setEditor({ kind: "pricing", product, rule })
                                }
                              >
                                <Pencil size={16} />
                              </button>
                            </td>
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
    </>
  );
}

function ProductForm({
  event,
  product,
  cancel,
  saved
}: {
  readonly event: AdminEventDetail;
  readonly product: AdminEventProduct | null;
  readonly cancel: () => void;
  readonly saved: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = new FormData(formEvent.currentTarget);
      const input = readProduct(data);
      const reason = requiredValue(data, "reason");
      if (product) {
        await updateEventProduct(event.id, product.id, {
          expectedLockVersion: event.lockVersion,
          reason,
          product: input
        });
      } else {
        await createEventProduct(event.id, {
          expectedLockVersion: event.lockVersion,
          reason,
          product: input
        });
      }
      await saved();
    } catch (caught) {
      setError(catalogMutationMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <form className="event-form-section catalog-form" onSubmit={(formEvent) => void submit(formEvent)}>
      <FormHeading
        title={product ? "Редактирование продукта" : "Новый продукт"}
        subtitle={`Версия события ${event.lockVersion}`}
        cancel={cancel}
      />
      <div className="event-form-grid">
        <label className="field">
          <span>Название</span>
          <input name="title" required maxLength={250} defaultValue={product?.title ?? ""} />
        </label>
        <label className="field">
          <span>Код</span>
          <input
            name="code"
            required
            pattern="[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*"
            defaultValue={product?.code ?? ""}
          />
        </label>
        <label className="field">
          <span>Тип</span>
          <select name="productType" defaultValue={product?.productType ?? "adult_standard"}>
            {ADMIN_PRODUCT_TYPES.map((type) => (
              <option key={type} value={type}>{productTypeLabel(type)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Валюта</span>
          <input name="currency" required pattern="[A-Za-z]{3}" defaultValue={product?.currency ?? "RUB"} />
        </label>
        <label className="field field-full">
          <span>Описание</span>
          <textarea name="description" rows={3} maxLength={5_000} defaultValue={product?.description ?? ""} />
        </label>
        <label className="field">
          <span>Единиц места на билет</span>
          <input name="inventoryUnitsPerItem" type="number" min={1} required defaultValue={product?.inventoryUnitsPerItem ?? 1} />
        </label>
        <label className="field">
          <span>Емкость продукта</span>
          <input name="capacity" type="number" min={1} placeholder="Общая емкость" defaultValue={product?.capacity ?? ""} />
        </label>
        <label className="field">
          <span>Максимум в заказе</span>
          <input name="maximumQuantityPerOrder" type="number" min={1} required defaultValue={product?.maximumQuantityPerOrder ?? 10} />
        </label>
        <label className="field">
          <span>Порядок</span>
          <input name="sortOrder" type="number" min={0} required defaultValue={product?.sortOrder ?? event.products.length} />
        </label>
        <label className="field field-full">
          <span>Состав комплекта, JSON</span>
          <textarea
            name="bundleComposition"
            rows={3}
            defaultValue={JSON.stringify(product?.bundleComposition ?? [], null, 2)}
          />
        </label>
        <label className="check-field">
          <input name="isActive" type="checkbox" defaultChecked={product?.isActive ?? true} />
          <span>Продукт активен</span>
        </label>
        <label className="field field-full">
          <span>Причина</span>
          <textarea name="reason" required minLength={3} maxLength={500} rows={2} />
        </label>
      </div>
      <FormActions submitting={submitting} cancel={cancel} error={error} />
    </form>
  );
}

function PricingRuleForm({
  event,
  product,
  rule,
  cancel,
  saved
}: {
  readonly event: AdminEventDetail;
  readonly product: AdminEventProduct;
  readonly rule: AdminEventPricingRule | null;
  readonly cancel: () => void;
  readonly saved: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = new FormData(formEvent.currentTarget);
      const input = readPricingRule(data, product.currency);
      const reason = requiredValue(data, "reason");
      if (rule) {
        await updateEventPricingRule(event.id, product.id, rule.id, {
          expectedLockVersion: event.lockVersion,
          reason,
          pricingRule: input
        });
      } else {
        await createEventPricingRule(event.id, product.id, {
          expectedLockVersion: event.lockVersion,
          reason,
          pricingRule: input
        });
      }
      await saved();
    } catch (caught) {
      setError(catalogMutationMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <form className="event-form-section catalog-form" onSubmit={(formEvent) => void submit(formEvent)}>
      <FormHeading
        title={rule ? "Редактирование тарифа" : "Новый тариф"}
        subtitle={product.title}
        cancel={cancel}
      />
      <div className="event-form-grid">
        <label className="field">
          <span>Цена, ₽</span>
          <input
            name="priceRubles"
            required
            inputMode="decimal"
            pattern="\\d+(?:[,.]\\d{1,2})?"
            defaultValue={rule ? kopecksToRublesInput(rule.unitPriceKopecks) : ""}
          />
        </label>
        <label className="field">
          <span>Валюта</span>
          <input value={product.currency} readOnly aria-readonly="true" />
        </label>
        <label className="field">
          <span>Минимальное количество</span>
          <input name="minimumQuantity" type="number" min={1} required defaultValue={rule?.minimumQuantity ?? 1} />
        </label>
        <label className="field">
          <span>Максимальное количество</span>
          <input name="maximumQuantity" type="number" min={1} placeholder="Без верхней границы" defaultValue={rule?.maximumQuantity ?? ""} />
        </label>
        <label className="field">
          <span>Приоритет</span>
          <input name="priority" type="number" required defaultValue={rule?.priority ?? 0} />
        </label>
        <label className="field">
          <span>Начало действия</span>
          <input name="validFrom" placeholder="2026-08-01T00:00:00+03:00" defaultValue={rule?.validFrom ?? ""} />
        </label>
        <label className="field">
          <span>Окончание действия</span>
          <input name="validUntil" placeholder="2026-08-20T00:00:00+03:00" defaultValue={rule?.validUntil ?? ""} />
        </label>
        <label className="field field-full">
          <span>Объяснение тарифа</span>
          <input name="explanation" required maxLength={500} defaultValue={rule?.explanation ?? ""} />
        </label>
        <label className="check-field">
          <input name="isActive" type="checkbox" defaultChecked={rule?.isActive ?? true} />
          <span>Тариф активен</span>
        </label>
        <label className="field field-full">
          <span>Причина</span>
          <textarea name="reason" required minLength={3} maxLength={500} rows={2} />
        </label>
      </div>
      <FormActions submitting={submitting} cancel={cancel} error={error} />
    </form>
  );
}

function FormHeading({
  title,
  subtitle,
  cancel
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly cancel: () => void;
}) {
  return (
    <div className="section-title-row">
      <div><h2>{title}</h2><span>{subtitle}</span></div>
      <button className="icon-button" type="button" title="Закрыть" aria-label="Закрыть" onClick={cancel}>
        <X size={18} />
      </button>
    </div>
  );
}

function FormActions({
  submitting,
  cancel,
  error
}: {
  readonly submitting: boolean;
  readonly cancel: () => void;
  readonly error: string | null;
}) {
  return (
    <>
      {error ? <p className="form-error catalog-form-error">{error}</p> : null}
      <div className="catalog-form-actions">
        <button className="secondary-button" type="button" disabled={submitting} onClick={cancel}>Отмена</button>
        <button className="primary-button" type="submit" disabled={submitting}>
          <Save size={16} />
          {submitting ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </>
  );
}

function readProduct(data: FormData): AdminEventProductInput {
  return {
    code: requiredValue(data, "code"),
    productType: requiredValue(data, "productType") as AdminProductType,
    title: requiredValue(data, "title"),
    description: stringValue(data, "description"),
    currency: requiredValue(data, "currency"),
    bundleComposition: parseBundleComposition(
      requiredValue(data, "bundleComposition")
    ),
    inventoryUnitsPerItem: integerValue(data, "inventoryUnitsPerItem"),
    capacity: nullableIntegerValue(data, "capacity"),
    maximumQuantityPerOrder: integerValue(data, "maximumQuantityPerOrder"),
    isActive: data.get("isActive") === "on",
    sortOrder: integerValue(data, "sortOrder")
  };
}

function readPricingRule(
  data: FormData,
  currency: string
): AdminEventPricingRuleInput {
  return {
    currency,
    minimumQuantity: integerValue(data, "minimumQuantity"),
    maximumQuantity: nullableIntegerValue(data, "maximumQuantity"),
    unitPriceKopecks: rublesInputToKopecks(requiredValue(data, "priceRubles")),
    priority: integerValue(data, "priority"),
    validFrom: nullableValue(data, "validFrom"),
    validUntil: nullableValue(data, "validUntil"),
    explanation: requiredValue(data, "explanation"),
    isActive: data.get("isActive") === "on"
  };
}

function parseBundleComposition(
  value: string
): readonly Readonly<Record<string, unknown>>[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed)
    || parsed.some(
      (item) => typeof item !== "object" || item === null || Array.isArray(item)
    )
  ) {
    throw new Error("bundle");
  }
  return parsed as readonly Readonly<Record<string, unknown>>[];
}

function stringValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function requiredValue(data: FormData, name: string): string {
  const value = stringValue(data, name);
  if (!value) {
    throw new Error("required");
  }
  return value;
}

function nullableValue(data: FormData, name: string): string | null {
  return stringValue(data, name) || null;
}

function integerValue(data: FormData, name: string): number {
  const parsed = Number(requiredValue(data, name));
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("integer");
  }
  return parsed;
}

function nullableIntegerValue(data: FormData, name: string): number | null {
  const value = stringValue(data, name);
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("integer");
  }
  return parsed;
}

function catalogMutationMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "ADMIN_EVENT_VERSION_CONFLICT") {
      return "Каталог уже изменен другим администратором. Обновите страницу.";
    }
    if (error.code === "ADMIN_EVENT_PRODUCT_CODE_CONFLICT") {
      return "Код продукта уже используется в этом мероприятии.";
    }
    if (error.status === 403) {
      return "У учетной записи нет разрешения events.write.";
    }
    return error.message;
  }
  return "Проверьте поля, формат дат, цену и JSON состава.";
}
