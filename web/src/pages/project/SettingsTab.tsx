import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/endpoints";
import { useAction } from "../../hooks/useToast";
import { useOverview } from "../../hooks/useOverview";
import { useProject } from "./ProjectLayout";
import { Card } from "../../components/Card";
import { Field } from "../../components/Field";
import { ConfirmButton } from "../../components/ConfirmButton";

/** "name: glob, glob" per line ⇄ { name: [glob, glob] } */
const modulesToText = (m: Record<string, string[]>) =>
  Object.entries(m)
    .map(([k, v]) => `${k}: ${v.join(", ")}`)
    .join("\n");
function textToModules(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const globs = line
      .slice(i + 1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (globs.length) out[line.slice(0, i).trim()] = globs;
  }
  return out;
}

export function SettingsTab() {
  const { id, detail, reload } = useProject();
  const { data: overview, reload: reloadOverview } = useOverview();
  const run = useAction();
  const navigate = useNavigate();
  const r = detail.record;
  const [f, setF] = useState({
    name: r.name,
    description: r.description ?? "",
    main_branch: r.main_branch,
    aliases: r.aliases.join(", "),
    critical: r.policy.critical_paths.join("\n"),
    modules: modulesToText(r.policy.modules),
  });
  const [note, setNote] = useState({ to_dev: "", body: "" });
  const [syncing, setSyncing] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    await run(
      () =>
        api.projects.update(id, {
          name: f.name.trim(),
          description: f.description.trim(),
          main_branch: f.main_branch.trim(),
          aliases: f.aliases
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          policy: {
            critical_paths: f.critical
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            modules: textToModules(f.modules),
          },
        }),
      "Đã lưu cài đặt",
    );
    void reload();
    void reloadOverview();
  };

  const devs = [...new Set([...(overview?.devs.map((d) => d.name) ?? []), ...detail.people.map((p) => p.dev)])];

  return (
    <div className="stack">
      <Card title="Project">
        <form className="stack" onSubmit={save}>
          <div className="form-grid">
            <Field label="Tên hiển thị">
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Nhánh chính">
              <input className="input mono" value={f.main_branch} onChange={(e) => setF({ ...f, main_branch: e.target.value })} />
            </Field>
            <Field label="Aliases" hint="remote khác trỏ về repo này (dấu phẩy)">
              <input className="input mono" value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} />
            </Field>
            <Field label="Mô tả">
              <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Critical paths" hint="mỗi dòng một glob — hai người cùng chạm → conflict CRITICAL">
              <textarea
                className="textarea"
                rows={5}
                value={f.critical}
                onChange={(e) => setF({ ...f, critical: e.target.value })}
                placeholder={"**/migrations/**\npackage-lock.json"}
              />
            </Field>
            <Field label="Modules" hint="mỗi dòng “tên: glob, glob” — dùng cho L0 cùng module">
              <textarea
                className="textarea"
                rows={5}
                value={f.modules}
                onChange={(e) => setF({ ...f, modules: e.target.value })}
                placeholder={"auth: src/app/routes/auth/**\narticles: src/app/routes/article/**"}
              />
            </Field>
          </div>
          <div className="row">
            <button className="btn primary" type="submit">
              Lưu
            </button>
            <span className="xs faint mono wrap-anywhere">repo: {detail.repo_url}</span>
          </div>
        </form>
      </Card>

      <div className="split">
        <Card title="Gửi ghi chú cho developer">
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => api.projects.message(id, note.to_dev, note.body), "Đã gửi — agent nhận ở lần gọi tool kế tiếp");
              if (ok) setNote({ ...note, body: "" });
            }}
          >
            <Field label="Tới">
              <input className="input" list="gtv-devs" required value={note.to_dev} onChange={(e) => setNote({ ...note, to_dev: e.target.value })} />
              <datalist id="gtv-devs">
                {devs.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
            <Field label="Nội dung">
              <textarea
                className="textarea"
                style={{ fontFamily: "var(--font)" }}
                required
                value={note.body}
                onChange={(e) => setNote({ ...note, body: e.target.value })}
                placeholder="Ví dụ: đừng đổi chữ ký AuthService.login trước thứ Sáu"
              />
            </Field>
            <div>
              <button className="btn" type="submit">
                Gửi
              </button>
            </div>
          </form>
        </Card>

        <Card title="Vận hành">
          <div className="stack">
            <div className="row between">
              <span className="small">Đồng bộ ngay: fetch repo, cập nhật main, code graph và tài liệu.</span>
              <button
                className="btn"
                type="button"
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true);
                  await run(() => api.projects.sync(id), "Đã đồng bộ");
                  setSyncing(false);
                  void reload();
                }}
              >
                {syncing ? "Đang sync…" : "Sync now"}
              </button>
            </div>
            <hr className="sep" style={{ margin: 0 }} />
            <div className="row between">
              <span className="small">Lưu trữ project: dừng theo dõi repo (dữ liệu vẫn giữ trên server).</span>
              <ConfirmButton
                onConfirm={async () => {
                  const ok = await run(() => api.projects.archive(id), "Đã lưu trữ project");
                  if (ok) {
                    void reloadOverview();
                    navigate("/");
                  }
                }}
              >
                Lưu trữ
              </ConfirmButton>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
