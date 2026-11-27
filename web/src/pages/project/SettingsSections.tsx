// The sections of Thiết lập: members, repository, share links and the system log.

import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Copy, Link2, Pencil, RefreshCw, Trash2, User as UserIcon, X } from "lucide-react";
import { api } from "../../api/endpoints";
import type { ActivityEvent, Invite, Level, Member, MemberLevel, ProjectAccess } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction, useToast } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useOverview } from "../../hooks/useOverview";
import { useProject } from "./ProjectLayout";
import { Av, Blank, Seg } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { ConfirmButton } from "../../components/ConfirmButton";
import { AccessChip, Modal } from "../../components/ui";
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
        Ghi chú cho AI
        <input className="p-input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="phụ trách thanh toán" />
      </label>
      <div className="acts wide" style={{ marginTop: 0 }}>
        <button type="submit" className="p-btn primary sm">
          Lưu
        </button>
        <button type="button" className="p-btn quiet sm" onClick={onDone}>
          Huỷ
        </button>
      </div>
      <datalist id="gtv-roles">
        {ROLE_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </form>
  );
}

const INVITE_HINT: Record<"developer" | "viewer", string> = {
  developer: "Agent trên máy người đó làm việc trong project. Trả lời câu hỏi, tạo và sửa việc của mình, sửa tài liệu.",
  viewer: "Chỉ xem: hợp với giảng viên, người theo dõi. Agent của họ không làm việc trong project.",
};
const day = (iso: string) => new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });

/** Mời bằng link: pick access, lifetime and uses; the link and a message to send appear once, right after. */
function InviteModal({ onClose, onMade }: { onClose: () => void; onMade: () => void }) {
  const { id, detail } = useProject();
  const run = useAction();
  const toast = useToast();
  const [o, setO] = useState<{ access: "developer" | "viewer"; days: string; max: string }>({ access: "developer", days: "7", max: "null" });
  const [made, setMade] = useState<Invite & { url: string }>();
  const message = made
    ? `Mời bạn vào project ${detail.name} trên gtv (quyền ${ACCESS_LABEL[made.access]}). Mở link, đăng nhập hoặc tạo tài khoản rồi bấm Tham gia: ${made.url} (hết hạn ${day(made.expires_at)}).`
    : "";
  if (made)
    return (
      <Modal
        title="Đã tạo link mời"
        sub={`${ACCESS_LABEL[made.access]} · hết hạn ${day(made.expires_at)}${made.max_uses ? ` · ${made.max_uses} người` : ""}. Ai có link đều vào được, nên chỉ gửi cho người trong nhóm. Link chỉ hiện lần này.`}
        onClose={onClose}
        foot={
          <>
            <button type="button" className="p-btn quiet" onClick={onClose}>
              Xong
            </button>
            <button
              type="button"
              className="p-btn primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message);
                  toast("Đã chép tin nhắn");
                } catch {
                  toast("Trình duyệt chặn chép: bôi đen rồi chép tay", true);
                }
              }}
            >
              <Copy size={15} />
              Chép tin nhắn
            </button>
          </>
        }
      >
        <div className="stack">
          <CopyLine text={made.url} />
          <label className="field">
            <span>Tin nhắn gửi kèm</span>
            <textarea className="p-textarea" readOnly value={message} />
          </label>
        </div>
      </Modal>
    );
  return (
    <Modal
      title="Mời bằng link"
      sub="Người nhận bấm link, đăng nhập hoặc tạo tài khoản, rồi bấm Tham gia."
      onClose={onClose}
      foot={
        <>
          <button type="button" className="p-btn quiet" onClick={onClose}>
            Huỷ
          </button>
          <button
            type="button"
            className="p-btn primary"
            onClick={async () => {
              const r = await run(() => api.invites.create(id, { access: o.access, days: Number(o.days), max_uses: o.max === "null" ? null : Number(o.max) }));
              if (r) {
                setMade(r);
                onMade();
              }
            }}
          >
            Tạo link mời
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="iopt">
          <span>Quyền</span>
          <Seg
            label="Quyền"
            value={o.access}
            onChange={(access) => setO({ ...o, access })}
            options={[
              ["developer", "Developer"],
              ["viewer", "Người xem"],
            ]}
          />
          <small>{INVITE_HINT[o.access]} Muốn ai làm Quản lý thì nâng sau khi họ vào.</small>
        </div>
        <div className="iopt">
          <span>Hết hạn sau</span>
          <Seg
            label="Hết hạn sau"
            value={o.days}
            onChange={(days) => setO({ ...o, days })}
            options={[
              ["1", "1 ngày"],
              ["7", "7 ngày"],
              ["30", "30 ngày"],
            ]}
          />
        </div>
        <div className="iopt">
          <span>Số người dùng được</span>
          <Seg
            label="Số người dùng được"
            value={o.max}
            onChange={(max) => setO({ ...o, max })}
            options={[
              ["1", "1 người"],
              ["10", "10 người"],
              ["null", "Không giới hạn"],
            ]}
          />
        </div>
      </div>
    </Modal>
  );
}

