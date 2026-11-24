import { createContext, useContext } from "react";
import { Outlet, useParams } from "react-router-dom";
import { api } from "../../api/endpoints";
import type { ProjectDetail } from "../../api/types";
import { usePoll, type Poll } from "../../hooks/usePoll";
import { PageHead } from "../../components/Layout";
import { Tabs } from "../../components/Tabs";
import { ErrorNotice, Loading } from "../../components/Empty";
import { shortSha, ago, repoName } from "../../lib/format";

interface ProjectCtx {
  id: string;
  detail: ProjectDetail;
  reload: Poll<ProjectDetail>["reload"];
}

const Ctx = createContext<ProjectCtx | null>(null);

export function useProject(): ProjectCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProject outside ProjectLayout");
  return c;
}

export function ProjectLayout() {
  const { id = "" } = useParams();
  const { data, error, reload } = usePoll(() => api.projects.detail(id), [id], 5000);
  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const c = data.counts;
  return (
    <Ctx.Provider value={{ id, detail: data, reload }}>
      <PageHead
        title={data.name}
        subtitle={
          <span className="meta">
            <span className="mono" title={data.repo_url}>
              {repoName(data.repo_url)}
            </span>
            <span className="mono">
              {data.main_branch}@{shortSha(data.main_sha)}
            </span>
            {data.last_sync && (
              <span className={data.last_sync.ok ? "" : "danger-text"}>
                sync {ago(data.last_sync.at)}
                {data.last_sync.ok ? "" : ` lỗi: ${data.last_sync.error}`}
              </span>
            )}
          </span>
        }
      />
      <Tabs
        items={[
          { to: `/p/${id}`, label: "Tổng quan", end: true },
          { to: `/p/${id}/board`, label: "Việc", count: data.board.open, alert: data.board.blocked + data.board.overdue > 0 },
          { to: `/p/${id}/conversations`, label: "Trao đổi" },
          { to: `/p/${id}/members`, label: "Thành viên", count: data.members.length },
          { to: `/p/${id}/conflicts`, label: "Conflicts", count: c.conflicts_open, alert: c.conflicts_by_level.high + c.conflicts_by_level.critical > 0 },
          { to: `/p/${id}/layers`, label: "Layers" },
          { to: `/p/${id}/qa`, label: "Q&A", count: c.tickets_waiting, alert: c.tickets_waiting > 0 },
          { to: `/p/${id}/knowledge`, label: "Tài liệu", count: c.kb_unverified },
          { to: `/p/${id}/graph`, label: "Code graph" },
          { to: `/p/${id}/stats`, label: "Thống kê" },
          { to: `/p/${id}/settings`, label: "Cài đặt", className: "manage-only" },
        ]}
      />
      <Outlet />
    </Ctx.Provider>
  );
}
