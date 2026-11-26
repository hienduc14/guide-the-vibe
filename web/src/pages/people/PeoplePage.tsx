// /people (admins): everyone with an account, their system role, project access, computers and activation state.
// Adding a person makes an account without a password and shows a one-time activation link to send them.

import { Fragment, useState, type FormEvent } from "react";
import { Laptop } from "lucide-react";
import { api } from "../../api/endpoints";
import type { ProjectAccess, Role, User } from "../../api/types";
import { isLoaded } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useOverview } from "../../hooks/useOverview";
import { PageHead } from "../../components/Layout";
import { Card } from "../../components/Card";
import { Field } from "../../components/Field";
import { Badge } from "../../components/Badge";
import { Avatar } from "../../components/Member";
import { CopyCommand } from "../../components/CopyCommand";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ErrorNotice, Loading } from "../../components/Empty";
import { ago } from "../../lib/format";
import { ACCESS_HINT, ACCESS_LABEL } from "../../lib/people";
import { DeviceTable } from "../account/AccountPages";

export const ROLE_LABEL: Record<Role, string> = { admin: "Quản trị", member: "Thường" };
const ROLE_HINT: Record<Role, string> = {
  admin: "Quản lý tài khoản, AI trả lời, thêm và lưu trữ project; quản lý mọi project.",
  member: "Làm những gì quyền trong từng project cho phép.",
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone={role === "admin" ? "solid" : "default"} title={ROLE_HINT[role]}>
      {ROLE_LABEL[role]}
    </Badge>
  );
}

/** The link shown once after creating a person or asking for a new one, with a message ready to send. */
function LinkBox({ name, url, reset, onDismiss }: { name: string; url: string; reset: boolean; onDismiss: () => void }) {
  const message = reset
    ? `Chào ${name}, đây là link đặt lại mật khẩu gtv của bạn (dùng một lần, hết hạn sau 48 giờ): ${url}`
    : `Chào ${name}, mình đã tạo tài khoản gtv cho bạn. Mở link này để đặt mật khẩu (dùng một lần, hết hạn sau 48 giờ), rồi làm theo trang "Kết nối máy của bạn": ${url}`;
  return (
    <div className="notice info stack tight">
      <b>
        {reset ? "Link đặt lại mật khẩu" : "Link kích hoạt"} cho {name}
      </b>
      <span className="small">Chỉ hiện một lần. Gửi riêng cho {name}: ai có link này đều đặt được mật khẩu cho tài khoản.</span>
      <CopyCommand text={url} label="Chép link" />
      <span className="xs muted">Câu gửi mẫu:</span>
      <CopyCommand text={message} label="Chép câu" />
      <div>
        <button className="btn sm ghost" type="button" onClick={onDismiss}>
          Đã gửi, đóng
        </button>
      </div>
    </div>
  );
}

function AddPerson({ onCreated }: { onCreated: (name: string, url: string) => void }) {
  const { data: overview } = useOverview();
  const run = useAction();
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState(false);
  const [access, setAccess] = useState<Record<string, ProjectAccess | "">>({});
  const projects = (overview?.projects ?? []).filter(isLoaded);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const chosen = Object.entries(access).flatMap(([id, a]) => (a ? [{ id, access: a }] : []));
    const res = await run(() => api.users.create({ name: name.trim(), role: admin ? "admin" : "member", projects: chosen }), "Đã tạo tài khoản");
    if (res) {
      onCreated(name.trim(), res.activation_url);
      setName("");
      setAdmin(false);
      setAccess({});
    }
  };
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <div className="row" style={{ alignItems: "flex-end", gap: 16 }}>
        <Field label="Tên" hint="Chữ, số và . _ - ; cũng là tên của người đó trong project.">
          <input className="input" required pattern="[a-zA-Z0-9._\-]{1,40}" value={name} onChange={(e) => setName(e.target.value)} placeholder="khanh" />
        </Field>
        <label className="row small" style={{ paddingBottom: 26 }} title={ROLE_HINT.admin}>
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Quản trị
        </label>
      </div>
      {projects.length > 0 && (
        <div className="stack tight">
          <span className="small muted">Thêm vào project</span>
          {projects.map((p) => (
            <label key={p.id} className="row small" style={{ gap: 10 }}>
              <span style={{ minWidth: 160 }}>{p.name}</span>
              <select
                className="input sm"
                value={access[p.id] ?? ""}
                onChange={(e) => setAccess({ ...access, [p.id]: e.target.value as ProjectAccess | "" })}
                title={access[p.id] ? ACCESS_HINT[access[p.id] as ProjectAccess] : undefined}
              >
                <option value="">Không</option>
                <option value="developer">{ACCESS_LABEL.developer}</option>
                <option value="manager">{ACCESS_LABEL.manager}</option>
                <option value="viewer">{ACCESS_LABEL.viewer}</option>
              </select>
            </label>
          ))}
        </div>
      )}
      <div>
        <button className="btn primary" type="submit" disabled={!name.trim()}>
          Thêm và tạo link kích hoạt
        </button>
      </div>
    </form>
  );
}

