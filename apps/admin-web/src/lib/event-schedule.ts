/**
 * Дата и время мероприятия человеческим вводом.
 *
 * Форма раньше требовала строку вида `2026-08-20T11:00:00+03:00` в четырёх полях подряд.
 * Для встречи, которую заводят каждую неделю, это ровно тот случай, когда смещение
 * однажды напишут не то, и мероприятие уедет на три часа. Здесь календарь, часы и
 * длительность, а смещение считается по часовому поясу мероприятия.
 */

/** Сколько длится городская встреча, если не сказано иначе: три часа вечером. */
export const DEFAULT_CITY_DURATION_HOURS = 3;

export interface LocalSchedule {
  /** `YYYY-MM-DD` — то, что отдаёт `<input type="date">`. */
  readonly date: string;
  /** `HH:MM` — то, что отдаёт `<input type="time">`. */
  readonly time: string;
}

/**
 * Момент времени по календарю, часам и часовому поясу мероприятия.
 *
 * Смещение зависит от самой даты (переход на летнее время есть у многих поясов), поэтому
 * считается для неё, а не берётся у сегодняшнего дня. Две итерации нужны, чтобы попасть в
 * правильную сторону перехода: первая даёт приблизительный момент, вторая — смещение уже
 * в нём.
 */
export function zonedToIso(
  schedule: LocalSchedule,
  timeZone: string
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.date)
    || !/^\d{2}:\d{2}$/.test(schedule.time)) {
    return null;
  }
  const naive = Date.parse(`${schedule.date}T${schedule.time}:00Z`);
  if (Number.isNaN(naive)) {
    return null;
  }
  let offset = zoneOffsetMinutes(naive, timeZone);
  if (offset === null) {
    return null;
  }
  const firstGuess = naive - offset * 60_000;
  const refined = zoneOffsetMinutes(firstGuess, timeZone);
  if (refined === null) {
    return null;
  }
  offset = refined;
  // Возвращаем ровно то, что ввели, со смещением пояса: так значение точно совпадает с
  // тем, что человек видел в полях, а не отличается на минуту после округлений.
  return `${schedule.date}T${schedule.time}:00${formatOffset(offset)}`;
}

/** Момент плюс длительность в часах, тем же представлением. */
export function addHoursIso(
  iso: string,
  hours: number,
  timeZone: string
): string | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed) || !Number.isFinite(hours) || hours <= 0) {
    return null;
  }
  const instant = parsed + Math.round(hours * 60) * 60_000;
  const offset = zoneOffsetMinutes(instant, timeZone);
  return offset === null ? null : withOffset(instant, offset);
}

/** Обратный разбор: из хранимого момента — календарь и часы в поясе мероприятия. */
export function isoToZoned(
  iso: string | null | undefined,
  timeZone: string
): LocalSchedule {
  if (!iso) {
    return { date: "", time: "" };
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return { date: "", time: "" };
  }
  const parts = zoneParts(parsed, timeZone);
  if (!parts) {
    return { date: "", time: "" };
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

/** Сколько часов между началом и окончанием. Пусто, если окончания нет. */
export function durationHours(
  startsAt: string,
  endsAt: string | null | undefined
): number | null {
  if (!endsAt) {
    return null;
  }
  const from = Date.parse(startsAt);
  const to = Date.parse(endsAt);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
    return null;
  }
  return Math.round(((to - from) / 3_600_000) * 100) / 100;
}

/**
 * Слаг из названия и даты. Кириллица переводится по общепринятой таблице, а не выбрасывается:
 * иначе у встреч с русскими названиями слаг вышел бы из одной даты и совпал бы у двух
 * мероприятий одного дня.
 */
export function suggestSlug(title: string, date: string): string {
  const base = title
    .toLowerCase()
    .split("")
    .map((letter) => TRANSLITERATION[letter] ?? letter)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const suffix = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  const slug = [base, suffix].filter(Boolean).join("-");
  return slug.length >= 2 ? slug : suffix;
}

function withOffset(instant: number, offsetMinutes: number): string {
  const shifted = new Date(instant + offsetMinutes * 60_000);
  const iso = shifted.toISOString().slice(0, 19);
  return `${iso}${formatOffset(offsetMinutes)}`;
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function zoneOffsetMinutes(instant: number, timeZone: string): number | null {
  const parts = zoneParts(instant, timeZone);
  if (!parts) {
    return null;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - instant) / 60_000;
}

interface ZoneParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
}

function zoneParts(instant: number, timeZone: string): ZoneParts | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return null;
  }
  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    found[part.type] = part.value;
  }
  const year = found.year;
  const month = found.month;
  const day = found.day;
  // Полночь в некоторых поясах Intl отдаёт как «24», а Date.UTC такой час примет за
  // следующие сутки. Приводим к нулю сразу, иначе смещение съедет ровно на день.
  const hour = found.hour === "24" ? "00" : found.hour;
  const minute = found.minute;
  const second = found.second;
  if (!year || !month || !day || !hour || !minute || !second) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

const TRANSLITERATION: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya"
};
