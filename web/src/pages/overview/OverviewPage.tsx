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
          <span className={`metric${p.attention ? " t-high" : ""}`} title="Vụ đụng nhau, câu hỏi và việc đang chờ một người quyết">
            <Zap />
            {p.attention} cần xử lý
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
  const need = sum((p) => p.attention);
  const waiting = sum((p) => p.counts.tickets_waiting);
  const bs = data.brain_stats;
  const done = sum((p) => p.board.done);
  const total = sum((p) => p.board.total);

  return (
    <>
      <PageHead
        title="Tổng quan"
        subtitle="gtv theo dõi các AI agent (Claude Code, Codex) của cả nhóm trên cùng một repo: ai đang sửa gì, và báo sớm khi hai người sửa trùng nhau."
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
        <Kpi icon={Zap} tone={need ? "high" : "neutral"} value={need} label="Cần xử lý" title="Vụ đụng nhau, câu hỏi và việc đang chờ một người quyết" />
        <Kpi
          icon={MessageCircleQuestion}
          tone={waiting ? "warning" : "neutral"}
          value={waiting}
          label="Chờ trả lời"
          title="Câu hỏi của agent đang chờ một người trả lời"
        />
        <Kpi icon={SquareKanban} value={`${done}/${total}`} label="Việc xong" aside={total ? <Ring value={done} total={total} size={40} /> : undefined} />
        <Kpi
          icon={BrainCircuit}
          to="/brain"
          tone={bs.totals.failed ? "high" : "neutral"}
          value={bs.totals.jobs}
          label="Câu AI trả lời · 7 ngày"
          title={bs.totals.jobs > 0 ? (bs.totals.failed ? `${bs.totals.failed} lỗi` : `thường mất ${ms(bs.totals.p50_ms)}`) : undefined}
        />
      </div>

      {!data.brain.ok && (
        <div className={`notice ${data.brain.backend === "null" ? "info" : "error"} notice-row`}>
          <BrainCircuit />
          <span>
            {data.brain.backend === "null"
              ? "Chưa kết nối AI: câu hỏi của agent sẽ chờ người trả lời. Phát hiện trùng việc vẫn chạy."
              : `AI chưa chạy được: ${data.brain.detail ?? "chưa kết nối nhà cung cấp hoặc chưa chọn model"}.`}
          </span>
          <span className="spacer" />
          <Link to="/brain" className="btn sm admin-only">
            Kết nối AI
          </Link>
        </div>
      )}

      <section className="stack tight">
        <h2 className="section-title">
          <FolderGit2 />
          Dự án
        </h2>
        {data.projects.length === 0 ? (
          <Card>
            <EmptyState icon={FolderGit2} title="Chưa có dự án">
              Bắt đầu trong 3 bước: 1. Bấm “Thêm project” và dán URL repo. 2. Ở trang Developers, bấm “Tạo lệnh mời” và gửi lệnh cho từng dev chạy trong repo
              của họ. 3. Quay lại đây để xem ai đang làm gì.
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
