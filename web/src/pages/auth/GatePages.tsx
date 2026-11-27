// Pages for people who are not logged in: setting up an empty server, logging in, signing up (with or without an
// invite), a password reset link and an invite link. A navy story panel on the left, one form on the right.

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Info, Link2, X } from "lucide-react";
import { api } from "../../api/endpoints";
import type { InviteInfo } from "../../api/types";
import { useAuth } from "../../hooks/useAuth";
import { BrandMark } from "../../components/Layout";
import { AccessChip, PwField } from "../../components/ui";
import { initials } from "../../lib/people";

const ACCESS_DOES: Record<string, string> = {
  developer: "Agent trên máy bạn làm việc trong project. Trả lời câu hỏi, tạo và sửa việc của mình, sửa tài liệu.",
  viewer: "Chỉ xem: hợp với giảng viên, người theo dõi. Agent của bạn không làm việc trong project.",
};
const RESERVED = ["admin", "root", "gtv", "system", "everyone", "all", "share", "me", "api"];
const host = () => window.location.host;

/** Where to go after logging in: ?next= when it stays on this site, else home. */
function useNext(): string {
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function GateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="pj">
      <div className="gate">
        <aside className="gate-side">
          <div className="brand-line">
            <BrandMark size={30} />
            Guide the Vibe
          </div>
          <div className="pitch">
            <h2>Agent của cả nhóm biết nhau đang sửa gì.</h2>
            <p>gtv đứng giữa Claude Code và Codex của mọi người trong project: báo đụng nhau trước khi thành conflict, và để agent hỏi đồng đội thay bạn.</p>
          </div>
          <figure className="peek">
            <figcaption>
              <span className="dot" />
              gtv → agent của hoc · 22:06
            </figcaption>
            <p>
              <b>bob</b> đang đổi chữ ký <code>refund(orderId, reason)</code> trong <code>src/orders/service.ts</code>. File bạn sắp sửa có gọi hàm này.
            </p>
            <div className="acts">
              <span className="p-chip clash">đụng nhau · mức cao</span>
              <span className="p-chip">hỏi bob trước khi sửa?</span>
            </div>
          </figure>
          <span className="foot">{host()} · gtv</span>
        </aside>
        <main className="gate-main">{children}</main>
      </div>
    </div>
  );
}

function ErrorNote({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="note warn" role="alert">
      <Info />
      <span>{text}</span>
    </div>
  );
}

function nameCheck(v: string): ["" | "err" | "ok", string] {
  if (!v) return ["", "Chữ thường, số và . _ - (3–32 ký tự). Tên này hiện trong mọi việc của bạn và không đổi được."];
  if (!/^[a-z0-9._-]+$/.test(v)) return ["err", "Chỉ dùng chữ thường không dấu, số và . _ -"];
  if (v.length < 3) return ["err", "Ít nhất 3 ký tự"];
  if (v.length > 32) return ["err", "Nhiều nhất 32 ký tự"];
  if (RESERVED.includes(v)) return ["err", "Tên này dành cho hệ thống, chọn tên khác"];
  return ["ok", "Dùng được nếu chưa ai lấy. Tên này không đổi được sau khi tạo."];
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [cls, msg] = nameCheck(value);
  return (
    <label className="field">
      <span>Tên đăng nhập</span>
      <input
        className="p-input mono"
        autoComplete="username"
        placeholder="minh"
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        required
        spellCheck={false}
        autoCapitalize="off"
      />
      <small className={cls}>{msg}</small>
    </label>
  );
}

/** Runs a form's action; the error message stays on the form. */
function useSubmit(): [boolean, string | undefined, (fn: () => Promise<void>) => (e: FormEvent) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return [busy, error, submit];
}

// ---- /setup ----------------------------------------------------------------------------------

