import type {
  EventAttributionRow,
  EventParticipantRow,
  EventParticipantsView,
  EventReport,
  EventReportBucket
} from "@ticket-platform/contracts";

/**
 * Отчёт по мероприятию.
 *
 * Считает не список, а разрезы: список приходит готовым со вкладки «Участники». Из-за этого
 * «записалось» и «дошло» в отчёте не могут разойтись с тем, что видно в самом списке, — а
 * разойтись им было бы легко, потому что участник берётся из двух разных таблиц, у заказа
 * есть исключение из отчётов, а у ручного участника — мягкое удаление.
 */

export interface EventReportRepository {
  loadParticipants(eventId: string): Promise<EventParticipantsView>;
  /** Чем каждая строка списка обязана своим появлением. Ключи те же, что у строк. */
  loadAttribution(eventId: string): Promise<readonly EventAttributionRow[]>;
  /** Заявки с формы сайта, отнесённые к этой встрече: всего и повторных. */
  countSiteRequests(eventId: string): Promise<{
    readonly total: number;
    readonly duplicates: number;
  }>;
}

export class EventReportNotFoundError extends Error {
  constructor() {
    super("Event was not found");
    this.name = "EventReportNotFoundError";
  }
}

export interface EventReportClock {
  now(): Date;
}

export class AdminEventReportService {
  constructor(
    private readonly repository: EventReportRepository,
    private readonly clock: EventReportClock
  ) {}

  async execute(input: { readonly eventId: string }): Promise<EventReport> {
    const [view, attribution, siteRequests] = await Promise.all([
      this.repository.loadParticipants(input.eventId),
      this.repository.loadAttribution(input.eventId),
      this.repository.countSiteRequests(input.eventId)
    ]);
    return buildEventReport({
      view,
      attribution,
      siteRequests,
      calculatedAt: this.clock.now()
    });
  }
}

export function buildEventReport(input: {
  readonly view: EventParticipantsView;
  readonly attribution: readonly EventAttributionRow[];
  readonly siteRequests: { readonly total: number; readonly duplicates: number };
  readonly calculatedAt: Date;
}): EventReport {
  const byKey = new Map<string, EventAttributionRow>();
  for (const row of input.attribution) {
    byKey.set(row.key, row);
  }

  const rows = input.view.rows;
  return {
    eventId: input.view.eventId,
    eventTitle: input.view.eventTitle,
    calculatedAt: input.calculatedAt.toISOString(),
    registered: rows.length,
    attended: rows.filter((row) => row.attendedAt !== null).length,
    siteRequests: input.siteRequests.total,
    siteRequestDuplicates: input.siteRequests.duplicates,
    byEntry: bucketize(rows, entryKey),
    // Метка источника — свободный текст, и «Instagram» с «instagram» это один канал.
    // Регистр приводим, но написание оставляем то, что встретилось первым: подписи в
    // отчёте должны выглядеть как в карточках, а не как в нижнем регистре.
    byChannel: bucketize(rows, (row) => channelKey(byKey.get(row.key))),
    byOutreach: bucketize(
      rows,
      (row) => byKey.get(row.key)?.contactedBefore === true ? "called" : "not_called"
    )
  };
}

/**
 * Как человек попал в список. Покупка в боте — это `order`: у неё нет метки источника,
 * потому что строка списка вообще не участник, а оплаченный заказ.
 */
function entryKey(row: EventParticipantRow): string {
  return row.origin === "order" ? "order" : row.channel;
}

function channelKey(attribution: EventAttributionRow | undefined): string {
  const source = attribution?.contactSource?.trim();
  return source ? source : "";
}

/**
 * Разрез в порядке убывания записавшихся. Пустой разрез («источник не указан») уходит вниз
 * независимо от размера: он ничего не объясняет, а сверху должно стоять объясняющее.
 */
function bucketize(
  rows: readonly EventParticipantRow[],
  keyOf: (row: EventParticipantRow) => string
): readonly EventReportBucket[] {
  const buckets = new Map<string, { registered: number; attended: number }>();
  const seen = new Map<string, string>();
  for (const row of rows) {
    const raw = keyOf(row);
    const normalized = raw.toLowerCase();
    const key = seen.get(normalized) ?? raw;
    seen.set(normalized, key);
    const bucket = buckets.get(key) ?? { registered: 0, attended: 0 };
    bucket.registered += 1;
    if (row.attendedAt !== null) {
      bucket.attended += 1;
    }
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => {
      if (left.key === "") {
        return 1;
      }
      if (right.key === "") {
        return -1;
      }
      return right.registered - left.registered || left.key.localeCompare(right.key);
    });
}
