import { useState } from "react";
import { api } from "../../api/endpoints";
import type { Conflict } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { LevelBadge, StatusBadge, Badge } from "../../components/Badge";
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

function ConflictRow({ c, onAct }: { c: Conflict; onAct: (a: "ack" | "dismiss" | "reopen") => void }) {
  const open = c.status === "open" || c.status === "acked";
  return (
    <div className="layer-row">
      <div className="stack tight" style={{ minWidth: 0 }}>
        <div className="row">
          <LevelBadge level={c.level} />
          <StatusBadge status={c.status} />
          <Badge mono>{c.kind}</Badge>
          <span className="xs faint">
            {c.dev_a} ↔ {c.dev_b} · {ago(c.updated_at)}
          </span>
        </div>
        <span className="small wrap-anywhere">{c.message}</span>
        <span className="xs mono faint wrap-anywhere">{c.subject}</span>
        <JsonView value={c.evidence} label="Bằng chứng" />
      </div>
      <div className="row" style={{ alignSelf: "start" }}>
        {c.status === "open" && (
          <button className="btn sm" type="button" onClick={() => onAct("ack")}>
            Ack
          </button>
        )}
        {open && (
          <button className="btn sm" type="button" onClick={() => onAct("dismiss")}>
            Bỏ qua
          </button>
        )}
        {!open || c.status === "acked" ? (
          <button className="btn sm ghost" type="button" onClick={() => onAct("reopen")}>
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
    await run(() => api.conflicts.act(id, c.id, action), action === "ack" ? "Đã ack" : action === "dismiss" ? "Đã bỏ qua" : "Đã mở lại");
    void reload();
    void reloadProject();
  };

  const groups = new Map<string, Conflict[]>();
  for (const c of [...(data ?? [])].sort((a, b) => RANK[a.level] - RANK[b.level])) groups.set(c.layer, [...(groups.get(c.layer) ?? []), c]);

  return (
    <div className="stack">
      <div className="row between">
        <p className="small muted">
          Conflict do các layer phát hiện giữa các workspace. Ack khi hai bên đã phối hợp; bỏ qua nếu là báo nhầm (sẽ không báo lại tới khi bằng chứng thay
          đổi).
        </p>
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
