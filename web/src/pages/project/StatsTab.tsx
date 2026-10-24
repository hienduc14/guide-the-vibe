import { useState } from "react";
import { api } from "../../api/endpoints";
import type { KN } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { Card, Stat } from "../../components/Card";
import { Segmented } from "../../components/Segmented";
import { BarChart, HBars, lastDays } from "../../components/Charts";
import { ErrorNotice, Loading } from "../../components/Empty";
import { BrainJobsTable } from "../brain/BrainJobsTable";
import { ms } from "../../lib/format";

const toBars = (rows: KN[], label: (k: string) => string = (k) => k) => rows.map((r) => ({ label: label(r.k), value: r.n }));
const TIER: Record<string, string> = { "1": "Bậc 1 · Operator", "2": "Bậc 2 · agent đồng đội", "3": "Bậc 3 · người" };

export function StatsTab() {
  const { id } = useProject();
  const [days, setDays] = useState<"7" | "30">("7");
  const { data, error } = usePoll(() => api.projects.stats(id, Number(days)), [id, days], 10_000);
  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const b = data.brain;
  const n = Number(days);

  return (
    <div className="stack">
      <div className="row between">
        <h2>Brain</h2>
        <Segmented options={[{ value: "7", label: "7 ngày" }, { value: "30", label: "30 ngày" }]} value={days} onChange={setDays} />
      </div>
      <div className="grid stats">
        <Stat label="Job" value={b.totals.jobs} />
        <Stat label="Lỗi" value={b.totals.failed} alert={b.totals.failed > 0} />
        <Stat label="p50" value={ms(b.totals.p50_ms)} />
        <Stat label="p95" value={ms(b.totals.p95_ms)} />
      </div>
      <div className="split">
        <Card title="Job theo ngày">
          <BarChart data={lastDays(b.byDay, n, (r) => r.day, (r) => ({ value: r?.jobs ?? 0, alt: r?.failed ?? 0 }))} />
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
          <BarChart data={lastDays(data.conflicts.byDay, n, (r) => r.k, (r) => ({ value: r?.n ?? 0 }))} />
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
          <BarChart data={lastDays(data.events.byDay, n, (r) => r.k, (r) => ({ value: r?.n ?? 0 }))} />
        </Card>
        <Card title="Theo loại">
          <HBars data={toBars(data.events.byType.slice(0, 14))} />
        </Card>
      </div>
    </div>
  );
}