export function SetupPage() {
  const { config, refresh } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ display: "", name: "", pw: "", token: "" });
  const [busy, error, submit] = useSubmit();
  return (
    <GateFrame>
      <form
        className="formcard"
        onSubmit={submit(async () => {
          await api.auth.setup({ name: f.name.trim(), display_name: f.display.trim(), password: f.pw, admin_token: f.token || undefined });
          await refresh();
          window.location.href = "/"; // reload: the server is no longer empty
          navigate("/");
        })}
      >
        <div>
          <h1>Tạo tài khoản quản trị</h1>
          <p className="sub">Server này chưa có ai. Tài khoản đầu tiên quản lý server: cấu hình AI, các tài khoản và ai được đăng ký.</p>
        </div>
        <ErrorNote text={error} />
        <label className="field">
          <span>Tên hiển thị</span>
          <input
            className="p-input"
            autoComplete="name"
            placeholder="Thái Học"
            value={f.display}
            onChange={(e) => setF({ ...f, display: e.target.value })}
            required
          />
        </label>
        <NameField value={f.name} onChange={(name) => setF({ ...f, name })} />
        <PwField label="Mật khẩu" auto="new-password" hint="Ít nhất 8 ký tự." value={f.pw} onChange={(pw) => setF({ ...f, pw })} />
        {config?.needs_admin_token && (
          <PwField
            label="Mã quản trị của server"
            auto="off"
            value={f.token}
            onChange={(token) => setF({ ...f, token })}
            hint={
              <>
                Giá trị <span className="mono">GTV_ADMIN_TOKEN</span> trong <span className="mono">docker/.env</span> của server. Chỉ hỏi lần này, để người lạ
                không giành quyền quản trị trước bạn.
              </>
            }
          />
        )}
        <button className="p-btn primary block" disabled={busy}>
          Tạo và đăng nhập
        </button>
      </form>
    </GateFrame>
  );
}

// ---- /login ----------------------------------------------------------------------------------

