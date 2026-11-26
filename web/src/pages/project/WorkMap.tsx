import { useState } from "react";
import { FileCode2, Network } from "lucide-react";
import type { Conflict, Session, TeamState } from "../../api/types";
import { Card } from "../../components/Card";
import { AvatarStack, DevAvatar, EmptyState, StatusDot, type Tone } from "../../components/Visual";
import { FileDialog } from "./FileDialog";

/*
 * Who is on which file: agents on the left, files on the right, a line for each "agent touches file".
 * Built from data gtv already has: footprints (files an agent edited), registered paths (files it said it
 * would edit) and open conflicts. A file two agents are on is red and comes first.
 */

const RECENT_MS = 30 * 60_000;
const AGENT_ROW = 64;
const FILE_ROW = 44;
const MAX_FILES = 12;

/** How an agent is linked to a file. */
type LinkKind = "editing" | "edited" | "declared";
/** What the lead needs to know about a file, worst first. */
export type FileStatus = "conflict" | "editing" | "edited" | "declared";

export const FILE_STATUS: Record<FileStatus, { label: string; tone: Tone; hint: string }> = {
  conflict: { label: "Xung đột", tone: "high", hint: "Từ hai người trở lên đang sửa file này" },
  editing: { label: "Đang sửa", tone: "accent", hint: "Có agent sửa file này trong 30 phút qua" },
  edited: { label: "Đã sửa", tone: "ok", hint: "Đã có thay đổi, agent không sửa thêm trong 30 phút qua" },
  declared: { label: "Đã khai báo", tone: "neutral", hint: "Agent nói sẽ sửa nhưng chưa chạm vào" },
};

interface AgentNode {
  ws: string;
  dev: string;
  agent: string;
  title?: string;
  status?: Session["status"];
}
interface FileNode {
  path: string;
  status: FileStatus;
  devs: { name: string; agent: string }[];
}
interface Edge {
  ws: string;
  path: string;
  kind: LinkKind;
  clash: boolean;
}

/** A registered path names one file (not a glob or a folder). */
const isFile = (v: string) => !v.includes("*") && !v.endsWith("/") && /\.[a-z0-9]+$/i.test(v);
const mentions = (c: Conflict, path: string) => c.subject === path || c.subject.startsWith(`${path}#`) || c.message.includes(path);

export function buildMap(s: TeamState, now = Date.now()) {
  const session = new Map(s.sessions.map((x) => [x.id, x]));
  const open = s.conflicts.filter((c) => c.status === "open" || c.status === "acked");
  const agents = new Map<string, AgentNode>();
  const edges = new Map<string, Edge>();
  const add = (ws: string, dev: string, agent: string) => {
    if (!agents.has(ws)) agents.set(ws, { ws, dev, agent });
    return agents.get(ws)!;
  };

  for (const x of s.sessions.filter((x) => x.status !== "ended")) add(x.workspace_id, x.dev, x.agent).status = x.status;
  for (const t of s.tasks) {
    const a = add(t.workspace_id, t.dev, session.get(t.session_id)?.agent ?? "other");
    a.title ??= t.title;
    a.status ??= session.get(t.session_id)?.status;
    for (const r of t.resources)
      if (r.kind === "path" && isFile(r.value) && !edges.has(`${t.workspace_id}|${r.value}`))
        edges.set(`${t.workspace_id}|${r.value}`, { ws: t.workspace_id, path: r.value, kind: "declared", clash: false });
  }
  for (const f of s.footprints) {
    add(f.workspace_id, f.dev, session.get(f.session_id)?.agent ?? "other");
    const kind: LinkKind = now - Date.parse(f.last_at) < RECENT_MS ? "editing" : "edited";
    edges.set(`${f.workspace_id}|${f.path}`, { ws: f.workspace_id, path: f.path, kind, clash: false });
  }

  const byFile = new Map<string, Edge[]>();
  for (const e of edges.values()) byFile.set(e.path, [...(byFile.get(e.path) ?? []), e]);
  const RANK: Record<FileStatus, number> = { conflict: 0, editing: 1, edited: 2, declared: 3 };
  const files: FileNode[] = [...byFile].map(([path, es]) => {
    const touched = es.filter((e) => e.kind !== "declared");
    const clash = touched.length >= 2 || (touched.length > 0 && open.some((c) => mentions(c, path)));
    if (clash) for (const e of touched) e.clash = true;
    const status: FileStatus = clash ? "conflict" : es.some((e) => e.kind === "editing") ? "editing" : touched.length ? "edited" : "declared";
    return { path, status, devs: es.map((e) => ({ name: agents.get(e.ws)!.dev, agent: agents.get(e.ws)!.agent })) };
  });
  files.sort((a, b) => RANK[a.status] - RANK[b.status] || b.devs.length - a.devs.length || a.path.localeCompare(b.path));
  return { agents: [...agents.values()], files, edges: [...edges.values()] };
}

function FileName({ path }: { path: string }) {
  const i = path.lastIndexOf("/");
  return (
    <span className="wm-name" title={path}>
      {i >= 0 && <span className="wm-dir">{path.slice(0, i + 1)}</span>}
      <b>{path.slice(i + 1)}</b>
    </span>
  );
}

type Focus = { kind: "agent" | "file"; key: string } | null;

