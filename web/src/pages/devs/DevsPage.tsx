import { useState, type FormEvent } from "react";
import { api } from "../../api/endpoints";
import type { Dev } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useOverview } from "../../hooks/useOverview";
import { PageHead } from "../../components/Layout";
import { Card } from "../../components/Card";
import { Table } from "../../components/Table";
import { Field } from "../../components/Field";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ErrorNotice, Loading } from "../../components/Empty";
import { ago } from "../../lib/format";
import { isLoaded } from "../../api/types";
import { LevelLadder } from "../../components/Member";
import { InviteLink, IssuedToken, forgetIssued, lastIssued, rememberIssued } from "./IssuedToken";

/** The daemon talks to the server constantly; seen in the last 5 minutes = connected. */
const online = (at: string | null) => !!at && Date.now() - new Date(at).getTime() < 5 * 60_000;

export function DevsPage() {
  const { data, error, reload } = usePoll(api.devs.list, [], 10_000);
  const { data: overview } = useOverview();
  const run = useAction();
  const [name, setName] = useState("");
  const [issued, setIssued] = useState(lastIssued());
  const [ack, setAck] = useState(false);
  const [invite, setInvite] = useState<{ name: string; code: string }>();
  // Issuing the first developer ends open dev mode; without an admin token the dashboard then locks.
  // Where each developer works and as what (from each project's members).
  const roles = (dev: string) =>
    (overview?.projects ?? []).filter(isLoaded).flatMap((p) => p.members.filter((m) => m.dev === dev).map((m) => ({ project: p.name, m })));
  const firstInOpenMode = !!overview?.open_mode && (data?.length ?? 0) === 0;

  const inviteDev = async (e: FormEvent) => {
    e.preventDefault();
    await inviteName(name.trim());
  };
  const inviteName = async (who: string) => {
    const res = await run(() => api.devs.invite(who), "Đã tạo lệnh mời");
    if (res) {
      setInvite(res);
      setName("");
    }
  };

  const create = async () => {
    if (!name.trim()) return;
    const res = await run(() => api.devs.issue(name.trim()), "Đã cấp token");
    if (res) {
      rememberIssued(res);
      setIssued(res);
      setName("");
      void reload();
    }
  };

  return (
    <>
      <PageHead title="Developers" />
      <Card title="Mời developer">
        <form className="stack" onSubmit={inviteDev}>
          {firstInOpenMode && (
            <div className="notice error stack tight">
              <b>Server đang ở open dev mode.</b>
              <span>
                Developer đầu tiên nhận token (cấp tay hoặc qua lệnh mời) sẽ tắt open mode. Nếu server chưa đặt <code>GTV_ADMIN_TOKEN</code>, dashboard sẽ khoá
                và cần admin token để vào lại.
              </span>
              <label className="row small">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Tôi hiểu, server đã có GTV_ADMIN_TOKEN
              </label>
            </div>
          )}
          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Tên developer">
              <input className="input" required pattern="[a-zA-Z0-9._\-]{1,40}" value={name} onChange={(e) => setName(e.target.value)} placeholder="alice" />
            </Field>
            <button className="btn primary" type="submit" disabled={firstInOpenMode && !ack}>
              Tạo lệnh mời
            </button>
            <button className="btn" type="button" disabled={firstInOpenMode && !ack} onClick={() => void create()}>
              Chỉ cấp token
            </button>
          </div>
        </form>
        {invite && (
          <div style={{ marginTop: 16 }}>
            <InviteLink {...invite} onDismiss={() => setInvite(undefined)} />
          </div>
        )}
        {issued && (
          <div style={{ marginTop: 16 }}>
            <IssuedToken
              {...issued}
              onDismiss={() => {
                forgetIssued();
                setIssued(undefined);
              }}
            />
          </div>
        )}
      </Card>
      {error && !data && <ErrorNotice error={error} />}
      <Card title="Danh sách" flush>
        {!data ? (
          <Loading />
        ) : (
          <Table<Dev>
            rows={data}
            rowKey={(d) => d.name}
            empty="Chưa có developer nào."
            columns={[
              {
                key: "n",
                title: "Tên",
                render: (d) => (
                  <span className="row" style={{ gap: 8 }}>
                    <span
                      className={`dot${online(d.last_seen) ? " on" : ""}`}
                      title={online(d.last_seen) ? "Daemon đang kết nối" : "Chưa thấy kết nối gần đây"}
                    />
                    <b>{d.name}</b>
                  </span>
                ),
              },
              {
                key: "p",
                title: "Project · vai trò",
                render: (d) => (
                  <div className="stack tight" style={{ gap: 4 }}>
                    {roles(d.name).map(({ project, m }) => (
                      <span key={project} className="row" style={{ gap: 8 }}>
                        <span className="small">
                          <b>{project}</b> · {m.role}
                        </span>
                        <LevelLadder level={m.level} />
                      </span>
                    ))}
                    {roles(d.name).length === 0 && <span className="xs faint">chưa thuộc project nào</span>}
                  </div>
                ),
              },
              { key: "s", title: "Kết nối lần cuối", render: (d) => <span className="xs muted">{d.last_seen ? ago(d.last_seen) : "chưa bao giờ"}</span> },
              { key: "c", title: "Thêm vào", render: (d) => <span className="xs muted">{ago(d.created_at)}</span> },
              {
                key: "a",
                title: "",
                render: (d) => (
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button
                      className="btn sm"
                      type="button"
                      onClick={() => void inviteName(d.name)}
                      title="Tạo lệnh mời mới cho máy khác hoặc khi mất token. Token cũ sẽ hết hiệu lực khi lệnh được dùng."
                    >
                      Mời lại
                    </button>
                    <ConfirmButton
                      onConfirm={async () => {
                        await run(() => api.devs.remove(d.name), "Đã xoá");
                        void reload();
                      }}
                    >
                      Xoá
                    </ConfirmButton>
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
