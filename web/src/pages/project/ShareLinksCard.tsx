import { useState, type FormEvent } from "react";
import { api } from "../../api/endpoints";
import type { ShareLink } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { Card } from "../../components/Card";
import { Field } from "../../components/Field";
import { Table } from "../../components/Table";
import { CopyCommand } from "../../components/CopyCommand";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ago } from "../../lib/format";

/** Read-only links for showing the project to people outside the team (a demo, a teacher, a client). */
export function ShareLinksCard({ id }: { id: string }) {
  const links = usePoll(() => api.shareLinks.list(id), [id], 0);
  const run = useAction();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("30");
  const [fresh, setFresh] = useState<string>();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run(() => api.shareLinks.create(id, label.trim(), Number(days) || undefined), "Đã tạo link");
    if (res) {
      setFresh(`${window.location.origin}/s/${res.code}`);
      setLabel("");
      void links.reload();
    }
  };

  return (
    <Card title="Link xem chỉ đọc">
      <div className="stack">
        <form className="row" style={{ alignItems: "flex-end" }} onSubmit={(e) => void create(e)}>
          <Field label="Ghi chú">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="demo cho giảng viên" />
          </Field>
          <Field label="Hết hạn sau">
            <select className="input" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="1">1 ngày</option>
              <option value="7">7 ngày</option>
              <option value="30">30 ngày</option>
              <option value="0">Không hết hạn</option>
            </select>
          </Field>
          <button className="btn primary" type="submit">
            Tạo link
          </button>
        </form>
        {fresh && (
          <div className="notice info stack tight">
            <span className="small">Link chỉ hiện một lần. Sao chép và gửi đi:</span>
            <CopyCommand text={fresh} />
          </div>
        )}
        <Table<ShareLink>
          rows={links.data ?? []}
          rowKey={(l) => l.id}
          empty="Chưa có link nào."
          columns={[
            { key: "l", title: "Ghi chú", render: (l) => l.label ?? <span className="muted">—</span> },
            { key: "c", title: "Tạo", render: (l) => <span className="xs muted">{`${ago(l.created_at)}${l.created_by ? ` bởi ${l.created_by}` : ""}`}</span> },
            {
              key: "e",
              title: "Hết hạn",
              render: (l) => <span className="xs muted">{l.expires_at ? new Date(l.expires_at).toLocaleDateString() : "không"}</span>,
            },
            { key: "u", title: "Mở lần cuối", render: (l) => <span className="xs muted">{l.last_used ? ago(l.last_used) : "chưa"}</span> },
            {
              key: "a",
              title: "",
              render: (l) => (
                <ConfirmButton
                  onConfirm={async () => {
                    await run(() => api.shareLinks.revoke(id, l.id), "Đã thu hồi");
                    void links.reload();
                  }}
                >
                  Thu hồi
                </ConfirmButton>
              ),
            },
          ]}
        />
      </div>
    </Card>
  );
}
