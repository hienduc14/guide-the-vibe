import { useState, type FormEvent } from "react";
import { api } from "../../api/endpoints";
import type { BrainProvider } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { Card } from "../../components/Card";
import { Table } from "../../components/Table";
import { Field } from "../../components/Field";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ErrorNotice, Loading } from "../../components/Empty";

type TestResult = { ok: boolean; model?: string; ms: number; detail: string };

/** Connect LLM providers: an API key for one of Pi's built-in providers, or any OpenAI-compatible endpoint. */
export function ProvidersCard({ onChange }: { onChange: () => void }) {
  const { data, error, reload } = usePoll(api.brain.providers, [], 30_000);
  const run = useAction();
  const [tests, setTests] = useState<Record<string, TestResult | "running">>({});
  const [builtin, setBuiltin] = useState({ id: "anthropic", key: "" });
  const [ep, setEp] = useState({ id: "", name: "", base_url: "", api: "openai-completions", key: "" });

  const changed = () => {
    void reload();
    onChange();
  };
  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: "running" }));
    const res = await run(() => api.brain.testProvider(id));
    setTests((t) => ({ ...t, [id]: res ?? { ok: false, ms: 0, detail: "lỗi" } }));
  };
  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.brain.setKey(builtin.id, builtin.key), "Đã lưu key")) {
      setBuiltin({ ...builtin, key: "" });
      changed();
      void test(builtin.id);
    }
  };
  const addEndpoint = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.brain.addEndpoint(ep), "Đã thêm endpoint")) {
      const id = ep.id;
      setEp({ id: "", name: "", base_url: "", api: "openai-completions", key: "" });
      changed();
      void test(id);
    }
  };

  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const connected = data.providers.filter((p) => p.kind === "endpoint" || p.configured);
  const builtins = data.providers.filter((p) => p.kind === "builtin");

  return (
    <Card title="Providers">
      <div className="stack">
        {!data.secrets_encrypted && (
          <div className="notice error">
            <b>GTV_SECRET_KEY chưa đặt:</b> key nhập ở đây được lưu <b>không mã hoá</b> trong hub.db. Đặt <code>GTV_SECRET_KEY</code> (openssl rand -hex 32) rồi
            nhập lại key.
          </div>
        )}
        <Table<BrainProvider>
          rows={connected}
          rowKey={(p) => p.id}
          empty="Chưa kết nối provider nào"
          columns={[
            {
              key: "n",
              title: "Provider",
              render: (p) => (
                <div className="stack tight">
                  <b>{p.name}</b>
                  <span className="xs faint mono">{p.base_url ?? p.id}</span>
                </div>
              ),
            },
            {
              key: "k",
              title: "Loại",
              render: (p) => <span className="badge">{p.kind === "endpoint" ? (p.env ? "endpoint (env)" : "endpoint") : "có sẵn"}</span>,
            },
            {
              key: "s",
              title: "Key",
              render: (p) => (
                <span className="xs mono muted">
                  {p.key_hint ?? ""} {p.source && <span className="faint">({p.source})</span>}
                </span>
              ),
            },
            {
              key: "t",
              title: "Kiểm tra",
              render: (p) => {
                const r = tests[p.id];
                if (r === "running") return <span className="xs muted">đang gọi…</span>;
                if (!r) return null;
                return (
                  <span className={`xs ${r.ok ? "muted" : "danger-text"}`} title={r.model}>
                    {r.ok ? "✓" : "✗"} {r.detail} · {(r.ms / 1000).toFixed(1)} s
                  </span>
                );
              },
            },
            {
              key: "a",
              title: "",
              render: (p) => (
                <div className="row">
                  <button className="btn sm" type="button" onClick={() => void test(p.id)}>
                    Kiểm tra
                  </button>
                  {!p.env && (p.kind === "endpoint" || p.source === "stored credential") && (
                    <ConfirmButton
                      onConfirm={async () => {
                        await run(() => (p.kind === "endpoint" ? api.brain.removeEndpoint(p.id) : api.brain.clearKey(p.id)), "Đã xoá");
                        changed();
                      }}
                    >
                      {p.kind === "endpoint" ? "Xoá" : "Xoá key"}
                    </ConfirmButton>
                  )}
                </div>
              ),
            },
          ]}
        />

        <form className="stack tight" onSubmit={saveKey}>
          <b className="small">Provider có sẵn (API key)</b>
          <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="Provider">
              <select className="select" value={builtin.id} onChange={(e) => setBuiltin({ ...builtin, id: e.target.value })}>
                {builtins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.configured ? " ✓" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="API key" hint="Claude: API key sk-ant-api… hoặc token của claude setup-token (sk-ant-oat…)">
              <input
                className="input mono"
                type="password"
                autoComplete="off"
                required
                value={builtin.key}
                onChange={(e) => setBuiltin({ ...builtin, key: e.target.value })}
              />
            </Field>
            <button className="btn primary" type="submit">
              Lưu key
            </button>
          </div>
        </form>

        <form className="stack tight" onSubmit={addEndpoint}>
          <b className="small">Endpoint tương thích OpenAI (CLIProxyAPI, OpenRouter, LiteLLM, Ollama…)</b>
          <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="Id" hint="dùng trong tên model: <id>/<model>">
              <input
                className="input mono"
                required
                pattern="[a-z0-9][a-z0-9\-]{1,30}"
                placeholder="cliproxy"
                value={ep.id}
                onChange={(e) => setEp({ ...ep, id: e.target.value })}
              />
            </Field>
            <Field label="Tên">
              <input className="input" placeholder="CLIProxyAPI" value={ep.name} onChange={(e) => setEp({ ...ep, name: e.target.value })} />
            </Field>
            <Field label="Base URL">
              <input
                className="input mono"
                required
                type="url"
                placeholder="http://127.0.0.1:8317/v1"
                value={ep.base_url}
                onChange={(e) => setEp({ ...ep, base_url: e.target.value })}
              />
            </Field>
            <Field label="Giao thức">
              <select className="select" value={ep.api} onChange={(e) => setEp({ ...ep, api: e.target.value })}>
                <option value="openai-completions">OpenAI</option>
                <option value="anthropic-messages">Anthropic</option>
              </select>
            </Field>
            <Field label="Key (nếu có)">
              <input className="input mono" type="password" autoComplete="off" value={ep.key} onChange={(e) => setEp({ ...ep, key: e.target.value })} />
            </Field>
            <button className="btn primary" type="submit">
              Thêm endpoint
            </button>
          </div>
        </form>
      </div>
    </Card>
  );
}
