import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useOverview } from "../hooks/useOverview";
import { useAuth } from "../hooks/useAuth";
import { isLoaded } from "../api/types";
import { Badge } from "./Badge";

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { data } = useOverview();
  const { token, logout } = useAuth();
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  return (
    <aside className={`sidebar${open ? " open" : ""}`} onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate()}>
      <div className="brand">
        <span className="brand-mark">g</span>
        <span>gtv Operator</span>
      </div>

      <nav className="nav">
        <NavLink to="/" end className={link}>
          Tổng quan
        </NavLink>
        <NavLink to="/brain" className={link}>
          <span className={`dot${data?.brain.ok ? " on" : data ? " bad" : ""}`} />
          Brain
        </NavLink>
        <NavLink to="/devs" className={link}>
          Developers
        </NavLink>
      </nav>

      <nav className="nav">
        <div className="nav-title label-caps">Projects</div>
        {data?.projects.map((p) => {
          const active = isLoaded(p) && p.counts.people_active > 0;
          const hot = isLoaded(p) && (p.counts.conflicts_by_level.high + p.counts.conflicts_by_level.critical > 0);
          return (
            <NavLink key={p.id} to={`/p/${p.id}`} className={link}>
              <span className={`dot${hot ? " bad" : active ? " on" : ""}`} />
              <span className="truncate">{p.name}</span>
            </NavLink>
          );
        })}
        {data && data.projects.length === 0 && <span className="xs faint" style={{ padding: "0 8px" }}>Chưa có project</span>}
      </nav>

      <div className="spacer" />
      <div className="stack tight" style={{ padding: "0 8px" }}>
        {data?.open_mode && (
          <Badge tone="danger-outline" title="Không có admin token và chưa có developer nào: mọi người đều truy cập được">
            open dev mode
          </Badge>
        )}
        {token && (
          <button type="button" className="btn sm ghost" onClick={logout} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
            Đăng xuất
          </button>
        )}
      </div>
    </aside>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="shell">
      <div className="mobile-bar">
        <button type="button" className="btn sm" onClick={() => setOpen(true)} aria-label="Menu">
          ☰
        </button>
        <span className="brand">
          <span className="brand-mark">g</span> gtv
        </span>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      <main className="main">
        <div className="main-inner">
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
