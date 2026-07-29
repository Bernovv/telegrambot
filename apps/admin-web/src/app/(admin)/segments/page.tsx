import { SegmentPreviewBuilder } from "@/components/segment-preview-builder";

export default function SegmentsPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Пользователи</span>
          <h1>Сегменты</h1>
          <p>Предварительная выборка по активным статусам и категориям.</p>
        </div>
      </div>
      <SegmentPreviewBuilder />
    </>
  );
}
