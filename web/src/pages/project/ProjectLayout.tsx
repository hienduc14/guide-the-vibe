import { createContext, useContext } from "react";
import { Outlet, useParams } from "react-router-dom";
import { api } from "../../api/endpoints";
import type { ProjectDetail } from "../../api/types";
import { usePoll, type Poll } from "../../hooks/usePoll";
import { PageHead } from "../../components/Layout";
import { Tabs } from "../../components/Tabs";
import { Badge } from "../../components/Badge";
import { ErrorNotice, Loading } from "../../components/Empty";
import { shortSha, ago } from "../../lib/format";

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
          <span className="mono wrap-anywhere">
            {data.repo_url} · {data.main_branch}@{shortSha(data.main_sha)}
            {data.last_sync && (
              <span className={data.last_sync.ok ? "" : "danger-text"}>
                {" "}
                · sync {ago(data.last_sync.at)}
                {data.last_sync.ok ? "" : ` lỗi: ${data.last_sync.error}`}
              </span>
            )}
          </span>
        }
        actions={<Badge mono>{id}</Badge>}
      />
      <Tabs
        items={[
          { to: `/p/${id}`, label: "Tổng quan", end: true },
          { to: `/p/${id}/conflicts`, label: "Conflicts", count: c.conflicts_open },
          { to: `/p/${id}/layers`, label: "Layers" },
          { to: `/p/${id}/qa`, label: "Q&A", count: c.tickets_waiting },
          { to: `/p/${id}/knowledge`, label: "Knowledge", count: c.kb_unverified },
          { to: `/p/${id}/graph`, label: "Code graph" },
          { to: `/p/${id}/stats`, label: "Thống kê" },
          { to: `/p/${id}/settings`, label: "Cài đặt" },
        ]}
      />
      <Outlet />
    </Ctx.Provider>
  );
}
