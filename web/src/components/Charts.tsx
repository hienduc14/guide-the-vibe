// Minimal inline-SVG charts (no chart library): vertical bars by day and horizontal breakdown bars.

export interface BarDatum {
  label: string;
  value: number;
  /** Part of `value` drawn in the accent colour (e.g. failures). */
  alt?: number;
}

export function BarChart({
  data,
  height = 120,
  altLabel = "lỗi",
  empty = "Chưa có gì trong khoảng thời gian này",
}: {
  data: BarDatum[];
  height?: number;
  altLabel?: string;
  empty?: string;
}) {
  // All-zero days draw an empty grid that reads like a broken chart; say so in words instead.
  if (!data.some((d) => d.value > 0))
    return (
      <div className="empty" style={{ minHeight: height, display: "grid", placeItems: "center" }}>
        {empty}
      </div>
    );
  const max = Math.max(1, ...data.map((d) => d.value));
  const chartH = height - 20;
  return (
    <div className="bars" style={{ height }}>
      {data.map((d) => {
        const h = (d.value / max) * chartH;
        const ah = d.alt ? (d.alt / max) * chartH : 0;
        return (
          <div className="bars-col" key={d.label} title={`${d.label}: ${d.value}${d.alt ? ` (${altLabel}: ${d.alt})` : ""}`}>
            <div className="bars-track" style={{ height: chartH }}>
              <div className="bars-fill" style={{ height: h }}>
                {ah > 0 && <div className="bars-alt" style={{ height: ah }} />}
              </div>
            </div>
            <span className="bars-label">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function HBars({ data, empty = "Chưa có dữ liệu" }: { data: { label: string; value: number; hint?: string }[]; empty?: string }) {
  if (!data.length) return <div className="empty">{empty}</div>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      {data.map((d) => (
        <div className="hbar" key={d.label}>
          <span className="truncate small" title={d.label}>
            {d.label}
          </span>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="small mono">
            {d.value}
            {d.hint ? <span className="danger-text"> {d.hint}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Fill missing days so a chart shows a continuous range ending today. */
export function lastDays<T>(rows: T[], days: number, dayOf: (r: T) => string, pick: (r: T | undefined) => { value: number; alt?: number }): BarDatum[] {
  const byDay = new Map(rows.map((r) => [dayOf(r), r]));
  const out: BarDatum[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ label: d.slice(8) + "/" + d.slice(5, 7), ...pick(byDay.get(d)) });
  }
  return out;
}
