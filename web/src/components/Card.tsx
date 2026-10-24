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

export function Stat({ label, value, hint, alert }: { label: string; value: ReactNode; hint?: ReactNode; alert?: boolean }) {
  return (
    <div className="stat">
      <div className="label-caps">{label}</div>
      <div className={`stat-value${alert ? " alert" : ""}`}>{value}</div>
      {hint && <div className="xs muted">{hint}</div>}
    </div>
  );
}
