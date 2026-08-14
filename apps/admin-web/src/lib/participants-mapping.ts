/**
 * Превращает произвольную таблицу менеджера в карточки участников.
 *
 * Здесь собраны все грабли августовского переноса, и каждая стала правилом:
 *
 * 1. Колонки не угадываются молча. Подсказка есть, но окончательно их назначает человек:
 *    в той таблице «Спальников» означало арендованные мешки, а спальные места — колонка
 *    «Ночь», и угадывание стоило неудачного импорта.
 * 2. Строки «С +1», «Муж», «Ребенок» — спутники предыдущего человека, а не отдельные
 *    гости. Иначе в списке появляются карточки без имени и телефона.
 * 3. Если такая строка называет другого человека («Плюс один от Олега»), к соседу сверху
 *    её не клеим — только к тому, кого она называет, и только если он рядом.
 * 4. Спальных мест не может быть больше, чем людей в карточке: это же правило стоит в базе.
 * 5. Телефоны Excel хранит как 7.96677E10 — приводим к +7XXXXXXXXXX, а что не похоже на
 *    номер, уводим в заметку, чтобы не потерять.
 * 6. Деньги считаем в копейках строками: 7317.60 * 100 в плавающей точке даёт 731759.99…
 */

export const PARTICIPANT_FIELDS = [
  "name",
  "phone",
  "email",
  "telegram",
  "amount",
  "sleeping",
  "children",
  "note"
] as const;

export type ParticipantField = typeof PARTICIPANT_FIELDS[number];

/** Какая колонка таблицы отвечает за какое поле. `null` — поле не заполняем. */
export type ColumnMapping = Readonly<Record<ParticipantField, number | null>>;

export interface MappedParticipant {
  /** Номер строки в файле — по нему человек находит запись глазами. */
  readonly line: number;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly telegram: string;
  readonly adults: number;
  readonly children: number;
  readonly sleeping: number;
  readonly amountKopecks: string;
  readonly note: string;
  /** Имена тех, кто пришёл с этим человеком: они не стали отдельными карточками. */
  readonly companions: readonly string[];
}

export interface MappingProblem {
  readonly line: number;
  readonly name: string;
  readonly message: string;
}

export interface MappingResult {
  readonly participants: readonly MappedParticipant[];
  readonly problems: readonly MappingProblem[];
  readonly totals: {
    readonly cards: number;
    readonly guests: number;
    readonly adults: number;
    readonly children: number;
    readonly sleeping: number;
    readonly amountKopecks: string;
  };
}

const CHILD = /^(ребен|ребён|дочка|дочь|сын|ее дочка|её дочка|ее сын|её сын)/i;
// Границы слова записаны через пробелы, а не через \b: в JavaScript \b знает только
// латиницу, и против кириллицы не срабатывает никогда. Из-за этого «Евгений муж» не
// опознавался спутником, а правило «строка называет другого человека» молча не работало.
const COMPANION = [
  /^[сc]\s*\+\s*\d+$/i,
  /^\+\s*\d+$/,
  /^(муж|жена|супруг|супруга)$/i,
  /^плюс\s*(\d+|один|одна)(?=\s|$)/i,
  /^[сc]\s+\S+.*хз кто$/i,
  /(?:^|\s)(муж|жена)$/i
];
/** «от Олега», «с Романом» — строка называет конкретного человека. */
const REFERS = /(?:^|\s)(от|с)\s+([А-ЯЁ][а-яё]+)/i;

