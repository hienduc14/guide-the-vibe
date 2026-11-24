import { useState } from "react";
import { api } from "../../api/endpoints";
import type { Ticket } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { Badge, StatusBadge } from "../../components/Badge";
import { Segmented } from "../../components/Segmented";
import { Field } from "../../components/Field";
import { Empty, ErrorNotice, Loading } from "../../components/Empty";
import { ago } from "../../lib/format";
import { EmptyState } from "../../components/Visual";
import { MessageCircleQuestion } from "lucide-react";

type Filter = "waiting" | "all" | "1" | "2" | "3";
const WAITING = new Set(["answering", "forwarded", "waiting_human"]);
const TIER = { 1: "Operator", 2: "Agent đồng đội", 3: "Người" } as const;

function Detail({ t, onReplied }: { t: Ticket; onReplied: () => void }) {
  const { id } = useProject();
  const run = useAction();
  const [answer, setAnswer] = useState("");
  const [as, setAs] = useState(t.to_dev ?? "admin");
  const canReply = t.status === "forwarded" || t.status === "waiting_human";
  return (
    <Card title={<h3 className="mono">{t.id}</h3>} actions={<StatusBadge status={t.status} />}>
      <div className="stack">
        <div className="kv">
          <span>
            Từ <b>{t.from_dev}</b>
          </span>
          {t.to_dev && (
            <span>
              Tới <b>{t.to_dev}</b>
            </span>
          )}
          <span>
            Bậc <b>{t.tier}</b> ({TIER[t.tier]})
          </span>
          {t.confidence && (
            <span>
              Độ tin cậy <b>{t.confidence}</b>
            </span>
          )}
          <span>{ago(t.created_at)}</span>
        </div>
        <div className="stack tight">
          <span className="label-caps">Câu hỏi</span>
          <p className="small wrap-anywhere">{t.question}</p>
          {t.forwarded_question && t.forwarded_question !== t.question && <p className="small muted wrap-anywhere">Chuyển tiếp: {t.forwarded_question}</p>}
          {t.context && <p className="xs muted wrap-anywhere">Ngữ cảnh: {t.context}</p>}
        </div>
        {t.answer && (
          <div className="stack tight">
            <span className="label-caps">Trả lời {t.answered_by ? `· ${t.answered_by}` : ""}</span>
            <p className="small wrap-anywhere" style={{ whiteSpace: "pre-wrap" }}>
              {t.answer}
            </p>
          </div>
        )}
        {t.sources.length > 0 && (
          <div className="row">
            {t.sources.map((s, i) => (
              <Badge key={i} mono title={s.note}>
                {s.type}:{s.ref}
              </Badge>
            ))}
          </div>
        )}
        {canReply && (
          <form
            className="stack tight manage-only"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => api.tickets.reply(id, t.id, answer.trim(), as.trim() || "admin"), "Đã gửi câu trả lời");
              if (ok) {
                setAnswer("");
                onReplied();
              }
            }}
          >
            <hr className="sep" />
            <Field label="Trả lời với tư cách người">
              <textarea
                className="textarea"
                style={{ fontFamily: "var(--font)" }}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Câu trả lời sẽ được chèn vào agent của người hỏi"
              />
            </Field>
            <div className="row">
              <input className="input" style={{ maxWidth: 180 }} value={as} onChange={(e) => setAs(e.target.value)} aria-label="Tên người trả lời" />
              <button className="btn primary" type="submit" disabled={!answer.trim()}>
                Gửi
              </button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

export function TicketsTab() {
  const { id } = useProject();
  const { data, error, reload } = usePoll(() => api.tickets.list(id), [id], 5000);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string>();

  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const rows = data.filter((t) => (filter === "all" ? true : filter === "waiting" ? WAITING.has(t.status) : String(t.tier) === filter));
  const current = data.find((t) => t.id === selected);

  return (
    <div className="stack">
      <div className="row between">
        <h2 title="Bậc 1: Operator tự trả lời · Bậc 2: chuyển agent đồng đội · Bậc 3: hỏi người">Câu hỏi của agent</h2>
        <Segmented<Filter>
          options={[
            { value: "all", label: "Tất cả" },
            { value: "waiting", label: "Đang chờ" },
            { value: "1", label: "Bậc 1" },
            { value: "2", label: "Bậc 2" },
            { value: "3", label: "Bậc 3" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <div className="split">
        <nav className="pick-list" aria-label="Câu hỏi">
          {rows.map((t) => (
            <button key={t.id} type="button" className={`thread-row${t.id === selected ? " active" : ""}`} onClick={() => setSelected(t.id)}>
              <span className="row" style={{ gap: 6 }}>
                <StatusBadge status={t.status} />
                <span className="spacer" />
                <span className="xs faint">{ago(t.created_at)}</span>
              </span>
              <span className="thread-title wrap-anywhere">{t.question}</span>
              <span className="xs muted">
                <b>{t.from_dev}</b> · bậc {t.tier} ({TIER[t.tier]})
              </span>
            </button>
          ))}
          {rows.length === 0 && <Empty>Chưa có câu hỏi nào khớp bộ lọc</Empty>}
        </nav>
        {current ? (
          <Detail key={current.id} t={current} onReplied={() => void reload()} />
        ) : (
          <Card>
            <EmptyState icon={MessageCircleQuestion} title="Chưa chọn câu hỏi">
              Chọn một câu hỏi bên trái để xem trả lời, nguồn và trả lời thay agent.
            </EmptyState>
          </Card>
        )}
      </div>
    </div>
  );
}
