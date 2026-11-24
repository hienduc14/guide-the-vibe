import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { api } from "../../api/endpoints";
import type { KbListItem } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { Badge, StatusBadge } from "../../components/Badge";
import { Segmented } from "../../components/Segmented";
import { Field } from "../../components/Field";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Empty, ErrorNotice, Loading } from "../../components/Empty";
import { ago } from "../../lib/format";
import { EmptyState } from "../../components/Visual";
import { Markdown } from "../../components/Markdown";
import { BookOpen } from "lucide-react";

export const DOC_TYPES: { value: string; label: string }[] = [
  { value: "req", label: "Yêu cầu" },
  { value: "business", label: "Nghiệp vụ" },
  { value: "adr", label: "Quyết định (ADR)" },
  { value: "guide", label: "Hướng dẫn / quy ước" },
  { value: "doc", label: "Tài liệu khác" },
  { value: "glossary", label: "Thuật ngữ" },
];
const TYPE_LABEL: Record<string, string> = { ...Object.fromEntries(DOC_TYPES.map((t) => [t.value, t.label])), qa: "Hỏi đáp" };
const SOURCE_LABEL: Record<string, string> = { repo: "repo", manual: "tải lên", ticket: "hỏi đáp" };
/** Text files a browser can read as-is. Word/PDF need converting to text or markdown first. */
const ACCEPT = ".md,.markdown,.txt,.rst,.adoc,.csv,.json,.yaml,.yml,.html";
const MAX_FILE = 400_000;

function CoreToggle({ docId, pinned, onChanged }: { docId: string; pinned: boolean; onChanged: () => void }) {
  const { id } = useProject();
  const run = useAction();
  return (
    <button
      type="button"
      className={`btn sm manage-only${pinned ? " primary" : ""}`}
      title="Tài liệu cốt lõi: Operator đọc trong mọi câu trả lời và đánh giá đăng ký; agent thấy tên tài liệu khi mở phiên"
      onClick={async () => {
        await run(() => api.kb.edit(id, docId, { pinned: !pinned }), pinned ? "Đã bỏ khỏi tài liệu cốt lõi" : "Đã đánh dấu cốt lõi — Operator sẽ dựa vào nó");
        onChanged();
      }}
    >
      {pinned ? "★ Cốt lõi" : "☆ Đánh dấu cốt lõi"}
    </button>
  );
}

