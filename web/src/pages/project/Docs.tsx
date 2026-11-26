// Tài liệu (in Tri thức): documents the AI reads. Core documents go into every answer; others are searched when needed.

import { useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, BookOpen, CircleHelp, FileText, GitBranch, Pencil, Plus, Search, Star, Trash2, Upload, X } from "lucide-react";
import { api } from "../../api/endpoints";
import type { KbListItem } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { Blank } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Markdown } from "../../components/Markdown";
import { ago } from "../../lib/format";

export const DOC_TYPES: { value: string; label: string }[] = [
  { value: "req", label: "Yêu cầu" },
  { value: "business", label: "Nghiệp vụ" },
  { value: "adr", label: "Quyết định (ADR)" },
  { value: "guide", label: "Hướng dẫn, quy ước" },
  { value: "doc", label: "Tài liệu khác" },
  { value: "glossary", label: "Thuật ngữ" },
];
const TYPE_LABEL: Record<string, string> = { ...Object.fromEntries(DOC_TYPES.map((t) => [t.value, t.label])), qa: "Hỏi đáp" };
const SOURCE_LABEL: Record<string, string> = { repo: "từ repo", manual: "tải lên", ticket: "hỏi đáp" };
const ACCEPT = ".md,.markdown,.txt,.rst,.adoc,.csv,.json,.yaml,.yml,.html";
const MAX_FILE = 400_000;
const titleOf = (name: string, body: string) => /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");

