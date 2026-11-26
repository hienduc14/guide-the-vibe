import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/endpoints";
import type { BoardView, KN } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { BarsChart, LineChart, type Point, type Segment } from "../../components/ProgressCharts";
import { BarChart, HBars, lastDays } from "../../components/Charts";
import { ErrorNotice, Loading } from "../../components/Empty";
import { Av, Blank, Seg } from "../../components/pj";
import { BrainJobsTable } from "../brain/BrainJobsTable";
import { ms } from "../../lib/format";

const toBars = (rows: KN[], label: (k: string) => string = (k) => k) => rows.map((r) => ({ label: label(r.k), value: r.n }));
const TIER: Record<string, string> = { "1": "AI tự trả lời", "2": "chuyển agent đồng đội", "3": "hỏi người" };

export function TechStats({ days }: { days: string }) {
  const { id } = useProject();
  const { data, error } = usePoll(() => api.projects.stats(id, Number(days)), [id, days], 10_000);
  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const b = data.brain;
  const n = Number(days);
  const byDay = <T,>(rows: T[], day: (r: T) => string, pick: (r: T | undefined) => { value: number; alt?: number }) => (
    <BarChart data={lastDays(rows, n, day, pick)} />
  );
  return (
    <div className="techstats">
      <div className="prog">
        <div className="panel p-stat">
          <div className="big num">{b.totals.jobs}</div>
          <small>lượt AI chạy</small>
        </div>
        <div className="panel p-stat">
          <div className={`big num${b.totals.failed ? " bad" : ""}`}>{b.totals.failed}</div>
          <small>lượt lỗi</small>
        </div>
        <div className="panel p-stat">
          <div className="big num">{ms(b.totals.p50_ms)}</div>
          <small>thời gian trả lời thường gặp</small>
        </div>
        <div className="panel p-stat">
          <div className="big num">{ms(b.totals.p95_ms)}</div>
          <small>lâu nhất (95% số lượt)</small>
        </div>
      </div>
      <div className="two">
        <div className="panel p-chart">
          <h3>AI chạy mỗi ngày</h3>
          {byDay(
            b.byDay,
            (r) => r.day,
            (r) => ({ value: r?.jobs ?? 0, alt: r?.failed ?? 0 }),
          )}
        </div>
        <div className="panel p-chart">
          <h3>Theo loại việc</h3>
          <HBars data={b.byKind.map((k) => ({ label: k.kind, value: k.jobs, hint: k.failed ? `${k.failed} lỗi` : undefined }))} empty="Chưa có lượt nào" />
        </div>
        <div className="panel p-chart">
          <h3>Xung đột phát hiện mỗi ngày</h3>
          {byDay(
            data.conflicts.byDay,
            (r) => r.k,
            (r) => ({ value: r?.n ?? 0 }),
          )}
        </div>
        <div className="panel p-chart">
          <h3>Xung đột theo lớp, mức, trạng thái</h3>
          <HBars data={toBars(data.conflicts.byLayer)} />
          <HBars data={toBars(data.conflicts.byLevel)} />
          <HBars data={toBars(data.conflicts.byStatus)} />
        </div>
        <div className="panel p-chart">
          <h3>Câu hỏi</h3>
          <HBars data={toBars(data.tickets.byTier, (k) => TIER[k] ?? k)} empty="Chưa có câu hỏi" />
          <HBars data={toBars(data.tickets.byStatus)} empty="" />
        </div>
        <div className="panel p-chart">
          <h3>Sự kiện theo loại</h3>
          <HBars data={toBars(data.events.byType.slice(0, 14))} />
        </div>
      </div>
      <div className="panel p-chart">
        <h3>Lượt AI gần đây</h3>
        <BrainJobsTable jobs={b.recent} />
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

/** Progress of the board: the "Tiến độ" view of the Việc page. */
export function ProgressView() {
  const { id, detail } = useProject();
  const [range, setRange] = useState<Range>("14");
  const board = usePoll(() => api.board.list(id, "all"), [id], 10_000);
  const n = Number(range);
  const p = useMemo(() => (board.data ? progress(board.data, n) : null), [board.data, n]);
  if (board.error && !board.data) return <ErrorNotice error={board.error} />;
  if (!p) return <Loading />;
  const b = detail.board;
  const delta = p.doneIn - p.donePrev;
  if (p.live.length === 0) return <Blank title="Chưa có việc trên bảng">Thêm việc, hoặc để agent tự đăng ký khi bắt đầu làm.</Blank>;
  return (
    <div className="progress-view">
      <div className="acts" style={{ marginTop: 0 }}>
        <Seg
          label="Khoảng ngày"
          value={range}
          onChange={setRange}
          options={[
            ["7", "7 ngày"],
            ["14", "14 ngày"],
            ["30", "30 ngày"],
          ]}
        />
      </div>
      <div className="prog">
        <div className="panel p-stat">
          <div className="big num">
            {b.done}/{b.total}
          </div>
          <small>việc đã xong</small>
        </div>
        <div className="panel p-stat" title={`Kỳ trước: ${p.donePrev}`}>
          <div className="big num">
            {p.doneIn} {delta !== 0 && <span className={`p-delta${delta < 0 ? " down" : ""}`}>{delta > 0 ? `▲ ${delta}` : `▼ ${-delta}`}</span>}
          </div>
          <small>xong trong {range} ngày, so với kỳ trước</small>
        </div>
        <div className="panel p-stat">
          <div className="big num">{fmtDays(p.cycle)}</div>
          <small>từ lúc bắt đầu tới lúc xong (trung vị)</small>
        </div>
        <div className="panel p-stat">
          <div className={`big num${b.blocked || b.overdue ? " bad" : ""}`}>{b.blocked}</div>
          <small>bị chặn · {b.overdue} quá hạn</small>
        </div>
      </div>
      <div className="two">
        <div className="panel p-chart">
          <h3 title="Số việc chưa xong vào cuối mỗi ngày. Đường đi xuống là đang về đích.">Việc còn lại, {range} ngày</h3>
          <LineChart data={p.open} unit="việc còn lại" />
        </div>
        <div className="panel p-chart">
          <h3>Xong mỗi ngày</h3>
          <BarsChart data={p.done} unit="việc xong" />
        </div>
        <div className="panel p-chart">
          <h3>Theo người</h3>
          <div className="p-bars">
            {p.byPerson.map((x) => (
              <div className="b" key={x.name || "-"}>
                <span className="p-who">
                  {x.name ? <Av who={x.name} agent={x.agent} size="sm" /> : null}
                  {x.name || "Chưa giao"}
                </span>
                <span className="track" title={x.segments.map((s) => `${s.value} ${s.label}`).join(" · ")}>
                  {x.segments.map((s) => (s.value ? <i key={s.key} className={s.key} style={{ flex: s.value }} /> : null))}
                </span>
                <span className="num muted">
                  {x.done}/{x.total}
                </span>
              </div>
            ))}
          </div>
          <div className="keys">
            <span>
              <i className="done" />
              xong
            </span>
            <span>
              <i className="doing" />
              đang làm
            </span>
            <span>
              <i className="blocked" />
              bị chặn
            </span>
            <span>
              <i className="todo" />
              cần làm
            </span>
          </div>
        </div>
        <div className="panel p-chart">
          <h3>Tới hạn trong 7 ngày</h3>
          {p.upcoming.length === 0 ? (
            <p className="muted">Không có việc nào tới hạn trong 7 ngày.</p>
          ) : (
            <div className="duelist">
              {p.upcoming.slice(0, 8).map((x) => (
                <Link key={x.id} to={`/p/${id}/work?task=${encodeURIComponent(x.id)}`}>
                  {x.assignee ? <Av who={x.assignee} size="sm" /> : <span className="av sm">?</span>}
                  <span>{x.title}</span>
                  <span className={`faint${x.overdue ? " bad" : ""}`}>
                    {x.due_date!.slice(8, 10)}/{x.due_date!.slice(5, 7)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
