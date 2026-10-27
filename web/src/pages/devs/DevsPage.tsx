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
import { IssuedToken, forgetIssued, lastIssued, rememberIssued } from "./IssuedToken";

export function DevsPage() {
  const { data, error, reload } = usePoll(api.devs.list, [], 10_000);
  const { data: overview } = useOverview();
  const run = useAction();
  const [name, setName] = useState("");
  const [issued, setIssued] = useState(lastIssued());
  const [ack, setAck] = useState(false);
  // Issuing the first developer ends open dev mode; without an admin token the dashboard then locks.
  const firstInOpenMode = !!overview?.open_mode && (data?.length ?? 0) === 0;

  const create = async (e: FormEvent) => {
    e.preventDefault();
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
      <PageHead title="Developers" subtitle="Mỗi developer có một token riêng cho daemon và CLI. Cấp lại token sẽ vô hiệu token cũ." />
      <Card title="Cấp token">
        <form className="stack" onSubmit={create}>
          {firstInOpenMode && (
            <div className="notice error stack tight">
              <b>Server đang ở open dev mode.</b>
              <span>
                Cấp token cho developer đầu tiên sẽ tắt open mode. Nếu server chưa đặt <code>GTV_ADMIN_TOKEN</code>, dashboard sẽ khoá và cần admin token để vào
                lại.
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
              Cấp / cấp lại
            </button>
          </div>
        </form>
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
