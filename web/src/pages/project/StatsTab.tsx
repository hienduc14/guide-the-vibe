import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/endpoints";
import type { BoardView, KN } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { Card, Stat } from "../../components/Card";
import { BarsChart, LineChart, StackBar, type Point, type Segment } from "../../components/ProgressCharts";
import { DevAvatar, EmptyState, Kpi, Ring } from "../../components/Visual";
import { DueChip, PRIORITY_INFO } from "../../components/Task";
import { Avatar } from "../../components/Member";
import { BarChart3, CalendarClock, CircleCheck, Hourglass, OctagonAlert, Timer, TrendingDown, UserX, Users, Wrench } from "lucide-react";
import { Segmented } from "../../components/Segmented";
import { BarChart, HBars, lastDays } from "../../components/Charts";
import { ErrorNotice, Loading } from "../../components/Empty";
import { BrainJobsTable } from "../brain/BrainJobsTable";
import { ms } from "../../lib/format";

const toBars = (rows: KN[], label: (k: string) => string = (k) => k) => rows.map((r) => ({ label: label(r.k), value: r.n }));
const TIER: Record<string, string> = { "1": "Bậc 1 · Operator", "2": "Bậc 2 · agent đồng đội", "3": "Bậc 3 · người" };

function TechStats({ days }: { days: "7" | "30" }) {
  const { id } = useProject();
  const { data, error } = usePoll(() => api.projects.stats(id, Number(days)), [id, days], 10_000);
  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const b = data.brain;
  const n = Number(days);

  return (
    <div className="stack">
      <h2>Brain</h2>
      <div className="grid stats">
        <Stat label="Job" value={b.totals.jobs} />
        <Stat label="Lỗi" value={b.totals.failed} alert={b.totals.failed > 0} />
        <Stat label="p50" value={ms(b.totals.p50_ms)} />
        <Stat label="p95" value={ms(b.totals.p95_ms)} />
      </div>
      <div className="split">
        <Card title="Job theo ngày">
          <BarChart
            data={lastDays(
              b.byDay,
              n,
              (r) => r.day,
              (r) => ({ value: r?.jobs ?? 0, alt: r?.failed ?? 0 }),
            )}
          />
        </Card>
        <Card title="Theo loại việc">
          <HBars data={b.byKind.map((k) => ({ label: k.kind, value: k.jobs, hint: k.failed ? `${k.failed} lỗi` : undefined }))} empty="Chưa có job" />
        </Card>
      </div>
      <Card title="Job gần đây" flush>
        <BrainJobsTable jobs={b.recent} />
      </Card>

      <h2>Conflict</h2>
      <div className="split">
        <Card title="Theo ngày">
          <BarChart
            data={lastDays(
              data.conflicts.byDay,
              n,
              (r) => r.k,
              (r) => ({ value: r?.n ?? 0 }),
            )}
          />
        </Card>
        <Card title="Theo layer / mức / trạng thái">
          <div className="stack">
            <HBars data={toBars(data.conflicts.byLayer)} />
            <HBars data={toBars(data.conflicts.byLevel)} />
            <HBars data={toBars(data.conflicts.byStatus)} />
          </div>
        </Card>
      </div>

      <h2>Hỏi đáp & tri thức</h2>
      <div className="split">
        <Card title="Ticket">
          <div className="stack">
            <HBars data={toBars(data.tickets.byTier, (k) => TIER[k] ?? k)} empty="Chưa có ticket" />
            <HBars data={toBars(data.tickets.byStatus)} empty="" />
          </div>
        </Card>
        <Card title="Knowledge (loại:trạng thái)">
          <HBars data={toBars(data.kb)} empty="Chưa có tài liệu" />
        </Card>
      </div>

      <h2>Sự kiện</h2>
      <div className="split">
        <Card title="Theo ngày">
          <BarChart
            data={lastDays(
              data.events.byDay,
              n,
              (r) => r.k,
              (r) => ({ value: r?.n ?? 0 }),
            )}
          />
        </Card>
        <Card title="Theo loại">
          <HBars data={toBars(data.events.byType.slice(0, 14))} />
        </Card>
      </div>
    </div>
  );
}

