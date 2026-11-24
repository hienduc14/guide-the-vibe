import { useState, type FormEvent } from "react";
import { api } from "../../api/endpoints";
import type { Member, MemberLevel, Person } from "../../api/types";
import { useAction } from "../../hooks/useToast";
import { useOverview } from "../../hooks/useOverview";
import { useAuth } from "../../hooks/useAuth";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { Field } from "../../components/Field";
import { StatusBadge, AgentBadge } from "../../components/Badge";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Avatar, LEVELS, LEVEL_LABEL, LevelLadder, ROLE_SUGGESTIONS } from "../../components/Member";
import { ago } from "../../lib/format";

function MemberCard({ m, person, onSaved }: { m: Member; person?: Person; onSaved: () => void }) {
  const { id } = useProject();
  const { can } = useAuth();
  const run = useAction();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ role: m.role, level: m.level, note: m.note ?? "" });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.members.save(id, m.dev, { role: f.role.trim(), level: f.level, note: f.note.trim() }), "Đã lưu");
    if (ok) {
      setEdit(false);
      onSaved();
    }
  };
  return (
    <article className="member">
      <div className="member-head">
        <Avatar name={m.dev} size={40} />
        <div className="stack tight" style={{ minWidth: 0, gap: 2 }}>
          <b className="truncate">{m.dev}</b>
          <span className="member-role">{m.role}</span>
        </div>
        <span className="spacer" />
        {person ? <StatusBadge status={person.status} /> : <StatusBadge status="ended" />}
      </div>
      <LevelLadder level={m.level} />
      {m.note && <p className="small muted">{m.note}</p>}
      <div className="member-now">
        {person && person.tasks.length > 0 ? (
          person.tasks.map((t) => (
            <span key={t} className="small">
              Đang làm: <b>{t}</b>
            </span>
          ))
        ) : (
          <span className="xs faint">Không có việc đang làm</span>
        )}
        {person && person.agents.length > 0 && (
          <span className="row" style={{ gap: 4 }}>
            {person.agents.map((a) => (
              <AgentBadge key={a} agent={a} />
            ))}
          </span>
        )}
        {person && person.conflicts > 0 && <span className="xs danger-text">{person.conflicts} conflict đang mở</span>}
        <span className="xs faint">{person ? `hoạt động ${ago(person.last_seen)}` : "chưa mở phiên agent nào"}</span>
      </div>
      {can("manager") &&
        (edit ? (
          <form className="stack tight" onSubmit={(e) => void save(e)}>
            <Field label="Vai trò">
              <input className="input" list="gtv-roles" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
            </Field>
            <Field label="Level">
              <select className="input" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as MemberLevel })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ghi chú">
              <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="phụ trách thanh toán" />
            </Field>
            <div className="row">
              <button className="btn sm primary" type="submit">
                Lưu
              </button>
              <button className="btn sm ghost" type="button" onClick={() => setEdit(false)}>
                Huỷ
              </button>
              <span className="spacer" />
              <ConfirmButton
                onConfirm={async () => {
                  await run(() => api.members.remove(id, m.dev), "Đã xoá khỏi project");
                  onSaved();
                }}
              >
                Xoá
              </ConfirmButton>
            </div>
          </form>
        ) : (
          <button className="btn sm" type="button" onClick={() => setEdit(true)} style={{ alignSelf: "flex-start" }}>
            Sửa
          </button>
        ))}
    </article>
  );
}

export function MembersTab() {
  const { id, detail, reload } = useProject();
  const { data: overview } = useOverview();
  const { can } = useAuth();
  const run = useAction();
  const [add, setAdd] = useState({ dev: "", role: "", level: "mid" as MemberLevel });
  const people = new Map(detail.people.map((p) => [p.dev, p]));
  // Most senior first, then by name: the order a newcomer would want to meet the team in.
  const members = [...detail.members].sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || a.dev.localeCompare(b.dev));
  const roles = [...new Set(members.map((m) => m.role))];
  const candidates = (overview?.devs ?? []).map((d) => d.name).filter((n) => !detail.members.some((m) => m.dev === n));

  return (
    <div className="stack">
      <div className="summary">
        <span className="chip">
          <b>{members.length}</b> thành viên
        </span>
        {roles.map((r) => (
          <span key={r} className="chip">
            <b>{members.filter((m) => m.role === r).length}</b> {r}
          </span>
        ))}
      </div>
      <datalist id="gtv-roles">
        {ROLE_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      {members.length === 0 ? (
        <Card>
          <div className="empty">
            <b>Chưa có thành viên</b>
            Dev tự thành thành viên khi mở agent lần đầu trong repo. Manager có thể thêm trước ở dưới.
          </div>
        </Card>
      ) : (
        <div className="members">
          {members.map((m) => (
            <MemberCard key={m.dev} m={m} person={people.get(m.dev)} onSaved={() => void reload()} />
          ))}
        </div>
      )}
      {can("manager") && (
        <Card
          title={
            <div>
              <h3>Thêm thành viên</h3>
              <div className="sub">Level chỉ dùng để phân xử khi hai việc cùng độ ưu tiên đụng nhau; độ ưu tiên của việc luôn quyết định trước.</div>
            </div>
          }
        >
          <form
            className="row"
            style={{ alignItems: "flex-end" }}
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => api.members.save(id, add.dev.trim(), { role: add.role.trim() || undefined, level: add.level }), "Đã thêm");
              if (ok) {
                setAdd({ dev: "", role: "", level: "mid" });
                void reload();
              }
            }}
          >
            <Field label="Developer">
              <input className="input" list="gtv-member-devs" required value={add.dev} onChange={(e) => setAdd({ ...add, dev: e.target.value })} />
              <datalist id="gtv-member-devs">
                {candidates.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
            <Field label="Vai trò">
              <input className="input" list="gtv-roles" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })} placeholder="backend" />
            </Field>
            <Field label="Level">
              <select className="input" value={add.level} onChange={(e) => setAdd({ ...add, level: e.target.value as MemberLevel })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn primary" type="submit">
              Thêm
            </button>
          </form>
        </Card>
      )}
    </div>
  );
}
