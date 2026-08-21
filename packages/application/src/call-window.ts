/**
 * Окно обзвона: часы, в которые автоматика назначает звонки.
 *
 * Заявка приходит когда угодно — в шесть утра, в полночь, в выходной. Задача «позвонить»
 * со сроком «сейчас» в такое время бесполезна: она мгновенно становится просроченной и
 * утром тонет в списке вместе с настоящими просрочками. Поэтому автоматика двигает срок в
 * ближайшее время, когда звонить действительно будут.
 *
 * Границы окна живут в настройке воронки, а не здесь: сегодня звонят с двенадцати до
 * семи, завтра решат иначе, и менять это должен кабинет, а не выкладка.
 */
export interface CallWindow {
  /** Час начала обзвона во времени `timeZone`, 0–23. */
  readonly startHour: number;
  /** Час конца обзвона, 1–24. Строго больше начала. */
  readonly endHour: number;
  readonly timeZone: string;
}

/**
 * Ближайшее время, когда по человеку будут звонить.
 *
 * Внутри окна — прямо сейчас: разговор нужен как раз тогда, когда человек только что
 * оставил заявку. До окна — сегодня к его началу. После — завтра к началу.
 */
export function nextCallSlot(now: Date, window: CallWindow): Date {
  const parts = zoneParts(now, window.timeZone);
  if (parts === null) {
    // Часовой пояс не распознан. Это настройка, а не данные пользователя, и падать из-за
    // неё нельзя: заявка важнее аккуратного срока.
    return now;
  }
  if (parts.hour >= window.startHour && parts.hour < window.endHour) {
    return now;
  }
  const day = parts.hour >= window.endHour
    ? addDays(parts, 1)
    : parts;
  return zonedInstant(
    { ...day, hour: window.startHour, minute: 0 },
    window.timeZone
  );
}

interface ZoneParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function addDays(parts: ZoneParts, days: number): ZoneParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute
  };
}

/**
 * Момент времени по местным дате и часу.
 *
 * Смещение пояса зависит от самого момента — в поясах с переводом часов оно меняется
 * ровно на границе, — поэтому первое приближение уточняется вторым проходом.
 */
function zonedInstant(parts: ZoneParts, timeZone: string): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute
  );
  const firstOffset = zoneOffsetMinutes(new Date(naive), timeZone);
  if (firstOffset === null) {
    return new Date(naive);
  }
  const guess = naive - firstOffset * 60_000;
  const secondOffset = zoneOffsetMinutes(new Date(guess), timeZone);
  if (secondOffset === null || secondOffset === firstOffset) {
    return new Date(guess);
  }
  return new Date(naive - secondOffset * 60_000);
}

function zoneOffsetMinutes(instant: Date, timeZone: string): number | null {
  const parts = zoneParts(instant, timeZone);
  if (parts === null) {
    return null;
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    instant.getUTCSeconds()
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

function zoneParts(instant: Date, timeZone: string): ZoneParts | null {
  try {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(instant);
    const value = (type: string) =>
      Number(formatted.find((part) => part.type === type)?.value);
    const parts = {
      year: value("year"),
      month: value("month"),
      day: value("day"),
      // В en-CA полночь приходит как «24»: это тот же день, но нулевой час.
      hour: value("hour") % 24,
      minute: value("minute")
    };
    return Object.values(parts).some(Number.isNaN) ? null : parts;
  } catch {
    return null;
  }
}