function AddDocs({ onAdded, onClose }: { onAdded: (id: string) => void; onClose: () => void }) {
  const { id } = useProject();
  const run = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ name: string; title: string; body: string }[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [type, setType] = useState("req");
  const [pinned, setPinned] = useState(true);
  const [manual, setManual] = useState({ title: "", body: "" });
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = async (list: FileList | null) => {
    if (!list) return;
    const next: typeof files = [];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE || /\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|zip)$/i.test(f.name)) bad.push(f.name);
      else {
        const body = await f.text();
        next.push({ name: f.name, title: titleOf(f.name, body), body });
      }
    }
    setFiles((cur) => [...cur, ...next]);
    setSkipped(bad);
  };
  const upload = async () => {
    setBusy(true);
    let last: string | undefined;
    for (const f of files) {
      const doc = await run(() => api.kb.add(id, { title: f.title, body: f.body, type, pinned, path: f.name }));
      if (doc) last = doc.id;
    }
    setBusy(false);
    if (last) onAdded(last);
  };
  return (
    <div className="panel addtask">
      <div className="dhead">
        <h3>Thêm tài liệu</h3>
        <button type="button" className="iconbtn x" onClick={onClose} aria-label="Đóng">
          <X />
        </button>
      </div>
      <div
        className={`drop${over ? " over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          void read(e.dataTransfer.files);
        }}
      >
        <Upload />
        <b>Kéo thả file vào đây, hoặc bấm để chọn</b>
        <small>Markdown, text, JSON, YAML, CSV, nhiều file cùng lúc. Word hay PDF: lưu thành .md hoặc .txt trước.</small>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => void read(e.target.files)} />
      </div>
      {skipped.length > 0 && (
        <p className="bad" style={{ marginTop: 8 }}>
          Bỏ qua vì không phải file chữ hoặc lớn hơn 400 KB: {skipped.join(", ")}
        </p>
      )}
      {files.map((f, i) => (
        <div key={`${f.name}${i}`} className="inline-form" style={{ marginTop: 8 }}>
          <span className="mono faint" style={{ minWidth: 140 }}>
            {f.name}
          </span>
          <input
            className="p-input"
            value={f.title}
            aria-label="Tiêu đề"
            onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
          />
          <button type="button" className="iconbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Bỏ file này">
            <X />
          </button>
        </div>
      ))}
      <div className="inline-form" style={{ marginTop: 12 }}>
        <select className="p-input" style={{ maxWidth: 220 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Loại tài liệu">
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <label className="check" style={{ marginTop: 0 }}>
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Tài liệu cốt lõi: AI đọc trong mọi câu trả lời
        </label>
        {files.length > 0 && (
          <button type="button" className="p-btn primary" disabled={busy} onClick={() => void upload()}>
            {busy ? "Đang tải lên…" : `Tải lên ${files.length} file`}
          </button>
        )}
      </div>
      <details style={{ marginTop: 12 }}>
        <summary>Hoặc viết trực tiếp</summary>
        <form
          className="formgrid"
          style={{ marginTop: 10 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const doc = await run(() => api.kb.add(id, { ...manual, type, pinned }), "Đã thêm tài liệu");
            if (doc) onAdded(doc.id);
          }}
        >
          <label className="wide">
            Tiêu đề
            <input className="p-input" required value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
          </label>
          <label className="wide">
            Nội dung (markdown)
            <textarea className="p-textarea mono" rows={8} required value={manual.body} onChange={(e) => setManual({ ...manual, body: e.target.value })} />
          </label>
          <div className="acts wide">
            <button type="submit" className="p-btn primary">
              Lưu tài liệu
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

function DocView({ docId, onBack, onChanged }: { docId: string; onBack: () => void; onChanged: () => void }) {
  const { id } = useProject();
  const { manage } = useProject();
  const run = useAction();
  const { data, reload } = usePoll(() => api.kb.get(id, docId), [id, docId], 0);
  const [edit, setEdit] = useState<{ title: string; body: string; type: string }>();
  if (!data) return <Loading />;
  const changed = () => {
    void reload();
    onChanged();
  };
  const fromRepo = data.source === "repo";
  return (
    <>
      <button type="button" className="linkbtn" onClick={onBack} style={{ display: "inline-flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
        <ArrowLeft size={14} />
        Tất cả tài liệu
      </button>
      <h2>{data.title}</h2>
      <p className="lede">
        {TYPE_LABEL[data.type] ?? data.type} · {SOURCE_LABEL[data.source] ?? data.source}
        {data.path ? ` · ${data.path}` : ""} · cập nhật {ago(data.updated_at)}
        {data.status === "unverified" && " · chưa xác nhận"}
      </p>
      {!!data.pinned && (
        <div className="verdict calm" style={{ marginBottom: 16 }}>
          <b>
            <Star />
            Tài liệu cốt lõi
          </b>
          AI đọc tài liệu này mỗi khi trả lời agent hoặc so các việc; agent thấy tên nó khi mở phiên.
        </div>
      )}
      {manage && (
        <div className="acts" style={{ marginTop: 0, marginBottom: 16 }}>
          {data.status === "unverified" && (
            <>
              <button
                type="button"
                className="p-btn primary sm"
                onClick={async () => {
                  await run(() => api.kb.review(id, docId, "confirm"), "Đã lưu vào Tri thức");
                  changed();
                }}
              >
                Đúng, lưu lại
              </button>
              <button
                type="button"
                className="p-btn sm"
                onClick={async () => {
                  await run(() => api.kb.review(id, docId, "reject"), "Đã bỏ");
                  changed();
                }}
              >
                Sai, bỏ
              </button>
            </>
          )}
          {data.status === "active" && (
            <button
              type="button"
              className={`p-btn sm${data.pinned ? " primary" : ""}`}
              onClick={async () => {
                await run(() => api.kb.edit(id, docId, { pinned: !data.pinned }), data.pinned ? "Đã bỏ khỏi tài liệu cốt lõi" : "Đã đánh dấu cốt lõi");
                changed();
              }}
            >
              <Star />
              {data.pinned ? "Bỏ cốt lõi" : "Đánh dấu cốt lõi"}
            </button>
          )}
          {data.source !== "ticket" && !edit && (
            <button type="button" className="p-btn sm" onClick={() => setEdit({ title: data.title, body: data.body, type: data.type })}>
              <Pencil />
              Sửa
            </button>
          )}
          {!fromRepo && (
            <ConfirmButton
              className="p-btn sm danger"
              onConfirm={async () => {
                if (await run(() => api.kb.remove(id, docId), "Đã xoá tài liệu")) {
                  onChanged();
                  onBack();
                }
              }}
            >
              <Trash2 size={14} /> Xoá
            </ConfirmButton>
          )}
        </div>
      )}
      {edit ? (
        <form
          className="formgrid"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.kb.edit(id, docId, edit), "Đã lưu")) {
              setEdit(undefined);
              changed();
            }
          }}
        >
          {!fromRepo && (
            <label>
              Tiêu đề
              <input className="p-input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </label>
          )}
          <label>
            Loại
            <select className="p-input" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {fromRepo ? (
            <p className="faint wide">Lấy từ repo: sửa file rồi merge vào nhánh chính để cập nhật nội dung.</p>
          ) : (
            <label className="wide">
              Nội dung (markdown)
              <textarea className="p-textarea mono" rows={16} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            </label>
          )}
          <div className="acts wide">
            <button type="submit" className="p-btn primary">
              Lưu
            </button>
            <button type="button" className="p-btn quiet" onClick={() => setEdit(undefined)}>
              Huỷ
            </button>
          </div>
        </form>
      ) : (
        <div className="docbody">{data.type === "qa" ? <p className="pre">{data.body}</p> : <Markdown text={data.body} />}</div>
      )}
    </>
  );
}

type Filter = "all" | "core" | "repo" | "qa";
const FILTERS: [Filter, string][] = [
  ["all", "Tất cả"],
  ["core", "Cốt lõi"],
  ["repo", "Từ repo"],
  ["qa", "Hỏi đáp"],
];

export function DocsSection() {
  const { id, reload: reloadProject } = useProject();
  const { manage } = useProject();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const list = usePoll(() => api.kb.list(id), [id], 10_000);
  const hits = usePoll(() => (query ? api.kb.search(id, query) : Promise.resolve([])), [id, query], 0);
  const selected = params.get("doc");
  const select = (doc: string | null) => {
    const next = new URLSearchParams(params);
    if (doc) next.set("doc", doc);
    else next.delete("doc");
    setParams(next);
  };
  const changed = () => {
    void list.reload();
    void reloadProject();
  };
  if (selected) return <DocView key={selected} docId={selected} onBack={() => select(null)} onChanged={changed} />;
  const all = list.data ?? [];
  const rows = all.filter((d) =>
    filter === "all" ? d.status !== "superseded" : filter === "core" ? !!d.pinned : filter === "qa" ? d.type === "qa" : d.source === "repo",
  );
  const icon = (d: KbListItem) => (d.pinned ? <Star /> : d.type === "qa" ? <CircleHelp /> : d.source === "repo" ? <GitBranch /> : <FileText />);
  return (
    <>
      <h2>Tài liệu</h2>
      <p className="lede">Tài liệu cốt lõi được đưa cho AI trong mọi câu trả lời. Các tài liệu khác được tìm khi cần. File markdown trong repo tự có ở đây.</p>
      <div className="inline-form" style={{ marginBottom: 14 }}>
        <form
          className="inline-form"
          style={{ flex: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <input
            className="p-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm trong tài liệu, ADR, hỏi đáp"
            aria-label="Tìm tài liệu"
          />
          <button type="submit" className="p-btn">
            <Search />
            Tìm
          </button>
        </form>
        {manage && (
          <button type="button" className="p-btn primary" onClick={() => setAdding(true)}>
            <Plus />
            Thêm tài liệu
          </button>
        )}
      </div>
      {adding && (
        <AddDocs
          onClose={() => setAdding(false)}
          onAdded={(doc) => {
            setAdding(false);
            changed();
            select(doc);
          }}
        />
      )}
      {query ? (
        <div className="block">
          <div className="inline-form">
            <span className="sect">Kết quả cho “{query}”</span>
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                setQ("");
                setQuery("");
              }}
            >
              Bỏ tìm
            </button>
          </div>
          {!hits.data ? (
            <Loading />
          ) : hits.data.length === 0 ? (
            <Blank title="Không tìm thấy" />
          ) : (
            <div className="doclist" style={{ marginTop: 8 }}>
              {hits.data.map((h) => (
                <button type="button" key={`${h.id}${h.section}`} className="docrow" onClick={() => select(h.id)}>
                  <span className="ic">
                    <Search />
                  </span>
                  <b>{h.section || h.title}</b>
                  <small>{h.snippet}</small>
                  <span className="r">
                    <span className="p-chip">{TYPE_LABEL[h.type] ?? h.type}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="filters" style={{ marginBottom: 10 }}>
            {FILTERS.map(([k, l]) => (
              <button key={k} type="button" className={`fchip${filter === k ? " on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
          {!list.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Blank icon={<BookOpen />} title={filter === "core" ? "Chưa có tài liệu cốt lõi" : "Chưa có tài liệu"}>
              Thêm yêu cầu, quy ước hay quyết định của nhóm để AI và agent làm đúng hướng.
            </Blank>
          ) : (
            <div className="doclist">
              {rows.map((d) => (
                <button type="button" key={d.id} className="docrow" onClick={() => select(d.id)}>
                  <span className={`ic${d.pinned ? " core" : ""}`}>{icon(d)}</span>
                  <b>{d.title}</b>
                  <small>
                    {SOURCE_LABEL[d.source] ?? d.source} · cập nhật {ago(d.updated_at)}
                  </small>
                  <span className="r">
                    {!!d.pinned && <span className="p-chip accent">cốt lõi</span>}
                    {d.status === "unverified" && <span className="p-chip warn">chờ xác nhận</span>}
                    <span className="p-chip">{TYPE_LABEL[d.type] ?? d.type}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
