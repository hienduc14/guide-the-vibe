import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../../api/endpoints";
import type { BrainProvider, OAuthSession } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction, useToast } from "../../hooks/useToast";
import { Field } from "../../components/Field";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ErrorNotice, Loading } from "../../components/Empty";

type TestResult = { ok: boolean; model?: string; ms: number; detail: string };

/** Logo tile colour + monogram, and a one-line "what you get" per provider we know. */
const BRAND: Record<string, { color: string; mark?: string; blurb?: string }> = {
  anthropic: { color: "#c15f3c", mark: "A", blurb: "Claude. Đăng nhập gói Pro/Max hoặc dùng API key." },
  "openai-codex": { color: "#10a37f", mark: "C", blurb: "Gói ChatGPT Plus/Pro qua Codex." },
  "openai-chatgpt": { color: "#10a37f", mark: "G", blurb: "Gói ChatGPT." },
  openai: { color: "#10a37f", mark: "O", blurb: "GPT qua API key của OpenAI." },
  "github-copilot": { color: "#24292f", mark: "GH", blurb: "Gói GitHub Copilot: Claude, GPT, Gemini." },
  antigravity: { color: "#3b6fe0", mark: "AG", blurb: "Google Antigravity: Gemini và Claude bằng tài khoản Google." },
  "google-antigravity": { color: "#3b6fe0", mark: "AG", blurb: "Google Antigravity: Gemini và Claude bằng tài khoản Google." },
  google: { color: "#3b6fe0", mark: "G", blurb: "Gemini qua API key của Google AI Studio." },
  openrouter: { color: "#6467f2", mark: "OR", blurb: "Hàng trăm model qua một key." },
  xai: { color: "#1f2328", mark: "x", blurb: "Grok." },
  "kimi-coding": { color: "#1e6fff", mark: "K", blurb: "Kimi cho lập trình." },
  meta: { color: "#0866ff", mark: "M", blurb: "Llama qua Meta." },
  groq: { color: "#f55036", mark: "gq", blurb: "Model mở, phản hồi rất nhanh." },
  deepseek: { color: "#4d6bfe", mark: "DS", blurb: "DeepSeek, rẻ." },
  mistral: { color: "#fa520f", mark: "Mi", blurb: "Mistral." },
  cerebras: { color: "#f15a29", mark: "Ce" },
};

/** Account logins worth a tile; the rest go in a picker. Blurbs differ from the API-key ones on purpose. */
const OAUTH_FEATURED: Record<string, { name: string; blurb: string }> = {
  anthropic: { name: "Claude Pro/Max", blurb: "Dùng gói Claude bạn đang trả tiền." },
  "openai-codex": { name: "ChatGPT Plus/Pro (Codex)", blurb: "Dùng gói ChatGPT đang trả tiền, qua cùng cổng với Codex CLI." },
  "github-copilot": { name: "GitHub Copilot", blurb: "Claude, GPT và Gemini trong gói Copilot." },
  antigravity: { name: "Antigravity", blurb: "Gemini và Claude bằng tài khoản Google. Google có thể khoá tài khoản dùng cách này." },
  openai: { name: "ChatGPT (trình duyệt)", blurb: "Đăng nhập tài khoản ChatGPT trên web, không cần gói Codex." },
  xai: { name: "Grok", blurb: "Gói Grok trên X." },
};

const POPULAR_KEYS = ["anthropic", "openai", "google", "openrouter", "xai", "groq", "deepseek", "mistral"];

/** Routers that already hold logins for many accounts; gtv talks to them like any OpenAI-compatible API. */
const ROUTERS = [
  {
    id: "cliproxy",
    name: "CLIProxyAPI",
    base_url: "http://127.0.0.1:8317/v1",
    color: "#4b5a6b",
    blurb: "Gemini CLI, Antigravity, Claude Code, Codex qua một proxy.",
  },
  {
    id: "9router",
    name: "9router",
    base_url: "http://localhost:20128/v1",
    color: "#7c3aed",
    blurb: "Router có dashboard, nhiều tài khoản, tự chuyển khi hết hạn mức.",
  },
  { id: "litellm", name: "LiteLLM", base_url: "http://localhost:4000/v1", color: "#2b6cb0", blurb: "Proxy cho hơn 100 provider." },
  { id: "ollama", name: "Ollama", base_url: "http://localhost:11434/v1", color: "#3a3f45", blurb: "Model chạy trên máy của bạn." },
];