export function mapParticipants(
  rows: readonly (readonly string[])[],
  mapping: ColumnMapping,
  options: { readonly groupCompanions: boolean; readonly headerRows: number }
): MappingResult {
  const problems: MappingProblem[] = [];
  const drafts: Draft[] = [];

  rows.slice(options.headerRows).forEach((cells, index) => {
    const line = index + options.headerRows + 1;
    const name = cell(cells, mapping.name).trim();
    if (name === "") {
      // Пустая строка в середине таблицы — обычное дело, молча пропускаем. Ругаться на
      // неё значит завалить человека сообщениями там, где всё в порядке.
      if (cells.some((value) => value.trim() !== "")) {
        problems.push({ line, name: "", message: "нет имени — строка пропущена" });
      }
      return;
    }

    const notes: string[] = [];
    const { phone, leftover } = normalizePhone(cell(cells, mapping.phone));
    if (leftover !== "") {
      notes.push(leftover);
    }
    const ownNote = cell(cells, mapping.note).trim();
    if (ownNote !== "") {
      notes.push(ownNote);
    }

    drafts.push({
      line,
      name,
      phone,
      telegram: normalizeTelegram(cell(cells, mapping.telegram)),
      email: normalizeEmail(cell(cells, mapping.email)),
      isChild: CHILD.test(name),
      sleeping: wholeNumber(cell(cells, mapping.sleeping)),
      children: wholeNumber(cell(cells, mapping.children)),
      amountKopecks: toKopecks(cell(cells, mapping.amount)),
      note: notes.join("; ")
    });
  });

  const groups = options.groupCompanions ? group(drafts) : drafts.map(alone);
  const participants: MappedParticipant[] = [];

  for (const entry of groups) {
    const host = entry.host;
    const adults = (host.isChild ? 0 : 1)
      + entry.members.filter((member) => !member.isChild).length;
    const children = host.children
      + (host.isChild ? 1 : 0)
      + entry.members.filter((member) => member.isChild).length;
    const sleeping = host.sleeping
      + entry.members.reduce((sum, member) => sum + member.sleeping, 0);
    const amount = entry.members.reduce(
      (sum, member) => sum + BigInt(member.amountKopecks),
      BigInt(host.amountKopecks)
    );

    if (sleeping > adults + children) {
      problems.push({
        line: host.line,
        name: host.name,
        message: `спальных мест ${sleeping}, а людей ${adults + children}`
          + " — похоже, места записаны на всю компанию сразу"
      });
      continue;
    }

    const parts = [host.note];
    if (entry.members.length > 0) {
      parts.push("с ним: " + entry.members.map(describe).join(", "));
    }

    participants.push({
      line: host.line,
      name: host.name,
      phone: host.phone,
      email: host.email,
      telegram: host.telegram,
      adults,
      children,
      sleeping,
      amountKopecks: amount.toString(),
      note: parts.filter((part) => part !== "").join("; ").slice(0, 500),
      companions: entry.members.map((member) => member.name)
    });
  }

  return { participants, problems, totals: totalsOf(participants) };
}

interface Draft {
  readonly line: number;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly telegram: string;
  readonly isChild: boolean;
  readonly sleeping: number;
  readonly children: number;
  readonly amountKopecks: string;
  readonly note: string;
}

interface Group {
  readonly host: Draft;
  readonly members: Draft[];
}

function alone(host: Draft): Group {
  return { host, members: [] };
}

function group(drafts: readonly Draft[]): readonly Group[] {
  const groups: Group[] = [];
  for (const draft of drafts) {
    const previous = groups.at(-1);
    if (previous && isCompanionOf(draft, previous.host)) {
      previous.members.push(draft);
    } else {
      groups.push(alone(draft));
    }
  }
  return groups;
}

function isCompanionOf(draft: Draft, host: Draft): boolean {
  const looksLikeCompanion = draft.isChild
    || COMPANION.some((pattern) => pattern.test(draft.name))
    || /^(муж|жена)\s+\S+/i.test(draft.note);
  if (!looksLikeCompanion) {
    return false;
  }
  // Строка может называть человека — тогда клеим только к нему, а не к соседу сверху:
  // «Плюс один от Олега спикера» не относится к тому, кто оказался строкой выше.
  const named = REFERS.exec(draft.name) ?? REFERS.exec(draft.note);
  if (!named) {
    return true;
  }
  const mentioned = named[2] ?? "";
  return overlap(stems(mentioned), stems(host.name));
}

function describe(member: Draft): string {
  const extras = [member.telegram, member.note].filter((part) => part !== "");
  return extras.length === 0 ? member.name : `${member.name} (${extras.join(", ")})`;
}

