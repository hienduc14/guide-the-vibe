import type { ReactNode } from "react";
import { Activity, CircleCheckBig, CircleHelp, Gavel, OctagonAlert, Sparkles, type LucideIcon } from "lucide-react";
import type { AiSummary, NoteTag } from "../api/types";
import { ago } from "../lib/format";

/*
 * How agents' messages read on the dashboard: an icon for what a note is about, a short headline for a
 * conflict built from its facts (not gtv's long sentence to the agent), and the brain's summary box.
 */

export const NOTE_TAG: Record<NoteTag, { label: string; icon: LucideIcon; tone: string }> = {
  progress: { label: "Tiến độ", icon: Activity, tone: "accent" },
  decision: { label: "Quyết định", icon: Gavel, tone: "ok" },
  blocker: { label: "Vướng", icon: OctagonAlert, tone: "high" },
  question: { label: "Câu hỏi", icon: CircleHelp, tone: "warning" },
  done: { label: "Hoàn thành", icon: CircleCheckBig, tone: "ok" },
};

export function NoteTagChip({ tag }: { tag?: NoteTag | null }) {
  const t = NOTE_TAG[tag ?? "progress"] ?? NOTE_TAG.progress;
  const I = t.icon;
  return (
    <span className={`note-tag t-${t.tone}`}>
      <I size={12} aria-hidden="true" />
      {t.label}
    </span>
  );
}

/** What the two sides collide on, as a short headline. */
export const KIND_VI: Record<string, string> = {
  same_contract: "Cùng sửa một API",
  same_file: "Cùng sửa một file",
  same_module: "Cùng sửa một module",
  scope_overlap: "Phạm vi đăng ký trùng nhau",
  same_symbol_changed: "Cùng đổi một hàm/lớp",
  same_symbol_declared: "Cùng định đổi một hàm/lớp",
  breaking_change_used: "Đổi hàm/lớp mà bên kia đang dùng",
  semantic: "AI thấy hai việc xung khắc",
  edit_in_scope: "Sửa file trong phạm vi người khác đã đăng ký",
  planned_breaking_change: "Định đổi hàm/lớp mà bên kia đang dùng",
  critical_path: "Cùng chạm đường dẫn quan trọng",
  main: "Không gộp sạch được vào nhánh chính",
  text: "Thử gộp code thì đụng nhau ở cùng dòng",
};

/**
 * The part of a conflict subject a person recognises: a symbol name, a file's name, an API. Subjects look like
 * "src/a/b.ts#createUser", "symbol:createUser", "module:src/app", "contract:GET /x" or "a ~ b".
 */
export function shortSubject(subject: string): string {
  const one = subject.split(" ~ ")[0].split(" ↔ ")[0];
  if (one.includes("#")) return one.split("#").pop()!;
  const bare = one.replace(/^(symbol|module|contract|planned|path):/, "");
  return bare.includes("/") && !bare.includes(" ") ? bare.split("/").pop() || bare : bare;
}

export function conflictHeadline(c: { kind: string; subject: string; dev_a: string; dev_b: string }): string {
  return `${c.dev_a} ↔ ${c.dev_b} · ${KIND_VI[c.kind] ?? c.kind}: ${shortSubject(c.subject)}`;
}

/** The brain's summary, always labelled as such and dated, so nobody takes it for a person's words. */
export function AiSummaryBox({ s, title = "AI tóm tắt", children }: { s: AiSummary; title?: string; children?: ReactNode }) {
  return (
    <div className="ai-summary">
      <span className="ai-summary-head">
        <Sparkles size={13} aria-hidden="true" />
        {title}
        <span className="faint">· {ago(s.at)}</span>
      </span>
      <p>{s.text}</p>
      {s.detail.length > 0 && (
        <ul>
          {s.detail.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}
