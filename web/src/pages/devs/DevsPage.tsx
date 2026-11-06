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
import { InviteLink, IssuedToken, forgetIssued, lastIssued, rememberIssued } from "./IssuedToken";

export function DevsPage() {
  const { data, error, reload } = usePoll(api.devs.list, [], 10_000);
  const { data: overview } = useOverview();
  const run = useAction();
  const [name, setName] = useState("");
  const [issued, setIssued] = useState(lastIssued());
  const [ack, setAck] = useState(false);
  const [invite, setInvite] = useState<{ name: string; code: string }>();
  // Issuing the first developer ends open dev mode; without an admin token the dashboard then locks.
  const firstInOpenMode = !!overview?.open_mode && (data?.length ?? 0) === 0;

  const inviteDev = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run(() => api.devs.invite(name.trim()), "Đã tạo lệnh mời");
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
      <PageHead title="Developers" subtitle="Mời developer bằng một lệnh npx. Mỗi developer có một token riêng; cấp lại token sẽ vô hiệu token cũ." />
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
            empty="Chưa có developer — server đang ở open dev mode (tin header X-Gtv-Dev)"
            columns={[
              { key: "n", title: "Tên", render: (d) => <b>{d.name}</b> },
              { key: "c", title: "Tạo", render: (d) => <span className="xs muted">{ago(d.created_at)}</span> },
              { key: "s", title: "Hoạt động", render: (d) => <span className="xs muted">{ago(d.last_seen)}</span> },
              {
                key: "a",
                title: "",
                render: (d) => (
                  <ConfirmButton
                    onConfirm={async () => {
                      await run(() => api.devs.remove(d.name), "Đã xoá");
                      void reload();
                    }}
                  >
                    Xoá
                  </ConfirmButton>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
