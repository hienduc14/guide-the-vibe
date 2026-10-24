import { api } from "../../api/endpoints";
import type { ActivityEvent, Person, Task } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { Card, Stat } from "../../components/Card";
import { Badge, StatusBadge } from "../../components/Badge";
import { Table } from "../../components/Table";
import { Empty } from "../../components/Empty";
import { ago, clock, parseJson } from "../../lib/format";

/** One-line human summary of an event_log row. */
function describe(e: ActivityEvent): string {
  const p = parseJson(e.payload) as Record<string, any>;
  switch (e.type) {
    case "session_start":
      return `mở phiên ${p.agent ?? ""} (${p.workspace_label ?? ""})`;
    case "register":
      return `đăng ký task “${p.title}”`;
    case "snapshot":
      return `snapshot ${String(p.sha ?? "").slice(0, 8)}`;
    case "conflict":
      return `${p.layer} ${p.level}: ${p.message}`;
    case "ticket_ask":
      return `hỏi: ${p.question}`;
    case "ticket_tier1":
      return `Operator → ${p.output?.route ?? "?"} (${p.ms ?? "?"} ms)`;
    case "drift":
      return `sửa ngoài phạm vi: ${(p.paths ?? []).join(", ")}`;
    case "shadow_conflicts":
      return `[shadow] ${p.feature}: ${(p.found ?? []).length} phát hiện`;
    case "feature_set":
      return `đặt ${p.feature} = ${p.mode ?? "default"}`;
    case "feature_error":
      return `lỗi ${p.feature}: ${p.error}`;
    case "manual_message":
      return `ghi chú gửi ${p.to_dev}: ${p.body}`;
    case "work_merged":
      return `work đã merge vào main`;
    default:
      return typeof p === "string" ? p : Object.keys(p ?? {}).slice(0, 4).join(", ");
  }
}

export function ProjectOverview() {
  const { id, detail } = useProject();
  const state = usePoll(() => api.projects.state(id), [id], 5000);
  const activity = usePoll(() => api.projects.activity(id, 40), [id], 5000);
  const c = detail.counts;

  return (
    <>
      <div className="grid stats">
        <Stat label="Đang làm" value={c.people_active} hint={`${c.sessions_active} phiên agent`} />
        <Stat label="Task" value={c.tasks_active} />
        <Stat label="Conflict mở" value={c.conflicts_open} alert={c.conflicts_by_level.high + c.conflicts_by_level.critical > 0} hint={`${c.conflicts_by_level.high} high · ${c.conflicts_by_level.critical} critical`} />
        <Stat label="Ticket chờ" value={c.tickets_waiting} />
        <Stat label="Code graph" value={detail.graph.symbols} hint={`${detail.graph.files} file · ${detail.graph.refs} tham chiếu`} />
      </div>

      <Card title="Ai đang làm" flush>
        <Table<Person>
          rows={detail.people}
          rowKey={(p) => p.dev}
          empty="Chưa có ai kết nối vào project này"
          columns={[
            { key: "dev", title: "Dev", render: (p) => <b>{p.dev}</b> },
            { key: "status", title: "Trạng thái", render: (p) => <StatusBadge status={p.status} /> },
            { key: "agents", title: "Agent", render: (p) => <div className="row">{p.agents.length ? p.agents.map((a) => <Badge key={a}>{a}</Badge>) : <span className="faint">—</span>}</div> },
            { key: "ws", title: "Workspace", render: (p) => <span className="mono xs">{p.workspaces.join(", ") || "—"}</span> },
            { key: "tasks", title: "Task", render: (p) => (p.tasks.length ? p.tasks.join("; ") : <span className="faint">chưa đăng ký</span>) },
            { key: "editing", title: "Đang sửa", render: (p) => <span className="mono">{p.editing}</span> },
            { key: "conflicts", title: "Conflict", render: (p) => <span className={`mono${p.conflicts ? " danger-text" : ""}`}>{p.conflicts}</span> },
            { key: "seen", title: "Lần cuối", render: (p) => <span className="xs muted">{ago(p.last_seen)}</span> },
          ]}
        />
      </Card>

      <div className="split">
        <Card title="Task đang chạy" flush>
          {state.data?.tasks.length ? (
            <div className="feed">
              {state.data.tasks.map((t: Task) => (
                <div key={t.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }} className="stack tight">
                  <div className="row between">
                    <b className="small">{t.title}</b>
                    <span className="xs muted">
                      {t.dev} · {ago(t.created_at)}
                    </span>
                  </div>
                  {t.goal && <span className="small muted">{t.goal}</span>}
                  <div className="row">
                    {t.resources.map((r, i) => (
                      <Badge key={i} mono tone={r.op === "sig_change" || r.op === "rename" || r.op === "delete" ? "strong" : "default"}>
                        {r.kind}:{r.value}
                        {r.op ? ` · ${r.op}` : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Không có task nào đang chạy</Empty>
          )}
        </Card>

        <Card title="Hoạt động gần đây" flush>
          {activity.data?.length ? (
            <div className="feed">
              {activity.data.map((e) => (
                <div className="feed-item" key={e.id}>
                  <span className="xs faint mono">{clock(e.ts)}</span>
                  <span className="wrap-anywhere">
                    <b>{e.actor ?? "system"}</b> <span className="muted">{describe(e)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Chưa có hoạt động</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
