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

/**
 * Заявка с сайта в панели.
 *
 * В базе у заявки три состояния, и различать их важно: `registered` — человека завели
 * участником встречи, `duplicate` — этот телефон в списке уже был, `unassigned` — встречи,
 * к которой его отнести, не нашлось. Последние две сами собой никуда не денутся: человек
 * оставил телефон и ждёт звонка, а в списке участников его нет.
 */
export const ADMIN_SITE_REGISTRATION_STATES = [
  "registered",
  "duplicate",
  "unassigned"
] as const;

export type AdminSiteRegistrationState =
  typeof ADMIN_SITE_REGISTRATION_STATES[number];

export const ADMIN_SITE_REGISTRATION_FILTERS = [
  "all",
  /** Заявки, по которым никого не завели: их и надо разбирать руками. */
  "needs_attention"
] as const;

export type AdminSiteRegistrationFilter =
  typeof ADMIN_SITE_REGISTRATION_FILTERS[number];

export interface AdminSiteRegistration {
  readonly id: string;
  readonly displayName: string;
  readonly phone: string;
  readonly eventId: string | null;
  readonly eventTitle: string | null;
  readonly participantId: string | null;
  /** Человек в общей базе, найденный по тому же телефону. Отсюда карточка клиента. */
  readonly contactId: string | null;
  readonly page: string;
  readonly state: AdminSiteRegistrationState;
  readonly consentAt: string;
  readonly createdAt: string;
}

export interface AdminSiteRegistrationPage {
  readonly items: readonly AdminSiteRegistration[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  /** Сколько заявок ждёт разбора во всей базе, а не на этой странице. */
  readonly needsAttention: number;
}
