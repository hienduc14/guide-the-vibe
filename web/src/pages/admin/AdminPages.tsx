// Quản trị server (admins only): Tài khoản (admin toggle, lock, reset link, delete), Đăng ký (who may sign up),
// AI trả lời (the brain settings page).

import { useState } from "react";
import { AlertTriangle, Check, Info, KeyRound, Lock, Search, ShieldCheck, Sparkles, Trash2, Users } from "lucide-react";
import { api } from "../../api/endpoints";
import type { Registration } from "../../api/types";
import { useAuth } from "../../hooks/useAuth";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { SimpleTop } from "../../components/ui";
import { initials } from "../../lib/people";
import { ago } from "../../lib/format";
import { CopyLine } from "../project/SettingsSections";
import { BrainPage } from "../brain/BrainPage";

const ADMIN_TABS: [string, string, typeof Users][] = [
  ["/admin", "Tài khoản", Users],
  ["/admin/registration", "Đăng ký", KeyRound],
  ["/admin/ai", "AI trả lời", Sparkles],
];
const REG_WORD: Record<Registration, string> = { open: "mở", invite: "chỉ khi có link mời", closed: "đóng" };

function AdminFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="pj">
      <SimpleTop title="Quản trị server" icon={ShieldCheck} tabs={ADMIN_TABS} />
      <main className="screen">{children}</main>
    </div>
  );
}

