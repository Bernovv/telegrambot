"use client";

import { AdminApiError, markOutreachPersonOwn } from "@/lib/admin-api";
import { formatCompactDate } from "@/lib/format";
import type { OutreachPersonCard } from "@ticket-platform/contracts/admin-outreach";
import { ShieldCheck, ShieldOff, X } from "lucide-react";
import { type FormEvent, useState } from "react";

/**
 * Пометка «свои» — поставить, поправить объяснение или снять.
 *
 * Раньше это были два подряд идущих window.prompt: чтобы исправить объяснение, приходилось
 * сначала снять пометку, потом поставить заново, а снять её случайно поставленную было
 * неоткуда, кроме страницы человека. Пометка видна везде, где показан человек, и правят её
 * чаще всего сразу после того, как ошиблись, — поэтому одно окно на все три действия.
 */
export function PersonOwnDialog({
  person,
  onClose,
  onDone
}: {
  readonly person: OutreachPersonCard;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("note");
    const note = typeof value === "string" ? value.trim() : "";
    await run(
      { isOwn: true, ...(note ? { note } : {}) },
      person.isOwn ? "Пометка обновлена." : "Человек помечен своим."
    );
  }

  async function clear() {
    if (!window.confirm(
      `Снять пометку «свои» с ${person.displayName ?? "контакта"}?`
      + " Он снова попадёт в обзвон."
    )) {
      return;
    }
    await run({ isOwn: false }, "Пометка снята — человек снова в обзвоне.");
  }

  async function run(
    payload: { readonly isOwn: boolean; readonly note?: string },
    success: string
  ) {
    setBusy(true);
    setError(null);
    try {
      await markOutreachPersonOwn(person.contactId, payload);
      await onDone(success);
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось изменить пометку.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="outreach-modal-backdrop" role="presentation">
      <section
        className="outreach-modal outreach-small-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="own-dialog-title"
      >
        <div className="section-title-row">
          <div>
            <h2 id="own-dialog-title">Пометка «свои»</h2>
            <span>{person.displayName ?? "Без имени"}</span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {error ? <div className="page-warning">{error}</div> : null}

        <div className="own-dialog">
          <p className="muted">
            Своих не обзванивают: плашка видна везде, где показан человек, и предупреждает
            менеджера перед звонком.
          </p>
          {person.isOwn && person.ownMarkedByName ? (
            <p className="muted">
              Отметил {person.ownMarkedByName}
              {person.ownMarkedAt ? ` ${formatCompactDate(person.ownMarkedAt)}` : ""}.
            </p>
          ) : null}
          <form onSubmit={(event) => void save(event)}>
            <label>
              <span>Кто это</span>
              <input
                name="note"
                maxLength={500}
                autoFocus
                defaultValue={person.ownNote ?? ""}
                placeholder="Партнёр, подрядчик, родственник организатора"
              />
            </label>
            <div className="own-dialog-actions">
              <button className="primary-button" type="submit" disabled={busy}>
                <ShieldCheck size={16} />
                {person.isOwn ? "Сохранить" : "Отметить «свои»"}
              </button>
              {person.isOwn ? (
                <button
                  className="secondary-button danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void clear()}
                >
                  <ShieldOff size={16} />
                  Снять пометку
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
