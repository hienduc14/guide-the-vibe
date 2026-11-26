import { useEffect } from "react";
import { Link } from "react-router-dom";
import { FileCode2, GitCompare, Zap } from "lucide-react";
import { api } from "../../api/endpoints";
import type { FileDetail } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { LevelBadge } from "../../components/Badge";
import { DevAvatar, EmptyState } from "../../components/Visual";
import { ErrorNotice, Loading } from "../../components/Empty";
import { ago } from "../../lib/format";
import { KIND_VI } from "./ConflictsTab";

/*
 * One file, opened from the work map: who is on it, the conflicts about it, and each person's change to it at
 * their latest WIP snapshot. Lines two people changed in the same place are red, with who else touched them.
 */

type Ws = FileDetail["workspaces"][number];
interface DiffLine {
  type: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
  /** Position in the original (main) file, so two people's changes can be compared: x.5 = inserted after line x. */
  anchor?: number;
}

export function parseDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (h) {
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      inHunk = true;
      out.push({ type: "hunk", text: h[3].trim() });
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) out.push({ type: "add", text: line.slice(1), newNo: newNo++, anchor: oldNo - 0.5 });
    else if (line.startsWith("-")) out.push({ type: "del", text: line.slice(1), oldNo, anchor: oldNo++ });
    else if (line.startsWith(" ")) out.push({ type: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }
  return out;
}

const changed = (lines: DiffLine[]) => lines.filter((l) => l.anchor !== undefined).map((l) => l.anchor!);
/** Changes closer than this many lines in the original file count as the same place (git would clash on them too). */
const NEAR = 1;

const OP_VI: Record<string, string> = { read: "đọc", modify: "sửa", create: "tạo", delete: "xoá", rename: "đổi tên", sig_change: "đổi chữ ký" };
const CHANGE_VI: Record<string, string> = {
  added: "thêm",
  deleted: "xoá",
  renamed: "đổi tên",
  sig_changed: "đổi chữ ký",
  body_changed: "sửa thân hàm",
};

function DiffView({ lines, others }: { lines: DiffLine[]; others: { dev: string; anchors: number[] }[] }) {
  return (
    <div className="diff" role="table" aria-label="Thay đổi">
      {lines.map((l, i) => {
        if (l.type === "hunk")
          return (
            <div key={i} className="diff-hunk" role="row">
              {l.text || "…"}
            </div>
          );
        const with_ = l.anchor === undefined ? [] : others.filter((o) => o.anchors.some((a) => Math.abs(a - l.anchor!) <= NEAR)).map((o) => o.dev);
        return (
          <div
            key={i}
            className={`diff-line ${l.type}${with_.length ? " overlap" : ""}`}
            role="row"
            title={with_.length ? `${with_.join(", ")} cũng sửa ở đây` : undefined}
          >
            <span className="diff-no">{l.oldNo ?? ""}</span>
            <span className="diff-no">{l.newNo ?? ""}</span>
            <span className="diff-sign">{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}</span>
            <code className="diff-text">{l.text || " "}</code>
            {with_.length > 0 && <span className="diff-tag">trùng {with_.join(", ")}</span>}
          </div>
        );
      })}
    </div>
  );
}