export function LoginPage() {
  const { config, refresh } = useAuth();
  const navigate = useNavigate();
  const next = useNext();
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [busy, error, submit] = useSubmit();
  const joining = next.startsWith("/join/");
  const connecting = next.startsWith("/connect");
  return (
    <GateFrame>
      <form
        className="formcard"
        onSubmit={submit(async () => {
          await api.auth.login(name.trim(), pw);
          await refresh();
          navigate(next, { replace: true });
        })}
      >
        <div>
          <h1>Đăng nhập</h1>
          <p className="sub">Vào gtv bằng tên đăng nhập của bạn.</p>
        </div>
        {(joining || connecting) && (
          <div className="note accent">
            <Link2 />
            <span>{joining ? "Đăng nhập xong bạn quay lại lời mời." : "Đăng nhập xong bạn quay lại trang duyệt máy."}</span>
          </div>
        )}
        <ErrorNote text={error} />
        <label className="field">
          <span>Tên đăng nhập</span>
          <input
            className="p-input"
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
        <PwField label="Mật khẩu" value={pw} onChange={setPw} />
        <button className="p-btn primary block" disabled={busy}>
          Đăng nhập
        </button>
        {config?.registration !== "closed" && (
          <p className="swap">
            Chưa có tài khoản? <Link to={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Tạo tài khoản</Link>
          </p>
        )}
        <p className="swap faint">Quên mật khẩu? Nhờ quản trị server tạo link đặt lại cho bạn.</p>
      </form>
    </GateFrame>
  );
}

// ---- /signup[?invite=…] ------------------------------------------------------------------------

export function SignupPage() {
  const { config, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = useNext();
  const invite = params.get("invite") ?? (next.startsWith("/join/") ? next.slice(6) : "");
  const [info, setInfo] = useState<InviteInfo>();
  const [f, setF] = useState({ display: "", name: "", pw: "", pw2: "" });
  const [busy, error, submit] = useSubmit();
  useEffect(() => {
    if (invite) void api.invites.info(invite).then(setInfo, () => setInfo({ valid: false }));
  }, [invite]);
  const loginLink = `/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
  if (config?.registration === "closed" || (config?.registration === "invite" && !invite))
    return (
      <GateFrame>
        <div className="formcard">
          <div>
            <h1>Chưa tạo được tài khoản</h1>
            <p className="sub">
              {config.registration === "closed"
                ? "Server này đã đóng đăng ký. Nhờ quản trị server nếu bạn cần tài khoản."
                : "Server này chỉ cho tạo tài khoản từ link mời vào một project. Nhờ người quản lý project gửi link cho bạn."}
            </p>
          </div>
          <p className="swap">
            Đã có tài khoản? <Link to={loginLink}>Đăng nhập</Link>
          </p>
        </div>
      </GateFrame>
    );
  const valid = info?.valid ? info : undefined;
  return (
    <GateFrame>
      <form
        className="formcard"
        onSubmit={submit(async () => {
          if (f.pw !== f.pw2) throw new Error("Hai mật khẩu không giống nhau");
          const r = await api.auth.signup({ name: f.name.trim(), display_name: f.display.trim(), password: f.pw, invite: invite || undefined });
          await refresh();
          navigate(r.project && invite ? `/join/${encodeURIComponent(invite)}?joined=1` : next, { replace: true });
        })}
      >
        <div>
          <h1>Tạo tài khoản</h1>
          <p className="sub">Một tài khoản cho bạn: đăng nhập dashboard, và là danh tính của agent trên các máy của bạn.</p>
        </div>
        {valid && (
          <div className="note accent">
            <span className="av sm">{initials(valid.invited_by_name)}</span>
            <span>
              <b>{valid.invited_by}</b> mời bạn vào <b>{valid.project_name}</b> với quyền <b>{valid.access === "developer" ? "Developer" : "Người xem"}</b>. Tạo
              tài khoản xong là bạn ở trong project.
            </span>
          </div>
        )}
        {invite && info && !info.valid && <ErrorNote text="Link mời này không dùng được nữa. Nhờ người mời gửi link mới." />}
        <ErrorNote text={error} />
        <label className="field">
          <span>Tên hiển thị</span>
          <input
            className="p-input"
            autoComplete="name"
            placeholder="Nguyễn Minh"
            value={f.display}
            onChange={(e) => setF({ ...f, display: e.target.value })}
            required
          />
          <small>Tên mọi người thấy. Đổi lúc nào cũng được.</small>
        </label>
        <NameField value={f.name} onChange={(name) => setF({ ...f, name })} />
        <PwField label="Mật khẩu" auto="new-password" hint="Ít nhất 8 ký tự." value={f.pw} onChange={(pw) => setF({ ...f, pw })} />
        <PwField label="Nhập lại mật khẩu" auto="new-password" value={f.pw2} onChange={(pw2) => setF({ ...f, pw2 })} />
        <button className="p-btn primary block" disabled={busy || (!!invite && info?.valid === false)}>
          {valid ? "Tạo tài khoản và tham gia" : "Tạo tài khoản"}
        </button>
        <p className="swap">
          Đã có tài khoản? <Link to={loginLink}>Đăng nhập</Link>
        </p>
      </form>
    </GateFrame>
  );
}

// ---- /reset/:code ----------------------------------------------------------------------------

export function ResetPage() {
  const { code = "" } = useParams();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [who, setWho] = useState<{ user: string } | null>();
  const [pw, setPw] = useState({ a: "", b: "" });
  const [busy, error, submit] = useSubmit();
  useEffect(() => {
    void api.auth.resetInfo(code).then(setWho, () => setWho(null));
  }, [code]);
  if (who === null)
    return (
      <GateFrame>
        <div className="formcard">
          <div className="big-bad">
            <X />
          </div>
          <div>
            <h1>Link này không dùng được nữa</h1>
            <p className="sub">Link đặt lại mật khẩu chỉ dùng một lần và hết hạn sau 1 giờ. Nhờ quản trị server tạo link mới.</p>
          </div>
        </div>
      </GateFrame>
    );
  return (
    <GateFrame>
      <form
        className="formcard"
        onSubmit={submit(async () => {
          if (pw.a !== pw.b) throw new Error("Hai mật khẩu không giống nhau");
          await api.auth.reset(code, pw.a);
          await refresh();
          navigate("/", { replace: true });
        })}
      >
        <div>
          <h1>Đặt mật khẩu mới</h1>
          <p className="sub">
            Cho tài khoản <b className="mono">{who?.user ?? "…"}</b>. Link này dùng một lần.
          </p>
        </div>
        <ErrorNote text={error} />
        <PwField label="Mật khẩu mới" auto="new-password" hint="Ít nhất 8 ký tự." value={pw.a} onChange={(a) => setPw({ ...pw, a })} />
        <PwField label="Nhập lại" auto="new-password" value={pw.b} onChange={(b) => setPw({ ...pw, b })} />
        <div className="note">
          <Info />
          <span>
            Các trình duyệt đang đăng nhập sẽ bị đăng xuất. Máy đã kết nối vẫn chạy, không phải <span className="mono">gtv login</span> lại.
          </span>
        </div>
        <button className="p-btn primary block" disabled={busy || !who}>
          Lưu và đăng nhập
        </button>
      </form>
    </GateFrame>
  );
}

// ---- /join/:code ----------------------------------------------------------------------------

/** The invite card: who invites, to which project, with what access. Guests see nothing else about the project. */
export function InviteCard({ info, children }: { info: Extract<InviteInfo, { valid: true }>; children: ReactNode }) {
  return (
    <div className="invite">
      <div className="from">
        <span className="av">{initials(info.invited_by_name)}</span>
        <span>
          <b>{info.invited_by_name}</b> mời bạn vào
        </span>
      </div>
      <div className="proj">
        <span className="ptile" style={{ background: "#476be0" }}>
          {info.project_name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <b>{info.project_name}</b>
          <span className="muted">project trên {host()}</span>
        </div>
      </div>
      <dl>
        <dt>Quyền</dt>
        <dd>
          <AccessChip access={info.access} />
        </dd>
        <dt>Được làm</dt>
        <dd>{ACCESS_DOES[info.access]}</dd>
        {info.expires_at && (
          <>
            <dt>Hết hạn</dt>
            <dd>{new Date(info.expires_at).toLocaleDateString("vi-VN")}</dd>
          </>
        )}
      </dl>
      {children}
    </div>
  );
}

export function InviteDead() {
  return (
    <div className="formcard">
      <div className="big-bad">
        <X />
      </div>
      <div>
        <h1>Link mời này không dùng được nữa</h1>
        <p className="sub">Link có thể đã hết hạn, đã đủ số người dùng, hoặc người quản lý project đã thu hồi.</p>
      </div>
      <div className="note">
        <Info />
        <span>
          Nhờ người mời gửi link mới. Nếu bạn đã ở trong project, cứ <Link to="/login">đăng nhập</Link>.
        </span>
      </div>
    </div>
  );
}

/** An invite link opened by someone not logged in. */
export function JoinGuestPage() {
  const { code = "" } = useParams();
  const [info, setInfo] = useState<InviteInfo>();
  useEffect(() => {
    void api.invites.info(code).then(setInfo, () => setInfo({ valid: false }));
  }, [code]);
  const back = encodeURIComponent(`/join/${code}`);
  return (
    <GateFrame>
      {!info ? (
        <span className="muted">Đang mở lời mời…</span>
      ) : !info.valid ? (
        <InviteDead />
      ) : (
        <div className="formcard">
          <InviteCard info={info}>
            <div className="stack" style={{ gap: 10 }}>
              <Link className="p-btn primary block" to={`/signup?invite=${encodeURIComponent(code)}&next=${back}`}>
                Tạo tài khoản để tham gia
              </Link>
              <Link className="p-btn block" to={`/login?next=${back}`}>
                Tôi đã có tài khoản · Đăng nhập
              </Link>
            </div>
          </InviteCard>
          <p className="swap faint">Bạn chưa đăng nhập, nên trang này chỉ hiện tên project và người mời.</p>
        </div>
      )}
    </GateFrame>
  );
}