export function WorkMap({ state, projectId }: { state: TeamState; projectId: string }) {
  const [focus, setFocus] = useState<Focus>(null);
  const [all, setAll] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const map = buildMap(state);
  const files = all ? map.files : map.files.slice(0, MAX_FILES);
  const shown = new Set(files.map((f) => f.path));
  const edges = map.edges.filter((e) => shown.has(e.path));
  const agents = map.agents.filter((a) => edges.some((e) => e.ws === a.ws));

  const title = (
    <h3 title="Mỗi đường nối là một agent đang chạm vào một file. Bấm vào file để xem thay đổi.">
      <Network />
      Ai đang sửa file nào
    </h3>
  );
  if (!files.length)
    return (
      <Card title={title}>
        <EmptyState icon={FileCode2} title="Chưa có file nào được sửa">
          Khi agent khai báo hoặc sửa file, file đó sẽ hiện ở đây và nối với người đang làm.
        </EmptyState>
      </Card>
    );

  const height = Math.max(agents.length * AGENT_ROW, files.length * FILE_ROW);
  const agentTop = (i: number) => (height - agents.length * AGENT_ROW) / 2 + i * AGENT_ROW;
  const fileTop = (i: number) => (height - files.length * FILE_ROW) / 2 + i * FILE_ROW;
  const agentIndex = new Map(agents.map((a, i) => [a.ws, i]));
  const fileIndex = new Map(files.map((f, i) => [f.path, i]));
  const lit = (e: Edge) => !focus || (focus.kind === "agent" ? e.ws === focus.key : e.path === focus.key);
  const counts = { conflict: 0, editing: 0, edited: 0, declared: 0 } as Record<FileStatus, number>;
  for (const f of map.files) counts[f.status]++;

  return (
    <Card
      title={title}
      actions={
        <span className="xs muted">
          {map.files.length} file
          {counts.conflict > 0 && <b style={{ color: "var(--high)" }}> · {counts.conflict} xung đột</b>}
        </span>
      }
    >
      <div className="wm-legend xs muted">
        <span>
          <i className="wm-line editing" /> đang sửa
        </span>
        <span>
          <i className="wm-line edited" /> đã sửa
        </span>
        <span>
          <i className="wm-line declared" /> mới khai báo
        </span>
        <span>
          <i className="wm-line clash" /> hai người cùng sửa
        </span>
      </div>
      <div className="wm" style={{ height }} onMouseLeave={() => setFocus(null)}>
        <div className="wm-col wm-agents">
          {agents.map((a, i) => (
            <div
              key={a.ws}
              className={`wm-agent${focus && !(focus.kind === "agent" && focus.key === a.ws) ? " dim" : ""}`}
              style={{ top: agentTop(i), height: AGENT_ROW }}
              onMouseEnter={() => setFocus({ kind: "agent", key: a.ws })}
            >
              <DevAvatar name={a.dev} agent={a.agent} size={32} />
              <span className="wm-agent-text">
                <b className="truncate">{a.dev}</b>
                <span className="xs muted truncate" title={a.title}>
                  {a.title ?? "Chưa đăng ký việc"}
                </span>
                {a.status && <StatusDot tone={a.status === "active" ? "ok" : "neutral"}>{a.status === "active" ? "Đang chạy" : "Tạm nghỉ"}</StatusDot>}
              </span>
            </div>
          ))}
        </div>
        <svg className="wm-lines" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden="true">
          {edges.map((e) => {
            const ya = agentTop(agentIndex.get(e.ws)!) + AGENT_ROW / 2;
            const yf = fileTop(fileIndex.get(e.path)!) + FILE_ROW / 2;
            return (
              <path
                key={`${e.ws}|${e.path}`}
                d={`M0,${ya} C50,${ya} 50,${yf} 100,${yf}`}
                className={`wm-edge ${e.clash ? "clash" : e.kind}${lit(e) ? "" : " dim"}`}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        <div className="wm-col wm-files">
          {files.map((f, i) => (
            <button
              key={f.path}
              type="button"
              className={`wm-file s-${f.status}${focus && !(focus.kind === "file" && focus.key === f.path) && !edges.some((e) => e.path === f.path && lit(e)) ? " dim" : ""}`}
              style={{ top: fileTop(i) + 4, height: FILE_ROW - 8 }}
              onMouseEnter={() => setFocus({ kind: "file", key: f.path })}
              onFocus={() => setFocus({ kind: "file", key: f.path })}
              onClick={() => setOpenFile(f.path)}
              title={`${f.path}\n${FILE_STATUS[f.status].label}: ${FILE_STATUS[f.status].hint}\nBấm để xem thay đổi`}
            >
              <StatusDot tone={FILE_STATUS[f.status].tone}>
                <span className="sr-only">{FILE_STATUS[f.status].label}</span>
              </StatusDot>
              <FileName path={f.path} />
              <span className="wm-file-devs">
                <AvatarStack people={f.devs} size={20} max={3} />
              </span>
            </button>
          ))}
        </div>
      </div>
      {map.files.length > MAX_FILES && (
        <button type="button" className="btn sm ghost" onClick={() => setAll((v) => !v)} style={{ marginTop: 8 }}>
          {all ? "Thu gọn" : `Xem thêm ${map.files.length - MAX_FILES} file`}
        </button>
      )}
      {openFile && <FileDialog projectId={projectId} path={openFile} onClose={() => setOpenFile(null)} />}
    </Card>
  );
}
