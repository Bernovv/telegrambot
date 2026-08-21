"use client";

import { bookMentorSlot, listMentorSlots } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import type { MentorSlot } from "@ticket-platform/contracts/admin-staff";
import type {
  OutreachManager,
  OutreachPersonCard,
  OutreachPersonField
} from "@ticket-platform/contracts/admin-outreach";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";

/**
 * Основное о человеке: ответственный, встреча, источник, ниша, запрос.
 *
 * Правка по клику, а не отдельным режимом на всю карточку. Прежняя форма «Изменить
 * карточку» разворачивалась во всю ширину и требовала помнить, что пустое поле в ней
 * означает «стереть»; поправить одну нишу это стоило четырёх действий.
 *
 * Пустые поля показываем: заполнять их некому, если их не видно. Но выглядят они как
 * приглашение, а не как отсутствие данных, — иначе получается страница из amoCRM, где в
 * тридцати строках стоит «…».
 */
export function PersonFieldsCard({
  person,
  managers,
  busy,
  onSaveContact,
  onSaveField,
  onBooked
}: {
  readonly person: OutreachPersonCard;
  readonly managers: readonly OutreachManager[];
  readonly busy: boolean;
  readonly onSaveContact: (changes: {
    readonly source?: string | null;
    readonly assignedAdminId?: string | null;
    readonly nextMeetingAt?: string | null;
  }) => Promise<boolean>;
  readonly onSaveField: (fieldId: string, value: string | null) => Promise<boolean>;
  /** Человека записали к наставнику: карточку надо перечитать, встреча теперь оттуда. */
  readonly onBooked: () => Promise<void>;
}) {
  return (
    <section className="data-section person-fields-card">
      <div className="section-title-row"><div><h2>Основное</h2></div></div>
      <dl className="person-fields">
        <PersonFieldRow label="Ответственный">
          <SelectValue
            value={person.assignedAdminId ?? ""}
            display={person.assignedAdminName}
            placeholder="не назначен"
            busy={busy}
            options={managers.map((manager) => ({
              value: manager.id,
              label: manager.displayName
            }))}
            emptyLabel="Никто"
            onSave={(next) => onSaveContact({ assignedAdminId: next || null })}
          />
        </PersonFieldRow>
        <PersonFieldRow label="Личная встреча">
          <MeetingValue
            value={person.nextMeetingAt}
            contactId={person.contactId}
            busy={busy}
            onSave={(next) => onSaveContact({ nextMeetingAt: next })}
            onBooked={onBooked}
          />
        </PersonFieldRow>
        {person.fields.map((field) => (
          <PersonFieldRow key={field.fieldId} label={field.label}>
            <SharedFieldValue
              field={field}
              busy={busy}
              onSave={(next) => onSaveField(field.fieldId, next)}
            />
          </PersonFieldRow>
        ))}
        <PersonFieldRow label="Источник">
          <TextValue
            value={person.source}
            placeholder="неизвестен"
            busy={busy}
            onSave={(next) => onSaveContact({ source: next })}
          />
        </PersonFieldRow>
      </dl>
    </section>
  );
}

function PersonFieldRow({
  label,
  children
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="person-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Общая обвязка правки: показанное значение, кнопка карандаша, поле и две кнопки.
 *
 * Сохранение по кнопке, а не по потере фокуса. Уход мышью мимо — не решение сохранить, и
 * молча записанное «случайно стёр» в поле «ниша» потом никто не найдёт.
 */
function Editable({
  busy,
  display,
  children,
  onSubmit,
  onOpen
}: {
  readonly busy: boolean;
  readonly display: React.ReactNode;
  readonly children: React.ReactNode;
  readonly onSubmit: () => Promise<boolean>;
  readonly onOpen: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <button
        className="person-field-open"
        type="button"
        disabled={busy}
        onClick={() => {
          onOpen();
          setEditing(true);
        }}
      >
        {display}
        <Pencil size={13} />
      </button>
    );
  }
  return (
    <span className="person-field-edit">
      {children}
      <button
        className="icon-button"
        type="button"
        aria-label="Сохранить"
        title="Сохранить"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          void onSubmit()
            .then((saved) => {
              if (saved) {
                setEditing(false);
              }
            })
            .finally(() => setSaving(false));
        }}
      >
        <Check size={15} />
      </button>
      <button
        className="icon-button"
        type="button"
        aria-label="Отменить"
        title="Отменить"
        disabled={saving}
        onClick={() => setEditing(false)}
      >
        <X size={15} />
      </button>
    </span>
  );
}

