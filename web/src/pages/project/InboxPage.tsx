// Cần xử lý: everything that waits for a person, in one list. Clashes (one per pair of people), questions only a
// person can answer, and work someone should look at. Acting on an item happens right here.

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  Check,
  ChevronDown,
  CircleHelp,
  Clock,
  Code2,
  FileText,
  GitMerge,
  History,
  OctagonAlert,
  Send,
  Sparkles,
  UserX,
  Zap,
} from "lucide-react";
import { api } from "../../api/endpoints";
import type { AttentionItem, Incident, TeamState, Ticket } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useProject } from "./ProjectLayout";
import { Av, Blank, Seg, usePc } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { Modal } from "../../components/ui";
import { incidentDone, incidentPlain, incidentTitle, isHot, LEVEL_VI } from "../../lib/incident";
import { KIND_VI, shortSubject } from "../../components/Message";
import { ago, clock } from "../../lib/format";
import { FixBox } from "./FixBox";

const today = () => new Date().toISOString().slice(0, 10);
const touches = (who: string | null, ...people: (string | null | undefined)[]) => !who || people.includes(who);

function taskOf(state: TeamState | undefined, ws: string): string | undefined {
  return state?.tasks.filter((t) => t.workspace_id === ws).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.title;
}

function IncidentDetail({ inc, state, onChanged }: { inc: Incident; state?: TeamState; onChanged: () => void }) {
  const { id, openFile } = useProject();
  const pc = usePc();
  const done = incidentDone(inc);
  const side = (dev: string, ws: string) => (
    <div className="sidecard" style={pc(dev)}>
      <Av who={dev} agent={state?.sessions.find((s) => s.workspace_id === ws)?.agent} />
      <b>{dev}</b>
      <small>{taskOf(state, ws) ?? "Chưa đăng ký việc"}</small>
    </div>
  );
  const log = [
    ...inc.evidence.map((e) => ({ at: e.updated_at, text: `gtv thấy: ${KIND_VI[e.kind] ?? e.kind} (${shortSubject(e.subject)})` })),
    ...(inc.guide ? [{ at: inc.guide.at, text: `${inc.guide.by} gửi hướng xử lý cho ${inc.guide.to.map((t) => t.dev).join(", ")}` }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <>
      <div className="eyebrow">
        <span className={`p-chip ${isHot(inc.level) ? "clash" : inc.level === "warning" ? "warn" : ""}`}>
          <Zap />
          Đụng nhau · {LEVEL_VI[inc.level]}
        </span>
        <span>{ago(inc.updated_at)}</span>
        {done && (
          <span className="p-chip ok">
            <Check />
            {done}
          </span>
        )}
      </div>
      <h2>{incidentTitle(inc)}</h2>
      <p>{incidentPlain(inc)}</p>
      <div className="vs">
        {side(inc.dev_a, inc.workspace_a)}
        <span className="p-mid">
          <Zap />
        </span>
        {inc.dev_b === "main" ? (
          <div className="sidecard">
            <b>nhánh chính</b>
            <small>bản mới nhất trên repo</small>
          </div>
        ) : (
          side(inc.dev_b, inc.workspace_b)
        )}
      </div>
      <div className="block">
        <span className="sect">Vì sao gtv báo</span>
        <ul className="evid">
          {inc.evidence.map((e) => (
            <li key={e.id} title={e.message}>
              <span className="ic">{e.layer === "L1" ? <GitMerge /> : e.layer === "L2" ? <Code2 /> : e.layer === "L3" ? <Sparkles /> : <FileText />}</span>
              <div>
                {KIND_VI[e.kind] ?? e.kind}
                <small>
                  {shortSubject(e.subject)} · {LEVEL_VI[e.level]}
                </small>
              </div>
              <span className="lay" title={`Lớp phát hiện ${e.layer}`}>
                {e.layer}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {inc.files.length > 0 && (
        <div className="block">
          <span className="sect">Ở đâu</span>
          <div className="scope">
            {inc.files.map((p) => (
              <button type="button" key={p} className="p-chip mono filechip" onClick={() => openFile(p)}>
                {p}
              </button>
            ))}
            <span className="faint" style={{ alignSelf: "center" }}>
              Bấm để xem code của hai bên
            </span>
          </div>
        </div>
      )}
      <div className="block">
        <FixBox projectId={id} inc={inc} onChanged={onChanged} />
      </div>
      <div className="block">
        <details>
          <summary>gtv đã làm gì ({log.length} bước)</summary>
          {log.map((l, i) => (
            <p key={i}>
              <span className="mono">{clock(l.at)}</span> {l.text}
            </p>
          ))}
        </details>
      </div>
    </>
  );
}

function QuestionDetail({ t, item, onChanged }: { t: Ticket; item?: AttentionItem; onChanged: () => void }) {
  const { id, manage, access } = useProject();
  const { me } = useAuth();
  const run = useAction();
  const pc = usePc();
  // Developers answer questions sent to them or to the whole team; everything else needs a manager.
  const canAnswer = manage || (access === "developer" && (!t.to_dev || t.to_dev === me?.name));
  const [pick, setPick] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [keep, setKeep] = useState(true);
  useEffect(() => {
    setPick(null);
    setText("");
  }, [t.id]);
  const open = t.status === "waiting_human" || t.status === "forwarded";
  const to = t.to_dev ?? "cả nhóm";
  const answer = text.trim() || (pick !== null ? (t.options?.[pick] ?? "") : "");
  return (
    <>
      <div className="eyebrow">
        <span className={`p-chip ${open ? "warn" : "ok"}`}>
          {open ? <CircleHelp /> : <Check />}
          {open ? "Câu hỏi" : "Đã trả lời"}
        </span>
        <Av who={t.from_dev} size="sm" />
        <span>
          agent của <b>{t.from_dev}</b> hỏi <b>{to}</b>
        </span>
        <span>{ago(t.created_at)}</span>
      </div>
      <h2>{t.forwarded_question && t.forwarded_question.length < t.question.length ? t.forwarded_question : t.question.split(/(?<=[.?!])\s/)[0]}</h2>
      <div className="quote" style={pc(t.from_dev)}>
        {t.question}
      </div>
      {t.context && (
        <details style={{ marginTop: 10 }}>
          <summary>Ngữ cảnh agent gửi kèm</summary>
          <p>{t.context}</p>
        </details>
      )}
      <dl className="p-kv" style={{ marginTop: 16 }}>
        {item?.board && (
          <>
            <dt>Trong việc</dt>
            <dd>
              <Link to={`/p/${id}/work?task=${item.board.id}`}>{item.board.title}</Link>
            </dd>
          </>
        )}
        <dt>Vì sao tới người</dt>
        <dd>
          {t.status === "forwarded"
            ? `Đã chuyển cho agent của ${to}, chưa có trả lời sau 15 phút.`
            : `AI và agent của ${to === "cả nhóm" ? "đồng đội" : to} không đủ căn cứ để tự trả lời.`}
        </dd>
      </dl>
      {t.answer && !open ? (
        <div className="block">
          <span className="sect">Trả lời{t.answered_by ? ` · ${t.answered_by}` : ""}</span>
          <p className="pre">{t.answer}</p>
        </div>
      ) : canAnswer ? (
        <form
          className="block"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() => api.tickets.reply(id, t.id, answer), `Đã gửi trả lời cho agent của ${t.from_dev}`);
            if (!ok) return;
            if (keep && manage) {
              // The answer becomes a Q&A document waiting for confirmation: confirm it now.
              const docs = await api.kb.list(id).catch(() => []);
              const doc = docs.find((d) => d.ticket_id === t.id && d.status === "unverified");
              if (doc) await api.kb.review(id, doc.id, "confirm").catch(() => undefined);
            }
            onChanged();
          }}
        >
          <span className="sect">Trả lời</span>
          {t.options && t.options.length > 0 && (
            <div className="opts">
              {t.options.map((o, n) => (
                <button
                  type="button"
                  key={n}
                  className={`opt${pick === n ? " on" : ""}`}
                  aria-pressed={pick === n}
                  onClick={() => setPick(pick === n ? null : n)}
                >
                  <span className="k">{String.fromCharCode(65 + n)}</span>
                  {o}
                </button>
              ))}
            </div>
          )}
          <textarea
            className="p-textarea"
            style={{ marginTop: 8 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.options?.length ? "Hoặc viết câu trả lời khác" : "Viết câu trả lời cho agent"}
            aria-label="Câu trả lời"
          />
          {manage && (
            <label className="check">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Lưu vào Tri thức, lần sau AI tự trả lời câu tương tự
            </label>
          )}
          <div className="acts">
            <button type="submit" className="p-btn primary" disabled={!answer}>
              <Send />
              Gửi trả lời cho agent của {t.from_dev}
            </button>
            {t.to_dev && manage && (
              <button
                type="button"
                className="p-btn"
                onClick={() =>
                  void run(
                    () => api.projects.message(id, t.to_dev!, `Agent của ${t.from_dev} đang chờ bạn trả lời: ${t.question.slice(0, 300)}`, t.id),
                    `Đã nhắc ${t.to_dev}`,
                  )
                }
              >
                Nhắc {t.to_dev}
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="p-hint block">{access === "developer" ? `Câu này gửi cho ${to}: cần quyền quản lý để trả lời thay.` : "Cần quyền quản lý để trả lời."}</p>
      )}
    </>
  );
}

function OtherDetail({ a, onChanged }: { a: AttentionItem; onChanged: () => void }) {
  const { id, detail } = useProject();
  const { manage } = useProject();
  const run = useAction();
  const board = usePoll(() => api.board.get(id, a.ref), [id, a.ref], 10_000);
  const t = board.data;
  if (!t) return <Loading />;
  const label = { unassigned: "Chưa ai nhận", stale: "Việc im lặng", overdue: "Quá hạn", blocked: "Bị chặn" }[a.kind as string] ?? a.kind;
  const icon = a.kind === "unassigned" ? <UserX /> : a.kind === "overdue" ? <CalendarClock /> : a.kind === "blocked" ? <OctagonAlert /> : <Clock />;
  return (
    <>
      <div className="eyebrow">
        <span className={`p-chip ${a.level === "high" ? "clash" : "warn"}`}>
          {icon}
          {label}
        </span>
      </div>
      <h2>{t.title}</h2>
      {t.description && <p>{t.description}</p>}
      <dl className="p-kv" style={{ marginTop: 16 }}>
        <dt>Ưu tiên</dt>
        <dd>{{ urgent: "Khẩn", high: "Cao", normal: "Thường", low: "Thấp" }[t.priority]}</dd>
        <dt>Hạn</dt>
        <dd>{t.due_date ?? "chưa đặt"}</dd>
        <dt>Người làm</dt>
        <dd>{t.assignee ?? "chưa giao"}</dd>
        <dt>Tình trạng</dt>
        <dd>{a.detail}</dd>
      </dl>
      <div className="acts">
        {manage &&
          a.kind === "unassigned" &&
          detail.members.map((m) => (
            <button
              type="button"
              key={m.dev}
              className="p-btn"
              onClick={async () => {
                if (await run(() => api.board.update(id, t.id, { assignee: m.dev }), `Đã giao cho ${m.dev}. Agent của ${m.dev} sẽ thấy việc này`)) onChanged();
              }}
            >
              <Av who={m.dev} size="sm" />
              Giao cho {m.dev}
            </button>
          ))}
        {manage && a.kind === "stale" && (
          <>
            {t.assignee && (
              <button
                type="button"
                className="p-btn primary"
                onClick={() =>
                  void run(() => api.projects.message(id, t.assignee!, `Việc "${t.title}" đang dừng. Còn làm tiếp không?`, t.id), `Đã nhắc ${t.assignee}`)
                }
              >
                Nhắc {t.assignee}
              </button>
            )}
            <button
              type="button"
              className="p-btn"
              onClick={async () => {
                if (await run(() => api.board.update(id, t.id, { status: "todo" }), "Đã trả việc về Cần làm")) onChanged();
              }}
            >
              Trả về Cần làm
            </button>
          </>
        )}
        <Link className="p-btn quiet" to={`/p/${id}/work?task=${t.id}`}>
          Mở việc
        </Link>
      </div>
    </>
  );
}

interface Row {
  key: string;
  icon: JSX.Element;
  ic: string;
  title: string;
  sub: JSX.Element | string;
  when?: string;
}

export function InboxPage() {
  const { id, detail, reload } = useProject();
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [history, setHistory] = useState(false);
  const [lowOpen, setLowOpen] = useState(false);
  const incs = usePoll(() => api.incidents.list(id, history), [id, history], 5000);
  const att = usePoll(() => api.projects.attention(id), [id], 5000);
  const tickets = usePoll(() => api.tickets.list(id), [id], 5000);
  const state = usePoll(() => api.projects.state(id), [id], 10_000);
  const isMember = me && detail.members.some((m) => m.dev === me.name);
  const who = params.has("who") ? params.get("who") || null : isMember ? me!.name : null;
  const sel = params.get("i");
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: k === "who" });
  };
  const refresh = () => {
    void incs.reload();
    void att.reload();
    void tickets.reload();
    void reload();
  };

  const groups = useMemo(() => {
    const all = incs.data ?? [];
    const open = all.filter((i) => i.status === "open" && touches(who, i.dev_a, i.dev_b));
    const hot = open.filter((i) => isHot(i.level));
    const low = open.filter((i) => !isHot(i.level));
    const items = att.data ?? [];
    const questions = items.filter((a) => a.kind === "question" && touches(who, a.ticket?.from_dev, a.ticket?.to_dev, a.ticket?.to_dev ? undefined : who));
    const others = items.filter((a) => !["conflict", "question"].includes(a.kind));
    const othersMine = others.filter((a) => !who || a.detail.includes(who) || a.kind === "unassigned");
    const day = today();
    const handled = [...all.filter((i) => i.status !== "open" && i.updated_at.startsWith(day) && touches(who, i.dev_a, i.dev_b))];
    const answered = (tickets.data ?? []).filter(
      (t) => t.status === "answered" && t.updated_at.startsWith(day) && t.answered_by?.endsWith("(human)") && touches(who, t.from_dev, t.to_dev),
    );
    const closed = history ? all.filter((i) => i.status === "closed" && !i.updated_at.startsWith(day) && touches(who, i.dev_a, i.dev_b)) : [];
    return { hot, low, questions, others: othersMine, handled, answered, closed };
  }, [incs.data, att.data, tickets.data, who, history]);

  const people = [...new Set([...detail.members.map((m) => m.dev)])];
  const total = groups.hot.length + groups.questions.length + groups.others.length;
  const current = sel;

  const incRow = (i: Incident): Row => ({
    key: i.id,
    icon: i.status === "open" ? <Zap /> : <Check />,
    ic: i.status === "open" ? "" : "done",
    title: incidentTitle(i),
    sub: (
      <>
        <Av who={i.dev_a} size="sm" />
        <Av who={i.dev_b} size="sm" />
        {i.dev_a} và {i.dev_b}
        {i.status !== "open" ? ` · ${incidentDone(i)}` : ""}
      </>
    ),
    when: ago(i.updated_at),
  });
  const row = (r: Row) => (
    <button type="button" key={r.key} className={`p-row${current === r.key ? " sel" : ""}`} onClick={() => set("i", r.key)}>
      <span className={`ic ${r.ic}`}>{r.icon}</span>
      <span className="t">{r.title}</span>
      <span className="when">{r.when}</span>
      <span className="s">{r.sub}</span>
    </button>
  );

  const loading = !incs.data || !att.data || !tickets.data;
  const curInc = incs.data?.find((i) => i.id === current);
  const curTicket = tickets.data?.find((t) => t.id === current);
  const curItem = att.data?.find((a) => a.ref === current);

  return (
    <div className="page-col narrow">
      <div className="head">
        <div>
          <h1>Cần xử lý</h1>
          <p className="lead">Mọi thứ đang chờ một người quyết, gom về một chỗ. Xử lý xong thì mục đó rời khỏi danh sách.</p>
        </div>
        <div className="tools">
          <span className="faint">Liên quan tới</span>
          <Seg
            label="Lọc theo người"
            value={who ?? ""}
            onChange={(v) => set("who", v)}
            options={[["", "Mọi người"], ...people.map((p) => [p, p] as [string, string])]}
          />
        </div>
      </div>
      <div>
        <section className="panel list">
          {loading ? (
            <Loading />
          ) : (
            <>
              {groups.hot.length > 0 && (
                <>
                  <div className="gh">
                    Đụng nhau <span className="n">{groups.hot.length}</span>
                  </div>
                  {groups.hot.map((i) => row(incRow(i)))}
                </>
              )}
              {groups.questions.length > 0 && (
                <>
                  <div className="gh">
                    Câu hỏi chờ người quyết <span className="n">{groups.questions.length}</span>
                  </div>
                  {groups.questions.map((a) => {
                    const t = tickets.data?.find((x) => x.id === a.ref);
                    return row({
                      key: a.ref,
                      icon: <CircleHelp />,
                      ic: "q",
                      title: a.detail.length > 140 ? `${a.detail.slice(0, 139)}…` : a.detail,
                      sub: (
                        <>
                          <Av who={a.ticket?.from_dev ?? "?"} size="sm" />
                          agent của {a.ticket?.from_dev} hỏi {a.ticket?.to_dev ?? "cả nhóm"}
                          {a.level === "warning" ? " · chưa ai trả lời" : ""}
                        </>
                      ),
                      when: ago(t?.created_at ?? a.at),
                    });
                  })}
                </>
              )}
              {groups.others.length > 0 && (
                <>
                  <div className="gh">
                    Việc cần để ý <span className="n">{groups.others.length}</span>
                  </div>
                  {groups.others.map((a) =>
                    row({
                      key: a.ref,
                      icon:
                        a.kind === "unassigned" ? <UserX /> : a.kind === "overdue" ? <CalendarClock /> : a.kind === "blocked" ? <OctagonAlert /> : <Clock />,
                      ic: "t",
                      title: a.title.replace(/^(Chưa ai nhận|Quá hạn|Việc bị chặn|Im lặng): /, ""),
                      sub: `${{ unassigned: "Chưa ai nhận", overdue: "Quá hạn", blocked: "Bị chặn", stale: "Im lặng" }[a.kind as string] ?? ""} · ${a.detail}`,
                    }),
                  )}
                </>
              )}
              {total === 0 && (
                <Blank icon={<Check />} title={`Không còn gì chờ ${who ?? "nhóm"}`}>
                  Mọi vụ đụng nhau và câu hỏi đã có người xử lý.
                </Blank>
              )}
              {groups.low.length > 0 && (
                <>
                  <button type="button" className="gh ghbtn" onClick={() => setLowOpen(!lowOpen)} aria-expanded={lowOpen}>
                    <ChevronDown style={{ transform: lowOpen ? "none" : "rotate(-90deg)" }} />
                    Mức thấp, chưa cần chặn ai <span className="n">{groups.low.length}</span>
                  </button>
                  {lowOpen && groups.low.map((i) => row(incRow(i)))}
                </>
              )}
              {groups.handled.length + groups.answered.length > 0 && (
                <>
                  <div className="gh">
                    Đã xử lý hôm nay <span className="n">{groups.handled.length + groups.answered.length}</span>
                  </div>
                  {groups.handled.map((i) => row(incRow(i)))}
                  {groups.answered.map((t) =>
                    row({
                      key: t.id,
                      icon: <Check />,
                      ic: "done",
                      title: t.question.length > 120 ? `${t.question.slice(0, 119)}…` : t.question,
                      sub: `đã trả lời agent của ${t.from_dev}`,
                    }),
                  )}
                </>
              )}
              {history && groups.closed.length > 0 && (
                <>
                  <div className="gh">
                    Đã đóng trước đây <span className="n">{groups.closed.length}</span>
                  </div>
                  {groups.closed.map((i) => row(incRow(i)))}
                </>
              )}
              {!history && (
                <button type="button" className="p-btn quiet sm" style={{ margin: "8px 10px 6px" }} onClick={() => setHistory(true)}>
                  <History />
                  Xem lịch sử đã đóng
                </button>
              )}
            </>
          )}
        </section>
      </div>
      {current && !loading && (
        <Modal wide title={curInc ? "Vụ đụng nhau" : curTicket ? "Câu hỏi của agent" : curItem ? "Việc cần để ý" : "Cần xử lý"} onClose={() => set("i", null)}>
          <div className="detail">
            {curInc ? (
              <IncidentDetail inc={curInc} state={state.data} onChanged={refresh} />
            ) : curTicket ? (
              <QuestionDetail t={curTicket} item={curItem} onChanged={refresh} />
            ) : curItem ? (
              <OtherDetail a={curItem} onChanged={refresh} />
            ) : (
              <Blank title="Mục này không còn trong danh sách">Có thể nó đã được xử lý.</Blank>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
