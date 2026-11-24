// A local server full of believable data, to look at the dashboard or show gtv to someone:
// a "Mini Shop" project with a charter, members, a task board, two agents working (simulated, no LLM),
// a conflict between them, questions between their agents and notes from the lead.
// Every run starts from scratch in a temp folder. Usage: npm run demo  (GTV_PORT, default 7395)

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "../src/server/main.ts";
import { loadConfig } from "../src/server/config.ts";
import { NullBrain } from "../src/server/brain/types.ts";
import { git } from "../src/shared/util.ts";

const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(tmpdir(), "gtv-demo");
const ADMIN = "demo-admin";
const PORT = Number(process.env.GTV_PORT ?? 7395);

rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });

// The "GitHub" repository: examples/sample-repo pushed to a local bare repo.
const origin = join(DATA, "origin.git");
const seed = join(DATA, "seed");
await git(DATA, ["init", "--bare", "-q", "-b", "main", origin]);
cpSync(join(ROOT, "examples", "sample-repo"), seed, { recursive: true });
await git(seed, ["init", "-q", "-b", "main"]);
await git(seed, ["add", "-A"]);
await git(seed, ["-c", "user.name=gtv", "-c", "user.email=gtv@localhost", "commit", "-q", "-m", "mini-shop: initial import"]);
await git(seed, ["push", "-q", origin, "main"]);

process.env.GTV_QUIET ??= "1";
const srv = await startServer(
  loadConfig({ ...process.env, GTV_DATA: join(DATA, "server"), GTV_ADMIN_TOKEN: ADMIN, GTV_PORT: String(PORT), GTV_POLL_MS: "60000" }),
  { brain: new NullBrain() },
);