/** Thêm theo tên: someone who already has an account joins at once. */
function AddNameModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { id } = useProject();
  const run = useAction();
  const [user, setUser] = useState("");
  const [access, setAccess] = useState<ProjectAccess>("developer");
  return (
    <Modal
      title="Thêm người đã có tài khoản"
      sub="Người đó vào project ngay, không cần bấm gì, và thấy project trong trang Project của tôi."
      onClose={onClose}
      foot={
        <>
          <button type="button" className="p-btn quiet" onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" form="add-form" className="p-btn primary" disabled={!user.trim()}>
            Thêm vào project
          </button>
        </>
      }
    >
      <form
        id="add-form"
        className="formgrid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.members.add(id, user.trim().toLowerCase(), access), `Đã thêm ${user.trim()}`)) {
            onAdded();
            onClose();
          }
        }}
      >
        <label>
          Tên đăng nhập
          <input
            className="p-input mono"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="ví dụ hien"
            spellCheck={false}
            autoCapitalize="off"
            required
            autoFocus
          />
        </label>
        <label>
          Quyền
          <select className="p-input" value={access} onChange={(e) => setAccess(e.target.value as ProjectAccess)}>
            <option value="developer">Developer</option>
            <option value="viewer">Người xem</option>
            <option value="manager">Quản lý</option>
          </select>
        </label>
      </form>
    </Modal>
  );
}

