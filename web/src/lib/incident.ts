// Plain-words title and explanation of an incident, written from its strongest evidence.

import type { Incident, Level } from "../api/types";
import { KIND_VI, shortSubject } from "../components/Message";

const fileName = (p: string) => p.split("/").pop() || p;

function symbols(i: Incident): string[] {
  const out = new Set<string>();
  for (const e of i.evidence) {
    const s = e.subject.split(" ~ ")[0];
    if (s.includes("#")) out.add(s.split("#").pop()!);
    else if (/^(symbol|planned):/.test(s))
      out.add(
        s
          .replace(/^(symbol|planned):/, "")
          .split(".")
          .pop()!,
      );
  }
  return [...out];
}

export function incidentTitle(i: Incident): string {
  const h = i.headline;
  const file = i.files[0] ? fileName(i.files[0]) : shortSubject(h.subject);
  const sym = symbols(i);
  const ev = i.evidence.find((e) => e.kind === h.kind)?.evidence as { changed_by?: string; used_by?: string } | undefined;
  switch (h.kind) {
    case "text":
      return `Gộp code sẽ lỗi ở ${file}`;
    case "main":
      return `Bản của ${i.dev_a} không gộp sạch vào nhánh chính`;
    case "breaking_change_used":
    case "planned_breaking_change": {
      const by = ev?.changed_by ?? i.dev_a;
      const other = by === i.dev_a ? i.dev_b : i.dev_a;
      return `${by} đổi ${sym[0] ?? shortSubject(h.subject)}, ${other} đang dùng nó`;
    }
    case "same_symbol_changed":
    case "same_symbol_declared":
      return `Cùng sửa ${sym.length ? sym.slice(0, 2).join(", ") : shortSubject(h.subject)}`;
    case "semantic":
      return "Hai việc có thể mâu thuẫn nhau";
    case "same_file":
    case "edit_in_scope":
      return `Cùng sửa ${file}`;
    case "critical_path":
      return `Cùng chạm đường dẫn quan trọng: ${file}`;
    default:
      return `${KIND_VI[h.kind] ?? h.kind}: ${shortSubject(h.subject)}`;
  }
}

export function incidentPlain(i: Incident): string {
  const h = i.headline;
  const file = i.files[0] ? fileName(i.files[0]) : "cùng một chỗ";
  const sym = symbols(i);
  const where = sym.length ? `${sym.slice(0, 3).join(", ")} trong ${file}` : file;
  switch (h.kind) {
    case "text":
      return `${i.dev_a} và ${i.dev_b} cùng sửa ${where}. Thử gộp hai bản đang làm dở thì Git báo xung đột. Cả hai bản đều đã được lưu, chưa mất gì.`;
    case "main":
      return `Bản đang làm của ${i.dev_a} không gộp sạch được vào nhánh chính mới nhất. Cần kéo nhánh chính về và sửa chỗ đụng trước khi đẩy.`;
    case "breaking_change_used":
    case "planned_breaking_change":
      return `Một bên đổi chữ ký hoặc tên của ${sym[0] ?? "một hàm"}, bên kia đang viết code gọi nó theo kiểu cũ. Code của bên gọi sẽ sai sau khi bên đổi được merge.`;
    case "same_symbol_changed":
    case "same_symbol_declared":
      return `${i.dev_a} và ${i.dev_b} cùng sửa ${where}. Hai bản chưa chắc gộp lỗi, nhưng dễ ghi đè ý nhau.`;
    case "semantic":
      return `AI so mục tiêu của hai việc và thấy chúng trùng hoặc ngược nhau, dù có thể khác file. Nếu cả hai cùng xong, kết quả dễ chồng chéo.`;
    default:
      return `${i.dev_a} và ${i.dev_b} cùng làm ở ${where}. Chưa chắc có lỗi, nhưng nên biết trước khi merge.`;
  }
}

export const LEVEL_VI: Record<Level, string> = { info: "mức thấp", warning: "mức vừa", high: "mức cao", critical: "nghiêm trọng" };

export const INC_DONE: Record<string, string> = {
  guided: "đã gửi hướng xử lý",
  acked: "hai bên tự phối hợp",
  dismissed: "báo nhầm, đã đóng",
  resolved: "đã hết đụng",
};

export function incidentDone(i: Incident): string | undefined {
  if (i.status === "guided" || i.status === "acked") return INC_DONE[i.status];
  if (i.status === "closed") return INC_DONE[i.closed_reason ?? "resolved"];
  return undefined;
}

/** "đụng nhau" when a file is in an incident at high level or worse, "cần để ý" below. */
export function fileIncident(incidents: Incident[], path: string): Incident | undefined {
  return incidents.filter((i) => i.status !== "closed" && i.files.includes(path)).sort((a, b) => rank(b.level) - rank(a.level))[0];
}
const rank = (l: Level) => ({ info: 0, warning: 1, high: 2, critical: 3 })[l];
export const isHot = (l: Level) => l === "high" || l === "critical";
