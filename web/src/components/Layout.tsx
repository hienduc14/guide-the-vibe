import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid, Laptop, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, ShieldCheck, Sun, User } from "lucide-react";
import { useOverview } from "../hooks/useOverview";
import { displayName, useAuth } from "../hooks/useAuth";
import { useWaiting } from "../hooks/useWaiting";
import { isLoaded } from "../api/types";
import { initials } from "../lib/people";
import { isDark, toggleTheme } from "../lib/theme";

/*
 * The app frame: a navy rail of icons on wide screens (labels as tooltips), or the same rail widened with labels
 * (toggle at the bottom, remembered); under 860px the items open as a labelled drawer from the top bar.
 */

const WIDE_KEY = "gtv.rail";
const MENU_EVENT = "gtv:account-menu";
/** Opens the account menu (Tài khoản, Máy của tôi, nền, Đăng xuất) from anywhere, e.g. the top bar on phones. */
export const openAccountMenu = () => window.dispatchEvent(new Event(MENU_EVENT));

function readWide(): boolean {
  try {
    return localStorage.getItem(WIDE_KEY) === "wide";
  } catch {
    return false;
  }
}

function Sidebar({ open, wide, onToggle, onMenu }: { open: boolean; wide: boolean; onToggle: () => void; onMenu: () => void }) {
  const { data } = useOverview();
  const { me, shared } = useAuth();
  const waiting = useWaiting();
  const navigate = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
      <div className="brand" title={data?.commit ? `Bản đang chạy ${data.commit.slice(0, 7)}` : "Guide the Vibe"}>
        <BrandMark />
        <span className="nav-label">Guide the Vibe</span>
      </div>

      <nav className="nav">
        <NavLink to="/" end className={link} title="Project của tôi">
          <LayoutGrid className="nav-icon" />
          <span className="nav-label">Project của tôi</span>
        </NavLink>
      </nav>

      <nav className="nav projects">
        <div className="nav-title label-caps nav-label">Project</div>
        {data?.projects.map((p) => {
          const w = waiting[p.id];
          const need = w ? w.clash + w.ask : 0;
          const active = isLoaded(p) && p.counts.people_active > 0;
          return (
            <NavLink key={p.id} to={`/p/${p.id}`} className={link} title={`${p.name}${need ? ` · ${need} thứ chờ bạn` : ""}`}>
              <span className="project-mark" aria-hidden="true">
                {p.name.slice(0, 1).toUpperCase()}
                <span className={`dot${!isLoaded(p) ? " bad" : active ? " on" : ""}`} />
                {need > 0 && <span className="need">{need}</span>}
              </span>
              <span className="truncate nav-label">{p.name}</span>
              {need > 0 && <span className="count alert nav-label">{need}</span>}
            </NavLink>
          );
        })}
        {!shared && (
          <button type="button" className="add-project" onClick={() => navigate("/new")} title="Tạo project">
            <span className="project-mark add" aria-hidden="true">
              <Plus size={16} />
            </span>
            <span className="nav-label">Tạo project</span>
          </button>
        )}
      </nav>

      <div className="spacer" />
      <div className="sidebar-foot">
        {me?.role === "admin" && !shared && (
          <nav className="nav">
            <NavLink to="/admin" className={link} title="Quản trị server">
              <ShieldCheck className="nav-icon" />
              <span className="nav-label">Quản trị server</span>
            </NavLink>
          </nav>
        )}
        {me && !shared && (
          <button type="button" className="who" onClick={onMenu} title={`${displayName(me)} (${me.name})`} aria-haspopup="menu">
            <span className="me-av">{initials(displayName(me))}</span>
            <span className="nav-label who-text">
              <b className="truncate">{displayName(me)}</b>
              <small className="truncate">{me.name}</small>
            </span>
          </button>
        )}
        {shared && me && (
          <div className="who" title="Link xem chỉ đọc">
            <span className="me-av">
              <User size={15} />
            </span>
            <span className="nav-label truncate">{me.name}</span>
          </div>
        )}
        <button
          type="button"
          className="rail-toggle"
          onClick={onToggle}
          title={wide ? "Thu gọn thanh bên" : "Mở rộng thanh bên"}
          aria-label={wide ? "Thu gọn thanh bên" : "Mở rộng thanh bên"}
        >
          {wide ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          <span className="nav-label">Thu gọn</span>
        </button>
      </div>
    </aside>
  );
}

function AccountMenu({ onClose }: { onClose: () => void }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => !(e.target as HTMLElement).closest(".acct-menu, .who, .top-me") && onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);
  if (!me) return null;
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <div className="acct-menu" role="menu">
      <div className="who-line">
        <b>{displayName(me)}</b>
        <small>
          {me.name}
          {me.role === "admin" ? " · quản trị server" : ""}
        </small>
      </div>
      <button type="button" role="menuitem" onClick={() => go("/account")}>
        <User />
        Tài khoản
      </button>
      <button type="button" role="menuitem" onClick={() => go("/account/devices")}>
        <Laptop />
        Máy của tôi
      </button>
      <button type="button" role="menuitem" onClick={() => setDark(toggleTheme())}>
        {dark ? <Sun /> : <Moon />}
        {dark ? "Nền sáng" : "Nền tối"}
      </button>
      <button type="button" role="menuitem" onClick={() => void logout()}>
        <LogOut />
        Đăng xuất
      </button>
    </div>
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
  const [menu, setMenu] = useState(false);
  const [wide, setWide] = useState(readWide);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [location.pathname]);
  useEffect(() => {
    const onMenu = () => setMenu(true);
    window.addEventListener(MENU_EVENT, onMenu);
    return () => window.removeEventListener(MENU_EVENT, onMenu);
  }, []);
  const toggle = () => {
    setWide(!wide);
    try {
      localStorage.setItem(WIDE_KEY, wide ? "narrow" : "wide");
    } catch {
      /* storage blocked: the choice lasts for this page */
    }
  };
  return (
    <div className={`shell flush ${wide ? "wide" : "rail"}`}>
      <div className="mobile-bar">
        <button type="button" className="btn menu-btn" onClick={() => setOpen(true)} aria-label="Mở menu">
          <Menu size={20} />
        </button>
        <span className="brand">
          <BrandMark size={26} /> Guide the Vibe
        </span>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <Sidebar open={open} wide={wide} onToggle={toggle} onMenu={() => setMenu(!menu)} />
      {menu && <AccountMenu onClose={() => setMenu(false)} />}
      <main className="main">
        <ShareBar />
        <Outlet />
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
