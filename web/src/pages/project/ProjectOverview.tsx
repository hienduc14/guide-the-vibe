import { api } from "../../api/endpoints";
import type { Person, Task } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { Card, Stat } from "../../components/Card";
import { Badge, StatusBadge } from "../../components/Badge";
import { Table } from "../../components/Table";
import { Empty } from "../../components/Empty";
import { ago } from "../../lib/format";
import { ActivityFeed } from "./ActivityFeed";

export function ProjectOverview() {
  const { id, detail } = useProject();
  const state = usePoll(() => api.projects.state(id), [id], 5000);
  const activity = usePoll(() => api.projects.activity(id, 120), [id], 5000);
  const c = detail.counts;

  return (
    <>
      <div className="grid stats">
        <Stat label="Đang làm" value={c.people_active} hint={`${c.sessions_active} phiên agent`} />
        <Stat label="Task" value={c.tasks_active} />
        <Stat
          label="Conflict mở"
          value={c.conflicts_open}
          alert={c.conflicts_by_level.high + c.conflicts_by_level.critical > 0}
          hint={`${c.conflicts_by_level.high} high · ${c.conflicts_by_level.critical} critical`}
        />
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
            {
              key: "agents",
              title: "Agent",
              render: (p) => <div className="row">{p.agents.length ? p.agents.map((a) => <Badge key={a}>{a}</Badge>) : <span className="faint">—</span>}</div>,
            },
            { key: "ws", title: "Workspace", render: (p) => <span className="mono xs">{p.workspaces.join(", ") || "—"}</span> },
            {
              key: "tasks",
              title: "Task",
              render: (p) => <span className="cell-wide">{p.tasks.length ? p.tasks.join("; ") : <span className="faint">chưa đăng ký</span>}</span>,
            },
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
                <div key={t.id} className="task-item stack tight">
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

        <ActivityFeed events={activity.data ?? []} />
      </div>
    </>
  );
}
