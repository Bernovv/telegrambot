import { ShieldCheck } from "lucide-react";

/**
 * Плашка «Свои».
 *
 * Одна на всю панель и намеренно одинаковая везде: партнёра, родственника организатора или
 * подрядчика менеджер должен узнавать одним и тем же значком — и в списке, и в воронке, и в
 * задаче, — иначе смысл пометки теряется ровно там, где он нужен, то есть перед звонком.
 *
 * Там, где пометку можно поправить, плашка становится кнопкой: ошибаются в ней сразу при
 * простановке, и искать отдельный пункт меню в этот момент неоткуда.
 */
export function OwnBadge({
  note,
  compact,
  onEdit
}: {
  readonly note?: string | null;
  readonly compact?: boolean;
  readonly onEdit?: () => void;
}) {
  const className = compact ? "own-badge own-badge-compact" : "own-badge";
  const title = note ? `Свои: ${note}` : "Свои — обзванивать не надо";

  if (!onEdit) {
    return (
      <span className={className} title={title}>
        <ShieldCheck size={compact ? 12 : 14} aria-hidden="true" />
        Свои
      </span>
    );
  }

  return (
    <button
      className={`${className} own-badge-button`}
      type="button"
      title={`${title}. Нажмите, чтобы изменить`}
      onClick={onEdit}
    >
      <ShieldCheck size={compact ? 12 : 14} aria-hidden="true" />
      Свои
    </button>
  );
}
