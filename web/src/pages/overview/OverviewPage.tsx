import { useState } from "react";
import { Link } from "react-router-dom";
import { useOverview } from "../../hooks/useOverview";
import { PageHead } from "../../components/Layout";
import { Card, Stat } from "../../components/Card";
import { Badge, LevelBadge } from "../../components/Badge";
import { BarChart, HBars, lastDays } from "../../components/Charts";
import { ErrorNotice, Loading, Empty } from "../../components/Empty";
import { isLoaded, type Level, type ProjectEntry } from "../../api/types";
import { ago, ms, shortSha } from "../../lib/format";
import { AddProjectForm } from "./AddProjectForm";

const LEVELS: Level[] = ["critical", "high", "warning", "info"];

function ProjectCard({ p }: { p: ProjectEntry }) {
  if (!isLoaded(p)) {
    return (
      <Link to={`/p/${p.id}`} className="card">
        <div className="card-body stack tight">
          <h3>{p.name}</h3>
          <span className="small danger-text">{p.error}</span>
        </div>
      </Link>
    );
  }
  const active = p.people.filter((x) => x.status === "active");
  return (
    <Link to={`/p/${p.id}`} className="card">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="truncate">{p.name}</h3>
          <div className="xs muted mono truncate">{p.repo_url}</div>
        </div>
        {p.last_sync && !p.last_sync.ok ? <Badge tone="danger">sync lỗi</Badge> : <Badge mono>{p.main_branch} · {shortSha(p.main_sha)}</Badge>}
      </div>
      <div className="card-body stack">
        <div className="kv">
          <span>
            Đang làm <b>{p.counts.people_active}</b>
          </span>
          <span>
            Task <b>{p.counts.tasks_active}</b>
          </span>
          <span>
            Conflict <b>{p.counts.conflicts_open}</b>
          </span>
          <span>
            Ticket chờ <b>{p.counts.tickets_waiting}</b>
          </span>
        </div>
        <div className="row">
          {active.length === 0 && <span className="small faint">Không ai đang làm</span>}
          {active.map((x) => (
            <Badge key={x.dev} tone="strong">
              {x.dev}
              {x.agents.length ? <span className="faint"> · {x.agents.join(", ")}</span> : null}
            </Badge>
          ))}
        </div>
        {p.counts.conflicts_open > 0 && (
          <div className="row">
            {LEVELS.filter((l) => p.counts.conflicts_by_level[l] > 0).map((l) => (
              <span key={l} className="row" style={{ gap: 4 }}>
                <LevelBadge level={l} />
                <span className="small mono">{p.counts.conflicts_by_level[l]}</span>
              </span>
            ))}
          </div>
        )}
        {p.last_sync && <span className="xs faint">Sync {ago(p.last_sync.at)}</span>}
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
  const bs = data.brain_stats;

  return (
    <>
      <PageHead
        title="Tổng quan"
        subtitle="Mọi project mà Operator đang điều phối, ai đang làm và Brain đã xử lý bao nhiêu việc."
        actions={
          <button className="btn primary" type="button" onClick={() => setAdding((v) => !v)}>
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

      <div className="grid stats">
        <Stat label="Projects" value={data.projects.length} />
        <Stat label="Đang làm" value={people.size} hint={`${sum((p) => p.counts.sessions_active)} phiên agent`} />
        <Stat label="Conflict mở" value={sum((p) => p.counts.conflicts_open)} alert={sum((p) => p.counts.conflicts_by_level.high + p.counts.conflicts_by_level.critical) > 0} />
        <Stat label="Ticket chờ" value={sum((p) => p.counts.tickets_waiting)} />
        <Stat label="Brain · 7 ngày" value={bs.totals.jobs} hint={bs.totals.failed ? `${bs.totals.failed} lỗi` : `p50 ${ms(bs.totals.p50_ms)}`} alert={bs.totals.failed > 0} />
      </div>

      <div className="split">
        <Card
          title="Brain"
          actions={
            <Link to="/brain" className="btn sm">
              Chi tiết
            </Link>
          }
        >
          <div className="stack">
            <div className="row">
              <span className={`dot${data.brain.ok ? " on" : " bad"}`} />
              <span className="small">
                {data.brain.backend} {data.brain.model ? <code>{data.brain.model}</code> : <span className="faint">(model mặc định)</span>}
              </span>
            </div>
            {!data.brain.ok && <span className="small danger-text">{data.brain.detail ?? "Brain không sẵn sàng"}</span>}
            <HBars data={bs.byKind.map((k) => ({ label: k.kind, value: k.jobs, hint: k.failed ? `${k.failed} lỗi` : undefined }))} empty="Chưa có job nào trong 7 ngày" />
          </div>
        </Card>
        <Card title="Job Brain theo ngày">
          <BarChart data={lastDays(bs.byDay, 7, (r) => r.day, (r) => ({ value: r?.jobs ?? 0, alt: r?.failed ?? 0 }))} />
        </Card>
      </div>

      <section className="stack">
        <h2>Projects</h2>
        {data.projects.length === 0 ? (
          <Card>
            <Empty>Chưa có project. Bấm “Thêm project” và trỏ tới repo (GitHub URL hoặc đường dẫn bare repo trên server).</Empty>
          </Card>
        ) : (
          <div className="grid">
            {data.projects.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
