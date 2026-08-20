import { ShieldCheck } from "lucide-react";

/**
 * Плашка «Свои».
 *
 * Одна на всю панель и намеренно одинаковая везде: партнёра, родственника организатора или
 * подрядчика менеджер должен узнавать одним и тем же значком — и в списке, и в воронке, и в
 * задаче, — иначе смысл пометки теряется ровно там, где он нужен, то есть перед звонком.
 */
export function OwnBadge({
  note,
  compact
}: {
  readonly note?: string | null;
  readonly compact?: boolean;
}) {
  return (
    <span
      className={compact ? "own-badge own-badge-compact" : "own-badge"}
      title={note ? `Свои: ${note}` : "Свои — обзванивать не надо"}
    >
      <ShieldCheck size={compact ? 12 : 14} aria-hidden="true" />
      Свои
    </span>
  );
}