// ---- progress statistics (what a lead reads) ---------------------------------------------------

type Range = "7" | "14" | "30";
const DAY = 86_400_000;
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Local calendar days ending today, oldest first. */
function dayList(n: number): { key: string; end: number; label: string; full: string }[] {
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    out.push({ key: `${d.getFullYear()}-${mm}-${dd}`, end: d.getTime() + DAY - 1, label: `${dd}/${mm}`, full: `${WEEKDAY[d.getDay()]} ${dd}/${mm}` });
  }
  return out;
}

const t = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const fmtDays = (d: number | null) => (d === null ? "–" : d < 1 ? `${Math.max(1, Math.round(d * 24))} giờ` : `${d.toFixed(d < 10 ? 1 : 0)} ngày`);

const STATUS_SEG: { key: string; label: string; tone: Segment["tone"]; match: (x: BoardView) => boolean }[] = [
  { key: "done", label: "xong", tone: "ok", match: (x) => x.status === "done" },
  { key: "doing", label: "đang làm", tone: "accent", match: (x) => (x.status === "in_progress" || x.status === "review") && !x.blocked },
  { key: "blocked", label: "bị chặn", tone: "high", match: (x) => x.blocked || x.status === "blocked" },
  { key: "todo", label: "cần làm", tone: "neutral", match: (x) => x.status === "todo" && !x.blocked },
];

function progress(tasks: BoardView[], n: number) {
  const live = tasks.filter((x) => x.status !== "cancelled");
  const days = dayList(n);
  const from = days[0]!.end - DAY + 1;
  const open: Point[] = days.map((d) => ({
    label: d.label,
    full: d.full,
    value: live.filter((x) => t(x.created_at) <= d.end && !(t(x.done_at) <= d.end)).length,
  }));
  const done: Point[] = days.map((d) => ({
    label: d.label,
    full: d.full,
    value: live.filter((x) => x.done_at && t(x.done_at) > d.end - DAY && t(x.done_at) <= d.end).length,
  }));
  const doneIn = live.filter((x) => t(x.done_at) >= from);
  const donePrev = live.filter((x) => t(x.done_at) >= from - n * DAY && t(x.done_at) < from).length;
  const cycle = median(doneIn.map((x) => (t(x.done_at) - t(x.started_at ?? x.created_at)) / DAY).filter((v) => v >= 0));
  const people = new Map<string, BoardView[]>();
  for (const x of live) {
    const k = x.assignee ?? "";
    people.set(k, [...(people.get(k) ?? []), x]);
  }
  const byPerson = [...people.entries()]
    .map(([name, xs]) => ({
      name,
      total: xs.length,
      done: xs.filter((x) => x.status === "done").length,
      segments: STATUS_SEG.map((s) => ({ key: s.key, label: s.label, tone: s.tone, value: xs.filter(s.match).length })),
      agent: xs.flatMap((x) => x.work).find((w) => w.dev === name && w.session_status === "active")?.agent ?? undefined,
    }))
    .sort((a, b) => (a.name === "" ? 1 : b.name === "" ? -1 : b.total - a.total));
  const soon = Date.now() + 7 * DAY;
  const upcoming = live
    .filter((x) => x.status !== "done" && x.due_date && new Date(`${x.due_date}T23:59:59`).getTime() <= soon)
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  return { live, open, done, doneIn: doneIn.length, donePrev, cycle, byPerson, upcoming };
}

