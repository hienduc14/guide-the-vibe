import { useState, type FormEvent } from "react";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../api/endpoints";
import { setToken } from "../../api/client";
import { Field } from "../../components/Field";
import { BrandMark } from "../../components/Layout";
import { Segmented } from "../../components/Segmented";
import { IssuedToken, forgetIssued, lastIssued } from "../devs/IssuedToken";

type Mode = "account" | "token";

export function LoginPage() {
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>("account");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [token, setTok] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(lastIssued());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (mode === "token") {
      if (!token.trim()) return;
      login(token.trim());
      window.location.reload();
      return;
    }
    setBusy(true);
    try {
      setToken(null); // a stale token must not ride along with the login call
      const res = await api.auth.login(name.trim(), password);
      login(res.token);
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={(e) => void submit(e)}>
        <div className="card-body stack">
          <div className="brand" style={{ padding: 0 }}>
            <BrandMark />
            <span>
              gtv
              <small>Điều phối agent cho cả nhóm</small>
            </span>
          </div>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "account", label: "Tài khoản" },
              { value: "token", label: "Admin token" },
            ]}
          />
          {mode === "account" ? (
            <>
              <p className="small muted">Đăng nhập bằng tài khoản admin tạo cho bạn (manager hoặc chỉ xem).</p>
              <Field label="Tên đăng nhập">
                <input className="input" autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Mật khẩu">
                <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <p className="small muted">Admin token của server (biến GTV_ADMIN_TOKEN trong file .env lúc triển khai).</p>
              <Field label="Admin token">
                <input
                  id="admin-token"
                  className="input mono"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={token}
                  onChange={(e) => setTok(e.target.value)}
                />
              </Field>
            </>
          )}
          {error && <div className="notice error">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy || (mode === "token" ? !token.trim() : !name.trim() || !password)}>
            Đăng nhập
          </button>
          {issued && (
            <IssuedToken
              {...issued}
              onDismiss={() => {
                forgetIssued();
                setIssued(undefined);
              }}
            />
          )}
        </div>
      </form>
    </div>
  );
}
