import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/endpoints";
import { Card } from "../../components/Card";
import { Field } from "../../components/Field";
import { useAction } from "../../hooks/useToast";

export function AddProjectForm({ onDone }: { onDone: () => void }) {
  const run = useAction();
  const navigate = useNavigate();
  const [f, setF] = useState({ id: "", name: "", repo_url: "", main_branch: "main", aliases: "", description: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await run(
      () =>
        api.projects.create({
          id: f.id.trim(),
          name: f.name.trim() || undefined,
          repo_url: f.repo_url.trim(),
          main_branch: f.main_branch.trim() || "main",
          aliases: f.aliases.split(",").map((s) => s.trim()).filter(Boolean),
          description: f.description.trim() || undefined,
        }),
      "Đã tạo project",
    );
    setBusy(false);
    if (res) {
      onDone();
      navigate(`/p/${res.id}`);
    }
  };

  return (
    <Card title="Thêm project">
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="ID" hint="chữ thường, số, dấu gạch ngang">
            <input className="input mono" required pattern="[a-z0-9][a-z0-9\-]{1,40}" value={f.id} onChange={set("id")} placeholder="realworld" />
          </Field>
          <Field label="Tên hiển thị">
            <input className="input" value={f.name} onChange={set("name")} placeholder="RealWorld API" />
          </Field>
          <Field label="Repo URL" hint="GitHub URL (có token chỉ-đọc) hoặc đường dẫn bare repo trên server">
            <input className="input mono" required value={f.repo_url} onChange={set("repo_url")} placeholder="https://github.com/org/repo.git" />
          </Field>
          <Field label="Nhánh chính">
            <input className="input mono" value={f.main_branch} onChange={set("main_branch")} />
          </Field>
          <Field label="Aliases" hint="các remote khác trỏ về repo này, cách nhau bằng dấu phẩy">
            <input className="input mono" value={f.aliases} onChange={set("aliases")} placeholder="org/repo" />
          </Field>
          <Field label="Mô tả">
            <input className="input" value={f.description} onChange={set("description")} />
          </Field>
        </div>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Đang tạo… (clone + index)" : "Tạo project"}
          </button>
          <span className="xs faint">Server sẽ clone mirror, dựng code graph và nạp tài liệu.</span>
        </div>
      </form>
    </Card>
  );
}