function TextValue({
  value,
  placeholder,
  busy,
  onSave
}: {
  readonly value: string | null;
  readonly placeholder: string;
  readonly busy: boolean;
  readonly onSave: (next: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <Editable
      busy={busy}
      display={value ?? <span className="muted">{placeholder}</span>}
      onOpen={() => setDraft(value ?? "")}
      onSubmit={() => onSave(draft.trim() || null)}
    >
      <input
        value={draft}
        maxLength={200}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
      />
    </Editable>
  );
}

function SelectValue({
  value,
  display,
  placeholder,
  emptyLabel,
  options,
  busy,
  onSave
}: {
  readonly value: string;
  readonly display: string | null;
  readonly placeholder: string;
  readonly emptyLabel: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly busy: boolean;
  readonly onSave: (next: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <Editable
      busy={busy}
      display={display ?? <span className="muted">{placeholder}</span>}
      onOpen={() => setDraft(value)}
      onSubmit={() => onSave(draft)}
    >
      <select
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </Editable>
  );
}

/**
 * Личная встреча — из окошек наставника.
 *
 * Раньше здесь было просто время, и это была та самая ошибка: менеджер назначал встречу,
 * не зная, свободен ли наставник, а совпадения выяснялись у самого наставника. Теперь
 * список — это свободные окошки из его календаря, и запись занимает окошко тем же
 * действием, каким ставит время в карточку.
 *
 * Ручной ввод остался: встреча бывает и без наставника — с руководителем, например, — и
 * запирать её ради стройности неправильно.
 */
function MeetingValue({
  value,
  contactId,
  busy,
  onSave,
  onBooked
}: {
  readonly value: string | null;
  readonly contactId: string;
  readonly busy: boolean;
  readonly onSave: (next: string | null) => Promise<boolean>;
  readonly onBooked: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => toLocalInput(value));
  const [slots, setSlots] = useState<readonly MentorSlot[]>([]);
  const [slotId, setSlotId] = useState("");
  const [slotsFailed, setSlotsFailed] = useState(false);
  const soon = value !== null && new Date(value).getTime() > Date.now();

  async function loadSlots() {
    try {
      setSlots(await listMentorSlots({ onlyFree: true }));
      setSlotsFailed(false);
    } catch {
      // Окошки — подсказка, а не условие: не дали их прочитать (нет роли, отвалился
      // запрос) — время всё равно можно поставить руками.
      setSlots([]);
      setSlotsFailed(true);
    }
  }

  return (
    <Editable
      busy={busy}
      display={value
        ? (
          <span className={soon ? "person-field-soon" : undefined}>
            {formatDateTime(value)}
          </span>
        )
        : <span className="muted">не назначена</span>}
      onOpen={() => {
        setDraft(toLocalInput(value));
        setSlotId("");
        void loadSlots();
      }}
      onSubmit={async () => {
        if (slotId) {
          await bookMentorSlot({ slotId, contactId });
          await onBooked();
          return true;
        }
        return onSave(draft ? new Date(draft).toISOString() : null);
      }}
    >
      <span className="person-meeting-edit">
        <select
          aria-label="Свободное окошко наставника"
          value={slotId}
          onChange={(event) => setSlotId(event.target.value)}
        >
          <option value="">
            {slots.length === 0
              ? (slotsFailed ? "Окошки не загрузились" : "Свободных окошек нет")
              : "Выбрать окошко наставника"}
          </option>
          {slots.map((slot) => (
            <option key={slot.id} value={slot.id}>
              {slot.mentorName} · {formatDateTime(slot.startsAt)}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          aria-label="Время встречи"
          value={draft}
          disabled={slotId !== ""}
          onChange={(event) => setDraft(event.target.value)}
        />
      </span>
    </Editable>
  );
}

function SharedFieldValue({
  field,
  busy,
  onSave
}: {
  readonly field: OutreachPersonField;
  readonly busy: boolean;
  readonly onSave: (next: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(field.value ?? "");
  return (
    <Editable
      busy={busy}
      display={field.value ?? <span className="muted">не заполнено</span>}
      onOpen={() => setDraft(field.value ?? "")}
      onSubmit={() => onSave(draft.trim() || null)}
    >
      {field.type === "select" ? (
        <select
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
        >
          <option value="">Не выбрано</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === "number"
            ? "number"
            : field.type === "date" ? "date" : "text"}
          value={draft}
          maxLength={500}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
    </Editable>
  );
}

/** ISO во время местного пояса: `datetime-local` понимает только его. */
function toLocalInput(value: string | null): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}`
    + `-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}
