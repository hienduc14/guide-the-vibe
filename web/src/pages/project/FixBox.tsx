// "Hướng xử lý": how a lead settles an incident. The brain drafts a few plans; the lead picks one, edits the
// words, chooses who receives it and sends it; or marks the incident handled without sending; or closes it.

import { useEffect, useState } from "react";
import { Check, RotateCcw, Send, Sparkles } from "lucide-react";
import { api } from "../../api/endpoints";
import type { Incident, Plan } from "../../api/types";
import { useAction } from "../../hooks/useToast";
import { useOverview } from "../../hooks/useOverview";
import { Av, usePc } from "../../components/pj";
import { clock } from "../../lib/format";
import { useProject } from "./ProjectLayout";

interface Draft {
  plan: number;
  text: string;
  edited: boolean;
  to: Record<string, boolean>;
}
/** Drafts outlive the component: the same incident is open in the inbox and in the file sheet, and data refreshes every few seconds. */
const drafts = new Map<string, Draft>();

function usePlans(projectId: string, inc: Incident): { plans: Plan[]; waiting: boolean } {
  const brainOff = useOverview().data?.brain.backend === "null";
  const [plans, setPlans] = useState<Plan[]>([]);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    if (inc.status !== "open") return;
    if (brainOff) return setWaiting(false);
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      const r = await api.incidents.plans(projectId, inc.id).catch(() => ({ plans: [] as Plan[] }));
      if (stop) return;
      if (r.plans.length) {
        setPlans(r.plans);
        setWaiting(false);
      } else if (Date.now() - started < 30_000) setTimeout(() => void tick(), 3000);
      else setWaiting(false);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [projectId, inc.id, inc.status, brainOff]);
  return { plans, waiting };
}

export function FixBar({ projectId, inc, onOpen }: { projectId: string; inc: Incident; onOpen: () => void }) {
  const { plans } = usePlans(projectId, inc);
  const text = drafts.get(inc.id)?.text || plans[0]?.text || "Chọn cách xử lý vụ đụng nhau này.";
  return (
    <div className="fixbar">
      <b>
        <Sparkles />
        Hướng xử lý
      </b>
      <span className="muted">{text}</span>
      <button type="button" className="p-btn primary" onClick={onOpen}>
        Xử lý vụ này
      </button>
    </div>
  );
}

