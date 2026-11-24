import { Link } from "react-router-dom";
import { api } from "../../api/endpoints";
import type { Conflict, Level, Session, TaskResource, TeamState } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { LevelBadge, agentName, agentTone } from "../../components/Badge";
import { Loading } from "../../components/Empty";
import { ago } from "../../lib/format";
import { ActivityFeed } from "./ActivityFeed";
import { LEVEL_LABEL } from "../../components/Member";
import type { Member } from "../../api/types";

const RANK: Record<Level, number> = { info: 0, warning: 1, high: 2, critical: 3 };
const BREAKING = new Set(["sig_change", "rename", "delete"]);
const OP_LABEL: Record<string, string> = {
  read: "đọc",
  modify: "sửa",
  create: "tạo",
  delete: "xoá",
  rename: "đổi tên",
  sig_change: "đổi chữ ký",
};

const stem = (v: string) => v.replace(/\/?\*.*$/, "");
/** A resource is "in the clash" when an open conflict on this workspace names it (or a file under it). */
const clashes = (r: TaskResource, conflicts: Conflict[]) =>
  conflicts.some((c) => {
    const s = stem(r.value);
    return !!s && (c.subject.includes(s) || s.includes(c.subject) || c.message.includes(r.value));
  });

function Resource({ r, clash }: { r: TaskResource; clash: boolean }) {
  return (
    <span className={`res${clash ? " clash" : BREAKING.has(r.op ?? "") ? " breaking" : ""}`} title={`${r.kind}: ${r.value}${r.op ? ` (${r.op})` : ""}`}>
      {r.value}
      {r.op && <em>{OP_LABEL[r.op] ?? r.op}</em>}
    </span>
  );
}

interface Strip {
  key: string;
  dev: string;
  agent: string;
  where: string;
  title?: string;
  goal?: string;
  resources: TaskResource[];
  since: string;
  conflicts: Conflict[];
  editing: number;
}

function strips(s: TeamState): Strip[] {
  const session = new Map(s.sessions.map((x) => [x.id, x]));
  const ws = new Map(s.workspaces.map((w) => [w.id, w]));
  const open = s.conflicts.filter((c) => c.status === "open" || c.status === "acked");
  const where = (id: string) => {
    const w = ws.get(id);
    return w ? `${w.label}${w.branch ? ` · ${w.branch}` : ""}` : id;
  };
  const touching = (wsId: string) => open.filter((c) => c.workspace_a === wsId || c.workspace_b === wsId).sort((a, b) => RANK[b.level] - RANK[a.level]);
  const editing = (wsId: string) => s.footprints.filter((f) => f.workspace_id === wsId).length;

  const out: Strip[] = s.tasks.map((t) => ({
    key: t.id,
    dev: t.dev,
    agent: session.get(t.session_id)?.agent ?? "other",
    where: where(t.workspace_id),
    title: t.title,
    goal: t.goal,
    resources: t.resources,
    since: t.created_at,
    conflicts: touching(t.workspace_id),
    editing: editing(t.workspace_id),
  }));
  // Live sessions that have not registered a task yet still belong on the board.
  const withTask = new Set(s.tasks.map((t) => t.session_id));
  for (const x of s.sessions.filter((x: Session) => x.status !== "ended" && !withTask.has(x.id)))
    out.push({
      key: x.id,
      dev: x.dev,
      agent: x.agent,
      where: where(x.workspace_id),
      resources: [],
      since: x.last_seen,
      conflicts: touching(x.workspace_id),
      editing: editing(x.workspace_id),
    });
  return out;
}

function Board({ state, projectId, members }: { state: TeamState; projectId: string; members: Member[] }) {
  const member = new Map(members.map((m) => [m.dev, m]));
  const rows = strips(state);
  if (!rows.length)
    return (
      <Card>
        <div className="empty">
          <b>Chưa ai làm việc trong project này</b>
          Khi một dev mở Claude Code hoặc Codex trong repo, phiên của họ hiện ở đây cùng việc họ đăng ký.
        </div>
      </Card>
    );
  return (
    <div className="board">
      {rows.map((r) => {
        const worst = r.conflicts[0];
        const alert = worst && RANK[worst.level] >= RANK.high;
        return (
          <article key={r.key} className={`strip ${agentTone(r.agent)}${alert ? " alert" : ""}`}>
            <div className="strip-who">
              <b>{r.dev}</b>
              {member.get(r.dev) && (
                <span className="who-role">
                  {member.get(r.dev)!.role} · {LEVEL_LABEL[member.get(r.dev)!.level]}
                </span>
              )}
              <span>{agentName(r.agent)}</span>
            </div>
            <div className="strip-what">
              {r.title ? <h3>{r.title}</h3> : <h3 className="muted">Chưa đăng ký việc</h3>}
              {r.goal && <p>{r.goal}</p>}
              {r.resources.length > 0 && (
                <div className="strip-route">
                  {r.resources.map((res, i) => (
                    <Resource key={i} r={res} clash={clashes(res, r.conflicts)} />
                  ))}
                </div>
              )}
              <span className="xs faint mono truncate">{r.where}</span>
            </div>
            <div className="strip-side">
              {worst ? (
                <Link to={`/p/${projectId}/conflicts`} className="row" style={{ gap: 6 }} title={worst.message}>
                  <LevelBadge level={worst.level} />
                  <span className="xs muted">
                    với {worst.dev_a === r.dev ? worst.dev_b : worst.dev_a}
                    {r.conflicts.length > 1 ? ` +${r.conflicts.length - 1}` : ""}
                  </span>
                </Link>
              ) : (
                <span className="xs ok-text">Không đụng ai</span>
              )}
              <span className="xs muted">
                {r.editing > 0 ? `${r.editing} file đã sửa · ` : ""}
                {ago(r.since)}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function ProjectOverview() {
  const { id, detail } = useProject();
  const state = usePoll(() => api.projects.state(id), [id], 5000);
  const activity = usePoll(() => api.projects.activity(id, 120), [id], 5000);
  const c = detail.counts;
  const serious = c.conflicts_by_level.high + c.conflicts_by_level.critical;

  return (
    <>
      <div className="summary">
        <span className="chip">
          <b>{c.people_active}</b> người đang làm
        </span>
        <span className="chip">
          <b>{c.tasks_active}</b> việc đã đăng ký
        </span>
        <Link to={`/p/${id}/conflicts`} className={`chip${serious ? " alert" : c.conflicts_open ? " warn" : ""}`}>
          <b>{c.conflicts_open}</b> conflict đang mở
        </Link>
        <Link to={`/p/${id}/qa`} className={`chip${c.tickets_waiting ? " warn" : ""}`}>
          <b>{c.tickets_waiting}</b> câu hỏi chờ người
        </Link>
        <Link to={`/p/${id}/graph`} className="chip" title={`${detail.graph.files} file, ${detail.graph.refs} tham chiếu`}>
          <b>{detail.graph.symbols}</b> hàm và class trong code graph
        </Link>
      </div>

      <section className="stack tight">
        <div className="row between">
          <h2>Bảng điều phối</h2>
          <span className="xs muted">Mỗi dải là một phiên agent. Ô đỏ là chỗ đang đụng người khác, ô vàng là thay đổi làm hỏng chỗ gọi.</span>
        </div>
        {state.data ? <Board state={state.data} projectId={id} members={detail.members} /> : <Loading />}
      </section>

      <ActivityFeed events={activity.data ?? []} />
    </>
  );
}
