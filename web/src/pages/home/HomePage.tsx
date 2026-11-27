// Project của tôi: a card per project (my access, what waits for me, members), my computers, and Tạo project.
// /new and /new?repo=owner/repo (the link `gtv on` prints) open the create popup over this page.

import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Copy, LayoutGrid, Laptop, Link2, Plus } from "lucide-react";
import { useToast } from "../../hooks/useToast";
import { api } from "../../api/endpoints";
import type { ProjectAccess, ProjectEntry } from "../../api/types";
import { isLoaded } from "../../api/types";
import { displayName, useAuth } from "../../hooks/useAuth";
import { useOverview } from "../../hooks/useOverview";
import { usePoll } from "../../hooks/usePoll";
import { useWaiting, type Waiting } from "../../hooks/useWaiting";
import { AccessChip, SimpleTop, Tile } from "../../components/ui";
import { initials } from "../../lib/people";
import { ago } from "../../lib/format";
import { CreateProjectModal } from "./Popups";

const COLORS = ["amber", "violet", "teal", "green", "pink", "sky"];
/** "https://***@github.com/Org/Repo.git" → "Org/Repo" */
const repoName = (url: string) =>
  url
    .replace(/\.git\/?$/, "")
    .replace(/^git@[^:]+:/, "/")
    .split(/[/\\]/)
    .filter(Boolean)
    .slice(-2)
    .join("/");

function ProjectCard({ p, access, w }: { p: ProjectEntry; access: ProjectAccess; w?: Waiting }) {
  const live = isLoaded(p) ? p.counts.sessions_active : 0;
  const members = isLoaded(p) ? p.members : [];
  const chips = [
    w?.clash ? (
      <span key="c" className="p-chip clash">
        {w.clash} vụ đụng nhau
      </span>
    ) : null,
    w?.ask ? (
      <span key="a" className="p-chip warn">
        {w.ask} câu hỏi chờ bạn
      </span>
    ) : null,
    w?.tasks ? (
      <span key="t" className="p-chip">
        {w.tasks} việc của bạn đang làm
      </span>
    ) : null,
  ].filter(Boolean);
  return (
    <Link className="panel pcard" to={`/p/${encodeURIComponent(p.id)}`}>
      <div className="t">
        <Tile id={p.id} name={p.name} size="sm" />
        <div>
          <b>{p.name}</b>
          <small>{repoName(p.repo_url ?? "")}</small>
        </div>
        <AccessChip access={access} />
      </div>
      <div className="w">
        {!isLoaded(p) ? (
          <span className="p-chip">Chưa tải được project</span>
        ) : chips.length ? (
          chips
        ) : (
          <span className="p-chip ok">
            <Check size={13} />
            Không có gì chờ bạn
          </span>
        )}
      </div>
      <div className="f">
        <span className="avs">
          {members.slice(0, 6).map((m, i) => (
            <span key={m.dev} className="av sm" style={{ ["--p" as string]: `var(--c-${COLORS[i % COLORS.length]})` }} title={m.dev}>
              {initials(m.dev)}
            </span>
          ))}
        </span>
        <span>
          {members.length} thành viên
          {live > 0 && (
            <>
              {" · "}
              <span className="state running">{live} agent đang chạy</span>
            </>
          )}
        </span>
      </div>
    </Link>
  );
}

export function HomePage() {
  const { me } = useAuth();
  const { data } = useOverview();
  const waiting = useWaiting();
  const navigate = useNavigate();
  const toast = useToast();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { data: devices } = usePoll(api.account.devices, [], 30_000);
  const creating = pathname === "/new";
  const mine = me?.projects ?? [];
  const accessOf = new Map(mine.map((p) => [p.id, p.access]));
  const projects = (data?.projects ?? []).filter((p) => accessOf.has(p.id) || me?.role === "admin");
  const totalWaiting = Object.values(waiting).reduce((n, w) => n + w.clash + w.ask, 0);
  const empty = data && projects.length === 0;
  return (
    <div className="pj">
      <SimpleTop title="Project của tôi" icon={LayoutGrid} />
      <main className="screen">
        <div className="page">
          <div className="head">
            <div>
              <h1>Chào {displayName(me)}</h1>
              <p className="lead">
                {empty ? (
                  "Bạn chưa ở project nào. Bắt đầu bằng một trong hai cách."
                ) : (
                  <>
                    {projects.length} project · <b>{totalWaiting ? `${totalWaiting} thứ đang chờ bạn` : "không có gì chờ bạn"}</b>
                  </>
                )}
              </p>
            </div>
            {!empty && (
              <div className="tools">
                <Link className="p-btn primary" to="/new">
                  <Plus size={16} />
                  Tạo project
                </Link>
              </div>
            )}
          </div>
          {empty ? (
            <div className="choices">
              <div className="panel choice">
                <span className="ic">
                  <Plus />
                </span>
                <h2>Tạo project cho nhóm</h2>
                <p>Có sẵn repo trên GitHub? Tạo project, bạn là Quản lý, rồi gửi link mời cho cả nhóm.</p>
                <div>
                  <Link className="p-btn primary" to="/new">
                    Tạo project
                  </Link>
                </div>
              </div>
              <div className="panel choice">
                <span className="ic">
                  <Link2 />
                </span>
                <h2>Vào project của nhóm</h2>
                <p>
                  Bấm vào link mời bạn nhận được, nó mở trang tham gia. Chưa có link thì gửi tên <b className="mono">{me?.name}</b> cho người quản lý project để
                  họ thêm bạn.
                </p>
                <div>
                  <button
                    type="button"
                    className="p-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(me?.name ?? "");
                        toast("Đã chép tên");
                      } catch {
                        toast("Trình duyệt chặn chép: bôi đen rồi chép tay", true);
                      }
                    }}
                  >
                    <Copy size={15} />
                    Chép tên
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="pgrid">
              {projects.map((p) => (
                <ProjectCard key={p.id} p={p} access={accessOf.get(p.id) ?? "manager"} w={waiting[p.id]} />
              ))}
            </div>
          )}
          {me?.kind === "user" && (
            <div className="strip">
              <span className="dv">
                <Laptop size={16} />
                <b>Máy của bạn</b>
              </span>
              {devices?.length === 0 && <span>Chưa kết nối máy nào</span>}
              {devices?.map((d) => (
                <span key={d.id} className="dv">
                  <span className="mono">{d.name}</span>
                  <span className={`state${d.online ? " running" : ""}`}>
                    {d.online ? "đang kết nối" : d.last_seen ? `thấy ${ago(d.last_seen)}` : "chưa thấy"}
                  </span>
                </span>
              ))}
              <Link to="/account/devices" className="more">
                Máy của tôi →
              </Link>
            </div>
          )}
        </div>
      </main>
      {creating && <CreateProjectModal repo={params.get("repo")} onClose={() => navigate("/")} />}
    </div>
  );
}