export function AdminUsersPage() {
  const { me } = useAuth();
  const run = useAction();
  const { data: users, reload } = usePoll(api.admin.users, [], 30_000);
  const { data: settings } = usePoll(api.admin.settings, [], 60_000);
  const [q, setQ] = useState("");
  const [reset, setReset] = useState<{ name: string; url: string }>();
  const [removing, setRemoving] = useState<string>();
  const list = users ?? [];
  const query = q.trim().toLowerCase();
  const rows = list.filter((u) => !query || u.name.includes(query) || u.display_name.toLowerCase().includes(query));
  const admins = list.filter((u) => u.role === "admin" && !u.disabled).length;
  const act = async (fn: () => Promise<unknown>, done: string) => (await run(fn, done)) !== undefined && reload();
  return (
    <AdminFrame>
      <div className="page stack">
        <div className="head" style={{ margin: 0 }}>
          <div>
            <h1>Tài khoản</h1>
            <p className="lead kpis">
              <span>
                <b>{list.length}</b> tài khoản
              </span>
              <span>
                <b>{admins}</b> quản trị
              </span>
              <span>
                <b>{list.filter((u) => u.disabled).length}</b> đã khoá
              </span>
              {settings && (
                <span>
                  Đăng ký: <b>{REG_WORD[settings.registration]}</b>
                </span>
              )}
            </p>
          </div>
          <div className="tools">
            <label className="hrow" style={{ gap: 6 }}>
              <Search size={16} />
              <input
                className="p-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm người"
                style={{ width: 200 }}
                aria-label="Tìm người"
              />
            </label>
          </div>
        </div>
        <div className="panel pad">
          <div className="tbl-wrap">
            <table className="tbl users">
              <thead>
                <tr>
                  <th>Người</th>
                  <th>Quản trị</th>
                  <th className="num">Project</th>
                  <th className="num">Máy</th>
                  <th>Thấy lần cuối</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const lastAdmin = u.role === "admin" && admins === 1 && !u.disabled;
                  const self = u.name === me?.name;
                  return [
                    <tr key={u.name} className={u.disabled ? "locked" : ""}>
                      <td>
                        <div className="hrow" style={{ gap: 10, flexWrap: "nowrap" }}>
                          <span className="av">{initials(u.display_name)}</span>
                          <div>
                            <b>{u.display_name}</b>
                            <div className="mono faint" style={{ fontSize: 12 }}>
                              {u.name}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          className="switch"
                          checked={u.role === "admin"}
                          disabled={lastAdmin}
                          title={lastAdmin ? "Server cần ít nhất một quản trị" : undefined}
                          aria-label={`Quản trị: ${u.display_name}`}
                          onChange={(e) =>
                            void act(
                              () => api.admin.update(u.name, { role: e.target.checked ? "admin" : "member" }),
                              e.target.checked ? `${u.name} giờ là quản trị` : `${u.name} thôi làm quản trị`,
                            )
                          }
                        />
                      </td>
                      <td className="num">{u.projects}</td>
                      <td className="num">{u.devices}</td>
                      <td>
                        {u.disabled ? (
                          <span className="p-chip warn">
                            <Lock size={12} />
                            đã khoá
                          </span>
                        ) : (
                          ago(u.last_seen ?? u.last_login)
                        )}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          className="p-btn sm"
                          onClick={async () => {
                            if (reset?.name === u.name) return setReset(undefined);
                            const r = await run(() => api.admin.reset(u.name));
                            if (r) setReset({ name: u.name, url: r.reset_url });
                          }}
                        >
                          <KeyRound size={14} />
                          Đặt lại mật khẩu
                        </button>
                        {!self && (
                          <>
                            <button
                              type="button"
                              className="p-btn sm quiet"
                              disabled={lastAdmin}
                              onClick={() =>
                                void act(() => api.admin.update(u.name, { disabled: !u.disabled }), u.disabled ? `Đã mở khoá ${u.name}` : `Đã khoá ${u.name}`)
                              }
                            >
                              {u.disabled ? "Mở khoá" : "Khoá"}
                            </button>
                            <button
                              type="button"
                              className="p-btn sm quiet"
                              disabled={lastAdmin}
                              onClick={() => setRemoving(u.name)}
                              aria-label={`Xoá ${u.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>,
                    reset?.name === u.name && (
                      <tr key={`${u.name}-reset`} className="expand">
                        <td colSpan={6}>
                          <div className="made">
                            <div className="head2">
                              <KeyRound size={16} />
                              Link đặt lại mật khẩu cho {u.name} · dùng một lần, hết hạn sau 1 giờ
                            </div>
                            <CopyLine text={reset.url} />
                            <small className="muted">
                              Gửi cho {u.display_name} qua tin nhắn. Đặt lại xong, các trình duyệt của họ bị đăng xuất; máy vẫn chạy.
                            </small>
                          </div>
                        </td>
                      </tr>
                    ),
                    removing === u.name && (
                      <tr key={`${u.name}-rm`} className="expand">
                        <td colSpan={6}>
                          <div className="confirm" style={{ borderRadius: 10, border: 0 }}>
                            <AlertTriangle size={16} />
                            <span className="grow">
                              Xoá tài khoản <b>{u.name}</b>? Phiên, máy và tư cách thành viên của họ mất hẳn; việc đã làm vẫn giữ tên, và tên này không cấp lại
                              cho ai.
                            </span>
                            <button
                              type="button"
                              className="p-btn sm danger"
                              onClick={async () => {
                                setRemoving(undefined);
                                await act(() => api.admin.remove(u.name), `Đã xoá ${u.name}`);
                              }}
                            >
                              Xoá tài khoản
                            </button>
                            <button type="button" className="p-btn sm quiet" onClick={() => setRemoving(undefined)}>
                              Huỷ
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Khoá: người đó không đăng nhập được và máy của họ bị từ chối; mở khoá là chạy lại như cũ. Quản trị không cần là thành viên project để xem và cứu
          project.
        </p>
      </div>
    </AdminFrame>
  );
}

export function AdminRegistrationPage() {
  const run = useAction();
  const { data, reload } = usePoll(api.admin.settings, [], 60_000);
  const opts: [Registration, string, string][] = [
    ["open", "Mở cho mọi người", "Ai vào trang này cũng tạo được tài khoản và project của riêng mình."],
    ["invite", "Chỉ khi có link mời", "Chỉ người mở link mời vào một project mới tạo được tài khoản."],
    ["closed", "Đóng", "Không ai tạo thêm tài khoản. Người đã có vẫn đăng nhập bình thường."],
  ];
  return (
    <AdminFrame>
      <div className="page stack">
        <div className="head" style={{ margin: 0 }}>
          <div>
            <h1>Ai được tạo tài khoản</h1>
            <p className="lead">Áp dụng ngay cho trang Đăng ký.</p>
          </div>
        </div>
        <div className="presets">
          {opts.map(([k, t, d]) => (
            <button
              key={k}
              type="button"
              className={`preset${data?.registration === k ? " on" : ""}`}
              onClick={async () => (await run(() => api.admin.setRegistration(k), "Đã lưu")) && reload()}
            >
              <b>
                {data?.registration === k && <Check />}
                {t}
              </b>
              <p>{d}</p>
            </button>
          ))}
        </div>
        <div className="note">
          <Info />
          <span>Server chưa gửi được email, nên người quên mật khẩu nhờ quản trị tạo link đặt lại ở tab Tài khoản.</span>
        </div>
      </div>
    </AdminFrame>
  );
}

export function AdminAiPage() {
  return (
    <AdminFrame>
      <div className="main-inner admin-ai">
        <BrainPage />
      </div>
    </AdminFrame>
  );
}
