import { useMemo, useState } from "react";
import { api } from "../../api/endpoints";
import type { CallMap, Level, MapNode, StructureMap } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { Card } from "../../components/Card";
import { Loading, Empty } from "../../components/Empty";
import { Segmented } from "../../components/Segmented";
import { Badge, LevelBadge } from "../../components/Badge";
import { GraphView, groupColor, type GEdge, type GNode } from "../../components/GraphView";

type Mode = "dir" | "file" | "calls";

const RANK: Record<Level, number> = { info: 0, warning: 1, high: 2, critical: 3 };
const RING = { conflict: "var(--high)", editing: "var(--accent)", scoped: "var(--warning)" };

const top = (id: string) => (id === "(root)" ? id : id.split("/").slice(0, 2).join("/"));
const worst = (levels: Level[]) => levels.reduce<Level | undefined>((m, l) => (!m || RANK[l] > RANK[m] ? l : m), undefined);

function structureNodes(map: StructureMap): { nodes: GNode[]; edges: GEdge[] } {
  const max = Math.max(1, ...map.nodes.map((n) => n.symbols));
  const nodes = map.nodes.map((n): GNode => {
    const w = worst(n.conflicts);
    const ring = w && RANK[w] >= RANK.warning ? RING.conflict : n.editing.length ? RING.editing : n.scoped.length ? RING.scoped : undefined;
    const people = [...new Set([...n.editing, ...n.scoped])];
    return {
      id: n.id,
      label: n.label,
      r: map.level === "dir" ? 8 + 18 * Math.sqrt(n.symbols / max) : 5 + 10 * Math.sqrt(n.symbols / max),
      color: groupColor(map.level === "dir" ? n.id : top(n.id)),
      ring,
      note: people.length ? people.join(", ") : undefined,
      title: `${n.id}\n${n.files} file · ${n.symbols} symbol${people.length ? `\nĐang làm: ${people.join(", ")}` : ""}${w ? `\nConflict: ${w}` : ""}`,
    };
  });
  return { nodes, edges: map.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight })) };
}

function callNodes(map: CallMap): { nodes: GNode[]; edges: GEdge[] } {
  const color = { center: "var(--accent)", caller: "hsl(28 70% 55%)", callee: "hsl(160 45% 45%)" };
  return {
    nodes: map.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      r: n.role === "center" ? 16 : 9,
      color: color[n.role],
      column: n.role === "caller" ? -1 : n.role === "center" ? 0 : 1,
      title: `${n.label} (${n.kind})\n${n.path}:${n.line}${n.sig ? `\n${n.sig}` : ""}`,
    })),
    edges: map.edges.map((e) => ({ source: e.source, target: e.target, dashed: e.confidence === "name" })),
  };
}

function NodePanel({ node, map, onOpenFiles }: { node: MapNode; map: StructureMap; onOpenFiles: (dir: string) => void }) {
  const out = map.edges.filter((e) => e.source === node.id).sort((a, b) => b.weight - a.weight);
  const inc = map.edges.filter((e) => e.target === node.id).sort((a, b) => b.weight - a.weight);
  const w = worst(node.conflicts);
  return (
    <div className="stack tight">
      <b className="mono wrap-anywhere">{node.id}</b>
      <span className="xs muted">
        {node.files} file · {node.symbols} hàm/class{node.lang ? ` · ${node.lang}` : ""}
      </span>
      {(node.editing.length > 0 || node.scoped.length > 0) && (
        <span className="small">
          {node.editing.length > 0 && (
            <>
              Đang sửa: <b>{node.editing.join(", ")}</b>.{" "}
            </>
          )}
          {node.scoped.length > 0 && (
            <>
              Đã đăng ký: <b>{node.scoped.join(", ")}</b>.
            </>
          )}
        </span>
      )}
      {w && (
        <span className="row" style={{ gap: 6 }}>
          <LevelBadge level={w} />
          <span className="xs muted">{node.conflicts.length} conflict đang mở ở đây</span>
        </span>
      )}
      <span className="label-caps" style={{ marginTop: 8 }}>
        Dùng tới ({out.length})
      </span>
      {out.slice(0, 8).map((e) => (
        <span key={e.target} className="xs mono">
          → {e.target} <span className="faint">×{e.weight}</span>
        </span>
      ))}
      <span className="label-caps" style={{ marginTop: 8 }}>
        Được dùng bởi ({inc.length})
      </span>
      {inc.slice(0, 8).map((e) => (
        <span key={e.source} className="xs mono">
          ← {e.source} <span className="faint">×{e.weight}</span>
        </span>
      ))}
      {node.kind === "dir" && (
        <button className="btn sm" type="button" style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={() => onOpenFiles(node.id)}>
          Xem các file trong module
        </button>
      )}
    </div>
  );
}

