import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/*
 * Small inline-SVG charts for progress: a single-series line with a crosshair, vertical bars with a
 * per-bar tooltip, and a stacked status bar. No chart library. Every value shown on hover is also
 * reachable without it (axis labels, totals beside the bar, or a table on the page).
 */

export interface Point {
  label: string; // short axis label, e.g. "24/11"
  full: string; // tooltip heading, e.g. "Thứ hai 24/11"
  value: number;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / step) * step;
}

/** Labels at the two ends and a few evenly spaced in between, so they never collide. */
function tickIdx(n: number, want = 5): number[] {
  if (n <= want) return [...Array(n).keys()];
  const out = new Set<number>([0, n - 1]);
  for (let i = 1; i < want - 1; i++) out.add(Math.round((i * (n - 1)) / (want - 1)));
  return [...out].sort((a, b) => a - b);
}

function Tooltip({ x, title, children }: { x: number; title: string; children: ReactNode }) {
  return (
    <div className="chart-tip" style={{ left: `${Math.min(82, Math.max(18, x))}%` }} role="status">
      <span className="chart-tip-title">{title}</span>
      {children}
    </div>
  );
}

/** The chart's real pixel width, so axis text stays 11px instead of scaling with the SVG. */
function useWidth(): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const H = 180;
const PAD = { l: 28, r: 8, t: 10, b: 22 };

/** One series over time: 2px line, faint area, crosshair + tooltip on hover/focus. */
export function LineChart({ data, unit }: { data: Point[]; unit: string }) {
  const [box, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (!data.length) return null;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (data.length === 1 ? iw / 2 : (i * iw) / (data.length - 1));
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join("");
  const area = `${line}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PAD.l) / iw) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="chart" ref={box} onPointerLeave={() => setHover(null)}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="chart-svg"
        onPointerMove={(e) => move(e.clientX)}
        tabIndex={0}
        role="img"
        aria-label={`${unit}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setHover((v) => Math.max(0, (v ?? data.length) - 1));
          if (e.key === "ArrowRight") setHover((v) => Math.min(data.length - 1, (v ?? -1) + 1));
        }}
        onBlur={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} />
            <text className="chart-axis" x={PAD.l - 6} y={y(max * f) + 4} textAnchor="end">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <path className="chart-area" d={area} />
        <path className="chart-line" d={line} />
        {tickIdx(data.length).map((i) => (
          <text key={i} className="chart-axis" x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}>
            {data[i]!.label}
          </text>
        ))}
        {/* The latest value is labelled directly: it is the number a lead looks for. */}
        <circle className="chart-dot" cx={x(data.length - 1)} cy={y(data[data.length - 1]!.value)} r={4} />
        {h && hover !== null && (
          <>
            <line className="chart-cross" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} />
            <circle className="chart-dot" cx={x(hover)} cy={y(h.value)} r={4} />
          </>
        )}
      </svg>
      {h && hover !== null && (
        <Tooltip x={(x(hover) / W) * 100} title={h.full}>
          <span className="chart-tip-row">
            <i className="key-line" />
            <b>{h.value}</b> {unit}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

/** Vertical bars, one per day; each bar is its own hover/focus target. */
export function BarsChart({ data, unit }: { data: Point[]; unit: string }) {
  const [box, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = iw / data.length;
  const bw = Math.max(3, Math.min(28, slot - 2)); // 2px surface gap between bars
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="chart" ref={box} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`${unit}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} />
            <text className="chart-axis" x={PAD.l - 6} y={y(max * f) + 4} textAnchor="end">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.l + slot * i + slot / 2;
          const top = y(d.value);
          const bh = PAD.t + ih - top;
          const r = Math.min(4, bw / 2, bh);
          return (
            <g
              key={i}
              className={`chart-bar${hover === i ? " on" : ""}`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${d.full}: ${d.value} ${unit}`}
            >
              {/* Hit area: the whole column, wider than the bar. */}
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} fill="transparent" />
              {d.value > 0 && (
                <path
                  d={`M${cx - bw / 2},${PAD.t + ih}V${top + r}q0,-${r} ${r},-${r}H${cx + bw / 2 - r}q${r},0 ${r},${r}V${PAD.t + ih}Z`}
                  className="chart-bar-fill"
                />
              )}
            </g>
          );
        })}
        {tickIdx(data.length).map((i) => (
          <text
            key={i}
            className="chart-axis"
            x={PAD.l + slot * i + slot / 2}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
          >
            {data[i]!.label}
          </text>
        ))}
      </svg>
      {h && hover !== null && (
        <Tooltip x={((PAD.l + slot * hover + slot / 2) / W) * 100} title={h.full}>
          <span className="chart-tip-row">
            <i className="key-box" />
            <b>{h.value}</b> {unit}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  tone: "ok" | "accent" | "high" | "neutral";
}

/** A 100% bar split by status with 2px gaps; each segment has its own tooltip. */
export function StackBar({ segments, name }: { segments: Segment[]; name: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((n, s) => n + s.value, 0);
  if (!total) return <span className="stack-bar empty" />;
  let acc = 0;
  const h = segments.find((s) => s.key === hover);
  return (
    <span className="stack-bar-wrap" onPointerLeave={() => setHover(null)}>
      <span className="stack-bar">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const left = acc;
            acc += s.value;
            return (
              <span
                key={s.key}
                className={`seg t-${s.tone}${hover === s.key ? " on" : ""}`}
                style={{ flexGrow: s.value }}
                data-left={left}
                tabIndex={0}
                aria-label={`${name} · ${s.label}: ${s.value}`}
                onPointerEnter={() => setHover(s.key)}
                onFocus={() => setHover(s.key)}
                onBlur={() => setHover(null)}
              />
            );
          })}
      </span>
      {h && (
        <Tooltip x={50} title={name}>
          <span className="chart-tip-row">
            <i className={`key-box t-${h.tone}`} />
            <b>{h.value}</b> {h.label}
          </span>
        </Tooltip>
      )}
    </span>
  );
}
