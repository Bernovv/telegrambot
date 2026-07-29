import { UserClassificationEditor } from "@/components/user-classification-editor";

export default function UserClassificationPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Пользователи</span>
          <h1>Статусы и категории</h1>
          <p>Стабильные коды для сценариев, сегментов и истории назначений.</p>
        </div>
      </div>
      <UserClassificationEditor />
    </>
  );
}
