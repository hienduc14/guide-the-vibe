// Hiện trường: who is working on what, drawn as threads from each agent to the files it touches,
// with what needs a person and today's digest beside it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, CircleHelp, Clock, Folder, Send, Sparkles, UserX, X, Zap, OctagonAlert, CalendarClock } from "lucide-react";
import { api } from "../../api/endpoints";
import type { AttentionItem, Incident, TeamState } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useColorOf } from "../../hooks/usePeople";
import { useProject } from "./ProjectLayout";
import { Av, Avs, Seg, State, base, dirOf } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { fileIncident, incidentTitle, isHot } from "../../lib/incident";
import { KIND_VI } from "../../components/Message";
import { NOTE_TAG } from "../../components/Message";
import { ago, clock } from "../../lib/format";

const RECENT_MS = 30 * 60_000;
const MAX_FILES = 12;

type Touch = "editing" | "edited" | "declared";
interface AgentCard {
  ws: string;
  dev: string;
  agent: string | null;
  status: string | null;
  last_seen: string | null;
  branch: string | null;
  task?: TeamState["tasks"][number];
}
interface FileRow {
  path: string;
  touches: { ws: string; dev: string; agent: string | null; state: Touch; n: number; last: string | null }[];
  inc?: Incident;
}

const isFile = (v: string) => !v.includes("*") && !v.endsWith("/") && /\.[a-z0-9]+$/i.test(v);
const STATUS_RANK: Record<string, number> = { active: 2, idle: 1, ended: 0 };

/** Agents = workspaces with a live session or open registration; files = what they edited or declared. */
export function buildMap(s: TeamState, incidents: Incident[], now = Date.now()) {
  const agents = new Map<string, AgentCard>();
  const wsOf = new Map(s.workspaces.map((w) => [w.id, w]));
  const sessionOf = new Map(s.sessions.map((x) => [x.id, x]));
  for (const x of s.sessions) {
    if (x.status === "ended") continue;
    const cur = agents.get(x.workspace_id);
    if (!cur || STATUS_RANK[x.status] > STATUS_RANK[cur.status ?? "ended"])
      agents.set(x.workspace_id, {
        ws: x.workspace_id,
        dev: x.dev,
        agent: x.agent,
        status: x.status,
        last_seen: x.last_seen,
        branch: wsOf.get(x.workspace_id)?.branch ?? null,
        task: cur?.task,
      });
  }
  for (const t of s.tasks) {
    const sess = sessionOf.get(t.session_id);
    const cur = agents.get(t.workspace_id) ?? {
      ws: t.workspace_id,
      dev: t.dev,
      agent: sess?.agent ?? null,
      status: sess?.status ?? null,
      last_seen: sess?.last_seen ?? null,
      branch: wsOf.get(t.workspace_id)?.branch ?? null,
    };
    if (!cur.task || t.updated_at > cur.task.updated_at) cur.task = t;
    agents.set(t.workspace_id, cur);
  }
  const files = new Map<string, FileRow>();
  const touch = (path: string, ws: string, dev: string, agent: string | null, state: Touch, n: number, last: string | null) => {
    const f = files.get(path) ?? { path, touches: [] };
    const prev = f.touches.find((t) => t.ws === ws);
    if (prev) {
      if (state !== "declared") Object.assign(prev, { state, n, last });
    } else f.touches.push({ ws, dev, agent, state, n, last });
    files.set(path, f);
  };
  for (const t of s.tasks)
    for (const r of t.resources)
      if (r.kind === "path" && isFile(r.value)) touch(r.value, t.workspace_id, t.dev, agents.get(t.workspace_id)?.agent ?? null, "declared", 0, null);
  for (const fp of s.footprints) {
    // A workspace with edits but no live session or open work shows on the file only (no card, no thread).
    touch(
      fp.path,
      fp.workspace_id,
      fp.dev,
      sessionOf.get(fp.session_id)?.agent ?? null,
      now - Date.parse(fp.last_at) < RECENT_MS ? "editing" : "edited",
      fp.count,
      fp.last_at,
    );
  }
  const rows = [...files.values()].map((f) => ({ ...f, inc: fileIncident(incidents, f.path) }));
  const rank = (f: FileRow) =>
    f.inc ? (isHot(f.inc.level) ? 0 : 1) : f.touches.some((t) => t.state === "editing") ? 2 : f.touches.some((t) => t.state === "edited") ? 3 : 4;
  rows.sort((a, b) => rank(a) - rank(b) || b.touches.length - a.touches.length || a.path.localeCompare(b.path));
  return {
    agents: [...agents.values()].sort((a, b) => STATUS_RANK[b.status ?? "ended"] - STATUS_RANK[a.status ?? "ended"] || a.dev.localeCompare(b.dev)),
    files: rows,
  };
}

