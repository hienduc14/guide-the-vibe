# Self-test: RealWorld (Node/Express) — 2 developers editing in parallel

Run: 2026-11-06T05:08:28.663Z · duration 70.0s · checks **21/21 passed** · real brain jobs: **3** (8963 ms p50)

Repo: `gothinkster/node-express-realworld-example-app` (TypeScript, 67 files) mirrored as a local bare repo.
Agents are simulated by sending the exact hook payloads of Claude Code (alice) and Codex (bob) to the real daemons;
files are really edited in two clones, WIP snapshots really pushed, the Operator and the brain (`pi anthropic/claude-haiku-5-5`) are real.

## Scenario
- **alice** (Claude Code): `profileMapper(user, id)` → `profileMapper(user, viewer?: { id })` (breaking), updates the 5 existing callers, caps article page size at 100.
- **bob** (Codex): new `getCommentAuthors()` calling `profileMapper(author, id)` with the old signature; changes the same page-size line to 20; unrelated edit in `tag.service.ts`.
- They coordinate through the Operator, bob adapts, alice merges to master.

## Checks
| | Check | Detail |
|---|---|---|
| ✅ | both sessions receive the Operator briefing |  |
| ✅ | alice registration accepted | Registered task task_2fdb35a8dfd0 "Profiles take a viewer object; cap article page size at 100". Status: ok. |
| ✅ | bob is told about the overlap at registration (before any code) | Registered task task_46e9692b18fb "Show comment authors' profiles; default article page size 20". Status: needs_coordination. |
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
| ✅ | conflict notices reach alice's agent (pre/post hooks) | [gtv WARNING · L0] bob (bob@master, task "Show comment authors' profiles; default article page size 20") is editing src/app/routes/article/article.service.ts, which is inside the registered scope "src |
| ✅ | tier 1: the brain answers from bob's WIP with sources | [gtv answer tk_8dcf3112d64d from operator, confidence high] Q: How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it? A: Bob's WIP calls profileMapper with a bare id in  |
| ✅ | brain routes a decision question to the owner (tier 2) | Ticket tk_515d880d9d31: forwarded to alice (Operator note: Not decided in the code or KB. Alice's task (task_2fdb35a8dfd0) caps article pages at 100 by changing getArticles to Math.min(Number(query.li |
| ✅ | the forwarded question is injected into alice's agent mid-turn | [gtv question tk_515d880d9d31 from bob] Bob wants the default article page size to be 20 (currently 10) in getArticles, alongside your 100 cap. Which default should we ship: 20 or 10? Also, once you'v |
| ✅ | alice's answer is delivered back into bob's agent | [gtv answer tk_515d880d9d31 from alice's agent, confidence high] Q: Alice caps the article page size at 100 and I wanted the default to be 20 instead of 10. Which default page size should we ship? Ali |
| ✅ | L1 resolves by itself once the overlapping edit is gone | 21.1s |
| ✅ | alice's task closes automatically after her work lands on master | 0.0s |
| ✅ | bob's WIP merges cleanly with the new master |  |

## Timeline
| t | who | action | result |
|---|---|---|---|
| 0.2s | alice/claude | SessionStart | gtv Project Operator is active for this repo. |
| 0.2s | bob/codex | SessionStart | gtv Project Operator is active for this repo. |
| 0.3s | alice/claude | gtv_register_task | Registered task task_2fdb35a8dfd0 "Profiles take a viewer object; cap article page size at 100". Status: ok. |
| 9.8s | bob/codex | gtv_register_task (9.5s incl. L3 brain) | Registered task task_46e9692b18fb "Show comment authors' profiles; default article page size 20". Status: needs_coordination. / - [info L0] with alice (alice@master): Registered scopes overlap: alice (alice@master, task "Profiles take a viewer object; cap arti |
| 9.8s | alice/claude | edited profile.utils.ts, profile.service.ts, article.service.ts | pre-edit decision on article.service.ts: allow; context: [gtv] src/app/routes/article/article.service.ts is inside the registered scope of bob ("Show comment authors' profiles; default article page size 20"). Keep cha |
| 9.8s | bob/codex | edited tag.service.ts (independent) and article.service.ts (new getCommentAuthors + page size 20) | pre-edit: allow; [gtv] src/app/routes/article/article.service.ts is inside the registered scope of alice ("Profiles take a viewer object; cap article page size at 100"). Keep changes there minimal or coordinate with g |
| 30.9s | operator | conflicts after bob's edit (+21.1s) | L0/warning/same_file:src/app/routes/article/article.service.ts, L0/info/scope_overlap:src/app/routes/article/article.service.ts ~ src/app/routes/article/**, L0/high/same_symbol_declared:symbol:profileMapper, L0/warning/same_symbol_declared:symbol:getArticles,  |
| 32.4s | alice/claude | PreToolUse on profile.utils.ts | ask (12ms) |
| 32.5s | bob/codex | PreToolUse on article.service.ts twice | deny then allow (10ms) |
| 41.5s | alice/claude | gtv_ask (tier 1, real brain) | [gtv answer tk_8dcf3112d64d from operator, confidence high] Q: How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it? A: Bob's WIP calls profileMapper with a bare id in getCommentAuthors (article.service.ts:65 |
| 48.5s | bob/codex | gtv_ask (decision question, real brain) | Ticket tk_515d880d9d31: forwarded to alice (Operator note: Not decided in the code or KB. Alice's task (task_2fdb35a8dfd0) caps article pages at 100 by changing getArticles to Math.min(Number(query.limit) // 10, 100) (article.service.ts:83 in her WIP). The cur |
| 48.5s | alice/claude | gtv_reply | Answer sent for tk_515d880d9d31. |
| 69.6s | operator | after coordination | L0/warning/open:src/app/routes/article/article.service.ts, L0/info/open:src/app/routes/article/article.service.ts ~ src/app/routes/article/**, L0/high/open:symbol:profileMapper, L0/warning/open:symbol:getArticles, L0/high/open:planned:profileMapper, L2/high/ac |

## Brain
- L3 registration judgement: Coordinate before coding: Bob and Alice must agree on the profileMapper signature (alice owns the change, since it is her sig_change) and on who owns the getArticles limit logic. No ADR or doc covers this in the knowledge base, so the agreement needs to come from the two of them. Neither workspace has a WIP snapshot yet, so the real diffs could differ from the declared scope; re-check once snapshots exist.
- Tier-1 answer: [gtv answer tk_8dcf3112d64d from operator, confidence high] Q: How is bob calling profileMapper in his work in progress, and will my change to a viewer object break it? A: Bob's WIP calls profileMapper with a bare id in getCommentAuthors (article.service.ts:659: `comments.map((comment: any) => profileMapper(comment.author, id))`, where `id?: number`). Your change to `profileMapper(user, viewer?: {id})` would break it: the number would be read as `viewer.id`, which is undefined, so the viewer-dependent field (e.g. following state) would silently be wrong, and TypeScript should flag it once the signature changes. Bob's task declares a read dependency on profileMapper, and the open conflicts cf_cf390e87a80b and cf_d6bf86269929 already flag this. Bob's WIP is not yet merged; he needs to adapt getCommentAuthors to pass `{ id }` (or agree on the shape with you first). On main, you also need to update the other bare-id callers: article.service.ts:599 and :645, profile.service.ts:19, :39, :59, and src/tests/utils/profile.utils.test.ts:24, :50, :76. Note that the getArticles limit conflict (cf_e944cd92e415, cf_2816dcca7957) is separate and needs agreement with Bob on who owns the clamp versus the default of 20. No knowledge base entry covers this decision. Sources: symbol:src/app/routes/profile/profile.utils.ts#profileMapper, file:src/app/routes/article/article.service.ts:659 (ws_7144859f39), file:src/app/routes/article/article.service.ts:599, :645 (base), file:src/app/routes/profile/profile.service.ts:19, :39, :59 (base), file:src/tests/utils/profile.utils.test.ts:24, :50, :76 (base), conflict:cf_cf390e87a80b, conflict:cf_d6bf86269929, conflict:cf_2816dcca7957, task:task_46e9692b18fb

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
