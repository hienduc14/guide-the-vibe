// Project documents: added on the dashboard, marked core, read by the Operator and listed for agents.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type Running } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import type { Brain, BrainJob, BrainResult } from "../src/server/brain/types.ts";
import { makeOrigin, tempDir, type Origin } from "./helpers.ts";

process.env.GTV_QUIET = "1";

/** Answers every question and remembers the prompts it got. */
class RecordingBrain implements Brain {
  readonly name = "fake";
  readonly model = "fake/m";
  prompts: string[] = [];
  async health() {
    return { ok: true };
  }
  async run<T>(job: BrainJob): Promise<BrainResult<T>> {
    this.prompts.push(job.prompt);
    return { output: { route: "answer", answer: "Refunds within 14 days.", confidence: "high", sources: [] } as T, ms: 1, backend: "fake" };
  }
}

let srv: Running;
let origin: Origin;
const brain = new RecordingBrain();
const ADMIN = "admin-secret";

async function call<T = any>(path: string, init: { method?: string; body?: unknown; dev?: string } = {}): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${ADMIN}` };
  if (init.dev) headers["x-gtv-dev"] = init.dev;
  const res = await srv.app.request(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: res.status, json: (await res.json()) as T };
}

test("setup", async () => {
  origin = await makeOrigin({ "src/a.ts": "export const a = 1\n", "docs/adr/001-ids.md": "# Use UUIDs\n\nAll ids are UUID v7.\n" });
  srv = await startServer(loadConfig({ GTV_DATA: tempDir(), GTV_POLL_MS: "3600000", GTV_ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv), { brain, listen: false });
  assert.equal((await call("/api/projects", { method: "POST", body: { id: "shop", repo_url: origin.bare } })).status, 200);
});

after(async () => {
  await srv?.close();
  origin?.cleanup();
});

test("core documents reach the Operator's prompt and the agents' briefing; repo documents keep their text", async () => {
  const req = await call<any>("/v1/p/shop/kb", {
    method: "POST",
    body: {
      title: "Refund requirements",
      type: "req",
      body: "# Refunds\n\nCustomers get a refund within 14 days of delivery.",
      pinned: true,
      path: "refunds.md",
    },
  });
  assert.equal(req.json.pinned, 1);
  await call("/v1/p/shop/kb", { method: "POST", body: { title: "Meeting notes", body: "Nothing decided." } });

  const s = await call<any>("/v1/p/shop/events", {
    method: "POST",
    dev: "alice",
    body: { type: "session_start", session: { dev: "alice", agent: "claude", workspace_id: "ws_a", workspace_label: "a", agent_session_id: "s-a" } },
  });
  assert.match(s.json.results[0].briefing, /Core project documents .*"Refund requirements"/);
  assert.doesNotMatch(s.json.results[0].briefing, /Meeting notes/);

  await call("/v1/p/shop/tickets", {
    method: "POST",
    dev: "alice",
    body: { session_id: s.json.results[0].session.id, question: "How long is the refund window?" },
  });
  assert.match(brain.prompts.at(-1)!, /Core project documents[\s\S]*Customers get a refund within 14 days of delivery/);

  const core = await call<any[]>("/v1/p/shop/kb?core=1");
  assert.deepEqual(
    core.json.map((d) => d.title),
    ["Refund requirements"],
  );

  // A repo document can be marked core, but its text comes from git; it cannot be deleted from the dashboard.
  const adr = "repo:docs/adr/001-ids.md";
  const edited = await call<any>(`/v1/p/shop/kb/${encodeURIComponent(adr)}`, { method: "PATCH", body: { pinned: true, body: "changed" } });
  assert.equal(edited.json.pinned, 1);
  assert.match(edited.json.body, /UUID v7/);
  assert.equal((await call(`/v1/p/shop/kb/${encodeURIComponent(adr)}`, { method: "DELETE" })).status, 400);

  // Manual documents can be edited, unpinned and deleted.
  await call(`/v1/p/shop/kb/${req.json.id}`, { method: "PATCH", body: { pinned: false, body: "Refunds within 30 days." } });
  assert.equal((await call<any>(`/v1/p/shop/kb/${req.json.id}`)).json.body, "Refunds within 30 days.");
  assert.equal((await call(`/v1/p/shop/kb/${req.json.id}`, { method: "DELETE" })).status, 200);
  assert.equal(srv.hub.live("shop")!.engine.kb.get(req.json.id), undefined);
});
