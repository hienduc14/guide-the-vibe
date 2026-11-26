// A person's own pages: activating the account (public link from the admin), approving a computer that ran
// `gtv login` (/connect), and "my account" (/me): how to connect a computer, the computers connected, the password.

import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Laptop, ShieldCheck } from "lucide-react";
import { api } from "../../api/endpoints";
import { setShareToken, setToken } from "../../api/client";
import type { Device } from "../../api/types";
import { useAuth } from "../../hooks/useAuth";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { PageHead } from "../../components/Layout";
import { Card } from "../../components/Card";
import { Table } from "../../components/Table";
import { Field } from "../../components/Field";
import { CopyCommand } from "../../components/CopyCommand";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ErrorNotice, Loading } from "../../components/Empty";
import { ago } from "../../lib/format";
import { ACCESS_LABEL } from "../../lib/people";
import { AuthCard, NewPassword, passwordOk } from "../login/LoginPage";
import { RoleBadge } from "../people/PeoplePage";

const PLATFORM: Record<string, string> = { linux: "Linux", darwin: "macOS", win32: "Windows", unknown: "không rõ" };
export const platformName = (p: string) => PLATFORM[p] ?? p;

/** /activate/:code (public): set the first password, or a new one after a reset, and log in. */
export function ActivatePage() {
  const { code = "" } = useParams();
  const [info, setInfo] = useState<{ user: string; kind: "activate" | "reset" }>();
  const [error, setError] = useState<string>();
  const [pw, setPw] = useState<[string, string]>(["", ""]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setShareToken(null);
    api.auth
      .activation(code)
      .then(setInfo)
      .catch((e: Error) => setError(e.message.includes("invalid") ? "Link không hợp lệ, đã dùng hoặc đã hết hạn. Nhờ quản trị gửi link mới." : e.message));
  }, [code]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.auth.activate(code, pw[0]);
      setToken(res.token);
      window.location.href = "/me";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <AuthCard onSubmit={(e) => void submit(e)}>
      {!info && !error && <Loading />}
      {error && <div className="notice error">{error}</div>}
      {info && (
        <>
          <h2 style={{ margin: 0 }}>
            Chào {info.user}, {info.kind === "activate" ? "đặt mật khẩu để bắt đầu" : "đặt mật khẩu mới"}
          </h2>
          <p className="small muted">Tên đăng nhập của bạn là {info.user}. Quản trị không biết mật khẩu này.</p>
          <NewPassword value={pw} onChange={setPw} />
          <button className="btn primary" type="submit" disabled={busy || !passwordOk(pw)}>
            {info.kind === "activate" ? "Kích hoạt và đăng nhập" : "Lưu và đăng nhập"}
          </button>
        </>
      )}
    </AuthCard>
  );
}

