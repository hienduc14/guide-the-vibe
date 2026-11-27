// Popups opened from the rail, home and Máy của tôi: create a project, connect a computer.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Link2, Lock, X } from "lucide-react";
import { api } from "../../api/endpoints";
import { useAuth } from "../../hooks/useAuth";
import { useOverview } from "../../hooks/useOverview";
import { Modal } from "../../components/ui";
import { CopyLine } from "../project/SettingsSections";

type RepoCheck = { state: "idle" } | { state: "wait" } | { state: "ok"; branch: string | null } | { state: "bad"; error: string };

/** Tạo project: name, repo URL that must pass "Kiểm tra" first, main branch, description. The server picks the id from the name. */
export function CreateProjectModal({ repo, onClose }: { repo?: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { reload } = useOverview();
  const fromRepo = repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : "";
  const [f, setF] = useState({
    name: fromRepo ? fromRepo.split("/")[1] : "",
    url: fromRepo ? `https://github.com/${fromRepo}.git` : "",
    branch: "",
    description: "",
  });
  const [check, setCheck] = useState<RepoCheck>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ id: string; name: string }>();
  const runCheck = async () => {
    if (!f.url.trim()) return setCheck({ state: "bad", error: "Dán URL repo trước." });
    setCheck({ state: "wait" });
    const r = await api.projects.checkRepo(f.url.trim()).catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (r.ok) {
      setCheck({ state: "ok", branch: r.default_branch });
      if (!f.branch && r.default_branch) setF((x) => ({ ...x, branch: r.default_branch! }));
    } else setCheck({ state: "bad", error: r.error });
  };
  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const p = await api.projects.create({
        name: f.name.trim(),
        repo_url: f.url.trim(),
        main_branch: f.branch.trim() || undefined,
        description: f.description.trim() || undefined,
      });
      await refresh();
      void reload();
      setDone({ id: p.id, name: p.name ?? f.name.trim() });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  if (done) {
    const to = `/p/${encodeURIComponent(done.id)}`;
    return (
      <Modal
        title="Tạo project"
        onClose={onClose}
        foot={
          <>
            <button type="button" className="p-btn quiet" onClick={() => navigate(to)}>
              Mở project
            </button>
            <button type="button" className="p-btn primary" onClick={() => navigate(`${to}/settings/members?invite=1`)}>
              <Link2 size={15} />
              Mời thành viên
            </button>
          </>
        }
      >
        <div className="created">
          <span className="big-ok">
            <Check />
          </span>
          <div>
            <b>Đã tạo {done.name}</b>
            <small>Bạn là Quản lý của project này.</small>
          </div>
        </div>
        <ul className="next-steps">
          <li>Gửi link mời cho nhóm: bấm Mời thành viên bên dưới.</li>
          <li>
            Mỗi người chạy <span className="mono">gtv on</span> trong bản clone của repo.
          </li>
          <li>
            Máy chưa có gtv: chạy <span className="mono">npx guide-the-vibe</span> rồi <span className="mono">gtv login</span> trước.
          </li>
        </ul>
      </Modal>
    );
  }
  return (
    <Modal
      title="Tạo project"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="p-btn quiet" onClick={onClose}>
            Huỷ
          </button>
          <button
            type="submit"
            form="np-form"
            className="p-btn primary"
            disabled={check.state !== "ok" || busy || !f.name.trim()}
            title={check.state !== "ok" ? "Bấm Kiểm tra repo trước" : undefined}
          >
            Tạo project
          </button>
        </>
      }
    >
      <form
        id="np-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        {error && (
          <div className="note warn" role="alert" style={{ marginBottom: 14 }}>
            <X />
            <span>{error}</span>
          </div>
        )}
        <div className="formgrid">
          <label className="wide">
            Tên project
            <input className="p-input" value={f.name} placeholder="Realworld API" required autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="wide">
            <span>URL repo</span>
            <div className="repo-check">
              <input
                className="p-input mono"
                value={f.url}
                placeholder="https://github.com/owner/repo.git"
                required
                spellCheck={false}
                onChange={(e) => {
                  setF({ ...f, url: e.target.value });
                  setCheck({ state: "idle" });
                }}
              />
              <button type="button" className="p-btn" onClick={() => void runCheck()} disabled={check.state === "wait"}>
                Kiểm tra
              </button>
            </div>
            <CheckLine check={check} />
          </label>
          <label>
            Nhánh chính
            <input className="p-input mono" value={f.branch} placeholder="main" onChange={(e) => setF({ ...f, branch: e.target.value })} />
          </label>
          <label>
            <span>
              Mô tả <span className="faint">(không bắt buộc)</span>
            </span>
            <input className="p-input" value={f.description} placeholder="API cho môn INT3507" onChange={(e) => setF({ ...f, description: e.target.value })} />
          </label>
        </div>
      </form>
    </Modal>
  );
}

function CheckLine({ check }: { check: RepoCheck }) {
  if (check.state === "wait")
    return (
      <div className="check-line wait">
        <span className="spin" />
        Đang đọc repo…
      </div>
    );
  if (check.state === "ok")
    return (
      <div className="check-line ok">
        <Check />
        Đọc được
        {check.branch ? (
          <>
            {" "}
            · nhánh mặc định <b className="mono">{check.branch}</b>
          </>
        ) : (
          ""
        )}
      </div>
    );
  if (check.state === "bad") {
    const address = /repo address/.test(check.error);
    return (
      <div className="check-line err">
        {address ? <X /> : <Lock />}
        {address ? (
          <span>
            gtv chỉ nhận repo qua <span className="mono">https://</span> hoặc <span className="mono">git@host:owner/repo</span>, không nhận đường dẫn trên máy,
            localhost hay mạng nội bộ.
          </span>
        ) : /cannot read/.test(check.error) ? (
          <span>
            Không đọc được repo này. Repo riêng tư thì dán URL có token chỉ đọc: <span className="mono">https://&lt;token&gt;@github.com/owner/repo.git</span>
          </span>
        ) : (
          <span>{check.error}</span>
        )}
      </div>
    );
  }
  return null;
}

/** Kết nối máy mới: the three commands, run on the computer to connect. */
export function ConnectGuideModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Kết nối một máy"
      sub="Làm trên máy muốn kết nối. Một lần cho mỗi máy, dùng được ở mọi project của bạn."
      onClose={onClose}
      foot={
        <button type="button" className="p-btn" onClick={onClose}>
          Đóng
        </button>
      }
    >
      <ol className="steps">
        <li>
          <div>
            Cài lệnh <span className="mono">gtv</span>
            <small>Cần Node.js 20 trở lên.</small>
            <CopyLine text="npx guide-the-vibe" />
          </div>
        </li>
        <li>
          <div>
            Đăng nhập trên máy đó
            <small>gtv mở trình duyệt tới trang duyệt máy; bấm Cho phép.</small>
            <CopyLine text={`gtv login ${window.location.host}`} />
          </div>
        </li>
        <li>
          <div>
            Bật trong repo của project
            <small>Cài cho Claude Code và Codex trên máy, không đụng tới git của nhóm.</small>
            <CopyLine text="gtv on" />
          </div>
        </li>
      </ol>
    </Modal>
  );
}
