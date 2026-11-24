import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/endpoints";
import type { Conflict, Level, Session, TaskResource, TeamState } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { agentName } from "../../components/Badge";
import { DevAvatar, EmptyState, Kpi, Ring, StatusDot, type Tone } from "../../components/Visual";
import {
  Activity,
  BellRing,
  Bot,
  CalendarClock,
  ChartNoAxesColumn,
  CircleCheck,
  CircleDot,
  FileCode2,
  GitBranch,
  MessageCircleQuestion,
  MessagesSquare,
  Moon,
  Network,
  OctagonAlert,
  SquareKanban,
  UserX,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
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
        <EmptyState icon={Bot} title="Chưa ai đang làm">
          Phiên Claude Code / Codex sẽ hiện ở đây.
        </EmptyState>
      </Card>
    );
  return (
    <div className="lanes">
      {rows.map((r) => {
        const worst = r.conflicts[0];
        const alert = worst && RANK[worst.level] >= RANK.high;
        const m = member.get(r.dev);
        return (
          <article key={r.key} className={`lane${alert ? " alert" : ""}`}>
            <div className="lane-who">
              <DevAvatar name={r.dev} agent={r.agent} size={36} />
              <div style={{ minWidth: 0 }}>
                <b className="truncate">{r.dev}</b>
                <span className="truncate">{m ? `${m.role} · ${LEVEL_LABEL[m.level]}` : agentName(r.agent)}</span>
              </div>
            </div>
            <div className="lane-what">
              {r.title ? (
                <h3 className="truncate" title={r.goal}>
                  {r.title}
                </h3>
              ) : (
                <h3 className="muted">Chưa đăng ký việc</h3>
              )}
              {r.resources.length > 0 && (
                <div className="lane-files">
                  {r.resources.map((res, i) => (
                    <Resource key={i} r={res} clash={clashes(res, r.conflicts)} />
                  ))}
                </div>
              )}
              <span className="xs faint mono truncate">
                <GitBranch size={12} style={{ verticalAlign: "-2px", marginInlineEnd: 4 }} />
                {r.where}
              </span>
            </div>
            <div className="lane-side">
              {worst ? (
                <Link to={`/p/${projectId}/conflicts`} title={worst.message}>
                  <StatusDot tone={alert ? "high" : "warning"}>
                    Đụng {worst.dev_a === r.dev ? worst.dev_b : worst.dev_a}
                    {r.conflicts.length > 1 ? ` +${r.conflicts.length - 1}` : ""}
                  </StatusDot>
                </Link>
              ) : (
                <StatusDot tone="ok">Ổn</StatusDot>
              )}
              <span className="metric" title={r.editing > 0 ? `${r.editing} file đã sửa` : undefined}>
                {r.editing > 0 && (
                  <>
                    <FileCode2 />
                    {r.editing}
                    <span aria-hidden="true">·</span>
                  </>
                )}
                {ago(r.since)}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

const ATTENTION: Record<AttentionItem["kind"], { label: string; icon: LucideIcon }> = {
  conflict: { label: "Conflict", icon: Zap },
  question: { label: "Câu hỏi", icon: MessageCircleQuestion },
  overdue: { label: "Quá hạn", icon: CalendarClock },
  blocked: { label: "Bị chặn", icon: OctagonAlert },
  unassigned: { label: "Chưa giao", icon: UserX },
  stale: { label: "Im lặng", icon: Moon },
};
const LEVEL_TONE: Record<Level, Tone> = { info: "neutral", warning: "warning", high: "high", critical: "critical" };

function AttentionIcon({ kind }: { kind: AttentionItem["kind"] }) {
  const I = ATTENTION[kind].icon;
  return <I />;
}

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
        <h3>
          <BellRing />
          Cần xử lý{data && data.length > 0 ? ` · ${data.length}` : ""}
        </h3>
      }
      flush
    >
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <EmptyState icon={CircleCheck} title="Không có gì cần xử lý" />
      ) : (
        <div className="attention">
          {data.slice(0, 8).map((a) => (
            <Link key={`${a.kind}:${a.ref}`} to={attentionLink(projectId, a)} className={`attention-item t-${LEVEL_TONE[a.level]}`}>
              <span className="att-icon" title={`${ATTENTION[a.kind].label} · ${a.level}`}>
                <AttentionIcon kind={a.kind} />
              </span>
              <span className="what">
                <b className="small">{a.title}</b>
                <span className="xs muted">{a.detail}</span>
              </span>
              <span className="xs faint" style={{ whiteSpace: "nowrap" }}>
                {ATTENTION[a.kind].label} · {ago(a.at)}
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
  return (
    <Card
      title={
        <h3>
          <ChartNoAxesColumn />
          Tiến độ
        </h3>
      }
      actions={
        <Link to={`/p/${projectId}/board`} className="btn sm">
          Bảng việc
        </Link>
      }
    >
      <div className="stack">
        <div className="row" style={{ gap: 16 }}>
          <Ring value={b.done} total={b.total} size={64} />
          <div className="stack tight" style={{ gap: 4 }}>
            <span className="metric" style={{ color: "var(--fg)" }}>
              <CircleCheck style={{ color: "var(--ok)" }} />
              {b.done}/{b.total} xong
            </span>
            <span className="metric">
              <CircleDot style={{ color: "var(--accent)" }} />
              {b.in_progress} đang làm
            </span>
            {(b.overdue > 0 || b.blocked > 0) && (
              <span className="metric t-high">
                <OctagonAlert />
                {b.overdue} quá hạn · {b.blocked} bị chặn
              </span>
            )}
          </div>
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
        <h3>
          <MessagesSquare />
          Trao đổi
        </h3>
      }
      actions={
        <Link to={`/p/${projectId}/conversations`} className="btn sm">
          Tất cả
        </Link>
      }
      flush
    >
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="Chưa có trao đổi" />
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
      <div className="kpis">
        <Kpi icon={Users} tone={c.people_active ? "accent" : "neutral"} value={c.people_active} label="Đang làm" />
        <Kpi
          icon={Zap}
          to={`/p/${id}/conflicts`}
          tone={serious ? "high" : c.conflicts_open ? "warning" : "neutral"}
          value={c.conflicts_open}
          label="Conflict"
        />
        <Kpi
          icon={MessageCircleQuestion}
          to={`/p/${id}/conversations`}
          tone={c.tickets_waiting ? "warning" : "neutral"}
          value={c.tickets_waiting}
          label="Chờ trả lời"
        />
        <Kpi
          icon={SquareKanban}
          to={`/p/${id}/board`}
          tone={detail.board.blocked + detail.board.overdue ? "warning" : "neutral"}
          value={`${detail.board.done}/${detail.board.total}`}
          label="Việc xong"
          aside={<Ring value={detail.board.done} total={detail.board.total} size={36} />}
        />
        <Kpi
          icon={Network}
          to={`/p/${id}/graph`}
          value={detail.graph.symbols}
          label="Symbol"
          title={`${detail.graph.files} file, ${detail.graph.refs} tham chiếu`}
        />
      </div>

      <div className="overview-cols">
        <div className="stack">
          <AttentionCard projectId={id} />
          <section className="stack tight">
            <h2 className="section-title" title="Mỗi hàng là một phiên agent. Ô đỏ: đang đụng người khác. Ô vàng: thay đổi làm hỏng chỗ gọi.">
              <Activity />
              Ai đang làm gì
            </h2>
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
