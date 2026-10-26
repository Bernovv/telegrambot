import type { AdminEventDetail } from "@ticket-platform/contracts/admin-events";

export interface PublicationRequirement {
  readonly label: string;
  readonly ready: boolean;
  readonly href: string;
}

/**
 * Что нужно мероприятию до публикации — тот же список, что проверяет сервер.
 *
 * У бесплатного мероприятия продавать нечего: ни каталога, ни цен, ни оферты, ни диалога
 * покупки в боте у него нет, и сервер требует только название и дату. Раньше панель этого
 * не знала и требовала продукты, цены, сценарий и контакт поддержки у городской встречи —
 * кнопка публикации стояла серой, хотя сервер опубликовал бы её сразу.
 */
export function eventPublicationRequirements(
  event: AdminEventDetail
): readonly PublicationRequirement[] {
  const titleAndDate: PublicationRequirement = {
    label: "Название и дата",
    ready: event.title.trim().length > 0 && Boolean(event.startsAt),
    href: `/events/${event.id}/edit`
  };

  if (event.isFree) {
    return [
      titleAndDate,
      {
        label: "Участие бесплатное: продукты, цены, сценарий и оферта не нужны",
        ready: true,
        href: `/events/${event.id}/edit`
      }
    ];
  }

  const activeProducts = event.products.filter((product) => product.isActive);
  return [
    titleAndDate,
    {
      label: "Контакт поддержки",
      ready: Boolean(event.supportContact?.trim()),
      href: `/events/${event.id}/edit`
    },
    {
      label: "Активный продукт",
      ready: activeProducts.length > 0,
      href: `/events/${event.id}/catalog`
    },
    {
      label: "Цена каждого активного продукта",
      ready: activeProducts.length > 0 && activeProducts.every(
        (product) => product.pricingRules.some(
          (rule) => rule.isActive && isPositiveKopeckAmount(rule.unitPriceKopecks)
        )
      ),
      href: `/events/${event.id}/catalog`
    },
    {
      label: "Опубликованный сценарий",
      ready: event.publishedScenarioVersionId !== null,
      href: `/events/${event.id}/scenario`
    },
    {
      label: event.offerRequired ? "Активная оферта" : "Оферта не обязательна",
      ready: !event.offerRequired || event.activeOfferVersionId !== null,
      href: `/events/${event.id}/offer`
    }
  ];
}

function isPositiveKopeckAmount(value: string): boolean {
  return /^\d{1,19}$/.test(value) && BigInt(value) > 0n;
}