/** Real logos (public/providers, see SOURCE.txt there); providers without one keep the coloured monogram. */
const LOGO: Record<string, string> = {
  anthropic: "claude-color",
  "openai-codex": "codex-color",
  "openai-chatgpt": "openai",
  openai: "openai",
  "github-copilot": "githubcopilot",
  antigravity: "antigravity-color",
  "google-antigravity": "antigravity-color",
  google: "gemini-color",
  openrouter: "openrouter",
  xai: "xai",
  "kimi-coding": "kimi-color",
  meta: "meta-color",
  groq: "groq",
  deepseek: "deepseek-color",
  mistral: "mistral-color",
  cerebras: "cerebras-color",
  ollama: "ollama",
};

function Logo({ id, name, color }: { id: string; name: string; color?: string }) {
  const b = BRAND[id];
  const file = LOGO[id];
  if (file)
    return (
      <span className="logo real" aria-hidden="true">
        <img src={`/providers/${file}.svg`} alt="" width={22} height={22} />
      </span>
    );
  const mark = b?.mark ?? name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  return (
    <span className="logo" style={{ ["--logo" as string]: color ?? b?.color ?? "#5b6875" }} aria-hidden="true">
      {mark}
    </span>
  );
}

function Tile({
  id,
  name,
  color,
  blurb,
  children,
  connected,
}: {
  id: string;
  name: string;
  color?: string;
  blurb?: ReactNode;
  children: ReactNode;
  connected?: boolean;
}) {
  return (
    <div className={`tile${connected ? " connected" : ""}`}>
      <div className="tile-head">
        <Logo id={id} name={name} color={color} />
        <h3 className="truncate">{name}</h3>
      </div>
      {blurb && <p>{blurb}</p>}
      <div className="tile-foot">{children}</div>
    </div>
  );
}

function Dialog({ title, logo, onClose, children }: { title: string; logo?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          {logo}
          <h2 style={{ flex: 1 }}>{title}</h2>
          <button className="btn sm ghost" type="button" onClick={onClose} aria-label="Đóng">
            Đóng
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

/** Starts a login on open, polls it, and asks for the pasted code when the flow needs it. */
function OAuthDialog({ id, name, onClose, onDone }: { id: string; name: string; onClose: () => void; onDone: () => void }) {
  const [s, setS] = useState<OAuthSession>();
  const [err, setErr] = useState<string>();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef<string>();
  const toast = useToast();

  useEffect(() => {
    let stop = false;
    api.brain
      .oauthStart(id)
      .then((x) => {
        if (stop) return void api.brain.oauthCancel(x.id).catch(() => undefined);
        live.current = x.id;
        setS(x);
      })
      .catch((e: Error) => setErr(e.message));
    return () => {
      stop = true;
    };
  }, [id]);

  useEffect(() => {
    if (!s || s.status === "done" || s.status === "error") return;
    const t = window.setTimeout(() => {
      api.brain
        .oauthStatus(s.id)
        .then(setS)
        .catch((e: Error) => setErr(e.message));
    }, 1500);
    return () => window.clearTimeout(t);
  }, [s]);

  const finished = useRef(false);
  useEffect(() => {
    if (s?.status === "done" && !finished.current) {
      finished.current = true;
      live.current = undefined;
      toast(`Đã đăng nhập ${name}`);
      onDone();
    }
  }, [s?.status, name, onDone, toast]);

  const close = () => {
    if (live.current) void api.brain.oauthCancel(live.current).catch(() => undefined);
    onClose();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!s || !value.trim()) return;
    setBusy(true);
    try {
      setS(await api.brain.oauthInput(s.id, value.trim()));
      setValue("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const error = err ?? (s?.status === "error" ? (s.error ?? "Đăng nhập không thành công") : undefined);
  return (
    <Dialog title={`Đăng nhập ${name}`} logo={<Logo id={id} name={name} />} onClose={close}>
      {error ? (
        <div className="notice error">{error}</div>
      ) : !s ? (
        <p className="small muted">Đang mở phiên đăng nhập…</p>
      ) : s.user_code ? (
        <>
          <ol className="steps">
            <li>
              Mở{" "}
              <a className="link" href={s.verification_uri} target="_blank" rel="noreferrer">
                {s.verification_uri}
              </a>
            </li>
            <li>Nhập mã dưới đây và cho phép truy cập.</li>
            <li>Quay lại đây, trang tự cập nhật khi xong.</li>
          </ol>
          <div className="code-big">{s.user_code}</div>
        </>
      ) : (
        <>
          <ol className="steps">
            <li>
              Bấm <b>Mở trang đăng nhập</b> và đăng nhập tài khoản {name}.
            </li>
            <li>
              Sau khi cho phép, trình duyệt chuyển tới một trang lỗi hoặc trang có mã. Copy <b>toàn bộ địa chỉ trên thanh URL</b> (hoặc mã được hiện), rồi dán
              vào ô dưới.
            </li>
          </ol>
          {s.url && (
            <a className="btn primary" href={s.url} target="_blank" rel="noreferrer">
              Mở trang đăng nhập
            </a>
          )}
          {s.instructions && <p className="xs muted">{s.instructions}</p>}
          <form className="stack tight" onSubmit={submit}>
            <Field label={s.prompt?.message ?? "Mã hoặc URL sau khi đăng nhập"}>
              <input
                id="oauth-input"
                className="input mono"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={s.prompt?.placeholder ?? "http://localhost:…/callback?code=…"}
                autoComplete="off"
              />
            </Field>
            <button className="btn primary" type="submit" disabled={busy || !value.trim()}>
              {busy ? "Đang xác nhận…" : "Xác nhận"}
            </button>
          </form>
        </>
      )}
      {s?.progress && !error && <p className="xs muted">{s.progress}</p>}
    </Dialog>
  );
}

function KeyDialog({ id, name, onClose, onDone }: { id: string; name: string; onClose: () => void; onDone: (id: string) => void }) {
  const run = useAction();
  const [key, setKey] = useState("");
  return (
    <Dialog title={`API key của ${name}`} logo={<Logo id={id} name={name} />} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.brain.setKey(id, key.trim()), "Đã lưu key")) onDone(id);
        }}
      >
        <Field
          label="API key"
          hint={
            id === "anthropic"
              ? "API key sk-ant-api… hoặc token của lệnh claude setup-token (sk-ant-oat…)."
              : "Key được mã hoá trước khi lưu và không bao giờ hiện lại."
          }
        >
          <input
            id="api-key"
            className="input mono"
            type="password"
            autoComplete="off"
            autoFocus
            required
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <button className="btn primary" type="submit" disabled={!key.trim()}>
          Lưu và kiểm tra
        </button>
      </form>
    </Dialog>
  );
}

