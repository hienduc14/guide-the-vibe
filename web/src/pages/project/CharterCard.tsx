import { useState, type FormEvent } from "react";
import { api } from "../../api/endpoints";
import type { Charter } from "../../api/types";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useProject } from "./ProjectLayout";
import { Field } from "../../components/Field";
import { Badge } from "../../components/Badge";

const QUALITY: Record<NonNullable<Charter["quality"]>, string> = { prototype: "Prototype", mvp: "MVP", production: "Production" };

/** Days until a YYYY-MM-DD date (negative when past). */
export function daysUntil(date: string): number {
  return Math.ceil((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86_400_000);
}

type TextKey = "goal" | "users" | "milestones" | "constraints" | "non_goals" | "notes";

function Editor({ charter, onDone }: { charter: Charter; onDone: () => void }) {
  const { id, reload } = useProject();
  const run = useAction();
  const [f, setF] = useState({ ...charter, stack: (charter.stack ?? []).join(", ") });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const stack = f.stack
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ok = await run(() => api.projects.update(id, { charter: { ...f, stack } }), "Đã lưu tiêu chí — agent thấy ở phiên kế tiếp");
    if (ok) {
      void reload();
      onDone();
    }
  };
  const text = (k: TextKey, label: string, placeholder: string, area = false) => (
    <Field label={label}>
      {area ? (
        <textarea className="textarea" rows={2} value={f[k] ?? ""} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      ) : (
        <input className="input" value={f[k] ?? ""} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      )}
    </Field>
  );
  return (
    <form className="stack" onSubmit={(e) => void save(e)}>
      {text("goal", "Mục tiêu", "Ra MVP đặt món cho 3 quán ăn thử nghiệm")}
      <div className="form-grid">
        {text("users", "Người dùng", "100 người dùng thử, chủ yếu trên điện thoại")}
        <Field label="Hạn chót">
          <input className="input" type="date" value={f.deadline ?? ""} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
        </Field>
        <Field label="Mức chất lượng">
          <select className="input" value={f.quality ?? ""} onChange={(e) => setF({ ...f, quality: (e.target.value || undefined) as Charter["quality"] })}>
            <option value="">—</option>
            <option value="prototype">Prototype: nhanh, bỏ đi được</option>
            <option value="mvp">MVP: chạy ổn, đơn giản</option>
            <option value="production">Production: test, bảo mật, dễ bảo trì</option>
          </select>
        </Field>
        <Field label="Công nghệ" hint="cách nhau bằng dấu phẩy; agent hỏi trước khi thêm cái mới">
          <input className="input" value={f.stack} placeholder="Next.js, Node 24, PostgreSQL" onChange={(e) => setF({ ...f, stack: e.target.value })} />
        </Field>
      </div>
      {text("milestones", "Mốc", "Tuần 4: đặt món chạy; tuần 8: thanh toán")}
      <div className="form-grid">
        {text("constraints", "Ràng buộc", "Chỉ dùng dịch vụ miễn phí; dữ liệu ở Việt Nam", true)}
        {text("non_goals", "Ngoài phạm vi", "Ứng dụng di động native, đa ngôn ngữ", true)}
      </div>
      {text("notes", "Ghi chú khác", "", true)}
      <div className="row">
        <button className="btn primary" type="submit">
          Lưu
        </button>
        <button className="btn ghost" type="button" onClick={onDone}>
          Huỷ
        </button>
      </div>
    </form>
  );
}

const MORE: [TextKey, string][] = [
  ["milestones", "Mốc"],
  ["constraints", "Ràng buộc"],
  ["non_goals", "Ngoài phạm vi"],
  ["notes", "Ghi chú"],
];

/** What the project is for, shown first to anyone who opens it; agents read the same text. */
export function CharterCard() {
  const { detail } = useProject();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const c = detail.record.charter ?? {};
  const empty = !Object.keys(c).length;
  const left = c.deadline ? daysUntil(c.deadline) : undefined;

  return (
    <section className="charter">
      <div className="row between">
        <span className="label-caps">Tiêu chí project</span>
        {can("manager") && !editing && (
          <button className="btn sm ghost" type="button" onClick={() => setEditing(true)}>
            {empty ? "Đặt tiêu chí" : "Sửa"}
          </button>
        )}
      </div>
      {editing ? (
        <Editor charter={c} onDone={() => setEditing(false)} />
      ) : empty ? (
        <p className="small muted">
          Chưa có. Mục tiêu, người dùng, hạn chót và công nghệ giúp agent chọn giải pháp vừa sức (ví dụ MVP 2 tháng thì không dựng microservice).
        </p>
      ) : (
        <>
          {c.goal && <p className="charter-goal">{c.goal}</p>}
          <div className="charter-facts">
            {c.quality && <Badge tone="accent">{QUALITY[c.quality]}</Badge>}
            {c.deadline && (
              <span className={left !== undefined && left < 0 ? "danger-text" : ""}>
                Hạn <b>{new Date(c.deadline).toLocaleDateString("vi-VN")}</b>
                {left !== undefined && (left >= 0 ? ` · còn ${left} ngày` : ` · trễ ${-left} ngày`)}
              </span>
            )}
            {c.users && <span>{c.users}</span>}
          </div>
          {c.stack && c.stack.length > 0 && (
            <div className="row" style={{ gap: 4 }}>
              {c.stack.map((s) => (
                <span key={s} className="res">
                  {s}
                </span>
              ))}
            </div>
          )}
          {MORE.some(([k]) => c[k]) && (
            <dl className="charter-more">
              {MORE.filter(([k]) => c[k]).map(([k, label]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{label}</dt>
                  <dd>{c[k]}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  );
}
