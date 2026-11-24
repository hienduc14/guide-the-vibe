import { Zap } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/endpoints";
import type { Conflict } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { LevelBadge, StatusBadge } from "../../components/Badge";
import { Segmented } from "../../components/Segmented";
import { JsonView } from "../../components/JsonView";
import { Empty, ErrorNotice, Loading } from "../../components/Empty";
import { ago } from "../../lib/format";

const LAYER_TITLE: Record<string, string> = {
  L0: "L0 · path / scope / khai báo",
  L1: "L1 · thử merge (git merge-tree)",
  L2: "L2 · symbol (tree-sitter)",
  L3: "L3 · ngữ nghĩa (Brain)",
};
const RANK = { critical: 0, high: 1, warning: 2, info: 3 };
/** What the two sides collide on, as a short headline; the server's full sentence stays below it. */
const KIND_VI: Record<string, string> = {
  same_contract: "Cùng đụng một contract",
  same_file: "Cùng sửa một file",
  same_module: "Cùng sửa một module",
  scope_overlap: "Phạm vi đăng ký trùng nhau",
  same_symbol_changed: "Cùng đổi một symbol",
  same_symbol_declared: "Cùng khai báo một symbol",
  breaking_change_used: "Đổi symbol mà bên kia đang dùng",
  semantic: "Brain thấy hai việc xung khắc",
};

function ConflictRow({ c, onAct }: { c: Conflict; onAct: (a: "ack" | "dismiss" | "reopen") => void }) {
  const open = c.status === "open" || c.status === "acked";
  return (
    <div className="layer-row">
      <div className="stack tight" style={{ minWidth: 0 }}>
        <div className="row">
          <LevelBadge level={c.level} />
          {c.status !== "open" && <StatusBadge status={c.status} />}
          <b className="small">{KIND_VI[c.kind] ?? c.kind}</b>
          <span className="xs faint">
            · <b className="muted">{c.dev_a}</b> và <b className="muted">{c.dev_b}</b> · {ago(c.updated_at)}
          </span>
        </div>
        <code className="small wrap-anywhere">{c.subject}</code>
        <span className="xs muted wrap-anywhere">{c.message}</span>
        <JsonView value={c.evidence} label="Bằng chứng" />
      </div>
      <div className="row" style={{ alignSelf: "start" }}>
        {c.status === "open" && (
          <button className="btn sm manage-only" type="button" onClick={() => onAct("ack")} title="Hai bên đã biết và đang phối hợp">
            Đã biết
          </button>
        )}
        {open && (
          <button className="btn sm manage-only" type="button" onClick={() => onAct("dismiss")}>
            Bỏ qua
          </button>
        )}
        {!open || c.status === "acked" ? (
          <button className="btn sm ghost manage-only" type="button" onClick={() => onAct("reopen")}>
            Mở lại
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ConflictsTab() {
  const { id, reload: reloadProject } = useProject();
  const [scope, setScope] = useState<"open" | "all">("open");
  const { data, error, reload } = usePoll(() => api.conflicts.list(id, scope === "all"), [id, scope], 5000);
  const run = useAction();

  const act = async (c: Conflict, action: "ack" | "dismiss" | "reopen") => {
    await run(() => api.conflicts.act(id, c.id, action), action === "ack" ? "Đã đánh dấu là đã biết" : action === "dismiss" ? "Đã bỏ qua" : "Đã mở lại");
    void reload();
    void reloadProject();
  };

  const groups = new Map<string, Conflict[]>();
  for (const c of [...(data ?? [])].sort((a, b) => RANK[a.level] - RANK[b.level])) groups.set(c.layer, [...(groups.get(c.layer) ?? []), c]);

  return (
    <div className="stack">
      <div className="row between">
        <h2 className="section-title" title="Bấm “Đã biết” khi hai bên đã phối hợp; “Bỏ qua” nếu là báo nhầm (không báo lại tới khi bằng chứng thay đổi).">
          <Zap />
          Conflict
        </h2>
        <Segmented
          options={[
            { value: "open", label: "Đang mở" },
            { value: "all", label: "Tất cả" },
          ]}
          value={scope}
          onChange={setScope}
        />
      </div>
      {error && <ErrorNotice error={error} />}
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Card>
          <Empty>Không có conflict {scope === "open" ? "đang mở" : ""}</Empty>
        </Card>
      ) : (
        ["L0", "L1", "L2", "L3"]
          .filter((l) => groups.has(l))
          .map((l) => (
            <Card key={l} title={LAYER_TITLE[l] ?? l} actions={<span className="xs muted">{groups.get(l)!.length}</span>} flush>
              {groups.get(l)!.map((c) => (
                <ConflictRow key={c.id} c={c} onAct={(a) => act(c, a)} />
              ))}
            </Card>
          ))
      )}
    </div>
  );
}
