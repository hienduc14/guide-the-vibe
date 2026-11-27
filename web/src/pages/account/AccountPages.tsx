// Pages for one's own account: Hồ sơ và bảo mật (profile, password, sessions, delete), Máy của tôi, accepting an invite
// while logged in, and approving a computer that ran `gtv login`.

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Info, Laptop, Link2, Monitor, Pencil, Plus, User, X } from "lucide-react";
import { api } from "../../api/endpoints";
import type { Device, InviteInfo } from "../../api/types";
import { displayName, useAuth } from "../../hooks/useAuth";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useOverview } from "../../hooks/useOverview";
import { AgentLogo, browserName, osName, PwField, SimpleTop } from "../../components/ui";
import { agentName } from "../../components/Badge";
import { initials } from "../../lib/people";
import { ago } from "../../lib/format";
import { CopyLine } from "../project/SettingsSections";
import { ConnectGuideModal } from "../home/Popups";
import { InviteCard, InviteDead } from "../auth/GatePages";

const date = (iso: string) => new Date(iso).toLocaleDateString("vi-VN");

// ---- /account ----------------------------------------------------------------------------------

export function AccountPage() {
  const { me, refresh, logout } = useAuth();
  const run = useAction();
  const [display, setDisplay] = useState(me?.display_name ?? "");
  const [pw, setPw] = useState({ cur: "", a: "", b: "" });
  const [del, setDel] = useState<string>();
  const { data: sessions, reload } = usePoll(api.account.sessions, [], 30_000);
  const sole = (me?.projects ?? []).filter((p) => p.access === "manager");
  const { data: soleProjects } = usePoll(
    async () => {
      const out: string[] = [];
      for (const p of sole) {
        const members = await api.members.list(p.id).catch(() => []);
        if (members.filter((m) => m.access === "manager").length === 1) out.push(p.name);
      }
      return out;
    },
    [sole.map((p) => p.id).join(",")],
    60_000,
  );
  useEffect(() => setDisplay(me?.display_name ?? ""), [me?.display_name]);
  if (!me) return null;
  const blocked = soleProjects ?? [];
  return (
    <div className="pj">
      <SimpleTop title="Tài khoản của tôi" icon={User} />
      <main className="screen">
        <div className="page narrow stack">
          <form
            className="panel pad"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.account.update(display), "Đã lưu hồ sơ")) void refresh();
            }}
          >
            <h2>Hồ sơ</h2>
            <p className="lede">Tên hiển thị là thứ mọi người thấy. Tên đăng nhập gắn với mọi việc bạn đã làm nên không đổi được.</p>
            <div className="hrow" style={{ alignItems: "flex-start", gap: 18 }}>
              <span className="av lg">{initials(displayName(me))}</span>
              <div className="formgrid grow">
                <label>
                  Tên hiển thị
                  <input className="p-input" value={display} onChange={(e) => setDisplay(e.target.value)} />
                </label>
                <label>
                  Tên đăng nhập
                  <input className="p-input mono" value={me.name} readOnly />
                  <small>{me.role === "admin" ? "Quản trị server" : "Người dùng"}</small>
                </label>
              </div>
            </div>
            <div className="acts">
              <button className="p-btn primary" disabled={!display.trim() || display === me.display_name}>
                Lưu
              </button>
            </div>
          </form>

          <form
            className="panel pad"
            onSubmit={async (e) => {
              e.preventDefault();
              if (pw.a !== pw.b) return void run(async () => Promise.reject(new Error("Hai mật khẩu mới không giống nhau")));
              if (await run(() => api.account.changePassword(pw.cur, pw.a), "Đã đổi mật khẩu. Các trình duyệt khác đã bị đăng xuất")) {
                setPw({ cur: "", a: "", b: "" });
                void reload();
              }
            }}
          >
            <h2>Mật khẩu</h2>
            <p className="lede">Đổi mật khẩu sẽ đăng xuất các trình duyệt khác. Máy đã kết nối vẫn chạy.</p>
            <div className="formgrid">
              <PwField label="Mật khẩu hiện tại" value={pw.cur} onChange={(cur) => setPw({ ...pw, cur })} />
              <span />
              <PwField label="Mật khẩu mới" auto="new-password" hint="Ít nhất 8 ký tự." value={pw.a} onChange={(a) => setPw({ ...pw, a })} />
              <PwField label="Nhập lại" auto="new-password" value={pw.b} onChange={(b) => setPw({ ...pw, b })} />
            </div>
            <div className="acts">
              <button className="p-btn primary">Đổi mật khẩu</button>
            </div>
          </form>

          <div className="panel pad">
            <div className="hrow">
              <div className="grow">
                <h2>Phiên đăng nhập</h2>
                <p className="lede" style={{ marginBottom: 8 }}>
                  Các trình duyệt đang đăng nhập bằng tài khoản này.
                </p>
              </div>
              {(sessions?.length ?? 0) > 1 && (
                <button
                  type="button"
                  className="p-btn"
                  onClick={async () => (await run(api.account.endOtherSessions, "Đã đăng xuất các trình duyệt khác")) && reload()}
                >
                  Đăng xuất mọi nơi khác
                </button>
              )}
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Trình duyệt</th>
                    <th>Địa chỉ</th>
                    <th>Lần dùng cuối</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sessions?.map((s) => (
                    <tr key={s.id}>
                      <td>{browserName(s.user_agent)}</td>
                      <td className="mono">{s.ip ?? "—"}</td>
                      <td>{s.current ? <span className="p-chip ok">phiên này</span> : ago(s.last_used)}</td>
                      <td style={{ textAlign: "right" }}>
                        {!s.current && (
                          <button
                            type="button"
                            className="p-btn sm"
                            onClick={async () => (await run(() => api.account.endSession(s.id), "Đã đăng xuất phiên đó")) && reload()}
                          >
                            Đăng xuất
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel pad">
            <h2>Xoá tài khoản</h2>
            <p className="lede">
              Xoá phiên, máy và tư cách thành viên của bạn. Việc đã làm vẫn giữ tên <span className="mono">{me.name}</span>, và tên này không cấp lại cho ai.
            </p>
            {blocked.length > 0 ? (
              <div className="note warn">
                <AlertTriangle />
                <span>
                  Bạn đang là <b>Quản lý duy nhất</b> của <b>{blocked.join(", ")}</b>. Nâng một thành viên khác lên Quản lý, hoặc lưu trữ project, rồi mới xoá
                  được tài khoản.
                </span>
              </div>
            ) : (
              del !== undefined && (
                <div className="formgrid">
                  <PwField label="Nhập mật khẩu để xoá" value={del} onChange={setDel} />
                </div>
              )
            )}
            <div className="acts">
              {del === undefined ? (
                <button type="button" className="p-btn danger" disabled={blocked.length > 0} onClick={() => setDel("")}>
                  Xoá tài khoản
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="p-btn danger"
                    disabled={!del}
                    onClick={async () => {
                      if (await run(() => api.account.remove(del), "Đã xoá tài khoản")) void logout();
                    }}
                  >
                    Xoá vĩnh viễn
                  </button>
                  <button type="button" className="p-btn quiet" onClick={() => setDel(undefined)}>
                    Huỷ
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ---- /account/devices ----------------------------------------------------------------------------

function DeviceCard({ d, reload }: { d: Device; reload: () => void }) {
  const run = useAction();
  const [name, setName] = useState<string>();
  const [unplug, setUnplug] = useState(false);
  const Icon = d.platform === "win32" ? Monitor : Laptop;
  return (
    <div className="panel dev">
      <div className="dev-h">
        <span className="ic">
          <Icon />
        </span>
        {name !== undefined ? (
          <form
            className="rename"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.account.renameDevice(d.id, name), "Đã đổi tên máy")) {
                setName(undefined);
                reload();
              }
            }}
          >
            <input className="p-input mono" value={name} onChange={(e) => setName(e.target.value)} aria-label="Tên máy" autoFocus />
            <button className="p-btn sm primary">Lưu</button>
            <button type="button" className="p-btn sm quiet" onClick={() => setName(undefined)}>
              Huỷ
            </button>
          </form>
        ) : (
          <div>
            <b>{d.name}</b>
            <small>
              {osName(d.platform)}
              {d.gtv_version ? ` · gtv ${d.gtv_version}` : ""} · kết nối từ {date(d.created_at)}
            </small>
          </div>
        )}
        <div className="acts">
          <span className={`state${d.online ? " running" : ""}`}>{d.online ? "đang kết nối" : d.last_seen ? `thấy ${ago(d.last_seen)}` : "chưa thấy"}</span>
          <button type="button" className="p-btn sm quiet" onClick={() => setName(d.name)}>
            <Pencil size={14} />
            Đổi tên
          </button>
          <button type="button" className="p-btn sm danger" onClick={() => setUnplug(true)}>
            Ngắt
          </button>
        </div>
      </div>
      {unplug && (
        <div className="confirm">
          <AlertTriangle />
          <span className="grow">
            Ngắt <b>{d.name}</b>? Khoá của máy bị thu hồi ngay. Agent trên máy đó thôi báo cho gtv tới khi bạn chạy lại <span className="mono">gtv login</span>.
          </span>
          <button
            type="button"
            className="p-btn sm danger"
            onClick={async () => {
              if (await run(() => api.account.revokeDevice(d.id), `Đã ngắt ${d.name}`)) reload();
            }}
          >
            Ngắt máy
          </button>
          <button type="button" className="p-btn sm quiet" onClick={() => setUnplug(false)}>
            Huỷ
          </button>
        </div>
      )}
      {d.reported_at ? (
        <div className="dev-b">
          <div className="agentlist">
            <span className="sect" style={{ marginRight: 4 }}>
              Agent trên máy
            </span>
            {d.agents.length ? (
              d.agents.map((a) => (
                <span key={a.kind} className="agentchip">
                  <AgentLogo kind={a.kind} />
                  {agentName(a.kind)}
                  {a.version && <span className="v">{a.version}</span>}
                </span>
              ))
            ) : (
              <span className="agentchip off">chưa thấy Claude Code hay Codex</span>
            )}
          </div>
          {d.repos.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Repo đã bật</th>
                    <th>Project</th>
                    <th>Agent</th>
                    <th>Bây giờ</th>
                  </tr>
                </thead>
                <tbody>
                  {d.repos.map((r) => (
                    <tr key={r.path}>
                      <td className="mono">{r.path}</td>
                      <td>
                        {r.project_name ? (
                          <Link to={`/p/${encodeURIComponent(r.project)}`}>{r.project_name}</Link>
                        ) : (
                          <span className="faint">không còn ở project này</span>
                        )}
                      </td>
                      <td>
                        <span className="logos">
                          {r.agents.map((k) => (
                            <AgentLogo key={k} kind={k} />
                          ))}
                        </span>
                      </td>
                      <td>
                        {r.sessions.length ? (
                          <span className="state running">
                            {r.sessions.length} phiên {[...new Set(r.sessions.map((s) => agentName(s.agent)))].join(", ")} đang chạy
                          </span>
                        ) : (
                          <span className="faint">không có phiên</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              Chưa bật repo nào. Chạy <span className="mono">gtv on</span> trong bản clone của một project.
            </p>
          )}
        </div>
      ) : (
        <div className="dev-b">
          <div className="note">
            <Info />
            <span>
              Máy này chạy bản gtv cũ, chưa gửi danh sách agent và repo. Cập nhật trên máy đó: <span className="mono">npx guide-the-vibe@latest</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function DevicesPage() {
  const { data, reload } = usePoll(api.account.devices, [], 15_000);
  const [guide, setGuide] = useState(false);
  return (
    <div className="pj">
      <SimpleTop title="Máy của tôi" icon={Laptop} />
      <main className="screen">
        <div className="page stack">
          <div className="head" style={{ margin: 0 }}>
            <div>
              <h1>Máy của tôi</h1>
              <p className="lead">Mỗi máy có một khoá riêng, dùng được ở mọi project bạn tham gia. Vào project mới không cần kết nối lại.</p>
            </div>
            <div className="tools">
              <button type="button" className="p-btn primary" onClick={() => setGuide(true)}>
                <Plus size={16} />
                Kết nối máy mới
              </button>
            </div>
          </div>
          {data && data.length === 0 && (
            <div className="panel p-empty">
              <b>Chưa có máy nào</b>Bấm Kết nối máy mới để bắt đầu.
            </div>
          )}
          {data?.map((d) => (
            <DeviceCard key={d.id} d={d} reload={() => void reload()} />
          ))}
        </div>
      </main>
      {guide && <ConnectGuideModal onClose={() => setGuide(false)} />}
    </div>
  );
}

// ---- /join/:code (logged in) ------------------------------------------------------------------------

export function JoinPage() {
  const { code = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { reload } = useOverview();
  const run = useAction();
  const [info, setInfo] = useState<InviteInfo>();
  const [joined, setJoined] = useState<{ id: string; name: string; access: string }>();
  const { data: devices } = usePoll(api.account.devices, [], 60_000);
  useEffect(() => {
    void api.invites.info(code).then(setInfo, () => setInfo({ valid: false }));
  }, [code]);
  const accept = async () => {
    const r = await run(() => api.invites.accept(code));
    if (!r) return;
    await refresh();
    void reload();
    setJoined({ ...r.project, access: r.access });
  };
  const fresh = params.get("joined") === "1" && info?.valid && info.member;
  const done = joined ?? (fresh && info?.valid && info.project_id ? { id: info.project_id, name: info.project_name, access: info.access } : undefined);
  const online = devices?.find((d) => d.online) ?? devices?.[0];
  return (
    <div className="pj">
      <SimpleTop title="Lời mời" icon={Link2} />
      <main className="screen">
        <div className="page narrow">
          {!info ? (
            <span className="muted">Đang mở lời mời…</span>
          ) : done ? (
            <div className="invite">
              <div className="big-ok">
                <Check />
              </div>
              <div>
                <h1 style={{ fontSize: 22 }}>Bạn đã vào {done.name}</h1>
                <p className="muted">Quyền {done.access === "viewer" ? "Người xem" : "Developer"}. Mọi người trong project đã thấy bạn.</p>
              </div>
              {done.access !== "viewer" && (
                <>
                  <div className="note accent">
                    <Laptop />
                    <span>
                      {online ? (
                        <>
                          Máy <b>{online.name}</b> của bạn đã kết nối. Mở terminal trong bản clone của repo và chạy:
                        </>
                      ) : (
                        <>
                          Bật gtv trên máy của bạn: <span className="mono">npx guide-the-vibe</span>,{" "}
                          <span className="mono">gtv login {window.location.host}</span>, rồi trong bản clone của repo:
                        </>
                      )}
                    </span>
                  </div>
                  <CopyLine text="gtv on" />
                  <p className="muted" style={{ fontSize: 13 }}>
                    Máy khác chưa kết nối? <Link to="/account/devices">Xem cách kết nối máy</Link>.
                  </p>
                </>
              )}
              <div className="hrow">
                <Link className="p-btn primary" to={`/p/${encodeURIComponent(done.id)}`}>
                  Mở project
                </Link>
              </div>
            </div>
          ) : !info.valid ? (
            <InviteDead />
          ) : info.member ? (
            <div className="invite">
              <div className="big-ok">
                <Check />
              </div>
              <div>
                <h1 style={{ fontSize: 22 }}>Bạn đã ở {info.project_name}</h1>
                <p className="muted">Quyền hiện có của bạn giữ nguyên.</p>
              </div>
              <div className="hrow">
                <Link className="p-btn primary" to={`/p/${encodeURIComponent(info.project_id ?? "")}`}>
                  Mở project
                </Link>
              </div>
            </div>
          ) : (
            <InviteCard info={info}>
              <div className="hrow">
                <button type="button" className="p-btn primary" onClick={() => void accept()}>
                  Tham gia {info.project_name}
                </button>
                <button type="button" className="p-btn quiet" onClick={() => navigate("/")}>
                  Không, cảm ơn
                </button>
              </div>
            </InviteCard>
          )}
        </div>
      </main>
    </div>
  );
}

// ---- /connect?code=… ---------------------------------------------------------------------------

export function ConnectPage() {
  const [params] = useSearchParams();
  const { me } = useAuth();
  const run = useAction();
  const code = (params.get("code") ?? "").toUpperCase();
  const [req, setReq] = useState<{ device_name: string; platform: string; created_at: string } | null>();
  const [result, setResult] = useState<"approve" | "deny">();
  useEffect(() => {
    if (!code) return setReq(null);
    void api.connect.get(code).then(setReq, () => setReq(null));
  }, [code]);
  const decide = async (action: "approve" | "deny") => {
    if (await run(() => api.connect.decide(code, action))) setResult(action);
  };
  return (
    <div className="pj">
      <SimpleTop title="Kết nối máy" icon={Laptop} />
      <main className="screen">
        <div className="page narrow">
          {result === "approve" ? (
            <div className="invite">
              <div className="big-ok">
                <Check />
              </div>
              <div>
                <h1 style={{ fontSize: 22 }}>Đã kết nối {req?.device_name}</h1>
                <p className="muted">
                  Quay lại terminal: gtv đã nhận khoá của máy, bước tiếp là <span className="mono">gtv on</span> trong repo.
                </p>
              </div>
              <CopyLine text="gtv on" />
              <div className="hrow">
                <Link className="p-btn" to="/account/devices">
                  Máy của tôi
                </Link>
              </div>
            </div>
          ) : result === "deny" ? (
            <div className="invite">
              <div className="big-bad">
                <X />
              </div>
              <div>
                <h1 style={{ fontSize: 22 }}>Đã từ chối</h1>
                <p className="muted">
                  Máy đó không vào được tài khoản của bạn. Nếu bạn không chạy <span className="mono">gtv login</span>, có người đang thử: đổi mật khẩu ở trang
                  Tài khoản cho chắc.
                </p>
              </div>
              <div className="hrow">
                <Link className="p-btn" to="/account">
                  Tài khoản
                </Link>
              </div>
            </div>
          ) : req === null ? (
            <div className="invite">
              <div className="big-bad">
                <X />
              </div>
              <div>
                <h1 style={{ fontSize: 22 }}>Mã này không dùng được</h1>
                <p className="muted">
                  Mã sai, đã dùng, hoặc đã quá 10 phút. Chạy lại <span className="mono">gtv login</span> trên máy đó để lấy mã mới.
                </p>
              </div>
            </div>
          ) : req ? (
            <div className="invite">
              <div className="hrow" style={{ gap: 14 }}>
                <span className="dev-h" style={{ padding: 0 }}>
                  <span className="ic">
                    <Monitor />
                  </span>
                </span>
                <div>
                  <b style={{ fontSize: 17 }}>{req.device_name}</b>
                  <div className="muted">
                    {osName(req.platform)} · yêu cầu {ago(req.created_at)}
                  </div>
                </div>
              </div>
              <p>
                Máy này muốn kết nối vào tài khoản <b>{me?.name}</b>. Sau khi cho phép, agent trên máy đó làm việc thay bạn ở mọi project bạn là Developer hoặc
                Quản lý.
              </p>
              <dl>
                <dt>Mã</dt>
                <dd>
                  <span className="mono" style={{ fontSize: 20, letterSpacing: "0.08em" }}>
                    {code}
                  </span>
                  <br />
                  <small className="muted">So với mã đang hiện trong terminal.</small>
                </dd>
              </dl>
              <div className="note warn">
                <AlertTriangle />
                <span>
                  Chỉ cho phép nếu chính bạn vừa chạy <span className="mono">gtv login</span> trên máy đó.
                </span>
              </div>
              <div className="hrow">
                <button type="button" className="p-btn primary" onClick={() => void decide("approve")}>
                  Cho phép
                </button>
                <button type="button" className="p-btn" onClick={() => void decide("deny")}>
                  Từ chối
                </button>
              </div>
            </div>
          ) : (
            <span className="muted">Đang tải…</span>
          )}
        </div>
      </main>
    </div>
  );
}
