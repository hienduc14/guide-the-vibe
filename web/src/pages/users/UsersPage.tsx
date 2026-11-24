import { useState, type FormEvent } from "react";
import { api } from "../../api/endpoints";
import type { Role, User } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { PageHead } from "../../components/Layout";
import { Card } from "../../components/Card";
import { Table } from "../../components/Table";
import { Field } from "../../components/Field";
import { Badge, type BadgeTone } from "../../components/Badge";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ErrorNotice, Loading } from "../../components/Empty";
import { ago } from "../../lib/format";

export const ROLE_INFO: Record<Role, { label: string; tone: BadgeTone; what: string }> = {
  admin: { label: "Admin", tone: "solid", what: "Toàn quyền: Brain, developer, tài khoản, thêm/xoá project." },
  manager: { label: "Manager", tone: "accent", what: "Quản lý nội dung project: giao việc, tiêu chí, thành viên, conflict, lớp phát hiện." },
  viewer: { label: "Chỉ xem", tone: "default", what: "Xem mọi trang, không thay đổi gì." },
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone={ROLE_INFO[role].tone} title={ROLE_INFO[role].what}>
      {ROLE_INFO[role].label}
    </Badge>
  );
}

export function UsersPage() {
  const { data, error, reload } = usePoll(api.users.list, [], 15_000);
  const { me } = useAuth();
  const run = useAction();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("manager");
  const [reset, setReset] = useState<{ name: string; password: string }>();
  const firstAccount = (data?.length ?? 0) === 0 && me?.kind === "open";

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.users.save(name.trim(), { role: firstAccount ? "admin" : role, password }), "Đã tạo tài khoản");
    if (ok) {
      setName("");
      setPassword("");
      void reload();
    }
  };

  return (
    <>
      <PageHead title="Tài khoản" />
      <div className="grid">
        {(["admin", "manager", "viewer"] as Role[]).map((r) => (
          <div key={r} className="card">
            <div className="card-body stack tight" style={{ alignItems: "flex-start" }}>
              <RoleBadge role={r} />
              <span className="small muted">{ROLE_INFO[r].what}</span>
            </div>
          </div>
        ))}
      </div>
      <Card title="Thêm tài khoản">
        <form className="stack" onSubmit={(e) => void create(e)}>
          {firstAccount && (
            <div className="notice">
              Server chưa đặt <code>GTV_ADMIN_TOKEN</code>: tài khoản đầu tiên phải là <b>Admin</b>, và từ lúc đó dashboard cần đăng nhập.
            </div>
          )}
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Tên đăng nhập">
              <input className="input" required pattern="[a-zA-Z0-9._@\-]{1,60}" value={name} onChange={(e) => setName(e.target.value)} placeholder="minh.pm" />
            </Field>
            <Field label="Mật khẩu">
              <input className="input" required minLength={8} type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Vai trò">
              <select className="input" value={firstAccount ? "admin" : role} disabled={firstAccount} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="manager">Manager</option>
                <option value="viewer">Chỉ xem</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <button className="btn primary" type="submit">
              Tạo
            </button>
          </div>
          <p className="xs muted">Mật khẩu ít nhất 8 ký tự. Gửi cho người dùng qua kênh riêng.</p>
        </form>
      </Card>
      {error && !data && <ErrorNotice error={error} />}
      <Card title="Danh sách" flush>
        {!data ? (
          <Loading />
        ) : (
          <Table<User>
            rows={data}
            rowKey={(u) => u.name}
            empty="Chưa có tài khoản nào. Admin token không phải tài khoản nên không nằm trong danh sách này."
            columns={[
              { key: "n", title: "Tên", render: (u) => <b>{u.name}</b> },
              {
                key: "r",
                title: "Vai trò",
                render: (u) => (
                  <select
                    className="input sm"
                    value={u.role}
                    disabled={me?.kind === "user" && me.name === u.name}
                    onChange={async (e) => {
                      await run(() => api.users.save(u.name, { role: e.target.value as Role }), "Đã đổi vai trò");
                      void reload();
                    }}
                  >
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="viewer">Chỉ xem</option>
                  </select>
                ),
              },
              { key: "l", title: "Đăng nhập lần cuối", render: (u) => <span className="xs muted">{u.last_login ? ago(u.last_login) : "chưa bao giờ"}</span> },
              {
                key: "a",
                title: "",
                render: (u) => (
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    {reset?.name === u.name ? (
                      <form
                        className="row"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const ok = await run(() => api.users.save(u.name, { password: reset.password }), "Đã đổi mật khẩu");
                          if (ok) setReset(undefined);
                        }}
                      >
                        <input
                          className="input sm"
                          autoFocus
                          minLength={8}
                          required
                          placeholder="mật khẩu mới"
                          value={reset.password}
                          onChange={(e) => setReset({ name: u.name, password: e.target.value })}
                        />
                        <button className="btn sm primary" type="submit">
                          Lưu
                        </button>
                        <button className="btn sm ghost" type="button" onClick={() => setReset(undefined)}>
                          Huỷ
                        </button>
                      </form>
                    ) : (
                      <button className="btn sm" type="button" onClick={() => setReset({ name: u.name, password: "" })}>
                        Đổi mật khẩu
                      </button>
                    )}
                    {!(me?.kind === "user" && me.name === u.name) && (
                      <ConfirmButton
                        onConfirm={async () => {
                          await run(() => api.users.remove(u.name), "Đã xoá");
                          void reload();
                        }}
                      >
                        Xoá
                      </ConfirmButton>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