async function call<T = any>(path: string, body?: unknown, opts: { method?: string; dev?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${ADMIN}` };
  if (opts.dev) headers["x-gtv-dev"] = opts.dev;
  const res = await srv.app.request(path, {
    method: opts.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
}
const P = "/v1/p/mini-shop";
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// ---- project, people -----------------------------------------------------------------------

await call("/api/projects", { id: "mini-shop", name: "Mini Shop", repo_url: origin, main_branch: "main" });
await call(
  "/api/projects/mini-shop",
  {
    description: "Cửa hàng online nhỏ cho đồ án",
    policy: { critical_paths: ["src/auth/session.ts"] },
    charter: {
      goal: "MVP bán hàng online cho 3 cửa hàng thử nghiệm: đặt hàng, thanh toán, hoàn tiền",
      users: "Khoảng 100 người mua thử, chủ yếu trên điện thoại",
      deadline: day(45),
      quality: "mvp",
      stack: ["TypeScript", "Node 24", "Express", "PostgreSQL"],
      milestones: "Tuần 2: đặt hàng chạy; tuần 4: thanh toán + hoàn tiền; tuần 6: demo",
      constraints: "Chỉ dùng dịch vụ miễn phí; không lưu số thẻ",
      non_goals: "App di động native, đa ngôn ngữ",
    },
  },
  { method: "PATCH" },
);
await call("/api/users/minh", { role: "manager", password: "minh-demo-123" }, { method: "PUT" });
await call("/api/users/khach", { role: "viewer", password: "khach-demo-123" }, { method: "PUT" });
for (const [dev, role, level, note] of [
  ["alice", "tech lead", "lead", "Phụ trách đơn hàng và thanh toán"],
  ["bob", "backend", "mid", "Phụ trách đăng nhập"],
  ["carol", "frontend", "junior", ""],
] as const)
  await call(`/api/projects/mini-shop/members/${dev}`, { role, level, note }, { method: "PUT" });

// ---- the board ----------------------------------------------------------------------------

const task = (input: Record<string, unknown>) => call<{ id: string }>(`${P}/board`, input, { dev: "minh" });
const refund = await task({
  title: "Hoàn tiền trong 14 ngày",
  description: "Khách được hoàn tiền trong 14 ngày kể từ ngày giao (docs/business/refund-policy.md). Xong khi: API hoàn tiền + test.",
  priority: "urgent",
  assignee: "alice",
  due_date: day(3),
  estimate_h: 6,
});
const rounding = await task({
  title: "Sửa lỗi làm tròn tổng tiền đơn hàng",
  description: "Tổng tiền lệch 1 đồng khi có giảm giá.",
  priority: "normal",
  assignee: "bob",
  due_date: day(-2),
});
await task({ title: "Đổi session token sang JWT", description: "Theo ADR 001.", priority: "high", assignee: "bob", due_date: day(7), estimate_h: 8 });
await task({ title: "Thêm rate limit cho đăng nhập", priority: "high", due_date: day(10) });
await task({ title: "Trang lịch sử đơn hàng", priority: "normal", assignee: "carol", due_date: day(12) });
await task({ title: "Viết test cho OrderService", priority: "low" });
const ci = await task({ title: "Thiết lập CI chạy test", priority: "normal", assignee: "alice" });
await call(`${P}/board/${ci.id}`, { status: "done" }, { method: "PATCH", dev: "alice" });

// ---- two agents at work (simulated sessions: what the hooks would send) ----------------------

const sessions: Record<string, string> = {};
for (const [dev, agent] of [
  ["alice", "claude"],
  ["bob", "codex"],
] as const) {
  const r = await call<any>(
    `${P}/events`,
    {
      type: "session_start",
      session: { dev, agent, workspace_id: `ws_${dev}`, workspace_label: `${dev}-laptop`, agent_session_id: `demo-${dev}`, branch: "main" },
    },
    { dev },
  );
  sessions[dev] = r.results[0].session.id;
}

await call(`${P}/board/${refund.id}/pick`, { session_id: sessions.alice }, { dev: "alice" });
await call(
  `${P}/tasks`,
  {
    session_id: sessions.alice,
    title: "Refund API within 14 days",
    goal: "POST /api/orders/:id/refund, checks the 14-day window",
    resources: [
      { kind: "path", value: "src/orders/**", op: "modify" },
      { kind: "symbol", value: "OrderService.refund", op: "create" },
      { kind: "contract", value: "GET /api/orders/:id", op: "modify" },
    ],
  },
  { dev: "alice" },
);
await call(`${P}/board/${rounding.id}/pick`, { session_id: sessions.bob }, { dev: "bob" });
await call(
  `${P}/tasks`,
  {
    session_id: sessions.bob,
    title: "Fix order total rounding",
    goal: "Round once at the end, not per line",
    resources: [
      { kind: "path", value: "src/orders/service.ts", op: "modify" },
      { kind: "contract", value: "GET /api/orders/:id", op: "modify" },
    ],
  },
  { dev: "bob" },
);
for (const dev of ["alice", "bob"])
  await call(`${P}/events`, { type: "edit", session_id: sessions[dev], paths: ["src/orders/service.ts"], phase: "post" }, { dev });

await call(`${P}/board/${refund.id}/notes`, { body: "Refund window counted from delivery date, not order date (refund-policy.md)." }, { dev: "alice" });
await call(
  `${P}/board/${rounding.id}/notes`,
  { body: "Found it: discount is rounded per line. Waiting for alice before touching OrderService." },
  { dev: "bob" },
);

// Questions between the agents: one answered by the other agent, one that needs a person.
const q1 = await call<any>(
  `${P}/tickets`,
  {
    session_id: sessions.bob,
    question: "Will OrderService.total() keep its signature? I need to change how it rounds.",
    context: "Fixing the rounding bug on the board.",
    to_dev: "alice",
  },
  { dev: "bob" },
);
await call(
  `${P}/tickets/${q1.id}/reply`,
  { answer: "Yes, total(order) stays as is. I only add refund(); round inside total() and I will rebase on your change.", session_id: sessions.alice },
  { dev: "alice" },
);
const q2 = await call<any>(
  `${P}/tickets`,
  { session_id: sessions.alice, question: "Refunds: round half-up or banker's rounding?", to_dev: "bob" },
  { dev: "alice" },
);
await call(
  `${P}/tickets/${q2.id}/reply`,
  { answer: "Not decided in code; the business must choose.", escalate: true, session_id: sessions.bob },
  { dev: "bob" },
);

await call("/api/projects/mini-shop/messages", { to_dev: "bob", body: "Ưu tiên để alice xong phần hoàn tiền trước thứ Sáu, sau đó làm JWT." }, { dev: "minh" });

const link = await call<{ code: string }>("/api/projects/mini-shop/share-links", { label: "demo", days: 7 });

const url = `http://localhost:${srv.port}`;
console.log(`
gtv demo is running: ${url}
  Admin token          ${ADMIN}
  Manager account      minh / minh-demo-123
  Viewer account       khach / khach-demo-123
  Read-only link       ${url}/s/${link.code}
Data: ${DATA} (recreated on every run). Stop with Ctrl+C.
`);

const stop = async () => {
  await srv.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
