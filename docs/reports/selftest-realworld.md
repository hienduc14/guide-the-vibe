# Self-test: RealWorld (Node/Express) — 2 developers editing in parallel

Run: 2026-11-06T04:29:01.171Z · duration 141.4s · checks **21/21 passed** · real brain jobs: **3** (42192 ms p50)

Repo: `gothinkster/node-express-realworld-example-app` (TypeScript, 67 files) mirrored as a local bare repo.
Agents are simulated by sending the exact hook payloads of Claude Code (alice) and Codex (bob) to the real daemons;
files are really edited in two clones, WIP snapshots really pushed, the Operator and the brain (`pi gemini-3.8-flash-high`) are real.

## Scenario
- **alice** (Claude Code): `profileMapper(user, id)` → `profileMapper(user, viewer?: { id })` (breaking), updates the 5 existing callers, caps article page size at 100.
- **bob** (Codex): new `getCommentAuthors()` calling `profileMapper(author, id)` with the old signature; changes the same page-size line to 20; unrelated edit in `tag.service.ts`.
- They coordinate through the Operator, bob adapts, alice merges to master.

## Checks
| | Check | Detail |
|---|---|---|
| ✅ | both sessions receive the Operator briefing |  |
| ✅ | alice registration accepted | Registered task task_996d67d36c7e "Profiles take a viewer object; cap article page size at 100". Status: ok. |
| ✅ | bob is told about the overlap at registration (before any code) | Registered task task_fcae278b65f9 "Show comment authors' profiles; default article page size 20". Status: needs_coordination. |
| ✅ | registration feedback names alice's breaking change on profileMapper |  |
| ✅ | alice is warned when editing inside bob's registered scope | [gtv] src/app/routes/article/article.service.ts is inside the registered scope of bob ("Show comment authors' profiles; default article page size 20"). Keep changes there minimal or coordinate with gt |
| ✅ | unrelated tag.service.ts edit is allowed with no warning about it | [gtv HIGH · L0] alice (alice@master, task "Profiles take a viewer object; cap article page size at 100") and bob (bob@master, task "Show comment authors' profil |
| ✅ | L2: alice's signature change vs bob's new caller detected | alice (alice@master) changes the signature of profileMapper from `profileMapper = (user: any, id: number / undefined): Profile =>` to `profileMapper = (user: any, viewer?: { id: number }): Profile =>`, but bob (bob@master) is writing code that uses it: src/app/routes/article/article.service.ts:659.  |
| ✅ | L2 blames only lines bob wrote (1 caller, not the 2 base callers in the same file) | [{"path":"src/app/routes/article/article.service.ts","line":659,"in":"getCommentAuthors","confidence":"import"}] |
| ✅ | L1: both changed the page-size line → text conflict before any PR | Merging the current work of alice (alice@master) and bob (bob@master) would conflict in src/app/routes/article/article.service.ts (Auto-merging). Agree who changes what before going further. |
| ✅ | no conflict reported for the independent tag.service.ts change |  |
| ✅ | no false critical-path alarm (nobody touched migrations/lockfiles/CI) |  |
| ✅ | Claude: editing the conflicted symbol asks the human | ask |
| ✅ | Codex: stopped once (no ask support), allowed on retry |  |
| ✅ | conflict notices reach alice's agent (pre/post hooks) | [gtv WARNING · L0] alice (alice@master, task "Profiles take a viewer object; cap article page size at 100") is editing src/app/routes/article/article.service.ts, which is inside the registered scope " |
| ✅ | tier 1: the brain answers from bob's WIP with sources | [gtv answer tk_6e04070f91ef from operator, confidence high] Q: How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it? A: In his work in progress, Bob calls `profileMappe |
| ✅ | brain routes a decision question to the owner (tier 2) | Ticket tk_e433202d0313: forwarded to alice (Operator note: In `src/app/routes/article/article.service.ts:81` (`getArticles`), the base default limit is 10. Alice added a cap of 100 (`Math.min(Number(q |
| ✅ | the forwarded question is injected into alice's agent mid-turn | [gtv HIGH · L3] Operator: task "Show comment authors' profiles; default article page size 20" (bob) and "Profiles take a viewer object; cap article page size at 100" (alice) may conflict: Alice is cha |
| ✅ | alice's answer is delivered back into bob's agent | [gtv HIGH · L3] Operator: task "Show comment authors' profiles; default article page size 20" (bob) and "Profiles take a viewer object; cap article page size at 100" (alice) may conflict: Alice is cha |
| ✅ | L1 resolves by itself once the overlapping edit is gone | 21.1s |
| ✅ | alice's task closes automatically after her work lands on master | 0.0s |
| ✅ | bob's WIP merges cleanly with the new master |  |

## Timeline
| t | who | action | result |
|---|---|---|---|
| 0.2s | alice/claude | SessionStart | gtv Project Operator is active for this repo. |
| 0.3s | bob/codex | SessionStart | gtv Project Operator is active for this repo. |
| 0.3s | alice/claude | gtv_register_task | Registered task task_996d67d36c7e "Profiles take a viewer object; cap article page size at 100". Status: ok. |
| 30.4s | bob/codex | gtv_register_task (30.1s incl. L3 brain) | Registered task task_fcae278b65f9 "Show comment authors' profiles; default article page size 20". Status: needs_coordination. / - [info L0] with alice (alice@master): Registered scopes overlap: alice (alice@master, task "Profiles take a viewer object; cap arti |
| 30.4s | alice/claude | edited profile.utils.ts, profile.service.ts, article.service.ts | pre-edit decision on article.service.ts: allow; context: [gtv] src/app/routes/article/article.service.ts is inside the registered scope of bob ("Show comment authors' profiles; default article page size 20"). Keep cha |
| 30.4s | bob/codex | edited tag.service.ts (independent) and article.service.ts (new getCommentAuthors + page size 20) | pre-edit: allow; [gtv] src/app/routes/article/article.service.ts is inside the registered scope of alice ("Profiles take a viewer object; cap article page size at 100"). Keep changes there minimal or coordinate with g |
| 51.6s | operator | conflicts after bob's edit (+21.1s) | L0/warning/same_file:src/app/routes/article/article.service.ts, L0/info/scope_overlap:src/app/routes/article/article.service.ts ~ src/app/routes/article/**, L0/high/same_symbol_declared:symbol:profileMapper, L0/warning/same_symbol_declared:symbol:getArticles,  |
| 53.1s | alice/claude | PreToolUse on profile.utils.ts | ask (11ms) |
| 53.1s | bob/codex | PreToolUse on article.service.ts twice | deny then allow (19ms) |
| 95.3s | alice/claude | gtv_ask (tier 1, real brain) | [gtv answer tk_6e04070f91ef from operator, confidence high] Q: How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it? A: In his work in progress, Bob calls `profileMapper` in `getCommentAuthors` at `src/app/ro |
| 119.8s | bob/codex | gtv_ask (decision question, real brain) | Ticket tk_e433202d0313: forwarded to alice (Operator note: In `src/app/routes/article/article.service.ts:81` (`getArticles`), the base default limit is 10. Alice added a cap of 100 (`Math.min(Number(query.limit) // 10, 100)`), while Bob changed the default to  |
| 119.9s | alice/claude | gtv_reply | Answer sent for tk_e433202d0313. |
| 141.0s | operator | after coordination | L0/warning/open:src/app/routes/article/article.service.ts, L0/info/open:src/app/routes/article/article.service.ts ~ src/app/routes/article/**, L0/high/open:symbol:profileMapper, L0/warning/open:symbol:getArticles, L0/high/open:planned:profileMapper, L2/high/ac |

## Brain
- L3 registration judgement: (no advice line)
- Tier-1 answer: [gtv answer tk_6e04070f91ef from operator, confidence high] Q: How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it? A: In his work in progress, Bob calls `profileMapper` in `getCommentAuthors` at `src/app/routes/article/article.service.ts:659` with a bare `id?: number`: `profileMapper(comment.author, id)`.  Yes, your change will break it: 1. Compile error: TypeScript will reject passing `number / undefined` where `{ id: number } / undefined` is expected. 2. Runtime bug: If executed, `viewer` is truthy when `id` is a number (e.g. `5`), but `viewer.id` evaluates to `undefined`, so `user.followedBy.some(...)` will check `followingUser.id === undefined` and `following` will always resolve to `false`.  Bob would need to pass `id ? { id } : undefined`, or `profileMapper` would need backward compatibility to accept `number / { id: number }`. Sources: file:src/app/routes/article/article.service.ts:659, file:src/app/routes/profile/profile.utils.ts:4, conflict:cf_cb6743f02710

## Layers after the run
| feature | mode | metrics |
|---|---|---|
| registration | on | tasks=2 |
| registration.auto_from_plan | shadow |  |
| drift_check | on | drift_events=1 |
| detect.l0_path | on | open=0, total=5, shadow_detections=0 |
| detect.l1_merge | on | open=0, total=1, shadow_detections=0 |
| detect.l2_symbol | on | open=0, total=2, shadow_detections=0 |
| detect.l3_semantic | on | open=0, total=1, shadow_detections=0 |
| knowledge.code_graph | on | files=38, symbols=42, refs=516 |
| knowledge.doc_kb | on | documents=3 |
| qa.tier1_answer | on | tickets=1 |
| qa.tier2_relay | on | tickets=1 |
| qa.tier3_human | on | tickets=0 |
| policy.ask | on |  |
| notify.desktop | on |  |
| brain | on |  |
