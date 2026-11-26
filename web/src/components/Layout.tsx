import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useOverview } from "../hooks/useOverview";
import { useAuth } from "../hooks/useAuth";
import { isLoaded } from "../api/types";
import { Badge } from "./Badge";
import { Avatar } from "./Member";
import { RoleBadge } from "../pages/people/PeoplePage";
import { BrainCircuit, LayoutDashboard, LogOut, Menu, Users } from "lucide-react";

/*
 * The app frame: on wide screens a 60px navy rail of icons (labels as tooltips), so a project page gets the
 * whole width; under 860px the same items open as a labelled drawer from the top bar.
 */
function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { data } = useOverview();
  const { token, logout, me, shared } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  const brainBad = !!data && data.brain.backend !== "null" && (!data.brain.ok || (data.brain.failing?.count ?? 0) > 0);
  return (
    <aside className={`sidebar${open ? " open" : ""}`} onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate()}>
      <div className="brand" title={data?.commit ? `Bản đang chạy ${data.commit.slice(0, 7)}` : "Guide the Vibe"}>
        <BrandMark />
        <span className="nav-label">Guide the Vibe</span>
      </div>

      <nav className="nav">
        <NavLink to="/" end className={link} title="Tổng quan các project">
          <LayoutDashboard className="nav-icon" />
          <span className="nav-label">Tổng quan</span>
        </NavLink>
        <NavLink
          to="/brain"
          className={({ isActive }) => `admin-only ${link({ isActive })}`}
          title={
            data?.brain.failing?.count
              ? `AI trả lời: ${data.brain.failing.count} lần lỗi trong 10 phút qua`
              : data?.brain.ok
                ? "AI trả lời: đã kết nối"
                : data?.brain.backend === "null"
                  ? "AI trả lời: chưa bật"
                  : "AI trả lời: chưa chạy được"
          }
        >
          <BrainCircuit className="nav-icon" />
          <span className="nav-label">AI trả lời</span>
          <span className={`dot${brainBad ? " bad" : data?.brain.ok ? " on" : ""}`} />
        </NavLink>
        <NavLink to="/people" className={({ isActive }) => `admin-only ${link({ isActive })}`} title="Người: tài khoản, quyền, máy">
          <Users className="nav-icon" />
          <span className="nav-label">Người</span>
        </NavLink>
      </nav>

      <nav className="nav projects">
        <div className="nav-title label-caps nav-label">Projects</div>
        {data?.projects.map((p) => {
          const loaded = isLoaded(p);
          const active = loaded && p.counts.people_active > 0;
          const need = loaded ? p.attention : 0;
          return (
            <NavLink
              key={p.id}
              to={`/p/${p.id}`}
              className={link}
              title={`${p.name}${!loaded ? " · không tải được" : need ? ` · ${need} việc cần xử lý` : active ? ` · ${p.counts.people_active} người đang làm` : ""}`}
            >
              <span className="project-mark" aria-hidden="true">
                {p.name.slice(0, 1).toUpperCase()}
                <span className={`dot${!loaded ? " bad" : active ? " on" : ""}`} />
                {need > 0 && <span className="need">{need}</span>}
              </span>
              <span className="truncate nav-label">{p.name}</span>
            </NavLink>
          );
        })}
        {data && data.projects.length === 0 && (
          <span className="xs muted nav-label">{me?.role === "admin" ? "Chưa có project. Thêm ở trang Tổng quan." : "Bạn chưa ở project nào."}</span>
        )}
      </nav>

      <div className="spacer" />
      <div className="sidebar-foot">
        {data?.commit && (
          <a
            className="xs muted nav-label"
            href={`https://github.com/hienduc14/guide-the-vibe/commit/${data.commit}`}
            target="_blank"
            rel="noreferrer"
            title="Commit đang chạy trên server. Bấm để xem trên GitHub."
          >
            Bản đang chạy <span className="mono">{data.commit.slice(0, 7)}</span>
          </a>
        )}
        {data?.open_mode && (
          <Badge tone="danger-outline" title="Server chạy không cần đăng nhập: mọi người đều truy cập được">
            open
          </Badge>
        )}
        {me && me.kind !== "open" && !shared && (
          <NavLink to="/me" className={({ isActive }) => `who${isActive ? " active" : ""}`} title={`${me.name}: tài khoản của tôi, kết nối máy`}>
            <Avatar name={me.name} size={28} />
            <span className="nav-label row" style={{ gap: 8 }}>
              <b className="truncate">{me.name}</b>
              <RoleBadge role={me.role} />
            </span>
          </NavLink>
        )}
        {shared && me && (
          <div className="who" title="Link xem chỉ đọc">
            <Avatar name={me.name} size={28} />
            <span className="nav-label truncate">{me.name}</span>
          </div>
        )}
        {token && !shared && (
          <button type="button" className="btn sm ghost logout" onClick={logout} title="Đăng xuất" aria-label="Đăng xuất">
            <LogOut size={16} />
            <span className="nav-label">Đăng xuất</span>
          </button>
        )}
      </div>
    </aside>
  );
}

/** The gtv mark: web/public/gtv-logo.png, a 128px crop of docs/assets/gtv-symbol-blue-transparent.png. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return <img className="gtv-mark" src="/gtv-logo.png" alt="" width={size} height={size} />;
}

function ShareBar() {
  const { shared, leaveShare } = useAuth();
  if (!shared) return null;
  return (
    <div className="share-bar">
      <span>Đang xem qua link chia sẻ · chỉ đọc</span>
      <span className="spacer" />
      <button type="button" className="btn sm" onClick={leaveShare}>
        Thoát
      </button>
    </div>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  // A project page draws its own header and uses the full width.
  const flush = location.pathname.startsWith("/p/");
  return (
    <div className={`shell rail${flush ? " flush" : ""}`}>
      <div className="mobile-bar">
        <button type="button" className="btn menu-btn" onClick={() => setOpen(true)} aria-label="Mở menu">
          <Menu size={20} />
        </button>
        <span className="brand">
          <BrandMark size={26} /> Guide the Vibe
        </span>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      <main className="main">
        {flush ? (
          <>
            <ShareBar />
            <Outlet />
          </>
        ) : (
          <div className="main-inner">
            <ShareBar />
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        <h1 className="wrap-anywhere">{title}</h1>
        {subtitle && <p className="muted small">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}