export function StatsTab() {
  const { id, detail } = useProject();
  const [range, setRange] = useState<Range>("14");
  const [tech, setTech] = useState(false);
  const board = usePoll(() => api.board.list(id, "all"), [id], 10_000);
  const n = Number(range);
  const p = useMemo(() => (board.data ? progress(board.data, n) : null), [board.data, n]);
  if (board.error && !board.data) return <ErrorNotice error={board.error} />;
  if (!p) return <Loading />;
  const b = detail.board;
  const delta = p.doneIn - p.donePrev;

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="section-title">
          <BarChart3 />
          Tiến độ
        </h2>
        <Segmented
          options={[
            { value: "7", label: "7 ngày" },
            { value: "14", label: "14 ngày" },
            { value: "30", label: "30 ngày" },
          ]}
          value={range}
          onChange={setRange}
        />
      </div>

      <div className="kpis">
        <Kpi icon={CircleCheck} tone="ok" value={`${b.done}/${b.total}`} label="Hoàn thành" aside={<Ring value={b.done} total={b.total} size={40} />} />
        <Kpi
          icon={TrendingDown}
          tone="accent"
          value={p.doneIn}
          label={`Xong · ${range} ngày`}
          title={`Kỳ trước: ${p.donePrev}`}
          aside={
            <span className={`delta${delta > 0 ? " up" : delta < 0 ? " down" : ""}`}>
              {delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {Math.abs(delta)}
            </span>
          }
        />
        <Kpi icon={Timer} value={fmtDays(p.cycle)} label="Thời gian làm" title="Trung vị, từ lúc bắt đầu tới lúc xong, các việc xong trong kỳ" />
        <Kpi icon={CalendarClock} to={`/p/${id}/board`} tone={b.overdue ? "high" : "neutral"} value={b.overdue} label="Quá hạn" />
        <Kpi icon={OctagonAlert} to={`/p/${id}/board`} tone={b.blocked ? "high" : "neutral"} value={b.blocked} label="Bị chặn" />
      </div>

      {p.live.length === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="Chưa có việc trên bảng" />
        </Card>
      ) : (
        <>
          <div className="split">
            <Card title={<h3 title="Số việc chưa xong vào cuối mỗi ngày. Đường đi xuống là đang về đích.">Việc còn lại</h3>}>
              <LineChart data={p.open} unit="việc còn lại" />
            </Card>
            <Card title="Xong mỗi ngày">
              <BarsChart data={p.done} unit="việc xong" />
            </Card>
          </div>

          <div className="split">
            <Card
              title={
                <h3>
                  <Users />
                  Theo người
                </h3>
              }
              actions={
                <span className="chart-legend">
                  {STATUS_SEG.map((s) => (
                    <span key={s.key}>
                      <i className={`key-box t-${s.tone}`} />
                      {s.label}
                    </span>
                  ))}
                </span>
              }
            >
              <div className="people-bars">
                {p.byPerson.map((x) => (
                  <div className="people-row" key={x.name || "-"}>
                    <span className="people-name">
                      {x.name ? <DevAvatar name={x.name} agent={x.agent} size={24} /> : <UserX />}
                      <span className="truncate">{x.name || "Chưa giao"}</span>
                    </span>
                    <StackBar segments={x.segments} name={x.name || "Chưa giao"} />
                    <span className="people-num" title={x.segments.map((s) => `${s.value} ${s.label}`).join(" · ")}>
                      <b>{x.done}</b>/{x.total}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card
              title={
                <h3>
                  <Hourglass />
                  Sắp tới hạn
                </h3>
              }
              flush
            >
              {p.upcoming.length === 0 ? (
                <EmptyState icon={CalendarClock} title="Không có việc tới hạn trong 7 ngày" />
              ) : (
                <div className="due-list">
                  {p.upcoming.slice(0, 8).map((x) => (
                    <Link key={x.id} to={`/p/${id}/board?task=${encodeURIComponent(x.id)}`} className="due-row">
                      {x.assignee ? <Avatar name={x.assignee} size={24} /> : <UserX />}
                      <span className="truncate small" title={`${PRIORITY_INFO[x.priority].label} · ${x.title}`}>
                        {x.title}
                      </span>
                      <DueChip date={x.due_date} />
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <details className="tech-stats" open={tech} onToggle={(e) => setTech((e.target as HTMLDetailsElement).open)}>
        <summary>
          <Wrench />
          Số liệu kỹ thuật (Brain, conflict, hỏi đáp, sự kiện)
        </summary>
        {tech && <TechStats days={n >= 30 ? "30" : "7"} />}
      </details>
    </div>
  );
}
