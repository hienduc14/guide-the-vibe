import type { ReactNode } from "react";
import { Inbox, LoaderCircle, TriangleAlert } from "lucide-react";

/** Empty list: a large icon and one short line. Pages with a better-fitting icon use EmptyState directly. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Inbox />
      </span>
      <span className="small muted">{children}</span>
    </div>
  );
}

export function Loading() {
  return (
    <div className="empty loading">
      <LoaderCircle className="spin" />
      Đang tải…
    </div>
  );
}

export function ErrorNotice({ error }: { error: string }) {
  return (
    <div className="notice error notice-row">
      <TriangleAlert />
      <span>{error}</span>
    </div>
  );
}
