import { useToast } from "../../hooks/useToast";

const KEY = "gtv.lastIssued";

/** The last issued token survives a switch to the login screen (issuing the first dev ends open mode). */
export function rememberIssued(v: { name: string; token: string }): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // storage unavailable
  }
}

export function lastIssued(): { name: string; token: string } | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { name: string; token: string }) : undefined;
  } catch {
    return undefined;
  }
}

export function forgetIssued(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

export function IssuedToken({ name, token, onDismiss }: { name: string; token: string; onDismiss?: () => void }) {
  const toast = useToast();
  const cmd = `node bin/gtv.mjs init --dev ${name} --server ${window.location.origin} --token ${token}`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Đã copy");
    } catch {
      toast("Không copy được — hãy chọn và copy tay", true);
    }
  };
  return (
    <div className="notice stack tight">
      <div className="row between">
        <b className="small">Token của {name} — chỉ hiện một lần</b>
        {onDismiss && (
          <button className="btn sm ghost" type="button" onClick={onDismiss}>
            Đã lưu, ẩn đi
          </button>
        )}
      </div>
      <div className="row">
        <code className="wrap-anywhere" style={{ flex: 1 }}>
          {token}
        </code>
        <button className="btn sm" type="button" onClick={() => copy(token)}>
          Copy
        </button>
      </div>
      <span className="xs muted">Trên máy của {name}:</span>
      <div className="row">
        <code className="xs wrap-anywhere" style={{ flex: 1 }}>
          {cmd}
        </code>
        <button className="btn sm" type="button" onClick={() => copy(cmd)}>
          Copy
        </button>
      </div>
    </div>
  );
}
