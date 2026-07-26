import { CircleAlert, Inbox, LoaderCircle, RefreshCw } from "lucide-react";

export function PageLoading({ label = "Загружаем данные" }) {
  return (
    <div className="page-state" role="status">
      <LoaderCircle className="spin" size={24} />
      <p>{label}</p>
    </div>
  );
}

export function PageError({
  message,
  retry
}: Readonly<{ message: string; retry: () => void }>) {
  return (
    <div className="page-state page-state-error" role="alert">
      <CircleAlert size={24} />
      <div>
        <strong>Данные не загрузились</strong>
        <p>{message}</p>
      </div>
      <button className="secondary-button" type="button" onClick={retry}>
        <RefreshCw size={16} />
        Повторить
      </button>
    </div>
  );
}

export function EmptyState({
  title,
  description
}: Readonly<{ title: string; description: string }>) {
  return (
    <div className="page-state">
      <Inbox size={26} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}
