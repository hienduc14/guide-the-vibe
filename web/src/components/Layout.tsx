import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useOverview } from "../hooks/useOverview";
import { useAuth } from "../hooks/useAuth";
import { isLoaded } from "../api/types";
import { Badge } from "./Badge";
import { Avatar } from "./Member";
import { RoleBadge } from "../pages/users/UsersPage";
import { BrainCircuit, LayoutDashboard, LogOut, Menu, ShieldCheck, Users } from "lucide-react";

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { data } = useOverview();
  const { token, logout, me, shared } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  return (
    <aside className={`sidebar${open ? " open" : ""}`} onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate()}>
      <div className="brand">
        <BrandMark />
        <span>Guide the Vibe</span>
      </div>

      <nav className="nav">
        <NavLink to="/" end className={link}>
          <LayoutDashboard className="nav-icon" />
          Tổng quan
        </NavLink>
        <NavLink to="/brain" className={({ isActive }) => `admin-only ${link({ isActive })}`}>
          <BrainCircuit className="nav-icon" />
          Brain
          <span
            className={`dot${data?.brain.ok ? " on" : data && data.brain.backend !== "null" ? " bad" : ""}`}
            style={{ marginLeft: "auto" }}
            title={data?.brain.ok ? "Brain sẵn sàng" : data?.brain.backend === "null" ? "Brain đang tắt" : "Brain chưa chạy được"}
          />
        </NavLink>
        <NavLink to="/devs" className={({ isActive }) => `admin-only ${link({ isActive })}`}>
          <Users className="nav-icon" />
          Developers
        </NavLink>
        <NavLink to="/users" className={({ isActive }) => `admin-only ${link({ isActive })}`}>
          <ShieldCheck className="nav-icon" />
          Tài khoản
        </NavLink>
      </nav>

      <nav className="nav">
        <div className="nav-title label-caps">Projects</div>
        {data?.projects.map((p) => {
          const active = isLoaded(p) && p.counts.people_active > 0;
          const hot = isLoaded(p) && p.counts.conflicts_by_level.high + p.counts.conflicts_by_level.critical > 0;
          const open = isLoaded(p) ? p.counts.conflicts_open : 0;
          return (
            <NavLink
              key={p.id}
              to={`/p/${p.id}`}
              className={link}
              title={active ? `${isLoaded(p) ? p.counts.people_active : 0} người đang làm` : "Không ai đang làm"}
            >
              <span className="project-mark" aria-hidden="true">
                {p.name.slice(0, 1).toUpperCase()}
                <span className={`dot${!isLoaded(p) ? " bad" : active ? " on" : ""}`} />
              </span>
              <span className="truncate">{p.name}</span>
              {open > 0 && <span className={`count${hot ? " alert" : ""}`}>{open}</span>}
            </NavLink>
          );
        })}
        {data && data.projects.length === 0 && (
          <span className="xs muted" style={{ padding: "0 8px" }}>
            Chưa có project. Thêm ở trang Tổng quan.
          </span>
        )}
      </nav>

      <div className="spacer" />
      <div className="sidebar-foot">
        {data?.commit && (
          <a
            className="xs muted"
            href={`https://github.com/hienduc14/guide-the-vibe/commit/${data.commit}`}
            target="_blank"
            rel="noreferrer"
            title="Commit đang chạy trên server. Bấm để xem trên GitHub."
          >
            Bản đang chạy <span className="mono">{data.commit.slice(0, 7)}</span>
          </a>
        )}
        {data?.open_mode && (
          <Badge tone="danger-outline" title="Không có admin token và chưa có developer nào: mọi người đều truy cập được">
            open dev mode
          </Badge>
        )}
        {me && me.kind !== "open" && (
          <div className="who">
            <span className="row" style={{ gap: 8 }}>
              <Avatar name={me.name} size={26} />
              <b className="truncate">{me.name}</b>
              <RoleBadge role={me.role} />
            </span>
            {shared && <span className="muted">Link xem chỉ đọc</span>}
          </div>
        )}
        {token && !shared && (
          <button type="button" className="btn sm ghost" onClick={logout} style={{ alignSelf: "flex-start" }}>
            <LogOut size={14} />
            Đăng xuất
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
  return (
    <div className="shell">
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
        <div className="main-inner">
          <ShareBar />
          <Outlet />
        </div>
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
