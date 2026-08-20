/**
 * Форма регистрации на сайте.
 *
 * Полей два — имя и телефон — и это решение, а не заготовка: вход на встречу бесплатный, а
 * каждое лишнее поле такой формы стоит части регистраций. Согласие отдельным флагом: без него
 * собранная база бесполезна, потому что оферты у бесплатного входа нет.
 */
export interface SiteRegistrationRequest {
  readonly name: string;
  readonly phone: string;
  readonly consent: boolean;
  /** Страница, с которой пришла заявка. Нужна, когда форм станет больше одной. */
  readonly page?: string;
}

export type SiteRegistrationStatus =
  /** Человека завели участником ближайшей встречи. */
  | "registered"
  /** Этот телефон в списке встречи уже был — второй раз не заводим. */
  | "already_registered";

export interface SiteRegistrationResponse {
  readonly status: SiteRegistrationStatus;
  /** Название встречи, если её удалось определить. Показывается в окне успеха. */
  readonly eventTitle: string | null;
  readonly startsAt: string | null;
}

export type SiteRegistrationErrorCode =
  | "invalid_name"
  | "invalid_phone"
  | "consent_required";
