// The sections of Thiết lập: members, repository, share links and the system log.

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Link2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../../api/endpoints";
import type { ActivityEvent, Level, Member, MemberLevel, ProjectAccess } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction, useToast } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useOverview } from "../../hooks/useOverview";
import { useProject } from "./ProjectLayout";
import { Av, Blank, Seg, State } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { ConfirmButton } from "../../components/ConfirmButton";
import { LEVELS, LEVEL_LABEL, ROLE_SUGGESTIONS } from "../../components/Member";
import { agentName } from "../../components/Badge";
import { ago, clock, parseJson } from "../../lib/format";
import { ACCESS_HINT, ACCESS_LABEL } from "../../lib/people";

const DANGER = "p-btn sm danger";

export function CopyLine({ text }: { text: string }) {
  const toast = useToast();
  return (
    <div className="p-cmd">
      <span>{text}</span>
      <button
        type="button"
        className="p-btn sm quiet"
        style={{ marginLeft: "auto" }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast("Đã chép");
          } catch {
            toast("Trình duyệt chặn chép: bôi đen rồi chép tay", true);
          }
        }}
      >
        <Copy />
        Chép
      </button>
    </div>
  );
}

// ---- members ------------------------------------------------------------------------------

function MemberEdit({ m, onDone }: { m: Member; onDone: () => void }) {
  const { id } = useProject();
  const run = useAction();
  const [f, setF] = useState({ role: m.role, level: m.level, note: m.note ?? "" });
  return (
    <form
      className="medit"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api.members.save(id, m.dev, { role: f.role.trim(), level: f.level, note: f.note.trim() }), "Đã lưu")) onDone();
      }}
    >
      <label>
        Vai trò
        <input className="p-input" list="gtv-roles" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
      </label>
      <label>
        Trình độ
        <select className="p-input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as MemberLevel })}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABEL[l]}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Ghi chú
        <input className="p-input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="phụ trách thanh toán" />
      </label>
      <div className="acts wide" style={{ marginTop: 0 }}>
        <button type="submit" className="p-btn primary sm">
          Lưu
        </button>
        <button type="button" className="p-btn quiet sm" onClick={onDone}>
          Huỷ
        </button>
        <span style={{ flex: 1 }} />
        <ConfirmButton
          className={DANGER}
          onConfirm={async () => {
            if (await run(() => api.members.remove(id, m.dev), "Đã bỏ khỏi project")) onDone();
          }}
        >
          <Trash2 size={14} /> Bỏ khỏi project
        </ConfirmButton>
      </div>
    </form>
  );
}

