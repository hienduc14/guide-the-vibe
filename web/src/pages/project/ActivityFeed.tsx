import { useState } from "react";
import type { ActivityEvent, Level } from "../../api/types";
import { LevelBadge } from "../../components/Badge";
import { Segmented } from "../../components/Segmented";
import { Empty } from "../../components/Empty";
import { clock, parseJson } from "../../lib/format";

/** Routine events: hidden under "Quan trọng" so conflicts and questions are not buried. */
const ROUTINE = new Set(["snapshot", "session_start", "prompt", "conflict_ack"]);
const PAGE = 15;
const ACTIONS: Record<string, string> = { ack: "đã xử lý", dismiss: "bỏ qua", reopen: "mở lại", confirm: "xác nhận", reject: "loại" };

/** One-line human summary of an event_log row, plus its severity when it has one. */
export function describe(e: ActivityEvent): { text: string; level?: Level } {
  const p = (parseJson(e.payload) ?? {}) as Record<string, any>;
  const verb = (prefix: string) => ACTIONS[e.type.slice(prefix.length)] ?? e.type.slice(prefix.length);
  switch (e.type) {
    case "session_start":
      return { text: `mở phiên ${p.agent ?? ""} (${p.workspace_label ?? ""})` };
    case "prompt":
      return { text: `prompt: ${p.prompt ?? ""}` };
    case "register":
      return { text: `đăng ký task “${p.title}”` };
    case "plan_intent":
      return { text: `plan → task “${p.intent?.title ?? "?"}” (${p.mode ?? "?"})` };
    case "l3_registration": {
      const overlaps: { level: Level; reason: string }[] = p.output?.overlaps ?? [];
      const top = overlaps.find((o) => o.level === "critical") ?? overlaps.find((o) => o.level === "high") ?? overlaps[0];
      return top ? { text: `Operator đánh giá task: ${top.reason}`, level: top.level } : { text: "Operator đánh giá task: không chồng chéo" };
    }
    case "snapshot":
      return { text: `snapshot ${String(p.sha ?? "").slice(0, 8)}` };
    case "conflict":
      return { text: `${p.layer}: ${p.message}`, level: p.level };
    case "ticket_ask":
      return { text: `hỏi${p.to_dev ? ` ${p.to_dev}` : ""}: ${p.question}` };
    case "ticket_tier1":
      return {
        text: `Operator ${p.output?.route === "answer" ? "trả lời" : `chuyển tiếp (${p.output?.route ?? "?"})`} sau ${((p.ms ?? 0) / 1000).toFixed(1)} s`,
      };
    case "drift":
      return { text: `sửa ngoài phạm vi: ${(p.paths ?? []).join(", ")}`, level: "warning" };
    case "shadow_conflicts":
      return { text: `[shadow] ${p.feature}: ${(p.found ?? []).length} phát hiện` };
    case "feature_set":
      return { text: `đặt ${p.feature} = ${p.mode ?? "default"}` };
    case "feature_error":
      return { text: `lỗi ${p.feature}: ${p.error}`, level: "high" };
    case "manual_message":
      return { text: `ghi chú gửi ${p.to_dev}: ${p.body}` };
    case "work_merged":
      return { text: "work đã merge vào main" };
    default:
      if (e.type.startsWith("conflict_")) return { text: `${verb("conflict_")} conflict ${p.id ?? ""}` };
      if (e.type.startsWith("kb_")) return { text: `${verb("kb_")} tài liệu ${p.id ?? ""}` };
      return { text: typeof p === "string" ? p : e.type };
  }
}

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const [filter, setFilter] = useState<"important" | "all">("important");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const rows = filter === "all" ? events : events.filter((e) => !ROUTINE.has(e.type));
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <section className="card">
      <div className="card-head">
        <h3>Hoạt động gần đây</h3>
        <Segmented
          options={[
            { value: "important", label: "Quan trọng", title: "Ẩn snapshot, mở phiên, prompt" },
            { value: "all", label: "Tất cả" },
          ]}
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setShown(PAGE);
          }}
        />
      </div>
      {rows.length === 0 ? (
        <Empty>{filter === "all" ? "Chưa có hoạt động" : "Chưa có conflict hay câu hỏi nào"}</Empty>
      ) : (
        <ol className="feed">
          {rows.slice(0, shown).map((e) => {
            const d = describe(e);
            const isOpen = open.has(e.id);
            return (
              <li key={e.id} className={`feed-item${d.level ? ` lvl-${d.level}` : ""}`}>
                <time className="xs faint" dateTime={e.ts}>
                  {clock(e.ts)}
                </time>
                <button type="button" className={`feed-text${isOpen ? " open" : ""}`} onClick={() => toggle(e.id)} aria-expanded={isOpen}>
                  <b>{e.actor ?? "system"}</b> {d.level && <LevelBadge level={d.level} />} <span className="muted">{d.text}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {rows.length > shown && (
        <div className="card-foot">
          <button type="button" className="btn sm ghost" onClick={() => setShown((n) => n + PAGE)}>
            Xem thêm ({rows.length - shown})
          </button>
        </div>
      )}
    </section>
  );
}
