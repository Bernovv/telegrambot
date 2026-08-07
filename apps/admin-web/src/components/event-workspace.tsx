"use client";

import type { AdminEventDetail } from "@ticket-platform/contracts/admin-events";
import { createContext, useContext } from "react";

/**
 * Мероприятие грузится один раз в layout и раздаётся вкладкам через контекст. Иначе каждая
 * вкладка тянула бы карточку заново — раньше так и было, и каждая из пяти страниц повторяла
 * один и тот же загрузчик со своей обработкой ошибок.
 */
export interface EventWorkspaceValue {
  readonly event: AdminEventDetail;
  /** Перечитать карточку после правки: вкладка меняет данные, шапка должна догнать. */
  readonly reload: () => Promise<void>;
}

const EventWorkspaceContext = createContext<EventWorkspaceValue | null>(null);

export const EventWorkspaceProvider = EventWorkspaceContext.Provider;

export function useEventWorkspace(): EventWorkspaceValue {
  const value = useContext(EventWorkspaceContext);
  if (!value) {
    throw new Error("useEventWorkspace вызван вне страницы мероприятия");
  }
  return value;
}
