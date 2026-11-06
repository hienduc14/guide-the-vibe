import type { ReactNode } from "react";

export function Card({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {typeof title === "string" ? <h3>{title}</h3> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body${flush ? " flush" : ""}`}>{children}</div>
    </section>
  );
}

/** One number in a summary line: "<b>12</b> label". Put several in a .grid.stats (or .summary) row. */
export function Stat({ label, value, hint, alert }: { label: string; value: ReactNode; hint?: ReactNode; alert?: boolean }) {
  return (
    <span className={`chip${alert ? " alert" : ""}`}>
      <b>{value}</b> {label}
      {hint && <span className="xs">{hint}</span>}
    </span>
  );
}
