import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../api/endpoints";
import { setShareToken, setToken } from "../../api/client";
import { Field } from "../../components/Field";
import { BrandMark } from "../../components/Layout";

/** The centred card the login, first-admin and activation pages share. */
export function AuthCard({ children, onSubmit }: { children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  return (
    <div className="login">
      <form className="card" onSubmit={onSubmit}>
        <div className="card-body stack">
          <div className="brand" style={{ padding: 0 }}>
            <BrandMark size={36} />
            <span>
              Guide the Vibe
              <small>Điều phối agent cho cả nhóm</small>
            </span>
          </div>
          {children}
        </div>
      </form>
    </div>
  );
}

/** Two password fields that must match (8+ characters). */
export function NewPassword({ value, onChange }: { value: [string, string]; onChange: (v: [string, string]) => void }) {
  const [a, b] = value;
  return (
    <>
      <Field label="Mật khẩu" hint="Ít nhất 8 ký tự.">
        <input className="input" type="password" autoComplete="new-password" minLength={8} required value={a} onChange={(e) => onChange([e.target.value, b])} />
      </Field>
      <Field label="Nhập lại mật khẩu">
        <input className="input" type="password" autoComplete="new-password" required value={b} onChange={(e) => onChange([a, e.target.value])} />
      </Field>
      {b && a !== b && (
        <span className="xs" style={{ color: "var(--high)" }}>
          Hai mật khẩu chưa khớp.
        </span>
      )}
    </>
  );
}
export const passwordOk = ([a, b]: [string, string]) => a.length >= 8 && a === b;

/**
 * Name + password. A server without any account (and without an admin token) shows "create the first admin" instead.
 * Rescue: /#admin-token=<GTV_ADMIN_TOKEN> logs in with the server's admin token (not shown anywhere on purpose).
 */
export function LoginPage({ first = false }: { first?: boolean }) {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pw, setPw] = useState<[string, string]>(["", ""]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const m = /^#admin-token=(.+)$/.exec(window.location.hash);
    if (!m) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    login(decodeURIComponent(m[1]));
    window.location.reload();
  }, [login]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      setToken(null); // stale tokens must not ride along with the login call
      setShareToken(null);
      if (first) {
        const created = await api.users.create({ name: name.trim(), role: "admin", projects: [] });
        const res = await api.auth.activate(created.activation_url.split("/activate/")[1], pw[0]);
        login(res.token);
      } else login((await api.auth.login(name.trim(), password)).token);
      window.location.reload(); // back to the page that asked for a login (e.g. /connect?code=…)
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard onSubmit={(e) => void submit(e)}>
      {first ? (
        <>
          <h2 style={{ margin: 0 }}>Tạo tài khoản quản trị đầu tiên</h2>
          <p className="small muted">Server chưa có tài khoản nào. Tài khoản này quản lý người dùng, project và AI; từ lúc đó dashboard cần đăng nhập.</p>
        </>
      ) : (
        <p className="small muted">Đăng nhập bằng tài khoản của bạn. Chưa có? Nhờ quản trị tạo và gửi link kích hoạt.</p>
      )}
      <Field label="Tên đăng nhập" hint={first ? "Chữ, số và . _ - (tên này cũng là tên của bạn trong các project)." : undefined}>
        <input className="input" autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {first ? (
        <NewPassword value={pw} onChange={setPw} />
      ) : (
        <Field label="Mật khẩu">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      )}
      {error && <div className="notice error">{error}</div>}
      <button className="btn primary" type="submit" disabled={busy || !name.trim() || (first ? !passwordOk(pw) : !password)}>
        {first ? "Tạo và đăng nhập" : "Đăng nhập"}
      </button>
    </AuthCard>
  );
}