function fileNote(f: FileRow): string | undefined {
  if (!f.inc) return undefined;
  const label = isHot(f.inc.level) ? "đụng nhau" : "cần để ý";
  return `${label}: ${incidentTitle(f.inc).replace(/^Gộp code sẽ lỗi ở .*/, "gộp code sẽ lỗi")}`;
}

function Wires({
  map,
  lit,
  files,
  agents,
}: {
  map: React.RefObject<HTMLDivElement>;
  lit: { kind: "who" | "file"; id: string } | null;
  files: FileRow[];
  agents: AgentCard[];
}) {
  const colorOf = useColorOf();
  const [paths, setPaths] = useState<
    { key: string; d: string; ws: string; file: string; cls: string; color: string; a: [number, number]; b: [number, number] }[]
  >([]);
  useLayoutEffect(() => {
    const el = map.current;
    if (!el) return;
    const draw = () => {
      const R = el.getBoundingClientRect();
      const out: typeof paths = [];
      const incoming: Record<string, number> = {};
      for (const a of agents) {
        const card = el.querySelector<HTMLElement>(`.agent[data-ws="${CSS.escape(a.ws)}"]`);
        if (!card || !card.offsetParent) continue;
        const ar = card.getBoundingClientRect();
        const mine = files.filter((f) => f.touches.some((t) => t.ws === a.ws));
        mine.forEach((f, i) => {
          const fe = el.querySelector<HTMLElement>(`.file[data-file="${CSS.escape(f.path)}"]`);
          if (!fe || !fe.offsetParent) return;
          const t = f.touches.find((x) => x.ws === a.ws)!;
          const fr = fe.getBoundingClientRect();
          const k = (incoming[f.path] = (incoming[f.path] ?? -1) + 1);
          const spread = Math.min(7, (ar.height - 28) / Math.max(1, mine.length));
          const x1 = ar.right - R.left;
          const y1 = ar.top - R.top + ar.height / 2 + (i - (mine.length - 1) / 2) * spread;
          const x2 = fr.left - R.left;
          const y2 = fr.top - R.top + fr.height / 2 + (k - (f.touches.length - 1) / 2) * 5;
          const dx = (x2 - x1) * 0.55;
          out.push({
            key: `${a.ws}|${f.path}`,
            d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
            ws: a.ws,
            file: f.path,
            cls: `${t.state}${f.inc && isHot(f.inc.level) && t.state !== "declared" ? " hot" : ""}`,
            color: colorOf(a.dev),
            a: [x1, y1],
            b: [x2, y2],
          });
        });
      }
      setPaths(out);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    void document.fonts?.ready.then(draw);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, agents]);
  const on = (p: (typeof paths)[number]) => !lit || (lit.kind === "who" ? p.ws === lit.id : p.file === lit.id);
  return (
    <svg className="wires" aria-hidden="true">
      {paths.map((p) => (
        <g key={p.key} style={{ ["--p" as string]: p.color }} className={on(p) ? "lit" : ""}>
          <path className={p.cls} d={p.d} />
          <circle cx={p.a[0]} cy={p.a[1]} r={2.5} />
          <circle cx={p.b[0]} cy={p.b[1]} r={2.5} />
        </g>
      ))}
    </svg>
  );
}

function NeedRow({ a, projectId }: { a: AttentionItem; projectId: string }) {
  const icon =
    a.kind === "conflict" ? (
      <Zap />
    ) : a.kind === "question" ? (
      <CircleHelp />
    ) : a.kind === "unassigned" ? (
      <UserX />
    ) : a.kind === "overdue" ? (
      <CalendarClock />
    ) : a.kind === "blocked" ? (
      <OctagonAlert />
    ) : (
      <Clock />
    );
  const title =
    a.kind === "conflict" && a.conflict
      ? `${a.conflict.dev_a} và ${a.conflict.dev_b} đụng nhau`
      : a.kind === "question" && a.ticket
        ? `${a.ticket.from_dev} hỏi ${a.ticket.to_dev ?? "một người"}`
        : a.title;
  const sub = a.kind === "conflict" && a.conflict ? `${KIND_VI[a.conflict.kind] ?? a.conflict.kind}` : a.detail;
  return (
    <Link className="need" to={`/p/${projectId}/inbox?i=${encodeURIComponent(a.ref)}`}>
      <span className={`ic ${a.kind === "conflict" ? "" : a.kind === "question" ? "q" : "t"}`}>{icon}</span>
      <b>{title}</b>
      <small>{sub}</small>
      <span className="go">
        <ChevronRight />
      </span>
    </Link>
  );
}

function SideHome({ attention }: { attention: AttentionItem[] | undefined }) {
  const { id } = useProject();
  const digest = usePoll(() => api.projects.digest(id), [id], 60_000);
  const d = digest.data?.digest;
  const shown = attention?.slice(0, 4) ?? [];
  return (
    <>
      <div className="panel">
        <h3>
          Cần người xử lý
          {attention && attention.length > 0 && (
            <Link className="all" to={`/p/${id}/inbox`}>
              Xem cả {attention.length}
            </Link>
          )}
        </h3>
        {!attention ? (
          <Loading />
        ) : shown.length ? (
          shown.map((a) => <NeedRow key={`${a.kind}:${a.ref}`} a={a} projectId={id} />)
        ) : (
          <p className="muted">Không có gì đang chờ.</p>
        )}
        {attention && attention.length > shown.length && (
          <p className="faint" style={{ padding: "8px 10px 0" }}>
            và {attention.length - shown.length} mục khác
          </p>
        )}
      </div>
      {d && (
        <div className="panel">
          <h3>
            Hôm nay
            <span className="byai">
              <Sparkles />
              AI tóm tắt lúc {clock(d.at)}
            </span>
          </h3>
          <p className="muted" style={{ marginBottom: 8 }}>
            {d.text}
          </p>
          {d.detail.length > 0 && (
            <ul className="digest">
              {d.detail.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function SideWho({ a, onClose }: { a: AgentCard; onClose: () => void }) {
  const { id } = useProject();
  const { can } = useAuth();
  const run = useAction();
  const [text, setText] = useState("");
  const boardId = a.task?.board_id ?? undefined;
  const board = usePoll(() => (boardId ? api.board.get(id, boardId) : Promise.resolve(undefined)), [id, boardId], 15_000);
  const notes = board.data?.notes.filter((n) => n.kind === "note" && n.author === a.dev).slice(-2) ?? [];
  const t = a.task;
  return (
    <div className="panel">
      <div className="dhead">
        <Av who={a.dev} agent={a.agent} size="lg" />
        <div>
          <h2>{a.dev}</h2>
          <div className="muted">
            <State status={a.status} />
          </div>
        </div>
        <button type="button" className="iconbtn x" onClick={onClose} aria-label="Đóng">
          <X />
        </button>
      </div>
      <dl className="p-kv">
        <dt>Việc</dt>
        <dd>{boardId ? <Link to={`/p/${id}/work?task=${boardId}`}>{t?.title}</Link> : (t?.title ?? <span className="faint">Chưa nói đang làm gì</span>)}</dd>
        {a.branch && (
          <>
            <dt>Nhánh</dt>
            <dd className="mono">{a.branch}</dd>
          </>
        )}
        {a.last_seen && (
          <>
            <dt>Thấy lần cuối</dt>
            <dd>{ago(a.last_seen)}</dd>
          </>
        )}
      </dl>
      {t?.goal && (
        <div className="block">
          <span className="sect">Mục tiêu agent đã đăng ký</span>
          <p>{t.goal}</p>
        </div>
      )}
      {t && t.resources.length > 0 && (
        <div className="block">
          <span className="sect">Phạm vi đã đăng ký</span>
          <div className="scope">
            {t.resources.map((r, i) => (
              <span key={i} className="p-chip" title={r.op}>
                {r.kind === "contract" ? `API: ${r.value}` : r.value}
              </span>
            ))}
          </div>
        </div>
      )}
      {notes.length > 0 && (
        <div className="block">
          <span className="sect">Agent ghi lại gần đây</span>
          <ul className="tl">
            {notes.map((n) => (
              <li key={n.id}>
                <span />
                <div className="h">
                  <span className="p-chip">{NOTE_TAG[n.tag ?? "progress"]?.label ?? "ghi chú"}</span>
                  {ago(n.created_at)}
                </div>
                <p>{n.summary ?? n.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {can("manager") && (
        <form
          className="block"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.projects.message(id, a.dev, text, boardId), `Đã gửi. Agent của ${a.dev} sẽ đọc ở lượt kế tiếp`)) setText("");
          }}
        >
          <label className="sect" htmlFor={`note-${a.ws}`}>
            Nhắn vào agent của {a.dev}
          </label>
          <textarea
            id={`note-${a.ws}`}
            className="p-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ví dụ: dừng sửa auth.service.ts, đợi hien đẩy xong"
          />
          <div className="acts" style={{ marginTop: 8 }}>
            <button className="p-btn primary" type="submit" disabled={!text.trim()}>
              <Send />
              Gửi
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function NowPage() {
  const { id, detail, openFile } = useProject();
  const state = usePoll(() => api.projects.state(id), [id], 5000);
  const incs = usePoll(() => api.incidents.list(id), [id], 5000);
  const attention = usePoll(() => api.projects.attention(id), [id], 5000);
  const [only, setOnly] = useState<"all" | "hot">("all");
  const [detailMode, setDetailMode] = useState<"short" | "long">("short");
  const [showAll, setShowAll] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<{ kind: "who" | "file"; id: string } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const colorOf = useColorOf();

  const m = useMemo(() => (state.data && incs.data ? buildMap(state.data, incs.data) : null), [state.data, incs.data]);
  useEffect(() => {
    if (sel && m && !m.agents.some((a) => a.ws === sel)) setSel(null);
  }, [m, sel]);
  if (!m) return <Loading />;

  const filtered = m.files.filter((f) => only === "all" || f.inc);
  const files = showAll ? filtered : filtered.slice(0, MAX_FILES);
  const shownWs = new Set(files.flatMap((f) => f.touches.map((t) => t.ws)));
  const agents = only === "hot" ? m.agents.filter((a) => shownWs.has(a.ws)) : m.agents;
  const groups = new Map<string, FileRow[]>();
  for (const f of files) groups.set(dirOf(f.path), [...(groups.get(dirOf(f.path)) ?? []), f]);
  const running = m.agents.filter((a) => a.status === "active").length;
  const idle = m.agents.filter((a) => a.status === "idle").length;
  const hot = (incs.data ?? []).filter((i) => i.status === "open" && isHot(i.level)).length;
  const asking = (attention.data ?? []).filter((a) => a.kind === "question").length;
  const hidden = Math.max(0, detail.graph.files - m.files.length);
  const lit = hover ?? (sel ? { kind: "who" as const, id: sel } : null);
  const litFiles = lit?.kind === "who" ? new Set(m.files.filter((f) => f.touches.some((t) => t.ws === lit.id)).map((f) => f.path)) : null;
  const litWs = lit?.kind === "file" ? new Set(m.files.find((f) => f.path === lit.id)?.touches.map((t) => t.ws)) : null;
  const selected = m.agents.find((a) => a.ws === sel);

  return (
    <>
      <div className="head">
        <div>
          <h1>Ai đang làm gì</h1>
          <p className="lead">
            <b>{running} agent</b> đang chạy{idle ? `, ${idle} tạm nghỉ` : ""}.{" "}
            {hot ? <span className="p-hot">{hot} chỗ đang đụng nhau</span> : "Không có chỗ nào đang đụng nhau"}
            {asking ? `, ${asking} câu hỏi chờ người quyết.` : "."}
          </p>
        </div>
        <div className="tools">
          <Seg
            label="Lọc sơ đồ"
            value={only}
            onChange={setOnly}
            options={[
              ["all", "Mọi file"],
              ["hot", "Chỉ chỗ đụng nhau"],
            ]}
          />
          <Seg
            label="Mức chi tiết"
            value={detailMode}
            onChange={setDetailMode}
            options={[
              ["short", "Gọn"],
              ["long", "Chi tiết"],
            ]}
          />
        </div>
      </div>
      <div className="now">
        <section className="panel">
          {agents.length === 0 && files.length === 0 ? (
            <div className="p-empty">
              <b>Chưa ai đang làm</b>
              Khi agent của một thành viên bắt đầu việc, nó hiện ở đây cùng các file nó sửa.
            </div>
          ) : (
            <div className="mapwrap">
              <div className={`map${detailMode === "long" ? " detail" : ""}${lit ? " focus" : ""}`} ref={mapRef} onMouseLeave={() => setHover(null)}>
                <Wires map={mapRef} lit={lit} files={files} agents={agents} />
                <div className="agents">
                  {agents.map((a) => {
                    const mine = m.files.filter((f) => f.touches.some((t) => t.ws === a.ws));
                    const bumps = [
                      ...new Set(
                        (incs.data ?? [])
                          .filter((i) => i.status === "open" && (i.workspace_a === a.ws || i.workspace_b === a.ws))
                          .map((i) => (i.workspace_a === a.ws ? i.dev_b : i.dev_a)),
                      ),
                    ];
                    const waits = (attention.data ?? []).some((x) => x.kind === "question" && x.ticket?.from_dev === a.dev);
                    const on = !lit || (lit.kind === "who" ? lit.id === a.ws : litWs?.has(a.ws));
                    return (
                      <button
                        type="button"
                        key={a.ws}
                        data-ws={a.ws}
                        className={`agent${sel === a.ws ? " sel" : ""}${on && lit ? " lit" : ""}`}
                        style={{ ["--p" as string]: colorOf(a.dev) }}
                        onMouseEnter={() => setHover({ kind: "who", id: a.ws })}
                        onFocus={() => setHover({ kind: "who", id: a.ws })}
                        onBlur={() => setHover(null)}
                        onClick={() => setSel(sel === a.ws ? null : a.ws)}
                      >
                        <Av who={a.dev} agent={a.agent} size="lg" />
                        <span className="p-who">
                          <b>{a.dev}</b>
                        </span>
                        <span className={`task${a.task ? "" : " none"}`}>{a.task?.title ?? "Chưa nói đang làm gì"}</span>
                        <span className="p-meta">
                          <State status={a.status} />
                          {bumps.length > 0 && <span className="bump">đụng {bumps.join(", ")}</span>}
                          {waits && <span>chờ trả lời</span>}
                        </span>
                        <span className="p-more">
                          {a.branch && <span className="mono">{a.branch}</span>} · {mine.length} file{a.last_seen ? ` · thấy lần cuối ${ago(a.last_seen)}` : ""}
                        </span>
                        <span className="inline-files">
                          {mine.map((f) => (
                            <span
                              key={f.path}
                              role="link"
                              tabIndex={0}
                              className={`p-chip mono${f.inc && isHot(f.inc.level) ? " clash" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openFile(f.path);
                              }}
                              onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), openFile(f.path))}
                            >
                              {base(f.path)}
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div />
                <div className="files">
                  {[...groups].map(([dir, list]) => (
                    <div key={dir} className="fgroup">
                      <div className="folder">
                        <Folder />
                        {dir}
                      </div>
                      {list.map((f) => {
                        const edits = f.touches.reduce((n, t) => n + t.n, 0);
                        const last = f.touches
                          .map((t) => t.last ?? "")
                          .sort()
                          .at(-1);
                        const on = !lit || (lit.kind === "file" ? lit.id === f.path : litFiles?.has(f.path));
                        return (
                          <button
                            type="button"
                            key={f.path}
                            data-file={f.path}
                            className={`file${f.inc ? (isHot(f.inc.level) ? " clash" : " watch") : ""}${on && lit ? " lit" : ""}`}
                            onMouseEnter={() => setHover({ kind: "file", id: f.path })}
                            onFocus={() => setHover({ kind: "file", id: f.path })}
                            onBlur={() => setHover(null)}
                            onClick={() => openFile(f.path)}
                            title={f.path}
                          >
                            <span>
                              <span className="fname">{base(f.path)}</span>
                              {f.inc && <span className="fsub">{fileNote(f)}</span>}
                              <span className="fsub sy">{edits ? `${edits} lần sửa${last ? ` · ${ago(last)}` : ""}` : "mới khai báo, chưa sửa"}</span>
                            </span>
                            <Avs people={f.touches.map((t) => ({ who: t.dev }))} />
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="p-legend">
            <span>
              <i />
              đang sửa
            </span>
            <span>
              <i className="thin" />
              đã sửa trước đó
            </span>
            <span>
              <i className="dots" />
              mới khai báo, chưa sửa
            </span>
            <span>
              <i className="box" />
              đụng nhau
            </span>
            <span className="p-right">
              {filtered.length > files.length ? (
                <button type="button" className="linkbtn" onClick={() => setShowAll(true)}>
                  Xem thêm {filtered.length - files.length} file
                </button>
              ) : (
                hidden > 0 && `${hidden} file chưa ai chạm tới được ẩn`
              )}
            </span>
          </div>
        </section>
        <aside className="side">{selected ? <SideWho a={selected} onClose={() => setSel(null)} /> : <SideHome attention={attention.data} />}</aside>
      </div>
    </>
  );
}