function WorkspaceChange({ w, others }: { w: Ws; others: { dev: string; anchors: number[] }[] }) {
  const lines = parseDiff(w.diff);
  const overlaps = lines.filter((l) => l.anchor !== undefined && others.some((o) => o.anchors.some((a) => Math.abs(a - l.anchor!) <= NEAR))).length;
  const adds = lines.filter((l) => l.type === "add").length;
  const dels = lines.filter((l) => l.type === "del").length;
  return (
    <section className="fd-ws">
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <DevAvatar name={w.dev} agent={w.agent} size={32} />
        <div className="stack tight" style={{ minWidth: 0, flex: 1, gap: 2 }}>
          <b>
            {w.dev} <span className="xs faint">· {w.label}</span>
          </b>
          {w.tasks.map((t) => (
            <span key={t.id} className="xs muted">
              {t.title}
              {t.ops.filter(Boolean).length > 0 && ` · định ${t.ops.map((o) => OP_VI[o] ?? o).join(", ")}`}
            </span>
          ))}
          <span className="xs faint">{w.footprint ? `Sửa ${w.footprint.count} lần · lần cuối ${ago(w.footprint.last_at)}` : "Mới khai báo, chưa sửa"}</span>
        </div>
        {w.diff && (
          <span className="xs mono" style={{ whiteSpace: "nowrap" }}>
            <span style={{ color: "var(--ok)" }}>+{adds}</span> <span style={{ color: "var(--high)" }}>−{dels}</span>
          </span>
        )}
      </div>
      {w.symbols.length > 0 && (
        <div className="lane-files">
          {w.symbols.map((s) => (
            <span
              key={s.symbol_id}
              className={`res${["deleted", "renamed", "sig_changed"].includes(s.change) ? " breaking" : ""}`}
              title={s.new_sig ?? s.old_sig}
            >
              <span className="res-v">{s.name}</span>
              <em>{CHANGE_VI[s.change] ?? s.change}</em>
            </span>
          ))}
        </div>
      )}
      {overlaps > 0 && (
        <div className="notice error notice-row xs">
          <Zap size={14} />
          {overlaps} dòng sửa trùng chỗ với người khác: khi gộp code sẽ phải chọn một bên.
        </div>
      )}
      {w.diff ? (
        <>
          <span className="xs faint">Thay đổi tính đến lần chụp gần nhất{w.snapshot_at ? ` (${ago(w.snapshot_at)})` : ""}, so với nhánh chính.</span>
          <DiffView lines={lines} others={others} />
        </>
      ) : (
        <span className="xs faint">
          {w.footprint ? "Chưa có bản chụp code của người này, nên chỉ biết là đã sửa file, chưa xem được sửa gì." : "Chưa có thay đổi."}
        </span>
      )}
    </section>
  );
}

export function FileDialog({ projectId, path, onClose }: { projectId: string; path: string; onClose: () => void }) {
  const { data, error } = usePoll(() => api.projects.file(projectId, path), [projectId, path], 10000);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const anchors = new Map((data?.workspaces ?? []).map((w) => [w.workspace_id, changed(parseDiff(w.diff))]));
  const othersOf = (w: Ws) =>
    (data?.workspaces ?? []).filter((o) => o.workspace_id !== w.workspace_id).map((o) => ({ dev: o.dev, anchors: anchors.get(o.workspace_id) ?? [] }));
  const i = path.lastIndexOf("/");

  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide fd" role="dialog" aria-modal="true" aria-label={path}>
        <div className="dialog-head">
          <FileCode2 size={18} />
          <div className="stack tight" style={{ minWidth: 0, gap: 2 }}>
            {i >= 0 && <span className="xs faint mono">{path.slice(0, i + 1)}</span>}
            <h3 className="wrap-anywhere mono">{path.slice(i + 1)}</h3>
          </div>
          <span className="spacer" />
          <button className="btn sm ghost" type="button" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="dialog-body">
          {error && <ErrorNotice error={error} />}
          {!data ? (
            <Loading />
          ) : (
            <>
              {data.conflicts.length > 0 && (
                <div className="stack tight">
                  {data.conflicts.map((c) => (
                    <div key={c.id} className="row" style={{ gap: 8 }}>
                      <LevelBadge level={c.level} />
                      <span className="small">
                        <b>{KIND_VI[c.kind] ?? c.kind}</b> · {c.dev_a} và {c.dev_b}
                        {c.subject.includes("#") && <span className="muted mono xs"> · {c.subject.split("#")[1]}</span>}
                      </span>
                    </div>
                  ))}
                  <Link to={`/p/${projectId}/conflicts`} className="xs" onClick={onClose}>
                    Xem trong tab Xung đột
                  </Link>
                </div>
              )}
              {data.workspaces.length === 0 ? (
                <EmptyState icon={GitCompare} title="Không ai đang làm file này" />
              ) : (
                data.workspaces.map((w) => <WorkspaceChange key={w.workspace_id} w={w} others={othersOf(w)} />)
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
