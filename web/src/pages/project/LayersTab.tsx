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

/** Vietnamese descriptions for the dashboard; the server's English text stays as a fallback for new features. */
const DESC_VI: Record<string, string> = {
  registration: "Đăng ký task và báo khi trùng việc người khác",
  "registration.auto_from_plan": "Tự soạn đăng ký từ kế hoạch của agent",
  drift_check: "Cảnh báo khi agent sửa ra ngoài phạm vi đã đăng ký",
  "detect.l0_path": "Trùng đường dẫn hoặc module",
  "detect.l1_merge": "Thử merge trước các bản đang làm dở (git merge-tree)",
  "detect.l2_symbol": "Symbol bị đổi trong khi chỗ khác đang dùng (tree-sitter)",
  "detect.l3_semantic": "LLM đánh giá các đăng ký và bằng chứng",
  "knowledge.code_graph": "Sơ đồ code bằng tree-sitter (bản gốc + phần đang sửa của từng người)",
  "knowledge.doc_kb": "Tìm toàn văn trong tài liệu nghiệp vụ, ADR, hỏi đáp",
  "qa.tier1_answer": "Operator tự trả lời câu hỏi",
  "qa.tier2_relay": "Chuyển câu hỏi tới agent của dev khác",
  "qa.tier3_human": "Hỏi người khi các agent không tự quyết được",
  "policy.ask": "Hỏi lại hoặc chặn khi có conflict high và critical",
  "coord.priority": "Kèm độ ưu tiên và hạn của mỗi bên, khuyên bên thấp hơn nhường",
  "notify.desktop": "Thông báo trên máy của dev",
  brain: "Brain LLM (Pi / null)",
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
        <span className="small" title={l.description}>
          {DESC_VI[l.key] ?? l.description}
        </span>
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
      <p className="xs muted">
        <b>off</b> không chạy · <b>shadow</b> chạy, chỉ ghi log · <b>on</b> chạy và báo
      </p>
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
