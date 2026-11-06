import { useState, type FormEvent } from "react";
import { api } from "../../api/endpoints";
import type { KbListItem } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { Badge, StatusBadge } from "../../components/Badge";
import { Segmented } from "../../components/Segmented";
import { Table } from "../../components/Table";
import { Field } from "../../components/Field";
import { Empty, ErrorNotice, Loading } from "../../components/Empty";
import { ago } from "../../lib/format";

function DocView({ docId, onChanged }: { docId: string; onChanged: () => void }) {
  const { id } = useProject();
  const run = useAction();
  const { data, error, reload } = usePoll(() => api.kb.get(id, docId), [id, docId], 0);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const review = async (action: "confirm" | "reject") => {
    await run(() => api.kb.review(id, docId, action), action === "confirm" ? "Đã xác nhận — tài liệu thành tri thức chính thức" : "Đã loại bỏ");
    void reload();
    onChanged();
  };
  return (
    <Card
      title={<h3 className="wrap-anywhere">{data.title}</h3>}
      actions={
        <>
          <StatusBadge doc status={data.status} />
          {data.status === "unverified" && (
            <>
              <button className="btn sm primary" type="button" onClick={() => review("confirm")}>
                Xác nhận
              </button>
              <button className="btn sm danger" type="button" onClick={() => review("reject")}>
                Loại bỏ
              </button>
            </>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="kv">
          <span>
            Loại <b>{data.type}</b>
          </span>
          <span>
            Nguồn <b>{data.source}</b>
          </span>
          {data.path && <span className="mono">{data.path}</span>}
          <span>cập nhật {ago(data.updated_at)}</span>
        </div>
        <div className="doc-body">{data.body}</div>
      </div>
    </Card>
  );
}

function AddDoc({ onAdded }: { onAdded: (id: string) => void }) {
  const { id } = useProject();
  const run = useAction();
  const [f, setF] = useState({ title: "", body: "", type: "doc" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const doc = await run(() => api.kb.add(id, f), "Đã thêm tài liệu");
    if (doc) {
      setF({ title: "", body: "", type: "doc" });
      onAdded(doc.id);
    }
  };
  return (
    <Card title="Thêm tri thức thủ công">
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Tiêu đề">
            <input className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Loại">
            <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="doc">doc · nghiệp vụ</option>
              <option value="adr">adr · quyết định</option>
              <option value="req">req · yêu cầu</option>
              <option value="glossary">glossary · thuật ngữ</option>
            </select>
          </Field>
        </div>
        <Field label="Nội dung (markdown)">
          <textarea className="textarea" required rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
        <div>
          <button className="btn primary" type="submit">
            Lưu
          </button>
        </div>
      </form>
    </Card>
  );
}

export function KnowledgeTab() {
  const { id, reload: reloadProject } = useProject();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unverified" | "qa" | "adr">("all");
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const list = usePoll(() => api.kb.list(id), [id], 10_000);
  const hits = usePoll(() => (query ? api.kb.search(id, query) : Promise.resolve([])), [id, query], 0);

  if (list.error && !list.data) return <ErrorNotice error={list.error} />;
  const rows = (list.data ?? []).filter((d) => filter === "all" || (filter === "unverified" ? d.status === "unverified" : d.type === filter));

  return (
    <div className="stack">
      <div className="row between">
        <form
          className="row"
          style={{ flex: 1, minWidth: 240 }}
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <input className="input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong docs, ADR, Q&A… (BM25)" />
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
        <button className="btn" type="button" onClick={() => setAdding((v) => !v)}>
          {adding ? "Đóng" : "Thêm tài liệu"}
        </button>
      </div>

      {adding && (
        <AddDoc
          onAdded={(docId) => {
            setAdding(false);
            setSelected(docId);
            void list.reload();
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
                    <Badge>{h.type}</Badge>
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
            <Segmented
              options={[
                { value: "all", label: "Tất cả" },
                { value: "unverified", label: "Chờ xác nhận" },
                { value: "qa", label: "Q&A" },
                { value: "adr", label: "ADR" },
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
            <Table<KbListItem>
              rows={rows}
              rowKey={(d) => d.id}
              selected={selected}
              onRowClick={(d) => setSelected(d.id)}
              empty="Chưa có tài liệu"
              columns={[
                { key: "t", title: "Tiêu đề", render: (d) => <span className="small">{d.title}</span> },
                { key: "type", title: "Loại", render: (d) => <Badge>{d.type}</Badge> },
                { key: "st", title: "Trạng thái", render: (d) => <StatusBadge doc status={d.status} /> },
                { key: "src", title: "Nguồn", render: (d) => <span className="xs muted">{d.source}</span> },
              ]}
            />
          )}
        </Card>
        {selected ? (
          <DocView
            key={selected}
            docId={selected}
            onChanged={() => {
              void list.reload();
              void reloadProject();
            }}
          />
        ) : (
          <Card>
            <Empty>Chọn một tài liệu. Câu trả lời của Operator vào đây ở trạng thái “unverified” và chỉ thành tri thức chính thức khi được xác nhận.</Empty>
          </Card>
        )}
      </div>
    </div>
  );
}