function DocView({ docId, onChanged, onDeleted }: { docId: string; onChanged: () => void; onDeleted: () => void }) {
  const { id } = useProject();
  const { can } = useAuth();
  const run = useAction();
  const { data, error, reload } = usePoll(() => api.kb.get(id, docId), [id, docId], 0);
  const [edit, setEdit] = useState<{ title: string; body: string; type: string }>();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const changed = () => {
    void reload();
    onChanged();
  };
  const review = async (action: "confirm" | "reject") => {
    await run(() => api.kb.review(id, docId, action), action === "confirm" ? "Đã xác nhận — tài liệu thành tri thức chính thức" : "Đã loại bỏ");
    changed();
  };
  const fromRepo = data.source === "repo";
  return (
    <Card
      title={<h3 className="wrap-anywhere">{data.title}</h3>}
      actions={
        <>
          <StatusBadge doc status={data.status} />
          {data.status === "unverified" && (
            <>
              <button className="btn sm primary manage-only" type="button" onClick={() => review("confirm")}>
                Xác nhận
              </button>
              <button className="btn sm danger manage-only" type="button" onClick={() => review("reject")}>
                Loại bỏ
              </button>
            </>
          )}
          {data.status === "active" && <CoreToggle docId={docId} pinned={!!data.pinned} onChanged={changed} />}
        </>
      }
    >
      {edit ? (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() => api.kb.edit(id, docId, edit), "Đã lưu");
            if (ok) {
              setEdit(undefined);
              changed();
            }
          }}
        >
          {!fromRepo && (
            <Field label="Tiêu đề">
              <input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
          )}
          <Field label="Loại">
            <select className="select" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          {fromRepo ? (
            <p className="xs muted">Lấy từ repo: sửa file và merge vào main để cập nhật.</p>
          ) : (
            <Field label="Nội dung (markdown)">
              <textarea className="textarea mono" rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            </Field>
          )}
          <div className="row">
            <button className="btn primary" type="submit">
              Lưu
            </button>
            <button className="btn ghost" type="button" onClick={() => setEdit(undefined)}>
              Huỷ
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <div className="kv">
            <span>
              Loại <b>{TYPE_LABEL[data.type] ?? data.type}</b>
            </span>
            <span>
              Nguồn <b>{SOURCE_LABEL[data.source] ?? data.source}</b>
            </span>
            {data.path && <span className="mono">{data.path}</span>}
            <span>cập nhật {ago(data.updated_at)}</span>
          </div>
          {!!data.pinned && (
            <div className="notice info small">
              Tài liệu cốt lõi: Operator đọc nó mỗi khi trả lời agent hoặc đánh giá việc đăng ký, agent thấy tên nó khi mở phiên.
            </div>
          )}
          <div className="doc-body">{data.type === "qa" ? data.body : <Markdown text={data.body} />}</div>
          {can("manager") && data.source !== "ticket" && (
            <div className="row">
              <button className="btn sm" type="button" onClick={() => setEdit({ title: data.title, body: data.body, type: data.type })}>
                Sửa
              </button>
              {!fromRepo && (
                <ConfirmButton
                  onConfirm={async () => {
                    const ok = await run(() => api.kb.remove(id, docId), "Đã xoá tài liệu");
                    if (ok) onDeleted();
                  }}
                >
                  Xoá
                </ConfirmButton>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

interface Pending {
  name: string;
  title: string;
  body: string;
}

const titleOf = (name: string, body: string) => /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");

/** Add documents: drop or pick text files (several at once), or write one by hand. */
function AddDocs({ onAdded }: { onAdded: (id: string) => void }) {
  const { id } = useProject();
  const run = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Pending[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [type, setType] = useState("req");
  const [pinned, setPinned] = useState(true);
  const [manual, setManual] = useState({ title: "", body: "" });
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const read = async (list: FileList | null) => {
    if (!list) return;
    const next: Pending[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE || /\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|zip)$/i.test(f.name)) {
        bad.push(f.name);
        continue;
      }
      const body = await f.text();
      next.push({ name: f.name, title: titleOf(f.name, body), body });
    }
    setFiles((cur) => [...cur, ...next]);
    setSkipped(bad);
  };

  const uploadAll = async () => {
    setBusy(true);
    let last: string | undefined;
    for (const f of files) {
      const doc = await run(() => api.kb.add(id, { title: f.title, body: f.body, type, pinned, path: f.name }));
      if (doc) last = doc.id;
    }
    setBusy(false);
    if (last) {
      setFiles([]);
      onAdded(last);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void read(e.dataTransfer.files);
  };

  return (
    <Card title="Thêm tài liệu">
      <div className="stack">
        <div
          className={`dropzone${over ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        >
          <b>Kéo thả file vào đây</b> hoặc bấm để chọn (nhiều file cùng lúc)
          <span className="xs muted">Markdown, text, JSON, YAML, CSV. Word/PDF: lưu thành .md hoặc .txt trước.</span>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => void read(e.target.files)} />
        </div>
        {skipped.length > 0 && <div className="notice warn small">Bỏ qua (không phải file chữ, hoặc lớn hơn 400 KB): {skipped.join(", ")}</div>}
        {files.length > 0 && (
          <div className="stack tight">
            {files.map((f, i) => (
              <div key={`${f.name}${i}`} className="row">
                <span className="mono xs muted" style={{ minWidth: 140 }}>
                  {f.name}
                </span>
                <input
                  className="input sm"
                  style={{ flex: 1 }}
                  value={f.title}
                  aria-label="Tiêu đề"
                  onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                />
                <span className="xs faint">{Math.ceil(f.body.length / 1000)}k ký tự</span>
                <button className="btn sm ghost" type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Bỏ file này">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Loại">
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <label className="row small" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Tài liệu cốt lõi (Operator luôn đọc)
          </label>
          {files.length > 0 && (
            <button className="btn primary" type="button" disabled={busy} onClick={() => void uploadAll()}>
              {busy ? "Đang tải lên…" : `Tải lên ${files.length} file`}
            </button>
          )}
        </div>
        <details>
          <summary className="small">Hoặc viết trực tiếp</summary>
          <form
            className="stack"
            style={{ marginTop: 12 }}
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              const doc = await run(() => api.kb.add(id, { ...manual, type, pinned }), "Đã thêm tài liệu");
              if (doc) {
                setManual({ title: "", body: "" });
                onAdded(doc.id);
              }
            }}
          >
            <Field label="Tiêu đề">
              <input className="input" required value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            </Field>
            <Field label="Nội dung (markdown)">
              <textarea className="textarea" required rows={8} value={manual.body} onChange={(e) => setManual({ ...manual, body: e.target.value })} />
            </Field>
            <div>
              <button className="btn primary" type="submit">
                Lưu
              </button>
            </div>
          </form>
        </details>
      </div>
    </Card>
  );
}

type Filter = "all" | "core" | "unverified" | "qa" | "repo";

export function KnowledgeTab() {
  const { id, reload: reloadProject } = useProject();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const list = usePoll(() => api.kb.list(id), [id], 10_000);
  const hits = usePoll(() => (query ? api.kb.search(id, query) : Promise.resolve([])), [id, query], 0);

  if (list.error && !list.data) return <ErrorNotice error={list.error} />;
  const all = list.data ?? [];
  const rows = all.filter((d) =>
    filter === "all"
      ? true
      : filter === "core"
        ? !!d.pinned
        : filter === "unverified"
          ? d.status === "unverified"
          : filter === "qa"
            ? d.type === "qa"
            : d.source === "repo",
  );
  const core = all.filter((d) => d.pinned && d.status === "active");
  const changed = () => {
    void list.reload();
    void reloadProject();
  };

  return (
    <div className="stack">
      <div className="summary">
        <button type="button" className="chip" onClick={() => setFilter("core")} title="Operator đọc các tài liệu này trong mọi câu trả lời">
          <b>{core.length}</b> tài liệu cốt lõi
        </button>
        <button type="button" className="chip" onClick={() => setFilter("all")}>
          <b>{all.filter((d) => d.type !== "qa").length}</b> tài liệu
        </button>
        <button type="button" className={`chip${all.some((d) => d.status === "unverified") ? " warn" : ""}`} onClick={() => setFilter("unverified")}>
          <b>{all.filter((d) => d.status === "unverified").length}</b> hỏi đáp chờ xác nhận
        </button>
      </div>

      <div className="row between">
        <form
          className="row"
          style={{ flex: 1, minWidth: 240 }}
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <input className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong tài liệu, ADR, hỏi đáp…" />
          <button className="btn" type="submit">
            Tìm
          </button>
          {query && (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setQ("");
                setQuery("");
              }}
            >
              Xoá
            </button>
          )}
        </form>
        <button className="btn primary manage-only" type="button" onClick={() => setAdding((v) => !v)}>
          {adding ? "Đóng" : "Thêm tài liệu"}
        </button>
      </div>

      {adding && (
        <AddDocs
          onAdded={(docId) => {
            setAdding(false);
            setSelected(docId);
            changed();
          }}
        />
      )}

      {query && (
        <Card title={`Kết quả cho “${query}”`} flush>
          {!hits.data ? (
            <Loading />
          ) : hits.data.length === 0 ? (
            <Empty>Không tìm thấy</Empty>
          ) : (
            <div className="feed">
              {hits.data.map((h) => (
                <button
                  key={`${h.id}${h.section}`}
                  type="button"
                  className="feed-item"
                  style={{
                    gridTemplateColumns: "1fr",
                    textAlign: "left",
                    background: "none",
                    border: 0,
                    borderBottom: "1px solid var(--line)",
                    cursor: "pointer",
                  }}
                  onClick={() => setSelected(h.id)}
                >
                  <span className="row">
                    <b className="small">{h.section}</b>
                    <Badge>{TYPE_LABEL[h.type] ?? h.type}</Badge>
                    {h.status !== "active" && <StatusBadge doc status={h.status} />}
                  </span>
                  <span className="xs muted">{h.snippet}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      <div className="split">
        <Card
          title="Tài liệu"
          actions={
            <Segmented<Filter>
              options={[
                { value: "all", label: "Tất cả" },
                { value: "core", label: "Cốt lõi" },
                { value: "repo", label: "Từ repo" },
                { value: "unverified", label: "Chờ xác nhận" },
                { value: "qa", label: "Hỏi đáp" },
              ]}
              value={filter}
              onChange={setFilter}
            />
          }
          flush
        >
          {!list.data ? (
            <Loading />
          ) : (
            <nav className="pick-list flat" aria-label="Tài liệu">
              {rows.map((d: KbListItem) => (
                <button key={d.id} type="button" className={`thread-row${d.id === selected ? " active" : ""}`} onClick={() => setSelected(d.id)}>
                  <span className="thread-title wrap-anywhere">
                    {d.pinned ? <span title="Tài liệu cốt lõi">★ </span> : null}
                    {d.title}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <Badge>{TYPE_LABEL[d.type] ?? d.type}</Badge>
                    <StatusBadge doc status={d.status} />
                    {d.source !== "ticket" && <span className="xs muted">· {SOURCE_LABEL[d.source] ?? d.source}</span>}
                  </span>
                </button>
              ))}
              {rows.length === 0 && <Empty>{filter === "core" ? "Chưa có tài liệu cốt lõi." : "Chưa có tài liệu"}</Empty>}
            </nav>
          )}
        </Card>
        {selected ? (
          <DocView
            key={selected}
            docId={selected}
            onChanged={changed}
            onDeleted={() => {
              setSelected(undefined);
              changed();
            }}
          />
        ) : (
          <Card>
            <EmptyState icon={BookOpen} title="Chưa chọn tài liệu">
              Chọn một tài liệu bên trái để đọc. Tài liệu cốt lõi (★) là thứ Operator luôn dựa vào; câu trả lời của Operator vào đây ở trạng thái “chưa xác
              nhận” cho tới khi có người xác nhận.
            </EmptyState>
          </Card>
        )}
      </div>
    </div>
  );
}
