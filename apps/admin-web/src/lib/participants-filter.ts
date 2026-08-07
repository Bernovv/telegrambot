import type {
  EventParticipantRow,
  ParticipantChannel
} from "@ticket-platform/contracts/admin-participants";

/**
 * Фильтрация списка участников идёт в браузере, а не запросом: на выездное мероприятие
 * приезжает несколько сотен человек, они уже приехали одним ответом, и переспрашивать
 * сервер на каждое нажатие клавиши незачем.
 */
export interface ParticipantsFilter {
  readonly search: string;
  readonly channel: ParticipantChannel | "";
  readonly ticketTitle: string;
  readonly sleepingOnly: boolean;
  readonly withChildrenOnly: boolean;
}

export const EMPTY_PARTICIPANTS_FILTER: ParticipantsFilter = {
  search: "",
  channel: "",
  ticketTitle: "",
  sleepingOnly: false,
  withChildrenOnly: false
};

export function filterParticipants(
  rows: readonly EventParticipantRow[],
  filter: ParticipantsFilter
): readonly EventParticipantRow[] {
  const needle = filter.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (filter.channel && row.channel !== filter.channel) {
      return false;
    }
    if (filter.ticketTitle && row.ticketTitle !== filter.ticketTitle) {
      return false;
    }
    if (filter.sleepingOnly && row.sleepingPlaces === 0) {
      return false;
    }
    if (filter.withChildrenOnly && row.children === 0) {
      return false;
    }
    if (needle === "") {
      return true;
    }
    return matches(row, needle);
  });
}

/**
 * Искать приходится по всему, чем человека называют вслух: по имени, по нику, по номеру
 * заказа и по телефону.
 *
 * Телефон сравнивается только без разделителей и от трёх цифр: в списке он записан как
 * +79001234567, а диктуют его через скобки и дефисы. Подстрокой телефон не ищется вовсе —
 * иначе запрос «7» выдал бы всех, у кого этот номер вообще есть.
 */
function matches(row: EventParticipantRow, needle: string): boolean {
  const digits = needle.replace(/\D/g, "");
  const haystack = [
    row.displayName,
    row.telegramUsername,
    row.orderNumber,
    row.ticketTitle,
    row.note
  ];

  for (const value of haystack) {
    if (value && value.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return digits.length >= 3
    && (row.phone ?? "").replace(/\D/g, "").includes(digits);
}

export function ticketTitlesOf(
  rows: readonly EventParticipantRow[]
): readonly string[] {
  const titles = new Set<string>();
  for (const row of rows) {
    if (row.ticketTitle.trim() !== "") {
      titles.add(row.ticketTitle);
    }
  }
  return [...titles].sort((left, right) => left.localeCompare(right));
}
