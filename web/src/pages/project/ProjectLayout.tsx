import { createContext, useContext, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BookOpen, ChevronDown, GitBranch, Inbox, MessagesSquare, Moon, SlidersHorizontal, Activity, SquareKanban, Sun } from "lucide-react";
import { api } from "../../api/endpoints";
import type { ProjectAccess, ProjectDetail } from "../../api/types";
import { isLoaded } from "../../api/types";
import { usePoll, type Poll } from "../../hooks/usePoll";
import { useOverview } from "../../hooks/useOverview";
import { useAuth } from "../../hooks/useAuth";
import { PeopleProvider } from "../../hooks/usePeople";
import { ErrorNotice, Loading } from "../../components/Empty";
import { ago, shortSha } from "../../lib/format";
import { isDark, toggleTheme } from "../../lib/theme";
import { daysUntil } from "../../lib/charter";
import { FileSheet } from "./FileSheet";

interface ProjectCtx {
  id: string;
  detail: ProjectDetail;
  /** The caller's access in this project. */
  access: ProjectAccess;
  /** Manager access: change anything in the project. */
  manage: boolean;
  reload: Poll<ProjectDetail>["reload"];
  /** Open the file sheet over the current page (?file=…). */
  openFile: (path: string) => void;
}

const Ctx = createContext<ProjectCtx | null>(null);

export function useProject(): ProjectCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProject outside ProjectLayout");
  return c;
}

function ProjectSwitch({ name, id }: { name: string; id: string }) {
  const { data } = useOverview();
  const others = data?.projects.filter((p) => p.id !== id) ?? [];
  return (
    <details className="pswitch">
      <summary className="pname" title={others.length ? "Đổi project" : undefined}>
        <span className="p-tile">{name.slice(0, 1).toUpperCase()}</span>
        <b>{name}</b>
        {others.length > 0 && <ChevronDown />}
      </summary>
      {others.length > 0 && (
        <div className="pswitch-menu">
          {others.map((p) => (
            <Link key={p.id} to={`/p/${p.id}`} onClick={(e) => (e.currentTarget.closest("details")!.open = false)}>
              <span className="p-tile">{p.name.slice(0, 1).toUpperCase()}</span>
              {p.name}
              {isLoaded(p) && p.attention > 0 && <span className="n">{p.attention}</span>}
            </Link>
          ))}
        </div>
      )}
    </details>
  );
}

function BrainPill() {
  const { data } = useOverview();
  const { can } = useAuth();
  if (!data) return null;
  const b = data.brain;
  const failing = b.failing?.count ?? 0;
  const off = b.backend === "null";
  const label = off ? "AI đang tắt" : failing ? "AI trả lời đang lỗi" : b.ok ? "AI trả lời" : "AI chưa chạy được";
  const title = failing ? `${failing} lần lỗi trong 10 phút qua: ${b.failing?.error ?? ""}` : (b.detail ?? "");
  const body = <span className={`state ${off ? "" : failing || !b.ok ? "idle" : "running"}`}>{label}</span>;
  return can("admin") ? (
    <Link to="/brain" className={`pill${failing || (!off && !b.ok) ? " warn" : ""}`} title={title}>
      {body}
    </Link>
  ) : (
    <span className={`pill${failing ? " warn" : ""}`} title={title}>
      {body}
    </span>
  );
}

function ThemeButton() {
  const [dark, setDark] = useState(isDark);
  return (
    <button
      type="button"
      className="iconbtn"
      onClick={() => setDark(toggleTheme())}
      title={dark ? "Chuyển sang nền sáng" : "Chuyển sang nền tối"}
      aria-label="Đổi nền sáng tối"
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

export function ProjectLayout() {
  const { id = "" } = useParams();
  const { shared } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = usePoll(() => api.projects.detail(id), [id], 5000);
  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const b = data.board;
  const deadline = data.charter.deadline;
  const left = deadline ? daysUntil(deadline) : undefined;
  const need = data.attention;
  const file = params.get("file");
  const openFile = (path: string) => {
    const next = new URLSearchParams(params);
    next.set("file", path);
    setParams(next);
  };
  const closeFile = () => {
    const next = new URLSearchParams(params);
    next.delete("file");
    setParams(next, { replace: true });
  };
  const tab = (to: string, label: string, Icon: typeof Activity, end = false, count?: number) => (
    <NavLink to={to} end={end} className={({ isActive }) => `tab${isActive ? " on" : ""}`}>
      <Icon />
      {label}
      {count ? <span className="n">{count}</span> : null}
    </NavLink>
  );
  return (
    <Ctx.Provider value={{ id, detail: data, reload, openFile, access: data.my_access, manage: data.my_access === "manager" }}>
      <PeopleProvider members={data.members}>
        <div className="pj">
          <header className="p-top">
            <div className="top-row">
              <ProjectSwitch name={data.name} id={id} />
              <div className="repo">
                <span className="mono" title={data.repo_url}>
                  <GitBranch />
                  {data.main_branch} · {shortSha(data.main_sha)}
                </span>
                {data.last_sync && (
                  <span className={data.last_sync.ok ? "" : "bad"} title={data.last_sync.error}>
                    {data.last_sync.ok ? "đồng bộ" : "đồng bộ lỗi"} {ago(data.last_sync.at)}
                  </span>
                )}
                {b.total > 0 && (
                  <span>
                    {b.done}/{b.total} việc xong{left !== undefined ? ` · ${left >= 0 ? `còn ${left} ngày` : `trễ hạn ${-left} ngày`}` : ""}
                  </span>
                )}
              </div>
              <div className="top-tools">
                <BrainPill />
                <ThemeButton />
              </div>
            </div>
            {data.last_sync && !data.last_sync.ok && (
              <details className="syncbad">
                <summary>Không lấy được code mới từ repo. Kiểm tra URL repo và quyền đọc trong Thiết lập.</summary>
                <pre className="mono">{data.last_sync.error}</pre>
              </details>
            )}
            <nav className="p-tabs" aria-label="Project">
              {tab(`/p/${id}`, "Tổng quan", Activity, true)}
              {tab(`/p/${id}/inbox`, "Cần xử lý", Inbox, false, need)}
              {tab(`/p/${id}/work`, "Việc", SquareKanban)}
              {tab(`/p/${id}/talk`, "Trao đổi", MessagesSquare)}
              {tab(`/p/${id}/knowledge`, "Tri thức", BookOpen)}
              <span className="gap" />
              {!shared && tab(`/p/${id}/settings`, "Thiết lập", SlidersHorizontal)}
            </nav>
          </header>
          <main className="screen">
            <Outlet />
          </main>
          {file && <FileSheet path={file} onClose={closeFile} onOpenIncident={(iid) => navigate(`/p/${id}/inbox?i=${iid}`)} />}
        </div>
      </PeopleProvider>
    </Ctx.Provider>
  );
}

/** Settings need a manager: others are sent back to the project's first page. */
export function ManagerOnly({ children }: { children: JSX.Element }) {
  const { id, manage } = useProject();
  if (!manage) {
    return (
      <div className="p-empty">
        <b>Cần quyền quản lý</b>
        <Link to={`/p/${id}`}>Về Tổng quan</Link>
      </div>
    );
  }
  return children;
}
