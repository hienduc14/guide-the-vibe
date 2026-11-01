import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { HermesBrain, parseJsonReply } from "../src/server/brain/hermes.ts";
import { ANSWER_SCHEMA } from "../src/server/brain/prompts.ts";
import { BrainUnavailable } from "../src/server/brain/types.ts";
import { makeOrigin, tempDir, type Origin } from "./helpers.ts";
import type { Ticket } from "../src/shared/types.ts";

process.env.GTV_QUIET = "1";

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: any;
}

/**
 * Fake Hermes gateway with the response shapes of Hermes v0.22 (gateway/platforms/api_server*.py).
 * `reply` decides each chat completion: [status, json].
 */
function fakeHermes(reply: (body: any, seen: Seen) => Promise<[number, unknown]> | [number, unknown]) {
  const seen: Seen[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const s: Seen = { method: req.method!, path: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    seen.push(s);
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    };
    if (req.headers.authorization !== "Bearer test-key-0123456789abcdef") {
      return send(401, { error: { message: "Invalid gateway API key (API_SERVER_KEY)", type: "gateway_auth_error", code: "gateway_auth_failed" } });
    }
    if (req.url === "/health") return send(200, { status: "ok", platform: "hermes-agent", version: "0.22.2" });
    if (req.url === "/api/model/options") {
      return send(200, {
        model: "gpt-6-luna",
        provider: "openai-codex",
        providers: [
          { slug: "openai-codex", models: ["gpt-6-luna", "gpt-5.5"], authenticated: true },
          { slug: "anthropic", models: ["claude-x"], authenticated: false },
          { slug: "openrouter", models: [] },
        ],
      });
    }
    if (req.method === "DELETE" && req.url?.startsWith("/api/sessions/")) return send(200, { deleted: true });
    if (req.url === "/v1/chat/completions") {
      const [status, json] = await reply(s.body, s);
      return send(status, json);
    }
    send(404, { error: { message: "not found" } });
  });
  return {
    seen,
    server,
    async listen(): Promise<string> {
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections(); // fetch keeps connections alive
      }),
  };
}

const completion = (content: string, finish_reason = "stop", extra: object = {}): [number, unknown] => [
  200,
  { id: "chatcmpl-1", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason }], ...extra },
];

const KEY = "test-key-0123456789abcdef";
const SCHEMA = { type: "object", required: ["answer"], properties: { answer: { type: "string" } } };
const job = { kind: "answer_question" as const, prompt: "Q?", schema: SCHEMA, project: "shop" };

test("parseJsonReply takes the JSON object out of prose or a code fence and checks required keys", () => {
  assert.deepEqual(parseJsonReply('Here:\n```json\n{"answer":"x"}\n```', SCHEMA), { answer: "x" });
  assert.throws(() => parseJsonReply("I could not find it.", SCHEMA), /no JSON object/);
  assert.throws(() => parseJsonReply('{"other":1}', SCHEMA), /misses answer/);
});

test("hermes brain: provider/model, project-aware system prompt, own session, cleanup", async () => {
  const h = fakeHermes(() => completion('```json\n{"answer":"42"}\n```'));
  const brain = new HermesBrain({ url: await h.listen(), apiKey: KEY, model: "openai-codex/gpt-6-luna" });
  try {
    const res = await brain.run<{ answer: string }>(job);
    assert.equal(res.output.answer, "42");
    assert.equal(res.backend, "hermes");
    const chat = h.seen.find((s) => s.path === "/v1/chat/completions")!;
    assert.equal(chat.body.provider, "openai-codex");
    assert.equal(chat.body.model, "gpt-6-luna");
    assert.equal(chat.body.stream, false);
    const system = chat.body.messages[0].content as string;
    assert.match(system, /mcp__gtv__/);
    assert.match(system, /project="shop"/);
    assert.match(system, /"required":\["answer"\]/);
    const session = chat.headers["x-hermes-session-id"] as string;
    assert.match(session, /^gtv-shop-answer_question-/);
    await new Promise((r) => setTimeout(r, 50)); // cleanup is fire-and-forget
    assert.ok(h.seen.some((s) => s.method === "DELETE" && s.path === `/api/sessions/${encodeURIComponent(session)}`));
  } finally {
    await h.close();
  }
});

