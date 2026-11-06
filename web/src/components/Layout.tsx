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
        <BrandMark />
        <span>
          gtv
          <small>Điều phối agent cho cả nhóm</small>
        </span>
      </div>

      <nav className="nav">
        <NavLink to="/" end className={link}>
          <Icon d="M3 4h10M3 8h7M3 12h10" />
          Tổng quan
        </NavLink>
        <NavLink to="/brain" className={link}>
          <Icon d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5v3l2 1.5" />
          Brain
          <span
            className={`dot${data?.brain.ok ? " on" : data ? " bad" : ""}`}
            style={{ marginLeft: "auto" }}
            title={data?.brain.ok ? "Brain sẵn sàng" : "Brain chưa sẵn sàng"}
          />
        </NavLink>
        <NavLink to="/devs" className={link}>
          <Icon d="M5.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM2 13c0-2 1.6-3.5 3.5-3.5S9 11 9 13M11 7.5a1.7 1.7 0 1 0 0-3.4M12 9.6c1.2.4 2 1.6 2 3.4" />
          Developers
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
              <span className={`dot${!isLoaded(p) ? " bad" : active ? " on" : ""}`} />
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
        {token && (
          <button type="button" className="btn sm ghost" onClick={logout} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>
            Đăng xuất
          </button>
        )}
      </div>
    </aside>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
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
          <BrandMark /> gtv
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
