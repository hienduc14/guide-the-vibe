import { useState } from "react";
import { Link } from "react-router-dom";
import { useOverview } from "../../hooks/useOverview";
import { PageHead } from "../../components/Layout";
import { Card } from "../../components/Card";
import { AvatarStack, EmptyState, Kpi, Ring, StatusDot } from "../../components/Visual";
import { BrainCircuit, CalendarClock, Flag, FolderGit2, MessageCircleQuestion, SquareKanban, Users, Zap } from "lucide-react";
import { ErrorNotice, Loading } from "../../components/Empty";
import { isLoaded, type ProjectEntry } from "../../api/types";
import { ms, repoName, shortSha } from "../../lib/format";
import { AddProjectForm } from "./AddProjectForm";

function ProjectCard({ p }: { p: ProjectEntry }) {
  if (!isLoaded(p)) {
    return (
      <Link to={`/p/${p.id}`} className="pcard">
        <div className="pcard-head">
          <h3 className="truncate">{p.name}</h3>
        </div>
        <StatusDot tone="high" title={p.error}>
          Không mở được
        </StatusDot>
      </Link>
    );
  }
  const active = p.people.filter((x) => x.working ?? x.status === "active");
  const syncFailed = p.last_sync && !p.last_sync.ok;
  const lv = p.counts.conflicts_by_level;
  const conflictTone = lv.critical + lv.high > 0 ? "high" : lv.warning > 0 ? "warning" : "neutral";
  const deadline = p.charter?.deadline;
  return (
    <Link to={`/p/${p.id}`} className="pcard" title={`${repoName(p.repo_url)} · ${p.main_branch}@${shortSha(p.main_sha)}`}>
      <div className="pcard-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="truncate">{p.name}</h3>
          <span className="xs faint mono truncate" style={{ display: "block" }}>
            {repoName(p.repo_url)}
          </span>
        </div>
        <Ring value={p.board.done} total={p.board.total} size={48} />
      </div>
      {p.charter?.goal && <p className="pcard-goal">{p.charter.goal}</p>}
      <div className="pcard-people">
        {active.length ? (
          <>
            <AvatarStack people={active.map((x) => ({ name: x.dev, agent: x.agents[0] }))} />
            <span>{active.length} đang làm</span>
          </>
        ) : (
          <StatusDot tone="neutral">Không ai đang làm</StatusDot>
        )}
      </div>
      <div className="pcard-foot">
        <span className="metrics">
          <span className={`metric t-${conflictTone}`} title="Conflict đang mở">
            <Zap />
            {p.counts.conflicts_open} conflict
          </span>
          <span className={`metric${p.counts.tickets_waiting ? " t-warning" : ""}`} title="Câu hỏi chờ người">
            <MessageCircleQuestion />
            {p.counts.tickets_waiting} chờ trả lời
          </span>
          <span className={`metric${p.board.overdue ? " t-high" : ""}`} title="Việc quá hạn">
            <CalendarClock />
            {p.board.overdue} quá hạn
          </span>
        </span>
        <span className="spacer" />
        {syncFailed ? (
          <StatusDot tone="high" title={p.last_sync?.error}>
            Đồng bộ lỗi
          </StatusDot>
        ) : deadline ? (
          <span className="metric" title="Hạn chót">
            <Flag />
            {new Date(deadline).toLocaleDateString("vi-VN")}
          </span>
        ) : null}
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
  const people = new Set(loaded.flatMap((p) => p.people.filter((x) => x.working ?? x.status === "active").map((x) => x.dev)));
  const conflicts = sum((p) => p.counts.conflicts_open);
  const serious = sum((p) => p.counts.conflicts_by_level.high + p.counts.conflicts_by_level.critical);
  const waiting = sum((p) => p.counts.tickets_waiting);
  const bs = data.brain_stats;
  const done = sum((p) => p.board.done);
  const total = sum((p) => p.board.total);

  return (
    <>
      <PageHead
        title="Tổng quan"
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

      <div className="kpis">
        <Kpi
          icon={Users}
          tone={people.size ? "accent" : "neutral"}
          value={people.size}
          label="Người đang làm"
          aside={people.size ? <AvatarStack people={[...people].map((name) => ({ name }))} max={3} size={24} /> : undefined}
        />
        <Kpi icon={Zap} tone={serious ? "high" : conflicts ? "warning" : "neutral"} value={conflicts} label="Conflict" />
        <Kpi icon={MessageCircleQuestion} tone={waiting ? "warning" : "neutral"} value={waiting} label="Chờ trả lời" />
        <Kpi icon={SquareKanban} value={`${done}/${total}`} label="Việc xong" aside={total ? <Ring value={done} total={total} size={40} /> : undefined} />
        <Kpi
          icon={BrainCircuit}
          to="/brain"
          tone={bs.totals.failed ? "high" : "neutral"}
          value={bs.totals.jobs}
          label="Brain · 7 ngày"
          title={bs.totals.jobs > 0 ? (bs.totals.failed ? `${bs.totals.failed} lỗi` : `thường mất ${ms(bs.totals.p50_ms)}`) : undefined}
        />
      </div>

      {!data.brain.ok && (
        <div className={`notice ${data.brain.backend === "null" ? "info" : "error"} notice-row`}>
          <BrainCircuit />
          <span>
            {data.brain.backend === "null"
              ? "Brain đang tắt: câu hỏi của agent sẽ chờ người trả lời."
              : `Brain chưa chạy được: ${data.brain.detail ?? "chưa kết nối provider hoặc chưa chọn model"}.`}
          </span>
          <span className="spacer" />
          <Link to="/brain" className="btn sm">
            Mở Brain
          </Link>
        </div>
      )}

      <section className="stack tight">
        <h2 className="section-title">
          <FolderGit2 />
          Projects
        </h2>
        {data.projects.length === 0 ? (
          <Card>
            <EmptyState icon={FolderGit2} title="Chưa có project">
              Dán URL repo để bắt đầu.
            </EmptyState>
          </Card>
        ) : (
          <div className="project-grid">
            {data.projects.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
