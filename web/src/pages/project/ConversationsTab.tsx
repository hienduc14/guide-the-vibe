import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/endpoints";
import type { Thread } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { Loading } from "../../components/Empty";
import { Segmented } from "../../components/Segmented";
import { ChatView, ThreadRow } from "./Chat";

type Filter = "all" | Thread["kind"];

/** Every exchange between agents, the Operator and the team, as chat threads. */
export function ConversationsTab() {
  const { id, detail } = useProject();
  const { data, reload } = usePoll(() => api.projects.conversations(id, 100), [id], 5000);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [who, setWho] = useState("");
  if (!data) return <Loading />;

  const threads = data.filter((t) => (filter === "all" || t.kind === filter) && (!who || t.participants.includes(who)));
  const selected = threads.find((t) => t.id === params.get("t")) ?? threads[0];
  const people = [...new Set(data.flatMap((t) => t.participants))].filter((p) => p !== "operator").sort();

  if (!data.length)
    return (
      <Card>
        <div className="empty">
          <b>Chưa có trao đổi nào</b>
          Khi agent hỏi nhau (gtv_ask), bị báo conflict, hoặc lead giao việc và nhắn tin, cuộc trao đổi hiện ở đây như một đoạn chat.
        </div>
      </Card>
    );

  return (
    <div className="stack">
      <div className="row between">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Tất cả" },
            { value: "question", label: "Câu hỏi" },
            { value: "conflict", label: "Xung đột" },
            { value: "task", label: "Việc" },
            { value: "note", label: "Ghi chú" },
          ]}
        />
        <select className="input sm" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Lọc theo người">
          <option value="">Mọi người</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="convo">
        <nav className="convo-list" aria-label="Các cuộc trao đổi">
          {threads.map((t) => (
            <ThreadRow key={t.id} t={t} active={t.id === selected?.id} onClick={() => setParams({ t: t.id }, { replace: true })} />
          ))}
          {threads.length === 0 && (
            <span className="xs faint" style={{ padding: 12 }}>
              Không có cuộc nào khớp bộ lọc.
            </span>
          )}
        </nav>
        {selected ? <ChatView thread={selected} projectId={id} members={detail.members} onSent={() => void reload()} /> : <div />}
      </div>
    </div>
  );
}