test("hermes brain: retries once in the same session when the reply is not JSON", async () => {
  let n = 0;
  const h = fakeHermes(() => (n++ === 0 ? completion("Let me think about it.") : completion('{"answer":"ok"}')));
  const brain = new HermesBrain({ url: await h.listen(), apiKey: KEY });
  try {
    assert.equal((await brain.run<{ answer: string }>(job)).output.answer, "ok");
    const chats = h.seen.filter((s) => s.path === "/v1/chat/completions");
    assert.equal(chats.length, 2);
    assert.equal(chats[0].headers["x-hermes-session-id"], chats[1].headers["x-hermes-session-id"]);
    assert.match(chats[1].body.messages.at(-1).content, /only the JSON object/);
    assert.equal(chats[0].body.model, "hermes-agent", "no model set: Hermes's configured default");
  } finally {
    await h.close();
  }
});

test("hermes brain: failed runs reported as HTTP 200 are errors; busy and unreachable are BrainUnavailable", async () => {
  const replies: [number, unknown][] = [
    completion("Provider error: token expired", "error", {
      hermes: { completed: false, partial: false, failed: true, error: "token expired", error_code: "agent_error" },
    }),
    [429, { error: { message: "Too many concurrent runs (max 10)", type: "rate_limit_error", code: "rate_limit_exceeded" } }],
  ];
  const h = fakeHermes(() => replies.shift()!);
  const url = await h.listen();
  const brain = new HermesBrain({ url, apiKey: KEY });
  try {
    await assert.rejects(brain.run(job), (e: Error) => !(e instanceof BrainUnavailable) && /token expired/.test(e.message));
    await assert.rejects(brain.run(job), BrainUnavailable);
    await assert.rejects(new HermesBrain({ url, apiKey: "wrong" }).run(job), /hermes 401: Invalid gateway API key/);
  } finally {
    await h.close();
  }
  await assert.rejects(new HermesBrain({ url, apiKey: KEY }).run(job), BrainUnavailable);
});

test("hermes brain: health and the dashboard model list (authenticated providers only)", async () => {
  const h = fakeHermes(() => completion("{}"));
  const brain = new HermesBrain({ url: await h.listen(), apiKey: KEY });
  try {
    assert.deepEqual(await brain.health(), { ok: true, detail: "hermes 0.22.2" });
    assert.deepEqual(await brain.models(), ["openai-codex/gpt-6-luna", "openai-codex/gpt-5.5"]);
  } finally {
    await h.close();
  }
});

let srv: Running | undefined;
let origin: Origin | undefined;
after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("end to end: a tier-1 question goes through Hermes, which reads the code with the Operator's shared MCP tools", async () => {
  origin = await makeOrigin({ "src/auth/service.ts": "export function getUser(id: number) { return { id } }\n" });
  // Like Hermes's tool loop: call mcp__gtv__find_symbol on the Operator, then answer from the result.
  const h = fakeHermes(async (body) => {
    const project = /project="([^"]+)"/.exec(body.messages[0].content)![1];
    const res = await srv!.app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer brain-secret" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_symbol", arguments: { project, query: "getUser" } } }),
    });
    const found = JSON.parse(((await res.json()) as any).result.content[0].text)[0];
    const answer = { route: "answer", answer: `getUser is declared as ${found.sig}`, confidence: "high", sources: [{ type: "symbol", ref: found.id }] };
    return completion(JSON.stringify(answer));
  });
  const env = { GTV_DATA: tempDir(), GTV_REPO_URL: origin.bare, GTV_POLL_MS: "3600000", GTV_BRAIN_TOKEN: "brain-secret" };
  const cfg = loadConfig({ ...env, BRAIN_BACKEND: "hermes", HERMES_URL: await h.listen(), HERMES_API_KEY: KEY } as NodeJS.ProcessEnv);
  assert.equal(cfg.brain.backend, "hermes");
  cfg.askWaitMs = 2000; // gtv_ask's wait timer is not cleared; keep it short so the test process exits
  srv = await startServer(cfg, { listen: false });
  try {
    assert.equal(srv.hub.brain.name, "hermes");
    const call = async (path: string, body: unknown) =>
      (await (
        await srv!.app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-gtv-dev": "alice" }, body: JSON.stringify(body) })
      ).json()) as any;
    const started = await call("/v1/p/default/events", {
      type: "session_start",
      session: { dev: "alice", agent: "claude", workspace_id: "ws_a", workspace_label: "alice-wt", agent_session_id: "c-1" },
    });
    const t = (await call("/v1/p/default/tickets", { session_id: started.results[0].session.id, question: "What does getUser take?" })) as Ticket;
    assert.equal(t.status, "answered");
    assert.match(t.answer!, /getUser\(id: number\)/);
    assert.deepEqual(t.sources, [{ type: "symbol", ref: "src/auth/service.ts#getUser" }]);
    // Without the brain token the shared MCP endpoint refuses.
    const denied = await srv.app.request("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(denied.status, 401);
  } finally {
    await h.close();
  }
});
