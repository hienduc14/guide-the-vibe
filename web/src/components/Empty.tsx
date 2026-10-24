import type { ReactNode } from "react";

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading() {
  return <div className="empty">Đang tải…</div>;
}

export function ErrorNotice({ error }: { error: string }) {
  return <div className="notice error">{error}</div>;
}
