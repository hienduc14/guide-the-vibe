// Tri thức: what the AI and the agents rely on in this project. The charter, documents, and answers waiting
// for a person to confirm them.

import { useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { BookOpen, Check, CircleHelp, Pencil, Target } from "lucide-react";
import { api } from "../../api/endpoints";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { Blank } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { QUALITY, daysUntil } from "../../lib/charter";
import type { Charter } from "../../api/types";
import { DocsSection } from "./Docs";
import { ago } from "../../lib/format";

type TextKey = "goal" | "users" | "milestones" | "constraints" | "non_goals" | "notes";

function CharterEditor({ charter, onDone }: { charter: Charter; onDone: () => void }) {
  const { id, reload } = useProject();
  const run = useAction();
  const [f, setF] = useState({ ...charter, stack: (charter.stack ?? []).join(", ") });
  const text = (k: TextKey, label: string, placeholder: string, area = false) => (
    <label className={area ? "wide" : ""}>
      {label}
      {area ? (
        <textarea className="p-textarea" rows={2} value={f[k] ?? ""} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      ) : (
        <input className="p-input" value={f[k] ?? ""} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      )}
    </label>
  );
  return (
    <>
      <h2>Sửa tiêu chí project</h2>
      <p className="lede">Agent thấy bản mới ở phiên kế tiếp.</p>
      <form
        className="formgrid"
        onSubmit={async (e) => {
          e.preventDefault();
          const stack = f.stack
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (await run(() => api.projects.update(id, { charter: { ...f, stack } }), "Đã lưu tiêu chí")) {
            void reload();
            onDone();
          }
        }}
      >
        <label className="wide">
          Mục tiêu
          <textarea
            className="p-textarea"
            rows={2}
            value={f.goal ?? ""}
            placeholder="Ra MVP đặt món cho 3 quán ăn thử nghiệm"
            onChange={(e) => setF({ ...f, goal: e.target.value })}
          />
        </label>
        {text("users", "Người dùng", "100 người dùng thử, chủ yếu trên điện thoại")}
        <label>
          Hạn
          <input className="p-input" type="date" value={f.deadline ?? ""} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
        </label>
        <label>
          Mức hoàn thiện
          <select className="p-input" value={f.quality ?? ""} onChange={(e) => setF({ ...f, quality: (e.target.value || undefined) as Charter["quality"] })}>
            <option value="">Chưa chọn</option>
            <option value="prototype">Prototype: nhanh, bỏ đi được</option>
            <option value="mvp">MVP: chạy ổn, đơn giản</option>
            <option value="production">Production: có test, bảo mật, dễ bảo trì</option>
          </select>
        </label>
        <label>
          Ngôn ngữ agent viết
          <select className="p-input" value={f.language ?? "vi"} onChange={(e) => setF({ ...f, language: e.target.value as Charter["language"] })}>
            <option value="vi">Tiếng Việt</option>
            <option value="en">Tiếng Anh</option>
          </select>
        </label>
        <label className="wide">
          Công nghệ
          <input className="p-input" value={f.stack} placeholder="Next.js, Node 24, PostgreSQL" onChange={(e) => setF({ ...f, stack: e.target.value })} />
          <small>Cách nhau bằng dấu phẩy. Agent hỏi trước khi thêm công nghệ mới.</small>
        </label>
        {text("milestones", "Mốc", "Tuần 4: đặt món chạy; tuần 8: thanh toán", true)}
        {text("constraints", "Ràng buộc", "Chỉ dùng dịch vụ miễn phí; dữ liệu ở Việt Nam", true)}
        {text("non_goals", "Không làm", "Ứng dụng di động native, đa ngôn ngữ", true)}
        {text("notes", "Ghi chú khác", "", true)}
        <div className="acts wide">
          <button type="submit" className="p-btn primary">
            Lưu tiêu chí
          </button>
          <button type="button" className="p-btn quiet" onClick={onDone}>
            Huỷ
          </button>
        </div>
      </form>
    </>
  );
}

function CharterView() {
  const { detail } = useProject();
  const { manage } = useProject();
  const [edit, setEdit] = useState(false);
  const c = detail.charter;
  if (edit) return <CharterEditor charter={c} onDone={() => setEdit(false)} />;
  const left = c.deadline ? daysUntil(c.deadline) : undefined;
  const field = (label: string, v: string | undefined, wide = true) =>
    v ? (
      <div className={`f${wide ? " wide" : ""}`}>
        <span className="sect">{label}</span>
        <p className="pre">{v}</p>
      </div>
    ) : null;
  const empty = !c.goal && !c.users && !c.deadline && !c.stack?.length && !c.constraints;
  return (
    <>
      <h2>Tiêu chí project</h2>
      <p className="lede">Agent đọc phần này mỗi lần bắt đầu một việc, nên viết ngắn và cụ thể.</p>
      {empty ? (
        <Blank title="Chưa có tiêu chí">Mục tiêu, hạn, công nghệ và ràng buộc giúp agent làm đúng hướng ngay từ đầu.</Blank>
      ) : (
        <div className="p-charter">
          {field("Mục tiêu", c.goal)}
          {field("Người dùng", c.users, false)}
          {c.deadline && (
            <div className="f">
              <span className="sect">Hạn</span>
              <p>
                {c.deadline.split("-").reverse().join("/")}
                {left !== undefined && ` · ${left >= 0 ? `còn ${left} ngày` : `trễ ${-left} ngày`}`}
              </p>
            </div>
          )}
          {c.quality && (
            <div className="f">
              <span className="sect">Mức hoàn thiện</span>
              <p>{QUALITY[c.quality]}</p>
            </div>
          )}
          <div className="f">
            <span className="sect">Ngôn ngữ của nhóm</span>
            <p>{c.language === "en" ? "Tiếng Anh" : "Tiếng Việt"}</p>
          </div>
          {c.stack && c.stack.length > 0 && (
            <div className="f wide">
              <span className="sect">Công nghệ</span>
              <div className="scope">
                {c.stack.map((s) => (
                  <span key={s} className="p-chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {field("Mốc", c.milestones)}
          {field("Ràng buộc", c.constraints)}
          {field("Không làm", c.non_goals)}
          {field("Ghi chú", c.notes)}
        </div>
      )}
      {manage && (
        <div className="acts">
          <button type="button" className="p-btn" onClick={() => setEdit(true)}>
            <Pencil />
            {empty ? "Đặt tiêu chí" : "Sửa tiêu chí"}
          </button>
        </div>
      )}
    </>
  );
}

function Review() {
  const { id, reload } = useProject();
  const { manage } = useProject();
  const run = useAction();
  const list = usePoll(() => api.kb.list(id), [id], 10_000);
  if (!list.data) return <Loading />;
  const rows = list.data.filter((d) => d.status === "unverified");
  const act = async (docId: string, action: "confirm" | "reject") => {
    if (await run(() => api.kb.review(id, docId, action), action === "confirm" ? "Đã lưu vào Tri thức" : "Đã bỏ")) {
      void list.reload();
      void reload();
    }
  };
  return (
    <>
      <h2>Chờ xác nhận</h2>
      <p className="lede">Câu trả lời của AI và của agent đồng đội nằm ở đây cho tới khi có người xác nhận. Sau đó AI dùng chúng để trả lời lần sau.</p>
      <div className="doclist">
        {rows.length === 0 ? (
          <Blank icon={<Check />} title="Không còn câu nào chờ xác nhận" />
        ) : (
          rows.map((d) => (
            <div key={d.id} className="docrow">
              <span className="ic">
                <CircleHelp />
              </span>
              <b>{d.title}</b>
              <small>{d.source === "ticket" ? `Hỏi đáp · ${ago(d.created_at)}` : `${d.source} · ${ago(d.created_at)}`}</small>
              {manage && (
                <span className="r">
                  <button type="button" className="p-btn sm primary" onClick={() => void act(d.id, "confirm")}>
                    <Check />
                    Đúng, lưu lại
                  </button>
                  <button type="button" className="p-btn sm" onClick={() => void act(d.id, "reject")}>
                    Sai, bỏ
                  </button>
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

export function KnowledgePage() {
  const { id, detail } = useProject();
  const { section = "charter" } = useParams();
  const nav: [string, string, JSX.Element, number | null][] = [
    ["charter", "Tiêu chí project", <Target key="t" />, null],
    ["docs", "Tài liệu", <BookOpen key="b" />, null],
    ["review", "Chờ xác nhận", <CircleHelp key="q" />, detail.counts.kb_unverified],
  ];
  return (
    <>
      <div className="head">
        <div>
          <h1>Tri thức</h1>
          <p className="lead">Những gì AI và các agent dựa vào khi làm việc trong project này.</p>
        </div>
      </div>
      <div className="know">
        <nav className="panel subnav" aria-label="Tri thức">
          {nav.map(([k, label, icon, n]) => (
            <NavLink key={k} to={`/p/${id}/knowledge/${k}`} className={() => (section === k ? "on" : "")}>
              {icon}
              {label}
              {n !== null && n > 0 && <span className="n warn">{n}</span>}
            </NavLink>
          ))}
        </nav>
        <section className="panel doc">{section === "docs" ? <DocsSection /> : section === "review" ? <Review /> : <CharterView />}</section>
      </div>
    </>
  );
}
