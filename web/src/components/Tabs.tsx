import { NavLink } from "react-router-dom";

export function Tabs({ items }: { items: { to: string; label: string; end?: boolean; count?: number }[] }) {
  return (
    <nav className="tabs">
      {items.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "active" : "")}>
          {t.label}
          {t.count ? <span className="faint"> {t.count}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}
