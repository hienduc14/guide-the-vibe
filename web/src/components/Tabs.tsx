import { Fragment, useEffect, useRef } from "react";
import { NavLink, matchPath, useLocation } from "react-router-dom";
import { ChevronDown, Ellipsis, type LucideIcon } from "lucide-react";

/** Container scroll-state queries show the edge fades in CSS; older browsers get the classes from an IntersectionObserver. */
const nativeScrollState = typeof CSS !== "undefined" && CSS.supports("container-type", "scroll-state");

export interface TabItem {
  to: string;
  label: string;
  icon?: LucideIcon;
  end?: boolean;
  count?: number;
  alert?: boolean;
  className?: string;
  title?: string;
  /** Not needed day to day: shown in the "Khác" menu under this group heading instead of the row. */
  more?: string;
}

function TabLink({ t }: { t: TabItem }) {
  const Icon = t.icon;
  return (
    <NavLink to={t.to} end={t.end} title={t.title} className={({ isActive }) => `${isActive ? "active" : ""} ${t.className ?? ""}`.trim()}>
      {Icon && <Icon />}
      {t.label}
      {t.count ? <span className={`count${t.alert ? " alert" : ""}`}>{t.count}</span> : null}
    </NavLink>
  );
}

/** "Khác" menu. The tab row scrolls (overflow), so the menu is placed with fixed coordinates under its button. */
function MoreMenu({ items }: { items: TabItem[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  const active = items.find((t) => matchPath({ path: t.to, end: !!t.end }, pathname));
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const place = () => {
    const d = ref.current;
    const menu = d?.querySelector<HTMLElement>(".tabs-more-menu");
    const btn = d?.querySelector("summary");
    if (!d?.open || !menu || !btn) return;
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
  };
  return (
    <details ref={ref} className={`tabs-more${active ? " has-active" : ""}`} onToggle={place}>
      <summary>
        {active?.icon ? <active.icon /> : <Ellipsis />}
        {active ? active.label : "Khác"}
        {items.some((t) => t.alert && t.count) && <span className="more-dot" aria-label="Có mục cần xem" />}
        <ChevronDown />
      </summary>
      <div className="tabs-more-menu">
        {items.map((t, i) => (
          <Fragment key={t.to}>
            {t.more !== items[i - 1]?.more && <span className="tabs-more-group">{t.more}</span>}
            <TabLink t={t} />
          </Fragment>
        ))}
      </div>
    </details>
  );
}

export function Tabs({ items }: { items: TabItem[] }) {
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // On narrow screens the tabs scroll sideways: keep the current tab in view.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  useEffect(() => {
    const nav = ref.current;
    if (!nav || nativeScrollState) return;
    const start = nav.querySelector(".tabs-sentinel.start");
    const end = nav.querySelector(".tabs-sentinel.end");
    if (!start || !end) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) nav.classList.toggle(e.target === start ? "more-start" : "more-end", !e.isIntersecting);
      },
      { root: nav },
    );
    io.observe(start);
    io.observe(end);
    return () => io.disconnect();
  }, []);

  return (
    <nav className="tabs" ref={ref}>
      <span className="tabs-sentinel start" aria-hidden="true" />
      <span className="tabs-fade start" aria-hidden="true" />
      {items
        .filter((t) => !t.more)
        .map((t) => (
          <TabLink key={t.to} t={t} />
        ))}
      {items.some((t) => t.more) && <MoreMenu items={items.filter((t) => t.more)} />}
      <span className="tabs-fade end" aria-hidden="true" />
      <span className="tabs-sentinel end" aria-hidden="true" />
    </nav>
  );
}