/** /connect?code=…: a computer ran `gtv login` and waits; the person logged in here lets it in (or not). */
export function ConnectPage() {
  const { me } = useAuth();
  const run = useAction();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [req, setReq] = useState<{ device_name: string; platform: string }>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<"approve" | "deny">();
  const clean = code.trim().toUpperCase();
  const complete = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean);
  useEffect(() => {
    setReq(undefined);
    setError(undefined);
    if (!complete) return;
    api.connect
      .get(clean)
      .then(setReq)
      .catch(() => setError("Không thấy mã này, hoặc mã đã hết hạn (10 phút). Chạy lại gtv login trên máy của bạn."));
  }, [clean, complete]);

  const decide = async (action: "approve" | "deny") => {
    if (await run(() => api.connect.decide(clean, action), action === "approve" ? "Đã cho phép" : "Đã từ chối")) setDone(action);
  };

  return (
    <>
      <PageHead title="Kết nối máy" subtitle="Máy của bạn vừa chạy gtv login và đang chờ ở đây." />
      <Card>
        <div className="stack" style={{ maxWidth: 560 }}>
          {me && me.kind !== "user" ? (
            <div className="notice">Đăng xuất rồi đăng nhập bằng tài khoản của bạn: máy sẽ được gắn vào tài khoản đang đăng nhập.</div>
          ) : done ? (
            <div className={`notice ${done === "approve" ? "info" : ""} notice-row`}>
              <Laptop />
              <span>
                {done === "approve" ? (
                  <>
                    Máy <b>{req?.device_name}</b> đã kết nối vào tài khoản <b>{me?.name}</b>. Quay lại terminal, rồi chạy <code>gtv on</code> trong repo.
                  </>
                ) : (
                  "Đã từ chối. Máy kia không nhận được gì."
                )}
              </span>
            </div>
          ) : (
            <>
              <Field label="Mã trên terminal">
                <input
                  className="input mono"
                  style={{ maxWidth: 200, letterSpacing: "0.08em" }}
                  placeholder="KQ7M-2XPD"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus={!code}
                />
              </Field>
              {error && <ErrorNotice error={error} />}
              {req && (
                <>
                  <p style={{ margin: 0 }}>
                    Máy <b>{req.device_name}</b> ({platformName(req.platform)}) muốn kết nối vào tài khoản <b>{me?.name}</b>.
                  </p>
                  <p className="small muted" style={{ margin: 0 }}>
                    Chỉ cho phép nếu bạn vừa chạy gtv login trên máy của mình.
                  </p>
                  <div className="row">
                    <button className="btn primary" type="button" onClick={() => void decide("approve")}>
                      Cho phép
                    </button>
                    <button className="btn" type="button" onClick={() => void decide("deny")}>
                      Từ chối
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </Card>
    </>
  );
}

function ChangePassword() {
  const run = useAction();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState<[string, string]>(["", ""]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run(() => api.auth.changePassword(current, pw[0]), "Đã đổi mật khẩu");
    if (res) {
      setToken(res.token); // the other sessions are logged out; this one carries on
      setCurrent("");
      setPw(["", ""]);
    }
  };
  return (
    <form className="stack" style={{ maxWidth: 360 }} onSubmit={(e) => void submit(e)}>
      <Field label="Mật khẩu hiện tại">
        <input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <NewPassword value={pw} onChange={setPw} />
      <div>
        <button className="btn primary" type="submit" disabled={!current || !passwordOk(pw)}>
          Đổi mật khẩu
        </button>
      </div>
      <p className="xs muted" style={{ margin: 0 }}>
        Các phiên đăng nhập khác của bạn sẽ bị đăng xuất. Máy đã kết nối vẫn chạy.
      </p>
    </form>
  );
}

/** Computers connected to an account, with "revoke". */
export function DeviceTable({ devices, onRevoke }: { devices: Device[]; onRevoke: (d: Device) => void }) {
  return (
    <Table<Device>
      rows={devices}
      rowKey={(d) => d.id}
      empty="Chưa có máy nào. Làm theo 3 bước ở trên."
      columns={[
        {
          key: "n",
          title: "Máy",
          render: (d) => (
            <span className="row" style={{ gap: 8 }}>
              <Laptop size={16} />
              <b>{d.name}</b>
            </span>
          ),
        },
        { key: "p", title: "Hệ điều hành", render: (d) => <span className="small">{platformName(d.platform)}</span> },
        { key: "s", title: "Thấy lần cuối", render: (d) => <span className="xs muted">{d.last_seen ? ago(d.last_seen) : "chưa bao giờ"}</span> },
        { key: "c", title: "Kết nối", render: (d) => <span className="xs muted">{ago(d.created_at)}</span> },
        {
          key: "a",
          title: "",
          render: (d) => (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <ConfirmButton onConfirm={() => onRevoke(d)}>Thu hồi</ConfirmButton>
            </div>
          ),
        },
      ]}
    />
  );
}

/** /me: connect a computer in three commands, the computers connected, the password. */
export function AccountPage() {
  const { me } = useAuth();
  const run = useAction();
  const own = me?.kind === "user";
  const { data, error, reload } = usePoll(api.auth.devices, [], 15_000);
  if (!me) return <Loading />;
  return (
    <>
      <PageHead
        title={
          <span className="row" style={{ gap: 10 }}>
            Tài khoản của tôi <RoleBadge role={me.role} />
          </span>
        }
        subtitle={own ? `Bạn đăng nhập là ${me.name}. Agent trên máy bạn kết nối cũng làm việc dưới tên này.` : undefined}
      />
      {!own && <div className="notice">Đang dùng khoá quản trị của server, không phải tài khoản: trang này chỉ dành cho tài khoản.</div>}
      {own && (
        <>
          <Card title="Kết nối máy của bạn">
            <div className="stack" style={{ maxWidth: 640 }}>
              {[
                ["Cài lệnh gtv (cần Node.js 20 trở lên). Chạy lại lệnh này để cập nhật.", "npx guide-the-vibe"],
                ["Đăng nhập: trình duyệt mở trang xác nhận, bấm Cho phép.", `gtv login ${window.location.origin}`],
                ["Trong thư mục repo của project, bật gtv cho agent (Claude Code, Codex).", "gtv on"],
              ].map(([what, cmd], n) => (
                <div key={cmd} className="stack tight">
                  <span>
                    <b>{n + 1}.</b> {what}
                  </span>
                  <CopyCommand text={cmd} />
                </div>
              ))}
            </div>
            {me.projects.length === 0 && (
              <p className="small muted" style={{ marginBottom: 0 }}>
                Bạn chưa ở project nào: <code>gtv on</code> sẽ báo lỗi cho tới khi một người quản lý thêm bạn.
              </p>
            )}
          </Card>
          <Card title="Máy đã kết nối" flush>
            {error && !data && <ErrorNotice error={error} />}
            {!data ? (
              <Loading />
            ) : (
              <DeviceTable
                devices={data}
                onRevoke={async (d) => {
                  await run(() => api.auth.revokeDevice(d.id), `Đã thu hồi ${d.name}`);
                  void reload();
                }}
              />
            )}
          </Card>
          <Card title="Project của tôi">
            {me.projects.length ? (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {me.projects.map((p) => (
                  <Link key={p.id} to={`/p/${p.id}`} className="chip">
                    <b>{p.name}</b> {ACCESS_LABEL[p.access]}
                  </Link>
                ))}
              </div>
            ) : (
              <span className="small muted">Bạn chưa ở project nào. Nhờ quản trị thêm bạn.</span>
            )}
          </Card>
          <Card
            title={
              <h3 className="row" style={{ gap: 8 }}>
                <ShieldCheck size={16} /> Đổi mật khẩu
              </h3>
            }
          >
            <ChangePassword />
          </Card>
        </>
      )}
    </>
  );
}
