import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/endpoints";
import type { Conflict, Level, Session, TaskResource, TeamState } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { LevelBadge, agentName, agentTone } from "../../components/Badge";
import { Loading } from "../../components/Empty";
import { ago } from "../../lib/format";
import { ActivityFeed } from "./ActivityFeed";
import { CharterCard } from "./CharterCard";
import { ThreadRow } from "./Chat";
import { TaskCard } from "./BoardTab";
import type { AttentionItem } from "../../api/types";
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

const ATTENTION_ICON: Record<AttentionItem["kind"], string> = {
  conflict: "Conflict",
  question: "Câu hỏi",
  overdue: "Quá hạn",
  blocked: "Bị chặn",
  unassigned: "Chưa giao",
  stale: "Im lặng",
};

function attentionLink(projectId: string, a: AttentionItem): string {
  if (a.kind === "conflict") return `/p/${projectId}/conflicts`;
  if (a.kind === "question") return `/p/${projectId}/conversations?t=${encodeURIComponent(a.ref)}`;
  return `/p/${projectId}/board?task=${encodeURIComponent(a.ref)}`;
}

/** What a lead should look at now: serious conflicts, questions waiting for a person, late or blocked work. */
function AttentionCard({ projectId }: { projectId: string }) {
  const { data } = usePoll(() => api.projects.attention(projectId), [projectId], 5000);
  return (
    <Card
      title={
        <div>
          <h3>Cần xử lý{data && data.length > 0 ? ` (${data.length})` : ""}</h3>
          <div className="sub">Việc cần một người quyết định hoặc theo dõi. Bấm để mở chi tiết.</div>
        </div>
      }
      flush
    >
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <div className="attention-ok">Không có gì cần xử lý. Các agent đang tự phối hợp được.</div>
      ) : (
        <div className="attention">
          {data.slice(0, 8).map((a) => (
            <Link key={`${a.kind}:${a.ref}`} to={attentionLink(projectId, a)} className="attention-item">
              <LevelBadge level={a.level} />
              <span className="what">
                <b className="small">{a.title}</b>
                <span className="xs muted">{a.detail}</span>
              </span>
              <span className="xs faint" style={{ whiteSpace: "nowrap" }}>
                {ATTENTION_ICON[a.kind]} · {ago(a.at)}
              </span>
            </Link>
          ))}
          {data.length > 8 && (
            <span className="xs faint" style={{ padding: "8px 16px" }}>
              +{data.length - 8} mục khác
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

/** Board progress and the most urgent open tasks. */
function ProgressCard({ projectId }: { projectId: string }) {
  const { detail } = useProject();
  const { data } = usePoll(() => api.board.list(projectId, "open"), [projectId], 5000);
  const navigate = useNavigate();
  const b = detail.board;
  const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
  return (
    <Card
      title={
        <div>
          <h3>Tiến độ</h3>
          <div className="sub">
            {b.total ? `${b.done}/${b.total} việc xong · ${b.in_progress} đang làm · ${b.overdue} quá hạn · ${b.blocked} bị chặn` : "Chưa có việc trên bảng"}
          </div>
        </div>
      }
      actions={
        <Link to={`/p/${projectId}/board`} className="btn sm">
          Mở bảng việc
        </Link>
      }
    >
      <div className="stack">
        <div className="progress-line">
          <span className="progress">
            <i style={{ width: `${pct}%` }} />
          </span>
          <b className="small">{pct}%</b>
        </div>
        {data && data.length > 0 && (
          <div className="stack tight">
            <span className="label-caps">Gấp nhất</span>
            {data.slice(0, 4).map((t) => (
              <TaskCard key={t.id} t={t} onOpen={() => navigate(`/p/${projectId}/board?task=${encodeURIComponent(t.id)}`)} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function RecentConversations({ projectId }: { projectId: string }) {
  const { data } = usePoll(() => api.projects.conversations(projectId, 6), [projectId], 5000);
  const navigate = useNavigate();
  return (
    <Card
      title={
        <div>
          <h3>Trao đổi gần đây</h3>
          <div className="sub">Agent hỏi nhau, cảnh báo conflict, giao việc.</div>
        </div>
      }
      actions={
        <Link to={`/p/${projectId}/conversations`} className="btn sm">
          Xem tất cả
        </Link>
      }
      flush
    >
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <div className="empty">Chưa có trao đổi nào.</div>
      ) : (
        <div className="stack tight" style={{ padding: 4, gap: 2 }}>
          {data.map((t) => (
            <ThreadRow key={t.id} t={t} onClick={() => navigate(`/p/${projectId}/conversations?t=${encodeURIComponent(t.id)}`)} />
          ))}
        </div>
      )}
    </Card>
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
      <CharterCard />
      <div className="summary">
        <span className="chip">
          <b>{c.people_active}</b> người đang làm
        </span>
        <Link to={`/p/${id}/board`} className={`chip${detail.board.blocked + detail.board.overdue ? " warn" : ""}`}>
          <b>
            {detail.board.done}/{detail.board.total}
          </b>{" "}
          việc xong
        </Link>
        <Link to={`/p/${id}/conflicts`} className={`chip${serious ? " alert" : c.conflicts_open ? " warn" : ""}`}>
          <b>{c.conflicts_open}</b> conflict đang mở
        </Link>
        <Link to={`/p/${id}/conversations`} className={`chip${c.tickets_waiting ? " warn" : ""}`}>
          <b>{c.tickets_waiting}</b> câu hỏi chờ người
        </Link>
        <Link to={`/p/${id}/graph`} className="chip" title={`${detail.graph.files} file, ${detail.graph.refs} tham chiếu`}>
          <b>{detail.graph.symbols}</b> hàm và class trong code graph
        </Link>
      </div>

      <div className="overview-cols">
        <div className="stack">
          <AttentionCard projectId={id} />
          <section className="stack tight">
            <div className="row between">
              <h2>Ai đang làm gì</h2>
              <span className="xs muted">Mỗi dải là một phiên agent. Ô đỏ là chỗ đang đụng người khác, ô vàng là thay đổi làm hỏng chỗ gọi.</span>
            </div>
            {state.data ? <Board state={state.data} projectId={id} members={detail.members} /> : <Loading />}
          </section>
        </div>
        <div className="stack">
          <ProgressCard projectId={id} />
          <RecentConversations projectId={id} />
        </div>
      </div>

      <ActivityFeed events={activity.data ?? []} />
    </>
  );
}
