// The file sheet: one file through the team's eyes. Who touches it, why gtv worries, and each person's
// unmerged change side by side (or merged into one column), with the clashing spots boxed.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, Code2, FileText, GitMerge, Link2, Sparkles, X, Zap } from "lucide-react";
import { api } from "../../api/endpoints";
import type { FileDetail, Incident } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useColorOf } from "../../hooks/usePeople";
import { useProject } from "./ProjectLayout";
import { Av, Seg, base, dirOf } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { alignDiffs, counts, type Segment } from "../../lib/diff";
import { fileIncident, incidentDone, incidentPlain, incidentTitle, isHot } from "../../lib/incident";
import { KIND_VI, shortSubject } from "../../components/Message";
import { ago, clock, shortSha } from "../../lib/format";
import { FixBox } from "./FixBox";

const KEYWORDS =
  /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(const|let|var|export|default|async|await|if|else|throw|new|return|function|import|from|class|extends|public|private|readonly|constructor|super|this|def|for|while|in|of|try|catch|type|interface)\b/g;

/** Light syntax colouring: keywords, strings, comments. */
function Code({ text }: { text: string }) {
  const parts: (string | JSX.Element)[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(KEYWORDS)) {
    parts.push(text.slice(last, m.index));
    parts.push(
      <span key={k++} className={`tk-${m[1] ? "c" : m[2] ? "s" : "k"}`}>
        {m[0]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <code>{parts.length > 1 || text ? parts : " "}</code>;
}

function Ln({ cls = "", no, mark = "", text, color }: { cls?: string; no?: number | ""; mark?: string; text: string; color?: string }) {
  return (
    <div className={`ln ${cls}`} style={color ? { ["--p" as string]: color } : undefined}>
      <span className="no">{no}</span>
      <span className="mk">{mark}</span>
      <Code text={text} />
    </div>
  );
}

type Ws = FileDetail["workspaces"][number];

function CodeView({ detail, mode, segs, cols }: { detail: FileDetail; mode: "split" | "merge"; segs: Segment[]; cols: Ws[] }) {
  const colorOf = useColorOf();
  const k = mode === "merge" ? 1 : cols.length;
  const symAt = (line: number) => detail.outline.filter((o) => o.start_line <= line && o.end_line >= line).at(-1);
  let lastSym: string | undefined = "\0";
  const clashes = segs.filter((s) => s.kind === "chg" && s.clash).length;
  return (
    <div className="sbs" style={{ ["--k" as string]: k }}>
      <div className="cols" style={{ ["--k" as string]: k }}>
        {mode === "merge" ? (
          <div className="colh">
            <div>
              <b>Nếu gộp tất cả vào nhánh chính</b>
              <small>
                {clashes
                  ? `Git không tự gộp được ${clashes} chỗ. Ở các chỗ đó, bản của từng người xếp chồng lên nhau.`
                  : "Git gộp sạch, không có chỗ nào đụng."}
              </small>
            </div>
            <span className="who-keys">
              {cols.map((w) => (
                <span key={w.workspace_id} style={{ ["--p" as string]: colorOf(w.dev) }}>
                  <i />
                  {w.dev}
                </span>
              ))}
            </span>
          </div>
        ) : (
          cols.map((w) => {
            const c = counts(w.diff);
            return (
              <div key={w.workspace_id} className="colh" style={{ ["--p" as string]: colorOf(w.dev) }}>
                <Av who={w.dev} agent={w.agent} />
                <div>
                  <b>{w.dev}</b>
                  <small>{w.tasks[0]?.title ?? w.label}</small>
                </div>
                <span className="pm">
                  <b className="plus">+{c.add}</b> <b className="minus">−{c.del}</b>
                  {w.snapshot_at && <small>bản lưu {clock(w.snapshot_at)}</small>}
                </span>
              </div>
            );
          })
        )}
      </div>
      {segs.map((s, i) => {
        let head: JSX.Element | null = null;
        if (s.kind === "chg") {
          const sym = symAt(s.start);
          if (sym?.name !== lastSym) {
            lastSym = sym?.name;
            head = (
              <div className="hunk-h" id={sym ? `sym-${sym.name}` : undefined}>
                <Code2 />
                {sym ? sym.name : "Ngoài hàm"}
                <span>dòng {s.start}</span>
              </div>
            );
          }
        }
        if (s.kind === "fold")
          return (
            <div key={i} className="fold">
              {s.count} dòng không đổi
            </div>
          );
        if (s.kind === "ctx") {
          const cell = (
            <div className="cell">
              {s.lines.map((t, j) => (
                <Ln key={j} no={s.start + j} text={t} />
              ))}
            </div>
          );
          return (
            <div key={i} className="cseg" style={{ ["--k" as string]: k }}>
              {mode === "merge" ? cell : cols.map((w) => <Fragment key={w.workspace_id}>{cell}</Fragment>)}
            </div>
          );
        }
        const who = Object.keys(s.changes);
        if (mode === "merge") {
          const rows = s.clash
            ? who.flatMap((d) => s.changes[d].rows.filter((r) => r.t === "add").map((r) => ({ ...r, d })))
            : s.changes[who[0]].rows.filter((r) => r.t !== "del").map((r) => ({ ...r, d: who[0] }));
          return (
            <Fragment key={i}>
              {head}
              <div className={`cseg${s.clash ? " clash" : ""}`} style={{ ["--k" as string]: 1 }}>
                {s.clash && (
                  <div className="clashbar">
                    <Zap />
                    Git không tự gộp được chỗ này: {who.join(" và ")} cùng sửa. Ai merge sau phải chọn cách gộp.
                  </div>
                )}
                <div className="cell">
                  {rows.map((r, j) => (
                    <Ln key={j} cls={r.t === "add" ? "add" : ""} mark={r.t === "add" ? "+" : ""} text={r.text} color={colorOf(r.d)} />
                  ))}
                </div>
              </div>
            </Fragment>
          );
        }
        return (
          <Fragment key={i}>
            {head}
            <div className={`cseg${s.clash ? " clash" : ""}`} style={{ ["--k" as string]: k }}>
              {s.clash && (
                <div className="clashbar">
                  <Zap />
                  {who.join(" và ")} cùng sửa chỗ này{s.base.length ? ` (dòng ${s.start}–${s.start + s.base.length - 1})` : ` (chèn trước dòng ${s.start})`}.
                  Gộp hai bản thì Git báo xung đột.
                </div>
              )}
              {cols.map((w) => {
                const c = s.changes[w.dev];
                if (!c)
                  return s.base.length ? (
                    <div key={w.workspace_id} className="cell">
                      {s.base.map((t, j) => (
                        <Ln key={j} no={s.start + j} text={t} />
                      ))}
                    </div>
                  ) : (
                    <div key={w.workspace_id} className="cell void" />
                  );
                let n = s.start;
                return (
                  <div key={w.workspace_id} className="cell">
                    {c.rows.map((r, j) =>
                      r.t === "add" ? (
                        <Ln key={j} cls="add" mark="+" text={r.text} color={colorOf(w.dev)} />
                      ) : (
                        <Ln key={j} cls={r.t === "del" ? "del" : ""} no={n++} mark={r.t === "del" ? "−" : ""} text={r.text} />
                      ),
                    )}
                  </div>
                );
              })}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

const TOUCH_LABEL = (w: Ws) =>
  w.footprint ? (Date.now() - Date.parse(w.footprint.last_at) < 30 * 60_000 ? "đang sửa" : "đã sửa trước đó") : "mới khai báo, chưa sửa";

export function FileSheet({ path, onClose }: { path: string; onClose: () => void }) {
  const { id, detail: project } = useProject();
  const colorOf = useColorOf();
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"split" | "merge">("split");
  const [fixOpen, setFixOpen] = useState(false);
  const file = usePoll(() => api.projects.file(id, path, 100_000), [id, path], 10_000);
  const incs = usePoll(() => api.incidents.list(id, true), [id], 10_000);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const d = file.data;
  const cols = useMemo(() => d?.workspaces.filter((w) => w.diff.trim()) ?? [], [d]);
  const segs = useMemo(() => alignDiffs(Object.fromEntries(cols.map((w) => [w.dev, w.diff]))), [cols]);
  const inc: Incident | undefined = incs.data ? (fileIncident(incs.data, path) ?? incs.data.find((i) => i.files.includes(path))) : undefined;
  const lines = segs.reduce((n, s) => n + (s.kind === "ctx" ? s.lines.length : s.kind === "fold" ? s.count : s.base.length), 0);
  const bases = new Set(cols.map((w) => w.base).filter(Boolean));
  const done = inc && incidentDone(inc);
  const whoTouched = (start: number, end: number) => [
    ...new Set(segs.filter((s) => s.kind === "chg" && s.start >= start && s.start <= end).flatMap((s) => (s.kind === "chg" ? Object.keys(s.changes) : []))),
  ];
  const clashIn = (start: number, end: number) => segs.some((s) => s.kind === "chg" && s.clash && s.start >= start && s.start <= end);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={`Chi tiết file ${path}`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
    >
      <header className="sh-head">
        <div>
          <div className="faint mono">{dirOf(path)}</div>
          <h2>{base(path)}</h2>
        </div>
        {inc &&
          (done ? (
            <span className="p-chip ok">
              <Check />
              {done}
            </span>
          ) : (
            <span className={`p-chip ${isHot(inc.level) ? "clash" : "warn"}`}>
              <Zap />
              {isHot(inc.level) ? "đụng nhau" : "cần để ý"}
            </span>
          ))}
        {lines > 0 && (
          <span className="faint">
            {lines} dòng · so với {project.main_branch} · {shortSha(cols[0]?.base ?? project.main_sha)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {cols.length > 0 && (
          <Seg
            label="Cách xem"
            value={mode}
            onChange={setMode}
            options={[
              ["split", "Cạnh nhau"],
              ["merge", "Gộp thử"],
            ]}
          />
        )}
        {inc?.status === "open" && !fixOpen && (
          <button type="button" className="p-btn primary" onClick={() => setFixOpen(true)}>
            <Sparkles />
            Xử lý
          </button>
        )}
        <button type="button" className="iconbtn" onClick={() => ref.current?.close()} aria-label="Đóng">
          <X />
        </button>
      </header>
      {!d ? (
        <Loading />
      ) : (
        <div className="sh-body">
          <aside className="sh-rail">
            {inc ? (
              <div className={`verdict${inc.status !== "open" ? " calm" : isHot(inc.level) ? "" : " warn"}`}>
                <b>
                  <Zap />
                  {incidentTitle(inc)}
                </b>
                {incidentPlain(inc)}
              </div>
            ) : (
              <div className="verdict calm">
                <b>
                  <Check />
                  Chưa đụng ai
                </b>
                {d.workspaces.length > 1 ? "Nhiều người chạm file này nhưng khác chỗ." : "Chỉ một người đang chạm file này."}
              </div>
            )}
            <div className="block">
              <span className="sect">Ai chạm vào file này</span>
              {d.workspaces.map((w) => (
                <div key={w.workspace_id} className="touch">
                  <Av who={w.dev} agent={w.agent} />
                  <div>
                    <b>{w.dev}</b>
                    <small>{w.tasks[0]?.title ?? w.label}</small>
                  </div>
                  <div className="when">
                    {TOUCH_LABEL(w)}
                    {w.footprint && (
                      <>
                        <br />
                        {w.footprint.count} lần · {ago(w.footprint.last_at)}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {d.outline.length > 0 && (
              <div className="block">
                <span className="sect">Trong file này</span>
                {d.outline.map((o) => {
                  const who = whoTouched(o.start_line, o.end_line);
                  const clash = clashIn(o.start_line, o.end_line);
                  const shown = who.length > 0 && mode === "split";
                  return (
                    <button
                      type="button"
                      key={`${o.name}:${o.start_line}`}
                      className={`sym${clash ? " clash" : ""}`}
                      disabled={!who.length}
                      onClick={() =>
                        (shown || mode === "merge") && document.getElementById(`sym-${o.name}`)?.scrollIntoView({ block: "start", behavior: "smooth" })
                      }
                    >
                      <span className="mono">{o.name}</span>
                      <span className="faint">dòng {o.start_line}</span>
                      <span className="dots">
                        {who.map((w) => (
                          <i key={w} style={{ ["--p" as string]: colorOf(w) }} title={w} />
                        ))}
                        {clash && <Zap />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {d.used_by.length > 0 && (
              <div className="block">
                <span className="sect">Ai đang gọi theo chữ ký cũ</span>
                {d.used_by.map((u, i) => (
                  <div key={i} className="touch">
                    <Av who={u.dev} size="sm" />
                    <div>
                      <b>{u.dev}</b>
                      <small>
                        {base(u.path)}:{u.line}
                        {u.from_symbol ? `, trong ${u.from_symbol}` : ""}
                      </small>
                      <small className="mono">gọi {u.symbol}</small>
                    </div>
                    <div />
                  </div>
                ))}
              </div>
            )}
            {inc && (
              <div className="block">
                <span className="sect">Vì sao gtv báo</span>
                <ul className="evid">
                  {inc.evidence.slice(0, 6).map((e) => (
                    <li key={e.id}>
                      <span className="ic">
                        {e.layer === "L1" ? <GitMerge /> : e.layer === "L2" ? <Code2 /> : e.layer === "L3" ? <Sparkles /> : <FileText />}
                      </span>
                      <div>
                        {KIND_VI[e.kind] ?? e.kind}
                        <small>{shortSubject(e.subject)}</small>
                      </div>
                      <span className="lay" title={`Lớp phát hiện ${e.layer}`}>
                        {e.layer}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {bases.size > 1 && (
              <p className="faint" style={{ marginTop: 14 }}>
                <Link2 style={{ verticalAlign: "-3px" }} /> Các bản được lưu trên những commit gốc khác nhau, số dòng có thể lệch vài dòng.
              </p>
            )}
          </aside>
          <section className="sh-code">
            {cols.length ? (
              <CodeView detail={d} mode={mode} segs={segs} cols={cols} />
            ) : (
              <div className="p-empty">
                <b>Chưa có thay đổi nào</b>
                {d.workspaces.length
                  ? `${d.workspaces.map((w) => w.dev).join(", ")} chưa có bản lưu tạm nào sửa file này. Khi agent sửa và lưu, thay đổi hiện ở đây.`
                  : "Không ai đang chạm vào file này."}
              </div>
            )}
          </section>
        </div>
      )}
      {/* the fix box only when asked for (Xử lý), so the code keeps the room; a closed incident shows its outcome */}
      {inc && (inc.status !== "open" || fixOpen) && (
        <footer className="sh-foot">
          <FixBox projectId={id} inc={inc} onChanged={() => void incs.reload()} onCollapse={inc.status === "open" ? () => setFixOpen(false) : undefined} />
        </footer>
      )}
    </dialog>
  );
}