export function MembersSection() {
  const { id, detail, manage, reload: reloadProject } = useProject();
  const { me, refresh } = useAuth();
  const { reload: reloadOverview } = useOverview();
  const navigate = useNavigate();
  const run = useAction();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const [modal, setModal] = useState<"invite" | "add">();
  const { data: members, reload } = usePoll(() => api.members.list(id), [id], 15_000);
  const { data: invites, reload: reloadInvites } = usePoll(() => (manage ? api.invites.list(id) : Promise.resolve([])), [id, manage], 30_000);
  if (!members) return <Loading />;
  const working = new Set(detail.people.filter((p) => p.working).map((p) => p.dev));
  const managers = members.filter((m) => m.access === "manager");
  const iAmLastManager = managers.length === 1 && managers[0].dev === me?.name;
  const created = params.get("created") === "1";
  const after = () => {
    void reload();
    void reloadProject();
  };
  return (
    <>
      {created && (
        <div className="banner">
          <span className="big-ok">
            <Check />
          </span>
          <div className="grow">
            <b>Đã tạo {detail.name}. Bạn là Quản lý.</b>
            <small>
              Bước tiếp: mời nhóm bằng link, rồi mỗi người chạy <span className="mono">gtv on</span> trong bản clone của repo.
            </small>
          </div>
          <button type="button" className="p-btn primary" onClick={() => setModal("invite")}>
            <Link2 size={15} />
            Mời bằng link
          </button>
          <button type="button" className="iconbtn" aria-label="Ẩn" onClick={() => setParams({}, { replace: true })}>
            <X />
          </button>
        </div>
      )}
      <div className="hrow" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <h2>
            Thành viên{" "}
            <span className="faint" style={{ fontWeight: 500 }}>
              {members.length}
            </span>
          </h2>
          <p className="lede">Quyền quyết định ai làm gì trong project. Vai trò công việc và trình độ giúp AI chọn người để hỏi.</p>
        </div>
        {manage && (
          <div className="hrow">
            <button type="button" className="p-btn" onClick={() => setModal("add")}>
              <UserIcon size={15} />
              Thêm theo tên
            </button>
            <button type="button" className="p-btn primary" onClick={() => setModal("invite")}>
              <Link2 size={15} />
              Mời bằng link
            </button>
          </div>
        )}
      </div>
      <div>
        {members.map((m) => {
          const lastMgr = m.access === "manager" && managers.length === 1;
          const mine = m.dev === me?.name;
          const seen = m.devices
            .map((d) => d.last_seen ?? "")
            .sort()
            .pop();
          return (
            <div key={m.dev} className="mrow">
              <Av who={m.dev} />
              <div>
                <b>
                  {m.display_name} {mine && <span className="you">(bạn)</span>}
                </b>
                <small>
                  <span className="mono">{m.dev}</span> · {m.role} · {LEVEL_LABEL[m.level]}
                  {manage && (
                    <button
                      type="button"
                      className="linkbtn"
                      onClick={() => setEditing(editing === m.dev ? undefined : m.dev)}
                      aria-label={`Sửa hồ sơ của ${m.dev}`}
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                </small>
              </div>
              <div>
                {manage ? (
                  <select
                    className="p-input"
                    value={m.access}
                    disabled={lastMgr}
                    title={lastMgr ? "Project cần ít nhất một Quản lý" : ACCESS_HINT[m.access]}
                    aria-label={`Quyền của ${m.display_name}`}
                    onChange={async (e) => {
                      const access = e.target.value as ProjectAccess;
                      if (await run(() => api.members.save(id, m.dev, { access }), `${m.display_name} giờ là ${ACCESS_LABEL[access]}`)) after();
                    }}
                  >
                    {ACCESS.map((a) => (
                      <option key={a} value={a}>
                        {ACCESS_LABEL[a]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <AccessChip access={m.access} />
                )}
                {lastMgr && manage && (
                  <small className="faint" style={{ marginTop: 3 }}>
                    Quản lý duy nhất
                  </small>
                )}
              </div>
              <div className="seen">
                {m.devices.length ? `${m.devices.length} máy · ` : "chưa kết nối máy · "}
                {working.has(m.dev) ? (
                  <span className="state running">đang làm</span>
                ) : m.devices.some((d) => d.online) ? (
                  "đang kết nối"
                ) : seen ? (
                  `thấy ${ago(seen)}`
                ) : (
                  "chưa thấy"
                )}
              </div>
              <div className="rm">
                {manage && !mine && !lastMgr && (
                  <button type="button" className="p-btn sm quiet" onClick={() => setRemoving(m.dev)} aria-label={`Xoá ${m.display_name}`}>
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              {removing === m.dev && (
                <div className="confirm" style={{ gridColumn: "1/-1", borderRadius: 10, border: 0 }}>
                  <AlertTriangle size={16} />
                  <span className="grow">
                    Xoá <b>{m.display_name}</b> khỏi project? Máy của họ thôi làm việc ở đây ngay. Việc đã làm vẫn giữ tên {m.dev}.
                  </span>
                  <button
                    type="button"
                    className="p-btn sm danger"
                    onClick={async () => {
                      if (await run(() => api.members.remove(id, m.dev), `Đã xoá ${m.dev} khỏi project`)) {
                        setRemoving(undefined);
                        after();
                      }
                    }}
                  >
                    Xoá khỏi project
                  </button>
                  <button type="button" className="p-btn sm quiet" onClick={() => setRemoving(undefined)}>
                    Huỷ
                  </button>
                </div>
              )}
              {editing === m.dev && (
                <div style={{ gridColumn: "1/-1" }}>
                  <MemberEdit
                    m={m}
                    onDone={() => {
                      setEditing(undefined);
                      after();
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {manage && (
        <div className="sec">
          <span className="sect">Link mời đang hiệu lực</span>
          {invites?.length ? (
            invites.map((i) => (
              <div key={i.id} className="irow">
                <Link2 size={16} />
                <div>
                  {ACCESS_LABEL[i.access]} · đã dùng {i.uses}
                  {i.max_uses ? `/${i.max_uses}` : ""} lượt
                  <small>
                    tạo bởi {i.created_by} · hết hạn {day(i.expires_at)}
                  </small>
                </div>
                <button
                  type="button"
                  className="p-btn sm quiet"
                  onClick={async () => (await run(() => api.invites.revoke(id, i.id), "Đã thu hồi link mời")) && reloadInvites()}
                >
                  Thu hồi
                </button>
              </div>
            ))
          ) : (
            <p className="muted">Không có link nào. Link đã thu hồi hoặc hết hạn không vào được nữa.</p>
          )}
          <p className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
            Link mời chỉ hiện một lần, lúc tạo. Mất link thì thu hồi rồi tạo link mới.
          </p>
        </div>
      )}

      <div className="sec">
        <span className="sect">Rời project</span>
        <div className="hrow">
          <p className="muted grow" style={{ maxWidth: "60ch" }}>
            {iAmLastManager
              ? "Bạn là Quản lý duy nhất. Nâng một người khác lên Quản lý trước khi rời."
              : "Rời project thì bạn thôi thấy project này, và máy của bạn thôi làm việc ở đây. Việc đã làm vẫn giữ tên bạn."}
          </p>
          {leaving ? (
            <>
              <button
                type="button"
                className="p-btn danger"
                onClick={async () => {
                  if (await run(() => api.members.remove(id, me!.name), `Đã rời ${detail.name}`)) {
                    await refresh();
                    void reloadOverview();
                    navigate("/");
                  }
                }}
              >
                Rời {detail.name}
              </button>
              <button type="button" className="p-btn quiet" onClick={() => setLeaving(false)}>
                Huỷ
              </button>
            </>
          ) : (
            <button type="button" className="p-btn danger" disabled={iAmLastManager || me?.kind !== "user"} onClick={() => setLeaving(true)}>
              Rời project
            </button>
          )}
        </div>
      </div>
      {modal === "invite" && <InviteModal onClose={() => setModal(undefined)} onMade={() => void reloadInvites()} />}
      {modal === "add" && <AddNameModal onClose={() => setModal(undefined)} onAdded={after} />}
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
