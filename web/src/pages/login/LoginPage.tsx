import { useState, type FormEvent } from "react";
import { useAuth } from "../../hooks/useAuth";
import { Field } from "../../components/Field";
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
        <div className="card-head">
          <div className="brand" style={{ padding: 0 }}>
            <span className="brand-mark">g</span>
            <span>gtv Operator</span>
          </div>
        </div>
        <div className="card-body stack">
          <p className="small muted">Dashboard cần admin token (biến môi trường GTV_ADMIN_TOKEN của server).</p>
          <Field label="Admin token">
            <input className="input mono" type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••••••" />
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
