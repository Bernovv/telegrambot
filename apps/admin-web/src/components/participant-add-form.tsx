"use client";

import { AdminApiError, addEventParticipant } from "@/lib/admin-api";
import type { AdminEventFormat } from "@ticket-platform/contracts/admin-events";
import type { EventParticipantSource } from "@ticket-platform/contracts/admin-accommodation";
import { UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";

/**
 * Завести участника руками прямо в списке участников.
 *
 * Раньше эта форма жила только на вкладке «Логистика», вместе с расселением и палатками.
 * У городской встречи такой вкладки нет вовсе, и завести человека, который записался по
 * телефону, было негде — при том, что на бесплатной встрече так приходит большинство.
 *
 * У городского формата спрашиваем четыре поля. Взрослые, дети, спальные места и тариф — это
 * про выезд с ночёвкой; на встрече из них осмысленно ноль.
 */
export function ParticipantAddForm({
  eventId,
  format,
  isFree,
  onAdded
}: Readonly<{
  readonly eventId: string;
  readonly format: AdminEventFormat;
  readonly isFree: boolean;
  readonly onAdded: () => void;
}>) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailed = format === "offsite";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const displayName = text(data, "displayName");
    if (!displayName) {
      setError("Без имени участника не завести.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const phone = text(data, "phone");
      const ticketTitle = text(data, "ticketTitle");
      const note = text(data, "note");
      await addEventParticipant(eventId, {
        displayName,
        ...(phone ? { phone } : {}),
        source: (text(data, "source") || "direct") as EventParticipantSource,
        ...(ticketTitle ? { ticketTitle } : {}),
        adults: detailed ? count(data, "adults", 1) : 1,
        children: detailed ? count(data, "children", 0) : 0,
        sleepingPlaces: detailed ? count(data, "sleepingPlaces", 0) : 0,
        ...(note ? { note } : {})
      });
      form.reset();
      onAdded();
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : "Не удалось завести участника."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="participant-form" onSubmit={(event) => void submit(event)}>
      <label className="field">
        <span>Имя</span>
        <input name="displayName" required maxLength={200} autoFocus />
      </label>
      <label className="field">
        <span>Телефон</span>
        {/* Номер приводит к единому виду сервер — тем же разбором, что и загрузку файла.
            Раскладку браузеру не навязываем: она мешала вводить обычное «8 999 123-45-67». */}
        <input name="phone" placeholder="8 999 123-45-67" maxLength={100} />
      </label>
      <label className="field">
        <span>Откуда</span>
        <select name="source" defaultValue="direct">
          <option value="direct">Записался напрямую</option>
          <option value="site">Сайт</option>
          <option value="max">MAX</option>
          <option value="timepad">Timepad</option>
          <option value="other">Другое</option>
        </select>
      </label>
      {detailed ? (
        <>
          <label className="field">
            <span>Тариф</span>
            <input name="ticketTitle" maxLength={200} placeholder="Все включено" />
          </label>
          <label className="field">
            <span>Взрослых</span>
            <input name="adults" type="number" min={0} max={100} defaultValue={1} required />
          </label>
          <label className="field">
            <span>Детей</span>
            <input name="children" type="number" min={0} max={100} defaultValue={0} required />
          </label>
          <label className="field">
            <span>Спальных мест</span>
            <input
              name="sleepingPlaces"
              type="number"
              min={0}
              max={200}
              defaultValue={0}
              required
            />
          </label>
        </>
      ) : null}
      <label className="field field-full">
        <span>Заметка</span>
        <input
          name="note"
          maxLength={500}
          placeholder={
            isFree
              ? "Например: придёт с коллегой"
              : "Например: оплатил переводом 5 августа"
          }
        />
      </label>
      {error ? <p className="form-error field-full">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={submitting}>
        <UserPlus size={16} />
        {submitting ? "Заводим..." : "Добавить"}
      </button>
    </form>
  );
}

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function count(data: FormData, name: string, fallback: number): number {
  const value = Number(text(data, name));
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
