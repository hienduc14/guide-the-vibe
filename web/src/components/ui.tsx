// Pieces shared by the account, home and admin pages (styles in styles/auth.css, scoped under .pj).

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { Eye, EyeOff, Moon, Sun, User, X, type LucideIcon } from "lucide-react";
import type { ProjectAccess } from "../api/types";
import { ACCESS_LABEL } from "../lib/people";
import { isDark, toggleTheme } from "../lib/theme";
import { agentName } from "./Badge";
import { openAccountMenu } from "./Layout";

/** A popup panel over the page (a bottom sheet on phones). Esc, ✕ or a click on the backdrop closes it. */
export function Modal({
  title,
  sub,
  children,
  foot,
  onClose,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // On <body>, so the backdrop covers the rail too; the .pj wrapper keeps the page styles.
  return createPortal(
    <div className="pj pj-portal">
      <div className="pj-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
          <div className="m-head">
            <div>
              <h2 id="m-title">{title}</h2>
              {sub && <p>{sub}</p>}
            </div>
            <button type="button" className="iconbtn" onClick={onClose} aria-label="Đóng">
              <X />
            </button>
          </div>
          <div className="m-body">{children}</div>
          {foot && <div className="m-foot">{foot}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A password input with a show/hide button. */
export function PwField({
  label,
  value,
  onChange,
  hint,
  auto = "current-password",
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  auto?: string;
  id?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="pw">
        <input
          className="p-input"
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={auto}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
        <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

const TILE_COLORS = ["#476be0", "#0f8a7e", "#b2477d", "#b26a12", "#6b4fd8", "#2f7fb5"];
/** A project's square: its first letter on a colour picked from its id. */
export function Tile({ id, name, size = "" }: { id: string; name: string; size?: "" | "sm" }) {
  const color = TILE_COLORS[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % TILE_COLORS.length];
  return (
    <span className={`ptile ${size}`} style={{ background: color }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export const AccessChip = ({ access }: { access: ProjectAccess }) => (
  <span className={`p-chip${access === "manager" ? " accent" : ""}`}>{ACCESS_LABEL[access]}</span>
);

const LOGO: Record<string, string> = { claude: "/agents/claude-code.svg", codex: "/agents/codex.svg" };
export const AgentLogo = ({ kind }: { kind: string }) =>
  LOGO[kind] ? <img src={LOGO[kind]} alt={agentName(kind)} title={agentName(kind)} /> : <span className="p-chip">{agentName(kind)}</span>;

export function ThemeButton() {
  const [dark, setDark] = useState(isDark);
  return (
    <button type="button" className="iconbtn" onClick={() => setDark(toggleTheme())} title="Đổi nền sáng tối" aria-label="Đổi nền sáng tối">
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

/** The top bar of a page outside a project: icon + title, optional tabs. */
export function SimpleTop({ title, icon: Icon, tabs }: { title: string; icon: LucideIcon; tabs?: [to: string, label: string, icon: LucideIcon][] }) {
  return (
    <header className="p-top simple">
      <div className="top-row" style={{ paddingBottom: tabs ? 0 : 12 }}>
        <div className="top-title">
          <Icon />
          {title}
        </div>
        <div className="top-tools">
          <ThemeButton />
          <button type="button" className="iconbtn top-me" onClick={openAccountMenu} aria-label="Tài khoản">
            <User />
          </button>
        </div>
      </div>
      {tabs && (
        <div className="p-tabs" role="tablist">
          {tabs.map(([to, label, TabIcon]) => (
            <NavLink key={to} to={to} end className={({ isActive }) => `tab${isActive ? " on" : ""}`} role="tab">
              <TabIcon />
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </header>
  );
}

/** "Windows", "macOS", "Linux" from Node's process.platform. */
export const osName = (p: string) => ({ win32: "Windows", darwin: "macOS", linux: "Linux" })[p] ?? p;

/** A browser's user agent as "Chrome · Windows". */
export function browserName(ua: string | null): string {
  if (!ua) return "Trình duyệt không rõ";
  const b = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : ua.split(/[ /]/)[0];
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${b} · ${os}` : b;
}

/** Turns "Realworld API" into "realworld-api" (Vietnamese marks dropped). */
export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
