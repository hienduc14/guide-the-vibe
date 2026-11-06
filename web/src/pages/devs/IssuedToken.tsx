import { CopyCommand } from "../../components/CopyCommand";

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
  const cmd = `npx guide-the-vibe init --dev ${name} --server ${window.location.origin} --token ${token} && npx guide-the-vibe install`;
  return (
    <div className="notice warn stack tight">
      <div className="row between">
        <b className="small">Token của {name}: chỉ hiện một lần, hãy lưu lại</b>
        {onDismiss && (
          <button className="btn sm ghost" type="button" onClick={onDismiss}>
            Đã lưu, ẩn đi
          </button>
        )}
      </div>
      <CopyCommand text={token} />
      <span className="xs muted">Hoặc gửi {name} lệnh này, chạy trong thư mục repo:</span>
      <CopyCommand text={cmd} />
    </div>
  );
}

/** The one-time `gtv join` command for an invite. */
export function InviteLink({ name, code, onDismiss }: { name: string; code: string; onDismiss: () => void }) {
  return (
    <div className="notice info stack tight">
      <div className="row between">
        <b className="small">Gửi lệnh này cho {name}</b>
        <button className="btn sm ghost" type="button" onClick={onDismiss}>
          Ẩn
        </button>
      </div>
      <CopyCommand text={`npx guide-the-vibe join ${window.location.origin}/j/${code}`} />
      <span className="xs muted">{name} chạy lệnh trong thư mục repo đã clone (cần Node.js 20 trở lên). Lệnh dùng được một lần và hết hạn sau 24 giờ.</span>
    </div>
  );
}
