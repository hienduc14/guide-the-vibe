import { useEffect, useState } from "react";
import { api } from "../../api/endpoints";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { PageHead } from "../../components/Layout";
import { Card } from "../../components/Card";
import { Segmented } from "../../components/Segmented";
import { BarChart, HBars, lastDays } from "../../components/Charts";
import { Field } from "../../components/Field";
import { ErrorNotice, Loading } from "../../components/Empty";
import { BrainJobsTable } from "./BrainJobsTable";
import { ProvidersCard } from "./ProvidersCard";
import { ms } from "../../lib/format";

/** "provider/model" ids grouped by provider, in the order the server lists them. */
function groupModels(models: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of models) {
    const provider = m.split("/")[0];
    out.set(provider, [...(out.get(provider) ?? []), m]);
  }
  return out;
}

export function BrainPage() {
  const [days, setDays] = useState<"7" | "30">("7");
  const { data, error, reload } = usePoll(() => api.brain.info(Number(days)), [days], 10_000);
  const run = useAction();
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  useEffect(() => {
    if (data) {
      setModel((m) => m || data.model || "");
      setThinking((t) => t || data.thinking || "off");
    }
  }, [data]);

  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const s = data.stats;
  const n = Number(days);
  const off = data.backend === "null";

  return (
    <>
      <PageHead
        title="Brain"
        subtitle="Model AI của Operator. Nó trả lời câu hỏi của agent khi thông tin có sẵn trong code hoặc tài liệu, và xét các việc có nguy cơ đụng nhau."
      />

      <Card
        title={
          <div className="row" style={{ gap: 10 }}>
            <span className={`dot${data.health.ok ? " on" : " bad"}`} />
            <h3>{off ? "Brain đang tắt" : data.health.ok ? "Brain sẵn sàng" : "Brain chưa chạy được"}</h3>
          </div>
        }
        actions={
          off || data.health.ok ? undefined : (
            <span className="small danger-text">
              {data.model ? (data.health.detail ?? "Không gọi được model") : "Chưa chọn model: kết nối một provider rồi chọn model ở đây."}
            </span>
          )
        }
      >
        {off ? (
          <p className="small muted">
            Operator vẫn báo trùng việc, nhưng không tự trả lời câu hỏi và không xét ngữ nghĩa (L3). Bật bằng biến <code>BRAIN_BACKEND=pi</code> rồi khởi động
            lại server.
          </p>
        ) : (
          <form
            className="form-grid"
            style={{ alignItems: "end" }}
            onSubmit={async (e) => {
              e.preventDefault();
              await run(() => api.brain.setModel(model.trim() || null, data.thinking === null ? undefined : thinking), "Đã lưu model");
              void reload();
            }}
          >
            <Field
              label="Model"
              hint={data.models.length ? `${data.models.length} model từ các provider đã kết nối` : "Kết nối một provider bên dưới để có danh sách model"}
            >
              <select id="brain-model" className="select mono" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">Chưa chọn</option>
                {model && !data.models.includes(model) && <option value={model}>{model}</option>}
                {[...groupModels(data.models)].map(([provider, ids]) => (
                  <optgroup key={provider} label={provider}>
                    {ids.map((m) => (
                      <option key={m} value={m}>
                        {m.slice(provider.length + 1)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            {data.thinking !== null && (
              <Field label="Mức suy nghĩ" hint="Không suy nghĩ là nhanh nhất. Mức cao suy luận kỹ hơn nhưng chậm và tốn hơn.">
                <Segmented
                  options={[
                    { value: "off", label: "Không" },
                    { value: "low", label: "Thấp" },
                    { value: "medium", label: "Vừa" },
                    { value: "high", label: "Cao" },
                  ]}
                  value={thinking as "off" | "low" | "medium" | "high"}
                  onChange={setThinking}
                />
              </Field>
            )}
            <div className="row">
              <button className="btn primary" type="submit" disabled={model.trim() === (data.model ?? "") && thinking === (data.thinking ?? "off")}>
                Lưu model
              </button>
            </div>
          </form>
        )}
      </Card>

      {!off && <ProvidersCard model={data.model} onChange={() => void reload()} />}

      <section className="stack">
        <div className="row between">
          <h2>Hoạt động</h2>
          <Segmented
            options={[
              { value: "7", label: "7 ngày" },
              { value: "30", label: "30 ngày" },
            ]}
            value={days}
            onChange={setDays}
          />
        </div>
        <div className="summary">
          <span className="chip">
            <b>{s.totals.jobs}</b> việc
          </span>
          <span className={`chip${s.totals.failed ? " alert" : ""}`}>
            <b>{s.totals.failed}</b> lỗi
          </span>
          <span className="chip" title="Một nửa số việc xong nhanh hơn mức này">
            <b>{ms(s.totals.p50_ms)}</b> thời gian thường gặp
          </span>
          <span className="chip" title="95% số việc xong nhanh hơn mức này">
            <b>{ms(s.totals.p95_ms)}</b> chậm nhất (p95)
          </span>
        </div>
        <div className="split">
          <Card title="Việc theo ngày">
            <BarChart
              data={lastDays(
                s.byDay,
                n,
                (r) => r.day,
                (r) => ({ value: r?.jobs ?? 0, alt: r?.failed ?? 0 }),
              )}
            />
          </Card>
          <Card title="Theo project và theo loại việc">
            <div className="stack">
              <HBars data={s.byProject.map((p) => ({ label: p.project, value: p.jobs }))} empty="Chưa có việc nào" />
              <HBars data={s.byKind.map((k) => ({ label: k.kind, value: k.jobs, hint: k.failed ? `${k.failed} lỗi` : undefined }))} empty="" />
            </div>
          </Card>
        </div>
        <Card title="Việc gần đây" flush>
          <BrainJobsTable jobs={s.recent} showProject />
        </Card>
      </section>
    </>
  );
}
