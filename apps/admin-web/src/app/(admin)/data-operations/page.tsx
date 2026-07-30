import { UserImportPreview } from "@/components/user-import-preview";

export default function DataOperationsPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Операции с данными</span>
          <h1>Импорт пользователей</h1>
          <p>Нормализация и проверка клиентских данных перед объединением.</p>
        </div>
      </div>
      <UserImportPreview />
    </>
  );
}