/** Сравниваем по первым четырём буквам: «Романом» и «Роман» — один человек. */
function stems(value: string): ReadonlySet<string> {
  const normalized = value.toLowerCase().replace(/ё/g, "е");
  return new Set(
    [...normalized.matchAll(/[а-яa-z]{4,}/g)].map((match) => match[0].slice(0, 4))
  );
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

export function normalizePhone(raw: string): {
  readonly phone: string;
  readonly leftover: string;
} {
  const value = raw.trim().replace(/[‪-‮]/g, "");
  if (value === "") {
    return { phone: "", leftover: "" };
  }
  // Excel хранит длинные числа как 7.9667700088E10 — иначе номер приедет обрезанным.
  const expanded = /^\d+(\.\d+)?[eE]\+?\d+$/.test(value)
    ? BigInt(Math.round(Number(value))).toString()
    : value;
  const digits = expanded.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return { phone: `+7${digits.slice(1)}`, leftover: "" };
  }
  if (digits.length === 10) {
    return { phone: `+7${digits}`, leftover: "" };
  }
  // Не номер — например «муж Алены» или ник. Уводим в заметку, чтобы не потерять.
  return { phone: "", leftover: value };
}

/**
 * Адрес почты или пусто. Проверка нарочно грубая — собака внутри и никаких пробелов: в
 * выгрузке Timepad адрес уже проверен формой, а строгий разбор здесь означал бы потерянного
 * участника из-за редкого, но допустимого адреса.
 */
function normalizeEmail(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value.length < 3 || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "";
  }
  return value;
}

function normalizeTelegram(raw: string): string {
  const value = raw.trim();
  if (value === "" || !/^@?[A-Za-z0-9_]{3,64}$/.test(value)) {
    return "";
  }
  return value.startsWith("@") ? value : `@${value}`;
}

function wholeNumber(raw: string): number {
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Рубли в копейки строкой: через число копейка теряется на первом же 7317.60. */
export function toKopecks(raw: string): string {
  const value = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return "0";
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
}

function cell(cells: readonly string[], column: number | null): string {
  return column === null ? "" : cells[column] ?? "";
}

function totalsOf(participants: readonly MappedParticipant[]) {
  let adults = 0;
  let children = 0;
  let sleeping = 0;
  let amount = 0n;
  for (const participant of participants) {
    adults += participant.adults;
    children += participant.children;
    sleeping += participant.sleeping;
    amount += BigInt(participant.amountKopecks);
  }
  return {
    cards: participants.length,
    guests: adults + children,
    adults,
    children,
    sleeping,
    amountKopecks: amount.toString()
  };
}

/** Подсказывает колонки по заголовку. Окончательное слово всё равно за человеком. */
export function guessMapping(header: readonly string[]): ColumnMapping {
  const hints: Readonly<Record<ParticipantField, readonly RegExp[]>> = {
    name: [/^имя$/i, /^фио$/i, /^участник$/i, /^name$/i, /^гость$/i],
    phone: [/телефон/i, /^phone$/i, /^номер/i],
    // «Почта» и «e-mail» — как их называет выгрузка Timepad и обычная таблица.
    email: [/^почта$/i, /^e-?mail$/i, /электрон/i],
    telegram: [/^тг$/i, /телеграм/i, /^telegram$/i, /^ник$/i],
    amount: [/^сумма$/i, /оплат/i, /^amount$/i, /^цена$/i],
    // Намеренно не ловим «спальник»: в августовской таблице так назывались арендованные
    // мешки, а не места. Пусть человек выберет сам.
    sleeping: [/^ночь$/i, /ночует/i, /ночёвк/i, /ночевк/i, /спальных мест/i],
    children: [/^детей$/i, /^дети$/i, /^children$/i],
    note: [/коммент/i, /заметк/i, /^note$/i, /примечан/i]
  };

  const mapping: Record<ParticipantField, number | null> = {
    name: null,
    phone: null,
    email: null,
    telegram: null,
    amount: null,
    sleeping: null,
    children: null,
    note: null
  };

  for (const field of PARTICIPANT_FIELDS) {
    const at = header.findIndex((title) =>
      hints[field].some((pattern) => pattern.test(title.trim())));
    mapping[field] = at === -1 ? null : at;
  }
  return mapping;
}