function EndpointDialog({ preset, onClose, onDone }: { preset?: (typeof ROUTERS)[number]; onClose: () => void; onDone: (id: string) => void }) {
  const run = useAction();
  const [ep, setEp] = useState({ id: preset?.id ?? "", name: preset?.name ?? "", base_url: preset?.base_url ?? "", api: "openai-completions", key: "" });
  return (
    <Dialog
      title={preset ? `Kết nối ${preset.name}` : "Endpoint riêng"}
      logo={<Logo id={ep.id || "x"} name={ep.name || "?"} color={preset?.color} />}
      onClose={onClose}
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api.brain.addEndpoint(ep), "Đã thêm endpoint")) onDone(ep.id);
        }}
      >
        <div className="form-grid">
          <Field label="Id" hint="Tên model sẽ có dạng id/model">
            <input
              id="ep-id"
              className="input mono"
              required
              pattern="[a-z0-9][a-z0-9\-]{1,30}"
              value={ep.id}
              onChange={(e) => setEp({ ...ep, id: e.target.value })}
            />
          </Field>
          <Field label="Tên hiển thị">
            <input id="ep-name" className="input" value={ep.name} onChange={(e) => setEp({ ...ep, name: e.target.value })} />
          </Field>
        </div>
        <Field label="Base URL" hint="Địa chỉ tính từ máy chạy server gtv. Server trong Docker thì localhost là chính container.">
          <input id="ep-url" className="input mono" required type="url" value={ep.base_url} onChange={(e) => setEp({ ...ep, base_url: e.target.value })} />
        </Field>
        <div className="form-grid">
          <Field label="Kiểu API">
            <select id="ep-api" className="select" value={ep.api} onChange={(e) => setEp({ ...ep, api: e.target.value })}>
              <option value="openai-completions">OpenAI (chat completions)</option>
              <option value="anthropic-messages">Anthropic (messages)</option>
            </select>
          </Field>
          <Field label="Key" hint="Để trống nếu endpoint không cần key">
            <input
              id="ep-key"
              className="input mono"
              type="password"
              autoComplete="off"
              value={ep.key}
              onChange={(e) => setEp({ ...ep, key: e.target.value })}
            />
          </Field>
        </div>
        <button className="btn primary" type="submit">
          Thêm và kiểm tra
        </button>
      </form>
    </Dialog>
  );
}

type Open = { kind: "oauth"; id: string; name: string } | { kind: "key"; id: string; name: string } | { kind: "endpoint"; preset?: (typeof ROUTERS)[number] };

