# Self-test: RealWorld (Node/Express) — 2 developers editing in parallel

Run: 2026-10-24T03:41:05.122Z · duration 81.5s · checks **21/21 passed** · real brain jobs: **3** (9708 ms p50)

Repo: `gothinkster/node-express-realworld-example-app` (TypeScript, 67 files) mirrored as a local bare repo.
Agents are simulated by sending the exact hook payloads of Claude Code (alice) and Codex (bob) to the real daemons;
files are really edited in two clones, WIP snapshots really pushed, the Operator and the brain (OpenCode + ChatGPT `gpt-6-luna`) are real.

## Scenario
- **alice** (Claude Code): `profileMapper(user, id)` → `profileMapper(user, viewer?: { id })` (breaking), updates the 5 existing callers, caps article page size at 100.
- **bob** (Codex): new `getCommentAuthors()` calling `profileMapper(author, id)` with the old signature; changes the same page-size line to 20; unrelated edit in `tag.service.ts`.
- They coordinate through the Operator, bob adapts, alice merges to master.

## Checks
| | Check | Detail |
|---|---|---|
| ✅ | both sessions receive the Operator briefing |  |
| ✅ | alice registration accepted | Registered task task_5c0d4c33a97d "Profiles take a viewer object; cap article page size at 100". Status: ok. |
| ✅ | bob is told about the overlap at registration (before any code) | Registered task task_74fd34d26a4d "Show comment authors' profiles; default article page size 20". Status: needs_coordination. |
| ✅ | registration feedback names alice's breaking change on profileMapper |  |
| ✅ | alice is warned when editing inside bob's registered scope | [gtv] src/app/routes/article/article.service.ts is inside the registered scope of bob ("Show comment authors' profiles; default article page size 20"). Keep changes there minimal or coordinate with gt |
| ✅ | unrelated tag.service.ts edit is allowed with no warning about it | [gtv HIGH · L0] alice (alice@master, task "Profiles take a viewer object; cap article page size at 100") and bob (bob@master, task "Show comment authors' profil |
| ✅ | L2: alice's signature change vs bob's new caller detected | alice (alice@master) changes the signature of profileMapper from `profileMapper = (user: any, id: number / undefined): Profile =>` to `profileMapper = (user: any, viewer?: { id: number }): Profile =>`, but bob (bob@master) is writing code that uses it: src/app/routes/article/article.service.ts:659.  |
| ✅ | L2 blames only lines bob wrote (1 caller, not the 2 base callers in the same file) | [{"path":"src/app/routes/article/article.service.ts","line":659,"in":"getCommentAuthors","confidence":"import"}] |
| ✅ | L1: both changed the page-size line → text conflict before any PR | Merging the current work of bob (bob@master) and alice (alice@master) would conflict in src/app/routes/article/article.service.ts (Auto-merging). Agree who changes what before going further. |
| ✅ | no conflict reported for the independent tag.service.ts change |  |
| ✅ | no false critical-path alarm (nobody touched migrations/lockfiles/CI) |  |
| ✅ | Claude: editing the conflicted symbol asks the human | ask |
| ✅ | Codex: stopped once (no ask support), allowed on retry |  |
| ✅ | conflict notices reach alice's agent (pre/post hooks) | [gtv WARNING · L0] alice (alice@master, task "Profiles take a viewer object; cap article page size at 100") is editing src/app/routes/article/article.service.ts, which is inside the registered scope " |
| ✅ | tier 1: the brain answers from bob's WIP with sources | [gtv answer tk_f0220a35f6aa from operator, confidence high] Q: How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it? A: Bob’s WIP calls `profileMapper(comment.author, i |
| ✅ | brain routes a decision question to the owner (tier 2) | Ticket tk_84767e708674: forwarded to alice (Operator note: The current WIP diffs show Alice's change as a maximum of 100 while preserving the existing default of 10, and Bob's change sets the default  |
| ✅ | the forwarded question is injected into alice's agent mid-turn | [gtv question tk_84767e708674 from bob] You own the article page-size decision. Bob proposes changing the default from 10 to 20; your WIP caps requests at 100 while leaving default 10. Which behavior  |
| ✅ | alice's answer is delivered back into bob's agent | [gtv answer tk_84767e708674 from alice's agent, confidence high] Q: Alice caps the article page size at 100 and I wanted the default to be 20 instead of 10. Which default page size should we ship? Ali |
| ✅ | L1 resolves by itself once the overlapping edit is gone | 22.6s |
| ✅ | alice's task closes automatically after her work lands on master | 1.3s |
| ✅ | bob's WIP merges cleanly with the new master |  |

## Timeline
| t | who | action | result |
|---|---|---|---|
| 1.3s | alice/claude | SessionStart | gtv Project Operator is active for this repo. |
| 1.7s | bob/codex | SessionStart | gtv Project Operator is active for this repo. |
| 1.7s | alice/claude | gtv_register_task | Registered task task_5c0d4c33a97d "Profiles take a viewer object; cap article page size at 100". Status: ok. |
| 10.9s | bob/codex | gtv_register_task (9.2s incl. L3 brain) | Registered task task_74fd34d26a4d "Show comment authors' profiles; default article page size 20". Status: needs_coordination. / - [info L0] with alice (alice@master): Registered scopes overlap: alice (alice@master, task "Profiles take a viewer object; cap arti |
| 11.0s | alice/claude | edited profile.utils.ts, profile.service.ts, article.service.ts | pre-edit decision on article.service.ts: allow; context: [gtv] src/app/routes/article/article.service.ts is inside the registered scope of bob ("Show comment authors' profiles; default article page size 20"). Keep cha |
| 11.1s | bob/codex | edited tag.service.ts (independent) and article.service.ts (new getCommentAuthors + page size 20) | pre-edit: allow; [gtv] src/app/routes/article/article.service.ts is inside the registered scope of alice ("Profiles take a viewer object; cap article page size at 100"). Keep changes there minimal or coordinate with g |
| 33.8s | operator | conflicts after bob's edit (+22.7s) | L0/warning/same_file:src/app/routes/article/article.service.ts, L0/info/scope_overlap:src/app/routes/article/article.service.ts ~ src/app/routes/article/**, L0/high/same_symbol_declared:symbol:profileMapper, L0/warning/same_symbol_declared:symbol:getArticles,  |
| 35.4s | alice/claude | PreToolUse on profile.utils.ts | ask (76ms) |
| 35.5s | bob/codex | PreToolUse on article.service.ts twice | deny then allow (75ms) |
| 45.8s | alice/claude | gtv_ask (tier 1, real brain) | [gtv answer tk_f0220a35f6aa from operator, confidence high] Q: How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it? A: Bob’s WIP calls `profileMapper(comment.author, id)` in `getCommentAuthors` (and the exis |
| 56.0s | bob/codex | gtv_ask (decision question, real brain) | Ticket tk_84767e708674: forwarded to alice (Operator note: The current WIP diffs show Alice's change as a maximum of 100 while preserving the existing default of 10, and Bob's change sets the default to 20. Both can coexist as default 20, capped at 100, but Al |
| 56.1s | alice/claude | gtv_reply | Answer sent for tk_84767e708674. |
| 78.9s | operator | after coordination | L0/warning/open:src/app/routes/article/article.service.ts, L0/info/open:src/app/routes/article/article.service.ts ~ src/app/routes/article/**, L0/high/open:symbol:profileMapper, L0/warning/open:symbol:getArticles, L0/high/open:planned:profileMapper, L2/high/ac |

## Brain
- L3 registration judgement: Talk to Alice before implementation: confirm the profileMapper viewer-object contract and reconcile default page size 20 with the 100-item cap. No relevant ADR/doc was found in the knowledge-base search. Neither workspace has a WIP snapshot, so the assessment is based on registered task scopes and current main signatures.
- Tier-1 answer: [gtv answer tk_f0220a35f6aa from operator, confidence high] Q: How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it? A: Bob’s WIP calls `profileMapper(comment.author, id)` in `getCommentAuthors` (and the existing article mapping also passes `id`). If your new signature is `profileMapper(user, viewer?: { id: number })`, those calls will break: `id` is a bare `number / undefined`, not a viewer object. Bob would need to pass `id === undefined ? undefined : { id }` (and the other call site must be updated too). His WIP also sets the article default limit to 20; that can coexist with your maximum of 100 if the page size is clamped at 100, but coordinate the overlapping `getArticles` edits with Bob. Sources: file:ws_3d7c39f17b:src/app/routes/article/article.service.ts:643-647, file:ws_3d7c39f17b:src/app/routes/article/article.service.ts:654-660, file:ws_aaf696e769:src/app/routes/profile/profile.utils.ts:4-10, conflict:cf_49c6bfdbf6c5, conflict:cf_373c21b5aa62

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