export function PeoplePage() {
  const { data, error, reload } = usePoll(api.users.list, [], 15_000);
  const { me } = useAuth();
  const run = useAction();
  const [link, setLink] = useState<{ name: string; url: string; reset: boolean }>();
  const [open, setOpen] = useState<string>();
  const devices = usePoll(() => (open ? api.users.devices(open) : Promise.resolve([])), [open], 15_000);
  const self = (u: User) => me?.kind === "user" && me.name === u.name;

  return (
    <>
      <PageHead title="Người" subtitle="Mỗi người một tài khoản: đăng nhập dashboard, và là danh tính của agent trên máy họ." />
      <Card title="Thêm người">
        {link ? (
          <LinkBox {...link} onDismiss={() => setLink(undefined)} />
        ) : (
          <AddPerson onCreated={(name, url) => (setLink({ name, url, reset: false }), void reload())} />
        )}
      </Card>
      {error && !data && <ErrorNotice error={error} />}
      <Card title="Danh sách" flush>
        {!data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Người</th>
                  <th>Quyền hệ thống</th>
                  <th>Project</th>
                  <th>Máy</th>
                  <th>Thấy lần cuối</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <Fragment key={u.name}>
                    <tr>
                      <td>
                        <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                          <Avatar name={u.name} size={28} />
                          <b>{u.name}</b>
                        </span>
                      </td>
                      <td>
                        <select
                          className="input sm"
                          value={u.role}
                          disabled={self(u)}
                          title={self(u) ? "Không tự hạ quyền của mình được" : ROLE_HINT[u.role]}
                          onChange={async (e) => {
                            await run(() => api.users.setRole(u.name, e.target.value as Role), "Đã đổi quyền");
                            void reload();
                          }}
                        >
                          <option value="member">{ROLE_LABEL.member}</option>
                          <option value="admin">{ROLE_LABEL.admin}</option>
                        </select>
                      </td>
                      <td>
                        <div className="stack tight" style={{ gap: 2 }}>
                          {u.role === "admin" && <span className="xs muted">quản lý mọi project</span>}
                          {u.role !== "admin" &&
                            u.projects.map((p) => (
                              <span key={p.id} className="small" title={ACCESS_HINT[p.access]}>
                                <b>{p.name}</b> · {ACCESS_LABEL[p.access]}
                              </span>
                            ))}
                          {u.role !== "admin" && u.projects.length === 0 && <span className="xs faint">chưa ở project nào</span>}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn sm ghost"
                          disabled={!u.devices}
                          onClick={() => setOpen(open === u.name ? undefined : u.name)}
                          title={u.devices ? "Xem và thu hồi máy" : "Chưa kết nối máy nào"}
                        >
                          <Laptop size={14} /> {u.devices}
                        </button>
                      </td>
                      <td>
                        <span className="xs muted">{u.last_seen ? ago(u.last_seen) : "chưa bao giờ"}</span>
                      </td>
                      <td>
                        {u.activated ? (
                          <Badge tone="ok" title={u.last_login ? `Đăng nhập lần cuối ${ago(u.last_login)}` : undefined}>
                            Đã kích hoạt
                          </Badge>
                        ) : (
                          <Badge tone="warning" title={`Tạo ${ago(u.created_at)}${u.created_by ? ` bởi ${u.created_by}` : ""}`}>
                            Chưa kích hoạt
                          </Badge>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                          <button
                            className="btn sm"
                            type="button"
                            title="Link mới dùng một lần, 48 giờ; link cũ hết hiệu lực"
                            onClick={async () => {
                              const res = await run(() => api.users.activation(u.name), "Đã tạo link mới");
                              if (res) setLink({ name: u.name, url: res.activation_url, reset: u.activated });
                            }}
                          >
                            {u.activated ? "Link đặt lại mật khẩu" : "Link kích hoạt mới"}
                          </button>
                          {!self(u) && (
                            <ConfirmButton
                              confirmLabel="Xoá cả máy và phiên?"
                              onConfirm={async () => {
                                await run(() => api.users.remove(u.name), `Đã xoá ${u.name}`);
                                void reload();
                              }}
                            >
                              Xoá
                            </ConfirmButton>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open === u.name && (
                      <tr>
                        <td colSpan={7} style={{ background: "var(--sunken)" }}>
                          {devices.data ? (
                            <DeviceTable
                              devices={devices.data}
                              onRevoke={async (d) => {
                                await run(() => api.users.revokeDevice(u.name, d.id), `Đã thu hồi ${d.name}`);
                                void devices.reload();
                                void reload();
                              }}
                            />
                          ) : (
                            <Loading />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
