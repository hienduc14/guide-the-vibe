import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";

export interface GNode {
  id: string;
  label: string;
  /** Radius in px before zoom. */
  r: number;
  color: string;
  /** Ring colour, e.g. someone is editing here or there is a conflict. */
  ring?: string;
  /** Small text under the label (who works here). */
  note?: string;
  /** Fixed column for layered layouts: -1 left, 0 middle, 1 right. */
  column?: number;
  title?: string;
}

export interface GEdge {
  source: string;
  target: string;
  weight?: number;
  dashed?: boolean;
}

interface Pos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Paths keep their last two parts ("src/app/routes/article" → "routes/article"); the full id stays in the hover title. */
function shortLabel(label: string): string {
  const parts = label.split("/").filter(Boolean);
  const short = parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : label;
  return short.length > 28 ? `${short.slice(0, 27)}…` : short;
}

const W = 1000;
const H = 640;

/** Force-directed layout, run to rest before drawing (graphs here stay under a few hundred nodes). */
function forceLayout(nodes: GNode[], edges: GEdge[]): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  const n = nodes.length;
  nodes.forEach((node, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const rad = 120 + 6 * Math.sqrt(n) * 10 * ((i % 3) / 3 + 0.5);
    pos.set(node.id, { x: W / 2 + Math.cos(a) * rad, y: H / 2 + Math.sin(a) * rad, vx: 0, vy: 0 });
  });
  const links = edges.filter((e) => pos.has(e.source) && pos.has(e.target) && e.source !== e.target);
  const ideal = n > 60 ? 70 : 110;
  const radius = new Map(nodes.map((x) => [x.id, x.r]));
  for (let tick = 0; tick < 320; tick++) {
    const alpha = 1 - tick / 320;
    const list = [...pos.entries()];
    for (let i = 0; i < list.length; i++) {
      const [ia, a] = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const [ib, b] = list[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const min = (radius.get(ia) ?? 8) + (radius.get(ib) ?? 8) + 14;
        const f = (2400 / d2 + (d2 < min * min ? 2 : 0)) * alpha;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
    }
    for (const e of links) {
      const a = pos.get(e.source)!;
      const b = pos.get(e.target)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = ((d - ideal) / d) * 0.04 * alpha;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    for (const p of pos.values()) {
      p.vx += (W / 2 - p.x) * 0.004 * alpha;
      p.vy += (H / 2 - p.y) * 0.006 * alpha;
      p.x += Math.max(-30, Math.min(30, p.vx));
      p.y += Math.max(-30, Math.min(30, p.vy));
      p.vx *= 0.6;
      p.vy *= 0.6;
    }
  }
  return pos;
}

/** Columns left → right (callers, symbol, callees), nodes spread vertically. */
function columnLayout(nodes: GNode[]): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  for (const col of [-1, 0, 1]) {
    const inCol = nodes.filter((n) => (n.column ?? 0) === col);
    const gap = Math.min(70, (H - 80) / Math.max(1, inCol.length));
    inCol.forEach((n, i) => pos.set(n.id, { x: W / 2 + col * 230, y: H / 2 + (i - (inCol.length - 1) / 2) * gap, vx: 0, vy: 0 }));
  }
  return pos;
}

/**
 * An interactive node-link diagram: scroll to zoom, drag the background to pan, drag a node to move it,
 * hover to see its neighbours, click to select.
 */