/** The project's structure as a picture: modules and their dependencies, files, or the calls around one function. */
export function CodeMap({ projectId, view }: { projectId: string; view: string }) {
  const [mode, setMode] = useState<Mode>("dir");
  const [focus, setFocus] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [q, setQ] = useState("");
  const [symbol, setSymbol] = useState("");
  const structure = usePoll(
    () => (mode === "calls" ? Promise.resolve(undefined) : api.graph.map(projectId, view, mode, mode === "file" ? focus : undefined)),
    [projectId, view, mode, focus],
    30_000,
  );
  const calls = usePoll(
    () => (mode === "calls" && symbol ? api.graph.calls(projectId, symbol, view) : Promise.resolve(undefined)),
    [projectId, view, mode, symbol],
    0,
  );

  const drawn = useMemo(() => {
    if (mode === "calls") return calls.data ? callNodes(calls.data) : undefined;
    return structure.data ? structureNodes(structure.data) : undefined;
  }, [mode, structure.data, calls.data]);

  const node = mode !== "calls" ? structure.data?.nodes.find((n) => n.id === selected) : undefined;
  const callNode = mode === "calls" ? calls.data?.nodes.find((n) => n.id === selected) : undefined;
  const people = new Set(structure.data?.nodes.flatMap((n) => [...n.editing, ...n.scoped]) ?? []);

  return (
    <Card
      title={
        <div>
          <h3
            title={
              mode === "dir"
                ? "Mỗi chấm là một module, to nhỏ theo số hàm/class; mũi tên là import."
                : mode === "file"
                  ? "Mỗi chấm là một file; mũi tên là import."
                  : "Trái: nơi gọi · giữa: hàm · phải: những gì nó gọi. Nét đứt: chỉ khớp theo tên."
            }
          >
            Sơ đồ code
          </h3>
        </div>
      }
      actions={
        <Segmented<Mode>
          value={mode}
          onChange={(m) => {
            setMode(m);
            setSelected(undefined);
            if (m !== "file") setFocus(undefined);
          }}
          options={[
            { value: "dir", label: "Module" },
            { value: "file", label: "File" },
            { value: "calls", label: "Gọi hàm" },
          ]}
        />
      }
    >
      <div className="stack">
        {mode === "calls" && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              setSymbol(q.trim());
              setSelected(undefined);
            }}
          >
            <input
              className="input mono"
              style={{ flex: 1 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tên hàm hoặc Class.method, ví dụ OrderService.refund"
            />
            <button className="btn primary" type="submit" disabled={!q.trim()}>
              Vẽ
            </button>
          </form>
        )}
        {mode === "file" && (
          <div className="row">
            {focus ? (
              <>
                <span className="small">
                  Đang xem <b className="mono">{focus}</b> và các file liên quan trực tiếp
                </span>
                <button className="btn sm ghost" type="button" onClick={() => setFocus(undefined)}>
                  Xem tất cả
                </button>
              </>
            ) : (
              structure.data?.truncated && <span className="xs muted">Chỉ hiện các file nhiều liên kết nhất.</span>
            )}
          </div>
        )}
        {people.size > 0 && mode !== "calls" && (
          <div className="row" style={{ gap: 12 }}>
            <span className="xs muted">Chú thích:</span>
            <span className="legend">
              <i style={{ borderColor: RING.editing }} /> đang sửa
            </span>
            <span className="legend">
              <i style={{ borderColor: RING.scoped }} /> đã đăng ký
            </span>
            <span className="legend">
              <i style={{ borderColor: RING.conflict }} /> conflict
            </span>
          </div>
        )}
        <div className="codemap">
          <div className="codemap-canvas">
            {mode === "calls" && !symbol ? (
              <Empty>Nhập tên hàm.</Empty>
            ) : !drawn ? (
              <Loading />
            ) : drawn.nodes.length === 0 ? (
              <Empty>{mode === "calls" ? `Không tìm thấy symbol “${symbol}”.` : "Code graph chưa có file nào. Chờ server đồng bộ repo."}</Empty>
            ) : (
              <GraphView nodes={drawn.nodes} edges={drawn.edges} layout={mode === "calls" ? "columns" : "force"} selected={selected} onSelect={setSelected} />
            )}
          </div>
          <aside className="codemap-side">
            {node && structure.data ? (
              <NodePanel
                node={node}
                map={structure.data}
                onOpenFiles={(dir) => {
                  setMode("file");
                  setFocus(dir);
                  setSelected(undefined);
                }}
              />
            ) : callNode ? (
              <div className="stack tight">
                <b className="mono wrap-anywhere">{callNode.label}</b>
                <span className="xs mono muted">
                  {callNode.path}:{callNode.line}
                </span>
                <Badge>{callNode.kind}</Badge>
                {callNode.sig && <code className="xs wrap-anywhere">{callNode.sig}</code>}
                {callNode.role !== "center" && callNode.kind !== "module" && (
                  <button
                    className="btn sm"
                    type="button"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => {
                      setQ(callNode.id);
                      setSymbol(callNode.id);
                      setSelected(undefined);
                    }}
                  >
                    Vẽ quanh hàm này
                  </button>
                )}
              </div>
            ) : (
              <span className="xs muted">
                Bấm một chấm để xem chi tiết. Cuộn để phóng to, kéo nền để di chuyển, kéo chấm để sắp xếp lại, rê chuột để làm nổi các liên kết.
              </span>
            )}
          </aside>
        </div>
      </div>
    </Card>
  );
}
