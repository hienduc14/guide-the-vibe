import { useEffect, useState } from "react";
import { api } from "../../api/endpoints";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { PageHead } from "../../components/Layout";
import { Card, Stat } from "../../components/Card";
import { Segmented } from "../../components/Segmented";
import { BarChart, HBars, lastDays } from "../../components/Charts";
import { Field } from "../../components/Field";
import { ErrorNotice, Loading } from "../../components/Empty";
import { BrainJobsTable } from "./BrainJobsTable";
import { ms } from "../../lib/format";

export function BrainPage() {
  const [days, setDays] = useState<"7" | "30">("7");
  const { data, error, reload } = usePoll(() => api.brain.info(Number(days)), [days], 10_000);
  const run = useAction();
  const [model, setModel] = useState("");
  useEffect(() => {
    if (data) setModel((m) => m || data.model || "");
  }, [data]);

  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const s = data.stats;
  const n = Number(days);

  return (
    <>
      <PageHead
        title="Brain"
        subtitle="LLM của Operator: trả lời câu hỏi, đánh giá đăng ký task (L3), trích intent từ plan. Mọi job đều được đếm theo project."
        actions={
          <Segmented
            options={[
              { value: "7", label: "7 ngày" },
              { value: "30", label: "30 ngày" },
            ]}
            value={days}
            onChange={setDays}
          />
        }
      />

      <div className="split">
        <Card title="Backend">
          <div className="stack">
            <div className="row">
              <span className={`dot${data.health.ok ? " on" : " bad"}`} />
              <b>{data.backend}</b>
              <span className={`small ${data.health.ok ? "muted" : "danger-text"}`}>
                {data.health.detail ?? (data.health.ok ? "sẵn sàng" : "không sẵn sàng")}
              </span>
            </div>
            <form
              className="stack tight"
              onSubmit={async (e) => {
                e.preventDefault();
                await run(() => api.brain.setModel(model.trim() || null), "Đã đổi model");
                void reload();
              }}
            >
              <Field label="Model" hint="provider/model — tài khoản ChatGPT chỉ dùng được các model Codex cho phép">
                <input
                  className="input mono"
                  list="gtv-models"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="openai-codex/gpt-6-luna"
                />
                <datalist id="gtv-models">
                  {data.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <div className="row">
                <button className="btn primary" type="submit" disabled={data.backend === "null"}>
                  Lưu model
                </button>
                <span className="xs faint">Hiện tại: {data.model ?? "mặc định của backend"}</span>
              </div>
            </form>
          </div>
        </Card>
        <div className="grid stats" style={{ alignContent: "start" }}>
          <Stat label="Job" value={s.totals.jobs} />
          <Stat label="Lỗi" value={s.totals.failed} alert={s.totals.failed > 0} />
          <Stat label="Trung bình" value={ms(s.totals.avg_ms)} />
          <Stat label="p50" value={ms(s.totals.p50_ms)} />
          <Stat label="p95" value={ms(s.totals.p95_ms)} />
        </div>
      </div>

      <div className="split">
        <Card title="Job theo ngày">
          <BarChart
            data={lastDays(
              s.byDay,
              n,
              (r) => r.day,
              (r) => ({ value: r?.jobs ?? 0, alt: r?.failed ?? 0 }),
            )}
          />
        </Card>
        <Card title="Theo project · theo loại">
          <div className="stack">
            <HBars data={s.byProject.map((p) => ({ label: p.project, value: p.jobs }))} empty="Chưa có job" />
            <HBars data={s.byKind.map((k) => ({ label: k.kind, value: k.jobs, hint: k.failed ? `${k.failed} lỗi` : undefined }))} empty="" />
          </div>
        </Card>
      </div>

      <Card title="Job gần đây" flush>
        <BrainJobsTable jobs={s.recent} showProject />
      </Card>
    </>
  );
}