export function MembersSection() {
  const { id, detail, reload } = useProject();
  const { can } = useAuth();
  const run = useAction();
  const [editing, setEditing] = useState<string>();
  const [add, setAdd] = useState({ dev: "", role: "", level: "mid" as MemberLevel, access: "developer" as ProjectAccess });
  const { data: accounts } = usePoll(api.people, [], 60_000);
  const people = new Map(detail.people.map((p) => [p.dev, p]));
  const members = [...detail.members].sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || a.dev.localeCompare(b.dev));
  const candidates = (accounts ?? []).map((u) => u.name).filter((n) => !detail.members.some((m) => m.dev === n));
  return (
    <>
      <h2>Thành viên</h2>
      <p className="lede">
        Quyền quyết định ai làm gì: Quản lý làm được mọi thứ, Developer cho agent của mình làm việc ở đây, Người xem chỉ xem. Vai trò và trình độ giúp AI chọn
        cách trả lời và người để hỏi.
      </p>
      <datalist id="gtv-roles">
        {ROLE_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div className="p-members">
        {members.length === 0 && <Blank title="Chưa có thành viên">Thêm người đã có tài khoản ở dưới.</Blank>}
        {members.map((m) => {
          const p = people.get(m.dev);
          const agent = p?.agents[0];
          return (
            <div key={m.dev} className="p-member">
              <Av who={m.dev} agent={agent} />
              <div>
                <b>{m.dev}</b>
                <small>
                  {m.role}
                  {agent ? ` · ${agentName(agent)}` : ""}
                  {m.note ? ` · ${m.note}` : ""}
                </small>
              </div>
              <div className="work">
                <small>{p?.tasks.length ? "đang làm" : p ? `hoạt động ${ago(p.last_seen)}` : "chưa mở phiên agent nào"}</small>
                {p?.tasks[0] ?? ""}
                {p && p.conflicts > 0 && <small className="bad">đang đụng việc người khác</small>}
              </div>
              <select
                className="p-input sm"
                style={{ width: "auto" }}
                value={m.access}
                title={ACCESS_HINT[m.access]}
                aria-label={`Quyền của ${m.dev}`}
                onChange={async (e) => {
                  await run(() => api.members.save(id, m.dev, { access: e.target.value as ProjectAccess }), `Đã đổi quyền của ${m.dev}`);
                  void reload();
                }}
              >
                {ACCESS.map((a) => (
                  <option key={a} value={a}>
                    {ACCESS_LABEL[a]}
                  </option>
                ))}
              </select>
              <span className="mstate">
                <span className="p-chip lvl">{LEVEL_LABEL[m.level]}</span>
                <State status={p?.status ?? "ended"} />
                <button
                  type="button"
                  className="iconbtn"
                  title={`Sửa ${m.dev}`}
                  aria-label={`Sửa ${m.dev}`}
                  onClick={() => setEditing(editing === m.dev ? undefined : m.dev)}
                >
                  <Pencil />
                </button>
              </span>
              {editing === m.dev && (
                <MemberEdit
                  m={m}
                  onDone={() => {
                    setEditing(undefined);
                    void reload();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <form
        className="block"
        onSubmit={async (e) => {
          e.preventDefault();
          const input = { role: add.role.trim() || "developer", level: add.level, access: add.access };
          if (await run(() => api.members.save(id, add.dev, input), `Đã thêm ${add.dev}`)) {
            setAdd({ dev: "", role: "", level: "mid", access: "developer" });
            void reload();
          }
        }}
      >
        <span className="sect">Thêm thành viên</span>
        <div className="inline-form">
          <select className="p-input" required value={add.dev} onChange={(e) => setAdd({ ...add, dev: e.target.value })} aria-label="Người">
            <option value="">{candidates.length ? "Chọn người" : "Không còn ai để thêm"}</option>
            {candidates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select className="p-input" value={add.access} onChange={(e) => setAdd({ ...add, access: e.target.value as ProjectAccess })} aria-label="Quyền">
            {ACCESS.map((a) => (
              <option key={a} value={a}>
                {ACCESS_LABEL[a]}
              </option>
            ))}
          </select>
          <input
            className="p-input"
            list="gtv-roles"
            value={add.role}
            onChange={(e) => setAdd({ ...add, role: e.target.value })}
            placeholder="Vai trò, ví dụ backend"
            aria-label="Vai trò"
          />
          <select className="p-input" value={add.level} onChange={(e) => setAdd({ ...add, level: e.target.value as MemberLevel })} aria-label="Trình độ">
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
          <button type="submit" className="p-btn" disabled={!add.dev}>
            Thêm
          </button>
        </div>
        <p className="faint" style={{ marginTop: 6 }}>
          {can("admin") ? (
            <>
              Người mới chưa có tài khoản? <Link to="/people">Tạo tài khoản ở trang Người</Link>.
            </>
          ) : (
            "Người mới chưa có tài khoản: nhờ quản trị tạo, rồi thêm ở đây."
          )}
        </p>
      </form>
    </>
  );
}

const ACCESS: ProjectAccess[] = ["manager", "developer", "viewer"];

// ---- repository ------------------------------------------------------------------------------

const modulesToText = (m: Record<string, string[]>) =>
  Object.entries(m)
    .map(([k, v]) => `${k}: ${v.join(", ")}`)
    .join("\n");
function textToModules(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const globs = line
      .slice(i + 1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (globs.length) out[line.slice(0, i).trim()] = globs;
  }
  return out;
}
const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export function RepoSection() {
  const { id, detail, reload } = useProject();
  const { reload: reloadOverview } = useOverview();
  const { can } = useAuth();
  const run = useAction();
  const navigate = useNavigate();
  const r = detail.record;
  const [f, setF] = useState({
    name: r.name,
    description: r.description ?? "",
    main_branch: r.main_branch,
    aliases: r.aliases.join(", "),
    critical: r.policy.critical_paths.join("\n"),
    modules: modulesToText(r.policy.modules),
    repo_url: "",
  });
  const [syncing, setSyncing] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await run(
      () =>
        api.projects.update(id, {
          ...(f.repo_url.trim() ? { repo_url: f.repo_url.trim() } : {}),
          name: f.name.trim(),
          description: f.description.trim(),
          main_branch: f.main_branch.trim(),
          aliases: f.aliases
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          policy: { critical_paths: lines(f.critical), modules: textToModules(f.modules) },
        }),
      "Đã lưu",
    );
    setF((x) => ({ ...x, repo_url: "" }));
    void reload();
    void reloadOverview();
  };
  return (
    <>
      <h2>Repo và đồng bộ</h2>
      <p className="lede">
        gtv kéo repo về định kỳ để so với phần đang làm dở của từng người.
        {detail.last_sync && ` Lần đồng bộ gần nhất: ${ago(detail.last_sync.at)}${detail.last_sync.ok ? "" : ", bị lỗi"}.`}
      </p>
      {detail.last_sync && !detail.last_sync.ok && <pre className="errbox">{detail.last_sync.error}</pre>}
      <form className="formgrid" onSubmit={(e) => void save(e)}>
        <label>
          Tên hiển thị
          <input className="p-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label>
          Nhánh chính
          <input className="p-input mono" value={f.main_branch} onChange={(e) => setF({ ...f, main_branch: e.target.value })} />
        </label>
        <label className="wide">
          Mô tả
          <input className="p-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <label className="wide">
          Đổi URL repo
          <input
            className="p-input mono"
            type="password"
            autoComplete="off"
            value={f.repo_url}
            onChange={(e) => setF({ ...f, repo_url: e.target.value })}
            placeholder="Để trống thì giữ nguyên"
          />
          <small>
            Đang dùng <span className="mono">{detail.repo_url}</span>. Repo private: dán URL kèm token chỉ đọc, ví dụ{" "}
            <span className="mono">https://x-access-token:&lt;token&gt;@github.com/org/repo.git</span>. Token không bao giờ hiện lại.
          </small>
        </label>
        <label className="wide">
          URL khác của cùng repo
          <input className="p-input mono" value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} />
          <small>Cách nhau bằng dấu phẩy. Dùng khi dev clone bằng SSH hoặc qua một mirror.</small>
        </label>
        <label>
          Đường dẫn quan trọng
          <textarea
            className="p-textarea mono"
            rows={5}
            value={f.critical}
            onChange={(e) => setF({ ...f, critical: e.target.value })}
            placeholder={"prisma/schema.prisma\n**/migrations/**"}
          />
          <small>Mỗi dòng một mẫu. Hai người cùng chạm vào đây thì gtv báo mức nghiêm trọng.</small>
        </label>
        <label>
          Module
          <textarea
            className="p-textarea mono"
            rows={5}
            value={f.modules}
            onChange={(e) => setF({ ...f, modules: e.target.value })}
            placeholder={"auth: src/routes/auth/**\narticle: src/routes/article/**"}
          />
          <small>Mỗi dòng “tên: mẫu, mẫu”. Hai người cùng sửa một module thì gtv báo mức thấp.</small>
        </label>
        <div className="acts wide">
          <button type="submit" className="p-btn primary">
            Lưu thay đổi
          </button>
          <button
            type="button"
            className="p-btn"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              await run(() => api.projects.sync(id), "Đã đồng bộ");
              setSyncing(false);
              void reload();
            }}
          >
            <RefreshCw />
            {syncing ? "Đang đồng bộ…" : "Đồng bộ ngay"}
          </button>
          {can("admin") && (
            <ConfirmButton
              className={DANGER}
              confirmLabel="Bấm lần nữa để lưu trữ"
              onConfirm={async () => {
                if (await run(() => api.projects.archive(id), "Đã lưu trữ project")) {
                  void reloadOverview();
                  navigate("/");
                }
              }}
            >
              Lưu trữ project
            </ConfirmButton>
          )}
        </div>
      </form>
    </>
  );
}

// ---- share links ------------------------------------------------------------------------------

export function ShareSection() {
  const { id } = useProject();
  const run = useAction();
  const links = usePoll(() => api.shareLinks.list(id), [id], 0);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("30");
  const [fresh, setFresh] = useState<string>();
  return (
    <>
      <h2>Link chia sẻ</h2>
      <p className="lede">Link chỉ xem, không cần tài khoản. Dùng để gửi giảng viên hoặc người ngoài nhóm.</p>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await run(() => api.shareLinks.create(id, label.trim(), Number(days) || undefined), "Đã tạo link");
          if (res) {
            setFresh(`${location.origin}/s/${res.code}`);
            setLabel("");
            void links.reload();
          }
        }}
      >
        <input
          className="p-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Ghi chú, ví dụ: demo cho giảng viên"
          aria-label="Ghi chú"
        />
        <select className="p-input" style={{ maxWidth: 160 }} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Hết hạn sau">
          <option value="1">1 ngày</option>
          <option value="7">7 ngày</option>
          <option value="30">30 ngày</option>
          <option value="0">Không hết hạn</option>
        </select>
        <button type="submit" className="p-btn primary">
          <Link2 />
          Tạo link
        </button>
      </form>
      {fresh && (
        <div className="block">
          <span className="sect">Link chỉ hiện một lần, chép rồi gửi đi</span>
          <CopyLine text={fresh} />
        </div>
      )}
      <div className="block">
        {!links.data ? (
          <Loading />
        ) : links.data.length === 0 ? (
          <Blank title="Chưa có link nào">Tạo một link để người khác xem project mà không sửa được gì.</Blank>
        ) : (
          <div className="doclist">
            {links.data.map((l) => (
              <div key={l.id} className="docrow">
                <span className="ic">
                  <Link2 />
                </span>
                <b>{l.label || "Không ghi chú"}</b>
                <small>
                  Tạo {ago(l.created_at)}
                  {l.created_by ? ` bởi ${l.created_by}` : ""} ·{" "}
                  {l.expires_at ? `hết hạn ${new Date(l.expires_at).toLocaleDateString("vi-VN")}` : "không hết hạn"} ·{" "}
                  {l.last_used ? `mở lần cuối ${ago(l.last_used)}` : "chưa ai mở"}
                </small>
                <span className="r">
                  <ConfirmButton
                    className={DANGER}
                    confirmLabel="Thu hồi?"
                    onConfirm={async () => {
                      await run(() => api.shareLinks.revoke(id, l.id), "Đã thu hồi");
                      void links.reload();
                    }}
                  >
                    Thu hồi
                  </ConfirmButton>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ---- system log ------------------------------------------------------------------------------

const ROUTINE = new Set(["snapshot", "session_start", "prompt", "conflict_ack"]);
const VERB: Record<string, string> = {
  ack: "đánh dấu đã biết",
  dismiss: "bỏ qua",
  reopen: "mở lại",
  confirm: "xác nhận",
  reject: "loại",
  edit: "sửa",
  pin: "ghim",
  unpin: "bỏ ghim",
  guided: "gửi hướng xử lý",
};

/** One line in plain words for an event_log row, with its severity when it has one. */
export function describe(e: ActivityEvent): { text: string; level?: Level } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (parseJson(e.payload) ?? {}) as Record<string, any>;
  switch (e.type) {
    case "session_start":
      return { text: `mở phiên ${agentName(p.agent ?? "")} (${p.workspace_label ?? ""})` };
    case "register":
      return { text: `đăng ký việc “${p.title}”` };
    case "plan_intent":
      return { text: `AI dựng đăng ký từ kế hoạch: “${p.intent?.title ?? "?"}”` };
    case "l3_registration": {
      const o: { level: Level; reason: string }[] = p.output?.overlaps ?? [];
      const top = o.find((x) => x.level === "critical") ?? o.find((x) => x.level === "high") ?? o[0];
      return top ? { text: `AI so hai việc: ${top.reason}`, level: top.level } : { text: "AI so việc: không chồng chéo" };
    }
    case "snapshot":
      return { text: `lưu bản tạm ${String(p.sha ?? "").slice(0, 8)}` };
    case "conflict":
      return { text: `${p.layer}: ${p.message}`, level: p.level };
    case "ticket_ask":
      return { text: `hỏi${p.to_dev ? ` ${p.to_dev}` : ""}: ${p.question}` };
    case "ticket_tier1":
      return { text: `AI ${p.output?.route === "answer" ? "trả lời" : "chuyển câu hỏi đi"} sau ${((p.ms ?? 0) / 1000).toFixed(1)} giây` };
    case "drift":
      return { text: `sửa ngoài phạm vi đã đăng ký: ${(p.paths ?? []).join(", ")}`, level: "warning" };
    case "shadow_conflicts":
      return { text: `chạy thử ${p.feature}: ${(p.found ?? []).length} phát hiện, không báo ai` };
    case "feature_set":
      return { text: `đặt ${p.feature} = ${p.mode ?? "mặc định"}` };
    case "feature_error":
      return { text: `lỗi ${p.feature}: ${String(p.error).slice(0, 200)}`, level: "high" };
    case "manual_message":
      return { text: `nhắn ${p.to_dev}: ${p.body}` };
    case "work_merged":
      return { text: "phần đã làm vào nhánh chính" };
    case "board_create":
      return { text: `tạo việc “${p.title ?? p.board_id}”${p.assignee ? `, giao ${p.assignee}` : ""}` };
    case "board_update":
      return { text: `cập nhật việc ${p.board_id ?? ""}${Array.isArray(p.changes) && p.changes.length ? `: ${p.changes.join(", ")}` : ""}` };
    case "board_note":
      return { text: `ghi chú vào việc: ${p.summary ?? p.body ?? ""}` };
    case "board_pick":
      return { text: `nhận việc ${p.board_id ?? ""}` };
    case "board_delete":
      return { text: `xoá việc ${p.board_id ?? ""}` };
    case "member_set":
      return { text: `cập nhật thành viên ${p.dev ?? ""}` };
    case "member_removed":
      return { text: `bỏ thành viên ${p.dev ?? ""}` };
    case "summary":
      return { text: `AI viết tóm tắt (${p.kind === "day" ? "trong ngày" : "một trao đổi"})` };
    default:
      if (e.type.startsWith("incident_")) return { text: `${VERB[e.type.slice(9)] ?? e.type.slice(9)} một vụ đụng nhau` };
      if (e.type.startsWith("conflict_")) return { text: `${VERB[e.type.slice(9)] ?? e.type.slice(9)} xung đột ${p.id ?? ""}` };
      if (e.type.startsWith("kb_")) return { text: `${VERB[e.type.slice(3)] ?? e.type.slice(3)} tài liệu ${p.title ?? p.id ?? ""}` };
      return { text: e.type };
  }
}

export function LogList({ events }: { events: ActivityEvent[] }) {
  const [filter, setFilter] = useState<"important" | "all">("important");
  const [shown, setShown] = useState(30);
  const rows = filter === "all" ? events : events.filter((e) => !ROUTINE.has(e.type));
  return (
    <>
      <div className="acts" style={{ marginTop: 0 }}>
        <Seg
          label="Lọc nhật ký"
          value={filter}
          onChange={setFilter}
          options={[
            ["important", "Quan trọng"],
            ["all", "Tất cả"],
          ]}
        />
      </div>
      <ul className="loglist">
        {rows.slice(0, shown).map((e) => {
          const d = describe(e);
          const hot = d.level === "high" || d.level === "critical";
          return (
            <li key={e.id} className={hot ? "hot" : ""}>
              <span className="mono faint" title={e.ts}>
                {e.ts.slice(5, 10).split("-").reverse().join("/")} {clock(e.ts)}
              </span>
              <b>{e.actor ?? "gtv"}</b>
              <span>{d.text}</span>
            </li>
          );
        })}
      </ul>
      {rows.length > shown && (
        <button type="button" className="p-btn quiet sm" onClick={() => setShown(shown + 50)}>
          Xem thêm {Math.min(50, rows.length - shown)} dòng
        </button>
      )}
    </>
  );
}
