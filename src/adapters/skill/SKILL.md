---
name: gtv-collaboration
description: Work safely alongside teammates' coding agents on this repo through the gtv Project Operator — register tasks before editing, ask the Operator instead of guessing, answer teammates' questions.
---

# Working with the gtv Project Operator

Several developers' agents work on this repository at the same time. The gtv Operator knows who is doing what,
the code graph, the team docs/ADRs and everybody's work in progress. Use it.

## Task board

The team plans work on the gtv task board. When the user asks what to do next, list it with `gtv_tasks`
(the `/gtv` skill walks through picking one). `gtv_pick_task` takes a task; your next `gtv_register_task`
links to it. Work you register without picking a task is added to the board for you.

## What the lead sees

Your team lead follows the work on a dashboard, mostly by reading one line per message. Write everything you send
to gtv (titles, notes, questions, answers, summaries) **in the team language named in the briefing**, short and
concrete; keep code names as they are.

- `gtv_log_work`: `kind` (`progress`, `decision`, `blocker`, `question`) + `summary` (one line, ≤ 120 characters)
  - `detail` only when needed. Log decisions and blockers when they happen, not every small step.
- `gtv_ask` with `options` when someone has to choose (e.g. `["làm tròn lên", "làm tròn kiểu ngân hàng"]`):
  the lead can pick one with a click.
- `gtv_finish_task` with `summary`: 1-3 lines — what changed, what you tested, what is left.

## Before editing

- Call `gtv_register_task` once you know what you will do: a short title (≤ 60 characters), the goal, and the resources
  you expect to touch (`path` like `src/auth/session.ts` — name concrete files when you know them, globs like
  `src/auth/**` otherwise; `symbol` like `AuthService.login`; `contract` like `POST /api/login`).
  Mark breaking changes with `op: "sig_change" | "rename" | "delete"`.
- Read the reply. If it says `adjust_suggested` or `needs_coordination`, change your plan (e.g. keep a signature
  and add a new function) or ask the teammate via `gtv_ask` before touching the overlapping parts.

## While coding — ask instead of guessing

The team keeps requirements, business rules and decisions in gtv. The briefing lists the **core documents**;
read the ones that touch your task with `gtv_docs` (`id`), or search with `gtv_docs` (`query`) before choosing
an approach. Follow them; if your task needs to go against one, tell your user.

Call `gtv_ask` when:

- you are about to change code another developer is working on or depends on;
- you need to know how a teammate is changing something ("how did B change the token format?");
- a business rule or past decision is unclear;
- you would otherwise stop and wait for your user only to learn what someone else is doing.

`gtv_ask` returns quickly. If the question was forwarded to a teammate, keep working on independent parts —
the answer will be injected into your context automatically.

If you start touching files outside your registered scope, call `gtv_update_task` with `add_resources`.

## Messages from gtv

- `[gtv WARNING/HIGH ...]` conflict notices: adapt your work, coordinate, then `gtv_ack` the conflict id.
- `[gtv question tk_... from X]`: a teammate's agent needs an answer. Answer with `gtv_reply` if your task/code
  lets you decide. If your user must decide, call `gtv_reply` with `escalate: true` and tell your user. Never
  invent a decision on your user's behalf.

## When done

Call `gtv_finish_task` with a `summary` (or it closes automatically once your work is merged into main).