export function FixBox({ projectId, inc, onChanged, onCollapse }: { projectId: string; inc: Incident; onChanged: () => void; onCollapse?: () => void }) {
  const { manage } = useProject();
  const run = useAction();
  const pc = usePc();
  const { plans, waiting } = usePlans(projectId, inc);
  const [d, setD] = useState<Draft>(() => drafts.get(inc.id) ?? { plan: 0, text: "", edited: false, to: { [inc.dev_a]: true, [inc.dev_b]: true } });
  const [busy, setBusy] = useState(false);
  const save = (next: Draft) => {
    drafts.set(inc.id, next);
    setD(next);
  };
  useEffect(() => {
    setD(drafts.get(inc.id) ?? { plan: 0, text: "", edited: false, to: { [inc.dev_a]: true, [inc.dev_b]: true } });
  }, [inc.id, inc.dev_a, inc.dev_b]);
  // The first plan fills the box once it arrives, unless the lead already typed something.
  useEffect(() => {
    if (plans.length && !d.edited && !d.text) save({ ...d, text: plans[Math.min(d.plan, plans.length - 1)].text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans]);

  if (inc.status !== "open") {
    const g = inc.guide;
    return (
      <section className="outcome">
        <b>
          <Check />
          {g
            ? `Đã gửi hướng xử lý lúc ${clock(g.at)}`
            : inc.status === "acked"
              ? "Hai bên tự phối hợp"
              : inc.closed_reason === "dismissed"
                ? "Đã đóng, coi là báo nhầm"
                : "Đã hết đụng nhau"}
        </b>
        {g ? (
          <>
            <p className="quote">{g.body}</p>
            <p className="muted">
              {g.to.map((t) => (
                <span key={t.dev} className="rcv">
                  <Av who={t.dev} size="sm" /> {t.dev}: {t.delivered_at ? `đã đọc lúc ${clock(t.delivered_at)}` : "chưa đọc, agent sẽ thấy ở lượt kế tiếp"}
                </span>
              ))}
            </p>
          </>
        ) : (
          <p className="muted">
            {inc.status === "acked"
              ? "gtv thôi nhắc và thôi chặn hai agent ở chỗ này. Nếu vụ nặng lên, gtv mở lại."
              : inc.closed_reason === "dismissed"
                ? "gtv không báo lại, trừ khi code ở chỗ này đổi khác."
                : "Một trong hai bên đã đổi hướng hoặc code đã vào nhánh chính."}
          </p>
        )}
        {manage && inc.closed_reason !== "resolved" && (
          <div className="acts" style={{ marginTop: 4 }}>
            <button
              type="button"
              className="p-btn sm"
              onClick={async () => {
                if (await run(() => api.incidents.act(projectId, inc.id, "reopen"), "Đã mở lại")) onChanged();
              }}
            >
              <RotateCcw />
              Mở lại vụ này
            </button>
          </div>
        )}
      </section>
    );
  }

  const to = [inc.dev_a, inc.dev_b].filter((w) => d.to[w]);
  return (
    <section className="fix">
      <div className="fix-draft">
        <div className="fix-h">
          <b>
            <Sparkles />
            Hướng xử lý
          </b>
          <span className="faint">
            {plans.length ? "AI soạn sẵn. Chọn phương án, sửa lời, rồi gửi." : waiting ? "AI đang soạn phương án…" : "Viết điều bạn muốn hai agent làm."}
          </span>
          {onCollapse && (
            <button type="button" className="p-btn quiet sm" style={{ marginLeft: "auto" }} onClick={onCollapse}>
              Thu gọn
            </button>
          )}
        </div>
        {plans.length > 0 && (
          <div className="plans" role="group" aria-label="Phương án">
            {plans.map((p, n) => (
              <button
                type="button"
                key={n}
                className={`plan${d.plan === n ? " on" : ""}`}
                aria-pressed={d.plan === n}
                onClick={() => save({ ...d, plan: n, text: p.text, edited: false })}
              >
                {p.title}
              </button>
            ))}
          </div>
        )}
        <textarea
          className="p-textarea"
          aria-label="Nội dung gửi cho agent"
          value={d.text}
          readOnly={!manage}
          placeholder={`Ví dụ: ${inc.dev_a} làm trước, ${inc.dev_b} đợi bản đó rồi mới sửa tiếp.`}
          onChange={(e) => save({ ...d, text: e.target.value, edited: true })}
        />
        {manage && (
          <div className="fix-tools">
            {plans.length > 0 && (
              <button
                type="button"
                className="p-btn sm"
                disabled={busy || !d.text.trim()}
                title="AI viết lại cùng phương án bằng lời khác"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.incidents.rewrite(projectId, inc.id, d.text);
                    if (r.text) save({ ...d, text: r.text, edited: true });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RotateCcw />
                {busy ? "Đang viết lại…" : "Viết lại cách khác"}
              </button>
            )}
            <span className="faint" style={{ marginLeft: "auto" }}>
              Gửi tới
            </span>
            {[inc.dev_a, inc.dev_b].map((w) => (
              <button
                type="button"
                key={w}
                className={`rcpt${d.to[w] ? " on" : ""}`}
                style={pc(w)}
                aria-pressed={!!d.to[w]}
                onClick={() => save({ ...d, to: { ...d.to, [w]: !d.to[w] } })}
              >
                <Av who={w} size="sm" />
                {w}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="fix-do">
        {manage ? (
          <>
            <button
              type="button"
              className="p-btn primary"
              disabled={!to.length || !d.text.trim()}
              onClick={async () => {
                const ok = await run(() => api.incidents.guide(projectId, inc.id, d.text.trim(), to), `Đã gửi cho agent của ${to.join(" và ")}`);
                if (ok) {
                  drafts.delete(inc.id);
                  onChanged();
                }
              }}
            >
              <Send />
              {to.length === 2 ? "Gửi cho hai agent" : to.length ? `Gửi cho agent của ${to[0]}` : "Chọn người nhận"}
            </button>
            <p className="p-hint">Agent đọc ở lượt kế tiếp và làm theo. Vụ này rời danh sách chờ, gtv thôi chặn hai agent.</p>
            <div className="or">Hoặc không gửi gì</div>
            <button
              type="button"
              className="alt"
              onClick={async () => {
                if (await run(() => api.incidents.act(projectId, inc.id, "ack"), "Đã ghi nhận. gtv thôi nhắc hai agent ở chỗ này")) onChanged();
              }}
            >
              <b>Để hai bên tự phối hợp</b>
              <small>Đánh dấu đã biết. gtv thôi nhắc và thôi chặn; vụ nặng lên thì báo lại.</small>
            </button>
            <button
              type="button"
              className="alt"
              onClick={async () => {
                if (await run(() => api.incidents.act(projectId, inc.id, "dismiss"), "Đã đóng vụ này")) onChanged();
              }}
            >
              <b>Báo nhầm, đóng lại</b>
              <small>gtv không báo lại, trừ khi code ở chỗ này đổi khác.</small>
            </button>
          </>
        ) : (
          <p className="p-hint">Cần quyền quản lý để xử lý vụ này.</p>
        )}
      </div>
    </section>
  );
}
