import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { setShareToken } from "../../api/client";
import { api } from "../../api/endpoints";

/** /s/:code — a read-only link: keep its token for this browser tab and open the project. */
export function ShareEntry() {
  const { code = "" } = useParams();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setShareToken(code);
    api.auth
      .me()
      .then((me) => window.location.replace(me.project ? `/p/${encodeURIComponent(me.project)}` : "/"))
      .catch(() => {
        setShareToken(null);
        setError("Link không hợp lệ, đã bị thu hồi hoặc đã hết hạn.");
      });
  }, [code]);
  return (
    <div className="login">
      <div className="card">
        <div className="card-body">{error ? <div className="notice error">{error}</div> : <span className="muted">Đang mở project…</span>}</div>
      </div>
    </div>
  );
}
