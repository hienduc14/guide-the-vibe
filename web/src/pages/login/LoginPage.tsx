import { useState, type FormEvent } from "react";
import { useAuth } from "../../hooks/useAuth";
import { Field } from "../../components/Field";
import { BrandMark } from "../../components/Layout";
import { IssuedToken, forgetIssued, lastIssued } from "../devs/IssuedToken";

export function LoginPage() {
  const { login } = useAuth();
  const [token, setToken] = useState("");
  const [issued, setIssued] = useState(lastIssued());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      login(token.trim());
      window.location.reload();
    }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="card-body stack">
          <div className="brand" style={{ padding: 0 }}>
            <BrandMark />
            <span>
              gtv
              <small>Điều phối agent cho cả nhóm</small>
            </span>
          </div>
          <p className="small muted">Dashboard dành cho admin. Nhập admin token của server (biến GTV_ADMIN_TOKEN trong file .env lúc triển khai).</p>
          <Field label="Admin token">
            <input
              id="admin-token"
              className="input mono"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </Field>
          <button className="btn primary" type="submit" disabled={!token.trim()}>
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
