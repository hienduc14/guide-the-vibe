import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { PiBrain, parseJsonReply } from "../src/server/brain/pi.ts";
import { BrainUnavailable, type BrainJob } from "../src/server/brain/types.ts";
import { makeOrigin, tempDir, type Origin } from "./helpers.ts";
import type { Ticket } from "../src/shared/types.ts";

process.env.GTV_QUIET = "1";

const KEY = "test-key-0123456789abcdef";
type Reply = { text?: string; tool?: { name: string; args: unknown }; status?: number; error?: string };

/** Fake OpenAI-compatible endpoint (what CLIProxyAPI, OpenRouter, vLLM… expose). `reply` decides each chat request. */
function fakeModel(reply: (body: any) => Promise<Reply> | Reply) {
  const seen: { headers: IncomingMessage["headers"]; body: any }[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: { message: "Invalid API key" } });
    if (req.url === "/v1/models") return json(200, { object: "list", data: [{ id: "flash-1" }, { id: "big-2" }] });
    if (req.url !== "/v1/chat/completions") return json(404, { error: { message: "not found" } });
    const body = JSON.parse(raw);
    seen.push({ headers: req.headers, body });
    const r = await reply(body);
    if (r.status) return json(r.status, { error: { message: r.error ?? "error" } });
    const delta = r.tool
      ? {
          role: "assistant",
          tool_calls: [{ index: 0, id: `call_${seen.length}`, type: "function", function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }],
        }
      : { role: "assistant", content: r.text ?? "" };
    const finish = r.tool ? "tool_calls" : "stop";
    if (!body.stream) {
      const message = r.tool ? { role: "assistant", content: null, tool_calls: delta.tool_calls } : { role: "assistant", content: r.text };
      return json(200, { id: "c1", object: "chat.completion", model: body.model, choices: [{ index: 0, message, finish_reason: finish }] });
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (choice: object) =>
      res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: body.model, choices: [choice] })}\n\n`);
    chunk({ index: 0, delta, finish_reason: null });
    chunk({ index: 0, delta: {}, finish_reason: finish });
    res.end("data: [DONE]\n\n");
  });
  return {
    seen,
    async listen(): Promise<string> {
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    },
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

const SCHEMA = { type: "object", required: ["answer"], properties: { answer: { type: "string" } } };
// The tools only need an engine to exist; these jobs never call one.
const job: BrainJob = { kind: "answer_question", prompt: "Q?", schema: SCHEMA, project: "shop", engine: () => ({}) as any };

test("parseJsonReply takes the JSON object out of prose or a code fence and checks required keys", () => {
  assert.deepEqual(parseJsonReply('Here:\n```json\n{"answer":"x"}\n```', SCHEMA), { answer: "x" });
  assert.throws(() => parseJsonReply("I could not find it.", SCHEMA), /no JSON object/);
  assert.throws(() => parseJsonReply('{"other":1}', SCHEMA), /misses answer/);
});

test("pi brain: model choice — custom endpoint, built-in provider, or a clear error", () => {
  const custom = new PiBrain({ baseUrl: "http://x/v1", model: "flash-1" });
  assert.deepEqual([custom.resolveModel().provider, custom.resolveModel().id], ["custom", "flash-1"]);
  custom.setModel("custom/vendor/model-3");
  assert.equal(custom.resolveModel().id, "vendor/model-3");
  const builtin = new PiBrain({ model: "anthropic/claude-sonnet-4-5" });
  assert.equal(builtin.resolveModel().api, "anthropic-messages");
  assert.throws(() => new PiBrain({}).resolveModel(), BrainUnavailable);
  assert.throws(() => new PiBrain({ model: "flash-1" }).resolveModel(), /needs BRAIN_BASE_URL/);
  assert.throws(() => new PiBrain({ model: "anthropic/no-such-model" }).resolveModel(), /unknown model/);
});

test("pi brain: retries once with the history kept when the reply is not JSON", async () => {
  let n = 0;
  const m = fakeModel(() => (n++ === 0 ? { text: "Let me think about it." } : { text: '{"answer":"ok"}' }));
  const brain = new PiBrain({ baseUrl: await m.listen(), apiKey: KEY, model: "flash-1" });
  try {
    const res = await brain.run<{ answer: string }>(job);
    assert.equal(res.output.answer, "ok");
    assert.equal(res.backend, "pi");
    assert.equal(m.seen.length, 2);
    const second = m.seen[1].body.messages;
    assert.ok(
      second.some((x: any) => x.role === "assistant" && /think about it/.test(JSON.stringify(x.content))),
      "first reply kept",
    );
    assert.match(JSON.stringify(second.at(-1).content), /only the JSON object/);
  } finally {
    await m.close();
  }
});

test("pi brain: bad key is an error; overload and unreachable are BrainUnavailable; health and model list", async () => {
  const m = fakeModel(() => ({ status: 400, error: "bad request: unknown field" }));
  const url = await m.listen();
  try {
    await assert.rejects(
      new PiBrain({ baseUrl: url, apiKey: "wrong", model: "flash-1" }).run(job),
      (e: Error) => !(e instanceof BrainUnavailable) && /401/.test(e.message),
    );
    await assert.rejects(
      new PiBrain({ baseUrl: url, apiKey: KEY, model: "flash-1" }).run(job),
      (e: Error) => !(e instanceof BrainUnavailable) && /unknown field/.test(e.message),
    );
    const brain = new PiBrain({ baseUrl: url, apiKey: KEY, model: "flash-1" });
    assert.equal((await brain.health()).ok, true);
    assert.equal((await new PiBrain({ baseUrl: url, apiKey: "wrong", model: "flash-1" }).health()).ok, false);
    const models = await brain.models();
    assert.deepEqual(models.slice(0, 2), ["custom/flash-1", "custom/big-2"]);
  } finally {
    await m.close();
  }
  await assert.rejects(new PiBrain({ baseUrl: url, apiKey: KEY, model: "flash-1" }).run(job), BrainUnavailable);
  await assert.rejects(new PiBrain({ baseUrl: url, apiKey: KEY, model: "flash-1" }).run({ ...job, engine: () => undefined }), /not loaded/);
});

test("pi brain: a job that runs past its timeout is BrainUnavailable", async () => {
  const m = fakeModel(() => new Promise<Reply>((r) => setTimeout(() => r({ text: '{"answer":"late"}' }), 3000)));
  try {
    const brain = new PiBrain({ baseUrl: await m.listen(), apiKey: KEY, model: "flash-1" });
    await assert.rejects(brain.run({ ...job, timeoutMs: 300 }), (e: Error) => e instanceof BrainUnavailable && /timed out/.test(e.message));
  } finally {
    await m.close();
  }
});

let srv: Running | undefined;
let origin: Origin | undefined;
after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("end to end: a tier-1 question goes through Pi, which calls the project's read-only tools in-process", async () => {
  origin = await makeOrigin({ "src/auth/service.ts": "export function getUser(id: number) { return { id } }\n" });
  // Turn 1: the model calls find_symbol. Turn 2: it answers from the tool result.
  const m = fakeModel((body) => {
    const result = body.messages.find((x: any) => x.role === "tool");
    if (!result) return { tool: { name: "find_symbol", args: { query: "getUser" } } };
    const found = JSON.parse(typeof result.content === "string" ? result.content : result.content[0].text)[0];
    return {
      text: JSON.stringify({
        route: "answer",
        answer: `getUser is declared as ${found.sig}`,
        confidence: "high",
        sources: [{ type: "symbol", ref: found.id }],
      }),
    };
  });
  const env = { GTV_DATA: tempDir(), GTV_REPO_URL: origin.bare, GTV_POLL_MS: "3600000" };
  const cfg = loadConfig({ ...env, BRAIN_BACKEND: "pi", BRAIN_BASE_URL: await m.listen(), BRAIN_API_KEY: KEY, BRAIN_MODEL: "flash-1" } as NodeJS.ProcessEnv);
  assert.equal(cfg.brain.backend, "pi");
  cfg.askWaitMs = 2000; // gtv_ask's wait timer is not cleared; keep it short so the test process exits
  srv = await startServer(cfg, { listen: false });
  try {
    assert.equal(srv.hub.brain.name, "pi");
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
    // The model saw only gtv's read-only tools (no shell, no file writes) and the answer schema.
    const first = m.seen[0].body;
    assert.equal(first.model, "flash-1");
    const tools = first.tools.map((x: any) => x.function.name).sort();
    assert.deepEqual(tools, [
      "conflicts",
      "file_symbols",
      "find_symbol",
      "grep",
      "impact",
      "kb_get",
      "kb_search",
      "overview",
      "owners",
      "read_file",
      "team_status",
      "who_calls",
      "wip_diff",
    ]);
    assert.match(JSON.stringify(first.messages[0]), /\\"required\\":\[\\"route\\"/);
    // The old brain MCP endpoints are gone: nothing on the published port serves the code to the brain.
    assert.equal((await srv.app.request("/mcp", { method: "POST" })).status, 404);
  } finally {
    await m.close();
  }
});
