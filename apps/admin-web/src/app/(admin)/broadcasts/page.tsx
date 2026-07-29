import { BroadcastEditor } from "@/components/broadcast-editor";

export default function BroadcastsPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Коммуникации</span>
          <h1>Рассылки</h1>
          <p>Черновики сообщений и зафиксированные аудитории получателей.</p>
        </div>
      </div>
      <BroadcastEditor />
    </>
  );
}
