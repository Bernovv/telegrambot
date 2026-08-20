import type { EventReportBucket } from "@ticket-platform/contracts/admin-event-report";

/**
 * Столбики «записалось / дошло».
 *
 * Две шкалы в одном столбике, а не два столбика рядом: вопрос здесь не «где людей больше»,
 * а «где из записавшихся доходит больше». Рядом стоящие столбики заставляли бы считать это
 * отношение глазами, а именно оно и есть ответ.
 *
 * Ширина считается от самого большого разреза, а не от общего числа: иначе у встречи, где
 * девять человек из десяти пришли с сайта, все остальные каналы сплющиваются в полоску и
 * сравнить их между собой нельзя.
 */
export function EventReportChart({
  buckets,
  labelOf,
  emptyLabel
}: {
  readonly buckets: readonly EventReportBucket[];
  readonly labelOf: (key: string) => string;
  readonly emptyLabel: string;
}) {
  if (buckets.length === 0) {
    return <p className="muted report-empty">{emptyLabel}</p>;
  }
  const widest = Math.max(...buckets.map((bucket) => bucket.registered), 1);

  return (
    <div className="report-chart">
      <div className="report-legend" aria-hidden="true">
        <span><i className="report-swatch report-swatch-registered" />записалось</span>
        <span><i className="report-swatch report-swatch-attended" />дошло</span>
      </div>
      <ul className="report-bars">
        {buckets.map((bucket) => {
          const share = bucket.registered > 0
            ? Math.round((bucket.attended / bucket.registered) * 100)
            : 0;
          return (
            <li key={bucket.key || "unknown"}>
              <span className="report-bar-label">{labelOf(bucket.key)}</span>
              <span className="report-bar-track">
                <span
                  className="report-bar-registered"
                  style={{ width: `${(bucket.registered / widest) * 100}%` }}
                >
                  <span
                    className="report-bar-attended"
                    style={{
                      width: bucket.registered > 0
                        ? `${(bucket.attended / bucket.registered) * 100}%`
                        : "0%"
                    }}
                  />
                </span>
              </span>
              <span className="report-bar-value">
                <strong>{bucket.attended}</strong>
                {" из "}
                {bucket.registered}
                <span className="muted">{` · ${share}%`}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
