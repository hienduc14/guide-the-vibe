import { useState } from "react";
import { Link } from "react-router-dom";
import { useOverview } from "../../hooks/useOverview";
import { PageHead } from "../../components/Layout";
import { Card } from "../../components/Card";
import { AgentBadge, Badge, LevelBadge } from "../../components/Badge";
import { ErrorNotice, Loading } from "../../components/Empty";
import { isLoaded, type Level, type ProjectEntry } from "../../api/types";
import { ago, ms, repoName, shortSha } from "../../lib/format";
import { AddProjectForm } from "./AddProjectForm";

const LEVELS: Level[] = ["critical", "high", "warning", "info"];

function ProjectRow({ p }: { p: ProjectEntry }) {
  if (!isLoaded(p)) {
    return (
      <Link to={`/p/${p.id}`} className="project-row">
        <div className="stack tight">
          <h3>{p.name}</h3>
          <span className="small danger-text">Không mở được project: {p.error}</span>
        </div>
      </Link>
    );
  }
  const active = p.people.filter((x) => x.status === "active");
  const syncFailed = p.last_sync && !p.last_sync.ok;
  return (
    <Link to={`/p/${p.id}`} className="project-row">
      <div className="stack tight" style={{ minWidth: 0 }}>
        <h3 className="truncate">{p.name}</h3>
        <div className="meta xs muted">
          <span className="mono truncate" title={p.repo_url}>
            {repoName(p.repo_url)}
          </span>
          <span className="mono">
            {p.main_branch}@{shortSha(p.main_sha)}
          </span>
          {syncFailed ? <span className="danger-text">sync lỗi</span> : p.last_sync && <span>sync {ago(p.last_sync.at)}</span>}
        </div>
      </div>
      <div className="people">
        {active.length === 0 ? (
          <span className="small muted">Không ai đang làm</span>
        ) : (
          active.map((x) => (
            <span key={x.dev} className="row" style={{ gap: 4 }}>
              <b className="small">{x.dev}</b>
              {x.agents.map((a) => (
                <AgentBadge key={a} agent={a} />
              ))}
            </span>
          ))
        )}
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {p.counts.conflicts_open === 0 ? (
          <Badge tone="ok">không conflict</Badge>
        ) : (
          LEVELS.filter((l) => p.counts.conflicts_by_level[l] > 0).map((l) => (
            <span key={l} className="row" style={{ gap: 4 }}>
              <LevelBadge level={l} />
              <b className="small num">{p.counts.conflicts_by_level[l]}</b>
            </span>
          ))
        )}
        {p.counts.tickets_waiting > 0 && <Badge tone="warning">{p.counts.tickets_waiting} câu hỏi chờ</Badge>}
      </div>
    </Link>
  );
}

export function OverviewPage() {
  const { data, error, reload } = useOverview();
  const [adding, setAdding] = useState(false);
  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;

  const loaded = data.projects.filter(isLoaded);
  const sum = (f: (p: (typeof loaded)[number]) => number) => loaded.reduce((n, p) => n + f(p), 0);
  const people = new Set(loaded.flatMap((p) => p.people.filter((x) => x.status === "active").map((x) => x.dev)));
  const conflicts = sum((p) => p.counts.conflicts_open);
  const serious = sum((p) => p.counts.conflicts_by_level.high + p.counts.conflicts_by_level.critical);
  const waiting = sum((p) => p.counts.tickets_waiting);
  const bs = data.brain_stats;

  return (
    <>
      <PageHead
        title="Tổng quan"
        subtitle="Ai đang làm ở project nào, chỗ nào đang đụng nhau, và câu hỏi nào đang chờ người trả lời."
        actions={
          <button className="btn primary admin-only" type="button" onClick={() => setAdding((v) => !v)}>
            {adding ? "Đóng" : "Thêm project"}
          </button>
        }
      />

      {adding && (
        <AddProjectForm
          onDone={() => {
            setAdding(false);
            void reload();
          }}
        />
      )}

      <div className="summary">
        <span className="chip">
          <b>{people.size}</b> người đang làm
        </span>
        <span className="chip">
          <b>{sum((p) => p.counts.sessions_active)}</b> phiên agent
        </span>
        <span className={`chip${serious ? " alert" : conflicts ? " warn" : ""}`}>
          <b>{conflicts}</b> conflict đang mở
        </span>
        <span className={`chip${waiting ? " warn" : ""}`}>
          <b>{waiting}</b> câu hỏi chờ người
        </span>
        <Link to="/brain" className={`chip${bs.totals.failed ? " alert" : ""}`} title="Số việc Brain đã làm trong 7 ngày">
          <b>{bs.totals.jobs}</b> việc Brain trong 7 ngày
          {bs.totals.jobs > 0 && <span className="xs">{bs.totals.failed ? `${bs.totals.failed} lỗi` : `thường mất ${ms(bs.totals.p50_ms)}`}</span>}
        </Link>
      </div>

      {!data.brain.ok && (
        <div className={`notice ${data.brain.backend === "null" ? "info" : "error"} row between`}>
          <span>
            {data.brain.backend === "null"
              ? "Brain đang tắt: Operator vẫn báo trùng việc, nhưng không tự trả lời câu hỏi."
              : `Brain chưa chạy được: ${data.brain.detail ?? "chưa kết nối provider hoặc chưa chọn model"}.`}
          </span>
          <Link to="/brain" className="btn sm">
            Mở Brain
          </Link>
        </div>
      )}

      <Card
        title={
          <div>
            <h3>Projects</h3>
            <div className="sub">Mỗi project là một repo. Dev được nhận vào project theo remote của repo họ clone.</div>
          </div>
        }
        flush
      >
        {data.projects.length === 0 ? (
          <div className="empty">
            <b>Chưa có project nào</b>
            Bấm “Thêm project” và dán URL repo của nhóm (GitHub, GitLab hoặc đường dẫn repo trên server).
          </div>
        ) : (
          data.projects.map((p) => <ProjectRow key={p.id} p={p} />)
        )}
      </Card>
    </>
  );
}
