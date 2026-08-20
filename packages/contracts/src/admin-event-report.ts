/**
 * Отчёт по мероприятию: кто откуда пришёл и кто дошёл.
 *
 * Числа «записалось» и «дошло» здесь те же самые, что на вкладке «Участники»: отчёт
 * собирается из её же строк, а не считает список заново. Второе определение того, кто
 * считается участником, разошлось бы с первым на первой же особенности отбора — исключённом
 * заказе, удалённом участнике, — и два экрана начали бы показывать разные числа про одно
 * событие.
 *
 * Разрезов три, и они отвечают на разные вопросы. `byEntry` — как человек попал в список:
 * это про работу, которую мы делали. `byChannel` — откуда он у нас вообще: это про то, что
 * приводит людей. `byOutreach` — звонили ли ему перед встречей: это про то, окупается ли
 * обзвон.
 */

export interface EventReportBucket {
  /**
   * Код разреза. Для `byChannel` это сам текст метки источника, как его вписали, — пустая
   * строка означает, что источник не указан.
   */
  readonly key: string;
  readonly registered: number;
  readonly attended: number;
}

export interface EventReport {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly calculatedAt: string;
  readonly registered: number;
  readonly attended: number;
  /** Заявки с формы на сайте, отнесённые к этой встрече. */
  readonly siteRequests: number;
  /** Из них повторных: телефон в списке уже был, второй раз человека не заводили. */
  readonly siteRequestDuplicates: number;
  readonly byEntry: readonly EventReportBucket[];
  readonly byChannel: readonly EventReportBucket[];
  readonly byOutreach: readonly EventReportBucket[];
}

/**
 * Чем строка списка обязана своим появлением. Собирается отдельным запросом и ложится на
 * строки вкладки «Участники» по их же ключу (`order:<id>` или `manual:<id>`).
 */
export interface EventAttributionRow {
  readonly key: string;
  /** Метка источника из карточки человека. Пусто — человека в базе нет или метки нет. */
  readonly contactSource: string | null;
  /** С человеком связывались до начала встречи. */
  readonly contactedBefore: boolean;
}
