import type { BoardStatus, Priority } from "../api/types";
import { Badge, type BadgeTone } from "./Badge";

export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
export const PRIORITY_INFO: Record<Priority, { label: string; tone: BadgeTone }> = {
  urgent: { label: "Khẩn", tone: "critical" },
  high: { label: "Cao", tone: "high" },
  normal: { label: "Thường", tone: "default" },
  low: { label: "Thấp", tone: "info" },
};

export const STATUS_INFO: Record<BoardStatus, { label: string; hint: string }> = {
  todo: { label: "Cần làm", hint: "Chưa ai bắt đầu" },
  in_progress: { label: "Đang làm", hint: "Có agent đang làm" },
  blocked: { label: "Bị chặn", hint: "Đụng việc khác ở mức high/critical, cần người quyết" },
  review: { label: "Chờ merge", hint: "Agent đã xong, chờ code vào main" },
  done: { label: "Xong", hint: "Code đã vào main" },
  cancelled: { label: "Huỷ", hint: "" },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={PRIORITY_INFO[priority].tone}>{PRIORITY_INFO[priority].label}</Badge>;
}

/** "còn 3 ngày" / "trễ 2 ngày" / "hôm nay" for a YYYY-MM-DD due date. */
export function dueText(date: string): { text: string; late: boolean; soon: boolean } {
  const days = Math.ceil((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86_400_000) - 1;
  if (days < 0) return { text: `trễ ${-days} ngày`, late: true, soon: false };
  if (days === 0) return { text: "hạn hôm nay", late: false, soon: true };
  return { text: `còn ${days} ngày`, late: false, soon: days <= 2 };
}

export function DueChip({ date, done }: { date?: string; done?: boolean }) {
  if (!date) return null;
  const d = dueText(date);
  return (
    <span className={`due${!done && d.late ? " late" : !done && d.soon ? " soon" : ""}`} title={`Hạn ${new Date(date).toLocaleDateString("vi-VN")}`}>
      {done ? new Date(date).toLocaleDateString("vi-VN") : d.text}
    </span>
  );
}
