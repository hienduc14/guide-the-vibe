import { api } from "../../api/endpoints";
import type { FeatureMode, Layer } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { Badge } from "../../components/Badge";
import { Segmented } from "../../components/Segmented";
import { ErrorNotice, Loading } from "../../components/Empty";

const GROUPS: { title: string; prefix: (k: string) => boolean }[] = [
  { title: "Phát hiện conflict", prefix: (k) => k.startsWith("detect.") },
  { title: "Đăng ký task", prefix: (k) => k.startsWith("registration") || k === "drift_check" || k === "policy.ask" },
  { title: "Hỏi đáp", prefix: (k) => k.startsWith("qa.") },
  { title: "Tri thức", prefix: (k) => k.startsWith("knowledge.") },
  { title: "Hệ thống", prefix: (k) => k === "brain" || k.startsWith("notify.") },
];

const METRIC_LABEL: Record<string, string> = {
  open: "đang mở",
  total: "tổng",
  shadow_detections: "phát hiện (shadow)",
  files: "file",
  symbols: "symbol",
  refs: "tham chiếu",
  documents: "tài liệu",
  tickets: "ticket",
  drift_events: "lần sửa ngoài scope",
  tasks: "task",
};

function LayerRow({ l, blockedBy, onSet }: { l: Layer; blockedBy: string[]; onSet: (m: FeatureMode | null) => void }) {
  const metrics = Object.entries(l.metrics);
  const changed = l.override !== null;
  return (
    <div className="layer-row">
      <div className="stack tight" style={{ minWidth: 0 }}>
        <div className="row">
          {l.layer && <Badge tone="solid">{l.layer}</Badge>}
          <code className="small">{l.key}</code>
          {changed && <Badge>chỉnh tay · mặc định: {l.default}</Badge>}
          {blockedBy.length > 0 && <Badge tone="danger-outline">đang tắt do: {blockedBy.join(", ")}</Badge>}
          {l.tripped && <Badge tone="danger">tự ngắt</Badge>}
        </div>
        <span className="small">{l.description}</span>
        <div className="kv">
          {metrics.map(([k, v]) => (
            <span key={k}>
              {METRIC_LABEL[k] ?? k} <b>{v ?? "—"}</b>
            </span>
          ))}
          {l.errors > 0 && (
            <span className="danger-text">
              lỗi <b className="danger-text">{l.errors}</b>
            </span>
          )}
          {l.requires.length > 0 && <span>cần: {l.requires.join(", ")}</span>}
        </div>
        {l.tripped && <span className="xs danger-text">Cầu dao: {l.tripped}. Đặt lại chế độ để bật lại.</span>}
      </div>
      <div className="stack tight manage-only" style={{ alignItems: "flex-end" }}>
        <Segmented<FeatureMode>
          options={[
            { value: "off", label: "off", title: "Không chạy" },
            { value: "shadow", label: "shadow", title: "Chạy và ghi log, không báo ai" },
            { value: "on", label: "on", title: "Chạy và báo" },
          ]}
          value={l.mode}
          onChange={(m) => onSet(m)}
        />
        {changed && (
          <button type="button" className="btn sm ghost" onClick={() => onSet(null)}>
            về mặc định
          </button>
        )}
      </div>
    </div>
  );
}

export function LayersTab() {
  const { id } = useProject();
  const { data, error, reload } = usePoll(() => api.projects.layers(id), [id], 5000);
  const run = useAction();

  const set = async (l: Layer, mode: FeatureMode | null) => {
    await run(() => api.features.set(id, l.key, mode), `${l.key} → ${mode ?? "mặc định"}`);
    void reload();
  };

  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const blockedBy = (l: Layer) => l.blocked_by ?? [];
  return (
    <div className="stack">
      <div className="notice">
        Mỗi tính năng có 3 chế độ: <b>off</b> — không chạy; <b>shadow</b> — chạy và ghi log để đánh giá nhưng không báo agent hay người; <b>on</b> — chạy và
        báo. Tính năng phụ thuộc (cột “cần”) tự tắt khi phụ thuộc bị tắt. Lỗi lặp lại sẽ ngắt tự động.
      </div>
      {GROUPS.map((g) => {
        const rows = data.filter((l) => g.prefix(l.key));
        if (!rows.length) return null;
        return (
          <Card key={g.title} title={g.title} flush>
            {rows.map((l) => (
              <LayerRow key={l.key} l={l} blockedBy={blockedBy(l)} onSet={(m) => set(l, m)} />
            ))}
          </Card>
        );
      })}
    </div>
  );
}