function howConnected(p: BrainProvider): string {
  if (p.kind === "endpoint") return p.env ? "Endpoint từ biến môi trường" : `Endpoint ${p.base_url ?? ""}`;
  if (p.auth_type === "oauth") return "Đăng nhập bằng tài khoản";
  if (p.source && p.source !== "stored credential") return `Key từ biến ${p.source}`;
  return `API key ${p.key_hint ?? ""}`;
}

/** Connect LLM providers: log in with an account, paste an API key, or point at a router / OpenAI-compatible endpoint. */
export function ProvidersCard({ model, onChange }: { model: string | null; onChange: () => void }) {
  const { data, error, reload } = usePoll(api.brain.providers, [], 30_000);
  const run = useAction();
  const [tests, setTests] = useState<Record<string, TestResult | "running">>({});
  const [open, setOpen] = useState<Open>();
  const [other, setOther] = useState("");
  const [otherOauth, setOtherOauth] = useState("");

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: "running" }));
    // Test with the brain's own model when it belongs to this provider: a proxy may list models it cannot serve.
    const res = await run(() => api.brain.testProvider(id, model?.startsWith(`${id}/`) ? model : undefined));
    setTests((t) => ({ ...t, [id]: res ?? { ok: false, ms: 0, detail: "lỗi" } }));
  };
  const changed = (id?: string) => {
    setOpen(undefined);
    void reload();
    onChange();
    if (id) void test(id);
  };

  if (error && !data) return <ErrorNotice error={error} />;
  if (!data) return <Loading />;
  const byId = new Map(data.providers.map((p) => [p.id, p]));
  const connected = data.providers.filter((p) => p.kind === "endpoint" || p.configured);
  const oauthAll = data.providers.filter((p) => p.oauth && !p.configured);
  const oauth = Object.keys(OAUTH_FEATURED)
    .map((id) => oauthAll.find((p) => p.id === id))
    .filter((p): p is BrainProvider => !!p);
  const oauthRest = oauthAll.filter((p) => !OAUTH_FEATURED[p.id]);
  const keys = data.providers.filter((p) => p.kind === "builtin" && p.api_key !== false && !p.configured);
  const popular = POPULAR_KEYS.map((id) => keys.find((p) => p.id === id)).filter((p): p is BrainProvider => !!p);
  const rest = keys.filter((p) => !POPULAR_KEYS.includes(p.id));
  const routers = ROUTERS.filter((r) => !byId.has(r.id));

  return (
    <section className="stack">
      <div className="stack tight">
        <h2>Providers</h2>
      </div>

      {!data.secrets_encrypted && (
        <div className="notice error">
          <b>Server chưa đặt GTV_SECRET_KEY</b>, nên key và đăng nhập ở đây được lưu không mã hoá. Đặt biến này (tạo bằng <code>openssl rand -hex 32</code>) rồi
          kết nối lại.
        </div>
      )}

      {connected.length > 0 && (
        <div className="tiles">
          {connected.map((p) => {
            const r = tests[p.id];
            const removable = !p.env && (p.kind === "endpoint" || p.source === "stored credential" || p.auth_type === "oauth");
            return (
              <Tile
                key={p.id}
                id={p.id}
                name={p.name}
                color={ROUTERS.find((x) => x.id === p.id)?.color}
                connected
                blurb={
                  <>
                    {howConnected(p)}
                    {p.models ? `. ${p.models} model` : ""}
                    {r && r !== "running" && (
                      <span className={`row ${r.ok ? "ok-text" : "danger-text"}`} style={{ marginTop: 6 }} title={r.model}>
                        {r.ok ? "Trả lời được" : "Lỗi"}: {r.detail}, {(r.ms / 1000).toFixed(1)} s
                      </span>
                    )}
                  </>
                }
              >
                <button className="btn sm" type="button" onClick={() => void test(p.id)} disabled={r === "running"}>
                  {r === "running" ? "Đang gọi thử…" : "Gọi thử"}
                </button>
                {removable && (
                  <ConfirmButton
                    confirmLabel="Ngắt thật?"
                    onConfirm={async () => {
                      await run(() => (p.kind === "endpoint" ? api.brain.removeEndpoint(p.id) : api.brain.clearKey(p.id)), "Đã ngắt kết nối");
                      changed();
                    }}
                  >
                    Ngắt kết nối
                  </ConfirmButton>
                )}
              </Tile>
            );
          })}
        </div>
      )}

      <details className="add-providers" open={connected.length === 0}>
        <summary>
          <b>{connected.length ? "Kết nối thêm provider" : "Kết nối một provider"}</b>
          <span className="xs muted">Đăng nhập tài khoản, nhập API key, hoặc trỏ tới router/endpoint riêng</span>
        </summary>
        <div className="stack">
          {oauth.length > 0 && (
            <div className="stack tight">
              <h3>Đăng nhập bằng tài khoản</h3>
              <p className="xs muted">Claude Pro/Max, ChatGPT, Copilot… không cần API key.</p>
              <div className="tiles">
                {oauth.map((p) => {
                  const f = OAUTH_FEATURED[p.id];
                  return (
                    <Tile key={p.id} id={p.id} name={f.name} blurb={f.blurb}>
                      <span />
                      <button
                        className="btn sm primary"
                        type="button"
                        title={p.oauth === "device" ? "Mở trang đăng nhập rồi nhập mã gtv đưa" : "Đăng nhập trên trình duyệt rồi dán URL trả về"}
                        onClick={() => setOpen({ kind: "oauth", id: p.id, name: f.name })}
                      >
                        Đăng nhập
                      </button>
                    </Tile>
                  );
                })}
                {oauthRest.length > 0 && (
                  <div className="tile">
                    <div className="tile-head">
                      <Logo id="other" name="+" color="#8794a2" />
                      <h3>Tài khoản khác</h3>
                    </div>
                    <select id="other-oauth" className="select" value={otherOauth} onChange={(e) => setOtherOauth(e.target.value)} aria-label="Tài khoản khác">
                      <option value="">Chọn trong {oauthRest.length} dịch vụ…</option>
                      {oauthRest.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <div className="tile-foot">
                      <span />
                      <button
                        className="btn sm primary"
                        type="button"
                        disabled={!otherOauth}
                        onClick={() => setOpen({ kind: "oauth", id: otherOauth, name: byId.get(otherOauth)?.name ?? otherOauth })}
                      >
                        Đăng nhập
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="stack tight">
            <h3>Dùng API key</h3>
            <div className="tiles">
              {popular.map((p) => (
                <Tile key={p.id} id={p.id} name={p.name} blurb={BRAND[p.id]?.blurb ?? (p.models ? `${p.models} model` : undefined)}>
                  <span />
                  <button className="btn sm" type="button" onClick={() => setOpen({ kind: "key", id: p.id, name: p.name })}>
                    Nhập key
                  </button>
                </Tile>
              ))}
              {rest.length > 0 && (
                <div className="tile">
                  <div className="tile-head">
                    <Logo id="other" name="+" color="#8794a2" />
                    <h3>Provider khác</h3>
                  </div>
                  <select id="other-provider" className="select" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Provider khác">
                    <option value="">Chọn trong {rest.length} provider…</option>
                    {rest.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <div className="tile-foot">
                    <span />
                    <button
                      className="btn sm"
                      type="button"
                      disabled={!other}
                      onClick={() => setOpen({ kind: "key", id: other, name: byId.get(other)?.name ?? other })}
                    >
                      Nhập key
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="stack tight">
            <h3>Qua router hoặc endpoint riêng</h3>

            <div className="tiles">
              {routers.map((r) => (
                <Tile key={r.id} id={r.id} name={r.name} color={r.color} blurb={r.blurb}>
                  <span className="xs faint mono truncate" title="Địa chỉ mặc định, tính từ máy chạy server gtv; đổi được khi kết nối">
                    {r.base_url.replace(/^https?:\/\//, "")}
                  </span>
                  <button className="btn sm" type="button" onClick={() => setOpen({ kind: "endpoint", preset: r })}>
                    Kết nối
                  </button>
                </Tile>
              ))}
              <Tile
                id="custom"
                name="Endpoint khác"
                color="#8794a2"
                blurb="Bất kỳ API nào tương thích OpenAI hoặc Anthropic: vLLM, LM Studio, gateway của công ty…"
              >
                <span />
                <button className="btn sm" type="button" onClick={() => setOpen({ kind: "endpoint" })}>
                  Thêm
                </button>
              </Tile>
            </div>
          </div>
        </div>
      </details>

      {open?.kind === "oauth" && <OAuthDialog id={open.id} name={open.name} onClose={() => setOpen(undefined)} onDone={() => changed(open.id)} />}
      {open?.kind === "key" && <KeyDialog id={open.id} name={open.name} onClose={() => setOpen(undefined)} onDone={changed} />}
      {open?.kind === "endpoint" && <EndpointDialog preset={open.preset} onClose={() => setOpen(undefined)} onDone={changed} />}
    </section>
  );
}