export function GraphView({
  nodes,
  edges,
  layout = "force",
  selected,
  onSelect,
  height = 560,
}: {
  nodes: GNode[];
  edges: GEdge[];
  layout?: "force" | "columns";
  selected?: string;
  onSelect?: (id: string | undefined) => void;
  height?: number;
}) {
  const key = useMemo(() => nodes.map((n) => n.id).join("|") + "#" + edges.length + layout, [nodes, edges, layout]);
  const initial = useMemo(() => (layout === "columns" ? columnLayout(nodes) : forceLayout(nodes, edges)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pos, setPos] = useState(initial);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string>();
  const svg = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: height });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width || 800, h: e.contentRect.height || height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);
  // Frame the drawing around the laid-out nodes (with room for labels), stretched to the box's shape so the
  // graph fills the space instead of sitting small in the middle.
  const vb = useMemo(() => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of nodes) {
      const p = initial.get(n.id);
      if (!p) continue;
      x0 = Math.min(x0, p.x - n.r - 70);
      x1 = Math.max(x1, p.x + n.r + 70);
      y0 = Math.min(y0, p.y - n.r - 20);
      y1 = Math.max(y1, p.y + n.r + 40);
    }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, w: W, h: H };
    let w = Math.max(320, x1 - x0);
    let h = Math.max(220, y1 - y0);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const aspect = size.w / size.h;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [initial, nodes, size]);
  const drag = useRef<{ kind: "pan" | "node"; id?: string; x: number; y: number; moved: boolean } | undefined>(undefined);

  useEffect(() => {
    setPos(initial);
    setView({ x: 0, y: 0, k: 1 });
  }, [initial]);

  const focus = hover ?? selected;
  const neighbours = useMemo(() => {
    if (!focus) return undefined;
    const s = new Set([focus]);
    for (const e of edges) {
      if (e.source === focus) s.add(e.target);
      if (e.target === focus) s.add(e.source);
    }
    return s;
  }, [focus, edges]);

  const toGraph = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    const sx = vb.x + (clientX - r.left) * (vb.w / r.width);
    const sy = vb.y + (clientY - r.top) * (vb.h / r.height);
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };

  const onWheel = (e: WheelEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const sx = vb.x + (e.clientX - r.left) * (vb.w / r.width);
    const sy = vb.y + (e.clientY - r.top) * (vb.h / r.height);
    const k = Math.min(4, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setView({ k, x: sx - ((sx - view.x) * k) / view.k, y: sy - ((sy - view.y) * k) / view.k });
  };

  const down = (e: ReactPointerEvent, id?: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: id ? "node" : "pan", id, x: e.clientX, y: e.clientY, moved: false };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const r = svg.current!.getBoundingClientRect();
    const dx = (e.clientX - d.x) * (vb.w / r.width);
    const dy = (e.clientY - d.y) * (vb.h / r.height);
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    if (d.kind === "pan") {
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      d.x = e.clientX;
      d.y = e.clientY;
    } else if (d.id && d.moved) {
      const p = toGraph(e.clientX, e.clientY);
      setPos((m) => new Map(m).set(d.id!, { ...m.get(d.id!)!, x: p.x, y: p.y }));
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = undefined;
    if (d && !d.moved) onSelect?.(d.kind === "node" ? (d.id === selected ? undefined : d.id) : undefined);
  };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const maxW = Math.max(1, ...edges.map((e) => e.weight ?? 1));
  // Graph units per screen pixel: text is sized in screen pixels so labels stay 11px whatever the zoom or box size.
  const unit = vb.w / Math.max(1, size.w) / view.k;
  // With many nodes, only the biggest and the flagged ones keep a permanent label; the rest show on hover.
  const labelled = useMemo(() => {
    if (nodes.length <= 14) return undefined;
    const keep = new Set(nodes.filter((n) => n.ring || n.note).map((n) => n.id));
    for (const n of [...nodes].sort((a, b) => b.r - a.r).slice(0, 10)) keep.add(n.id);
    return keep;
  }, [nodes]);

  return (
    <div className="graphview" style={{ height }} ref={box}>
      <svg
        ref={svg}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={(e) => down(e)}
        onPointerMove={move}
        onPointerUp={up}
        role="img"
        aria-label="Sơ đồ code"
      >
        <defs>
          <marker
            id="gv-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="11"
            markerHeight="11"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="gv-arrowhead" />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {edges.map((e, i) => {
            const a = pos.get(e.source);
            const b = pos.get(e.target);
            const tb = byId.get(e.target);
            if (!a || !b || !tb) return null;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const end = { x: b.x - (dx / d) * (tb.r + 3), y: b.y - (dy / d) * (tb.r + 3) };
            const on = !neighbours || (neighbours.has(e.source) && neighbours.has(e.target) && (e.source === focus || e.target === focus));
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={end.x}
                y2={end.y}
                className={`gv-edge${on ? (neighbours ? " hot" : "") : " dim"}${e.dashed ? " dashed" : ""}`}
                strokeWidth={1 + 2.5 * ((e.weight ?? 1) / maxW)}
                markerEnd="url(#gv-arrow)"
              />
            );
          })}
          {nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const dim = neighbours && !neighbours.has(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                className={`gv-node${dim ? " dim" : ""}${n.id === selected ? " selected" : ""}`}
                onPointerDown={(e) => down(e, n.id)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(undefined)}
              >
                <title>{n.title ?? n.label}</title>
                {n.ring && <circle r={n.r + 5} fill="none" stroke={n.ring} strokeWidth={3} />}
                <circle r={n.r} fill={n.color} className="gv-dot" />
                {(!labelled || labelled.has(n.id) || neighbours?.has(n.id)) && (
                  <text y={n.r + 14 * unit} textAnchor="middle" className="gv-label" style={{ fontSize: 11 * unit, strokeWidth: 3 * unit }}>
                    {shortLabel(n.label)}
                  </text>
                )}
                {n.note && (
                  <text y={n.r + 27 * unit} textAnchor="middle" className="gv-note" fill={n.ring} style={{ fontSize: 10.5 * unit, strokeWidth: 3 * unit }}>
                    {n.note}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="graphview-tools">
        <button type="button" className="btn sm" onClick={() => setView((v) => ({ ...v, k: Math.min(4, v.k * 1.25) }))} aria-label="Phóng to">
          +
        </button>
        <button type="button" className="btn sm" onClick={() => setView((v) => ({ ...v, k: Math.max(0.3, v.k / 1.25) }))} aria-label="Thu nhỏ">
          −
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            setView({ x: 0, y: 0, k: 1 });
            setPos(initial);
          }}
        >
          Đặt lại
        </button>
      </div>
    </div>
  );
}

/** A stable, readable colour per group name (top-level folder, language…). */
export function groupColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 58%)`;
}
