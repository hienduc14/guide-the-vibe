import { createContext, useContext } from "react";
import { Outlet, useParams } from "react-router-dom";
import { api } from "../../api/endpoints";
import type { ProjectDetail } from "../../api/types";
import { usePoll, type Poll } from "../../hooks/usePoll";
import { PageHead } from "../../components/Layout";
import { Tabs } from "../../components/Tabs";
import {
  BookOpen,
  ChartColumn,
  Layers,
  LayoutDashboard,
  MessageCircleQuestion,
  MessagesSquare,
  Network,
  Settings,
  SquareKanban,
  Users,
  Zap,
} from "lucide-react";
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
                {data.last_sync.ok ? "sync" : "sync lỗi"} {ago(data.last_sync.at)}
              </span>
            )}
          </span>
        }
      />
      {data.last_sync && !data.last_sync.ok && (
        <details className="notice error small sync-error">
          <summary>Không lấy được code mới từ repo. Kiểm tra URL repo và quyền truy cập trong Cài đặt.</summary>
          <pre className="mono xs wrap-anywhere">{data.last_sync.error}</pre>
        </details>
      )}
      <Tabs
        items={[
          // What a lead checks every day: progress, running work, collisions, questions waiting for them.
          { to: `/p/${id}`, label: "Tổng quan", icon: LayoutDashboard, end: true },
          { to: `/p/${id}/board`, label: "Việc", icon: SquareKanban, count: data.board.open, alert: data.board.blocked + data.board.overdue > 0 },
          {
            to: `/p/${id}/conversations`,
            label: "Trao đổi",
            icon: MessagesSquare,
            count: c.tickets_waiting,
            alert: c.tickets_waiting > 0,
            title: c.tickets_waiting ? `${c.tickets_waiting} câu hỏi chờ người trả lời` : undefined,
          },
          {
            to: `/p/${id}/conflicts`,
            label: "Conflict",
            icon: Zap,
            count: c.conflicts_open,
            alert: c.conflicts_by_level.high + c.conflicts_by_level.critical > 0,
          },
          { to: `/p/${id}/stats`, label: "Thống kê", icon: ChartColumn },
          // Everything else lives in "Khác".
          { to: `/p/${id}/members`, label: "Thành viên", icon: Users, count: data.members.length, more: "Nhóm" },
          { to: `/p/${id}/knowledge`, label: "Tài liệu", icon: BookOpen, count: c.kb_unverified, more: "Nhóm" },
          { to: `/p/${id}/qa`, label: "Nhật ký hỏi đáp", icon: MessageCircleQuestion, more: "Kỹ thuật" },
          { to: `/p/${id}/graph`, label: "Sơ đồ code", icon: Network, more: "Kỹ thuật" },
          { to: `/p/${id}/layers`, label: "Lớp phát hiện", icon: Layers, more: "Kỹ thuật" },
          { to: `/p/${id}/settings`, label: "Cài đặt", icon: Settings, className: "manage-only", more: "Quản trị" },
        ]}
      />
      <Outlet />
    </Ctx.Provider>
  );
}
