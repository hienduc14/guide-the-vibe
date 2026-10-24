import type { BrainJob } from "../../api/types";
import { Table } from "../../components/Table";
import { Badge } from "../../components/Badge";
import { ago, ms } from "../../lib/format";

export function BrainJobsTable({ jobs, showProject }: { jobs: BrainJob[]; showProject?: boolean }) {
  return (
    <Table<BrainJob>
      rows={jobs}
      rowKey={(j) => String(j.id)}
      empty="Chưa có job nào"
      columns={[
        { key: "at", title: "Lúc", render: (j) => <span className="xs muted">{ago(j.ts)}</span> },
        ...(showProject ? [{ key: "p", title: "Project", render: (j: BrainJob) => <span className="mono xs">{j.project}</span> }] : []),
        { key: "k", title: "Loại", render: (j) => <span className="mono xs">{j.kind}</span> },
        { key: "m", title: "Model", render: (j) => <span className="mono xs muted">{j.model ?? j.backend}</span> },
        { key: "ms", title: "Thời gian", render: (j) => <span className="mono xs">{ms(j.ms)}</span> },
        {
          key: "ok",
          title: "Kết quả",
          render: (j) =>
            j.ok ? (
              <Badge>ok</Badge>
            ) : (
              <span className="stack tight" style={{ gap: 2 }}>
                <Badge tone="danger">lỗi</Badge>
                <span className="xs danger-text wrap-anywhere">{j.error}</span>
              </span>
            ),
        },
      ]}
    />
  );
}
