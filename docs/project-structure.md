# Cấu trúc dự án và chia vùng việc

## Bản đồ thư mục

```
bin/gtv.mjs                 entry CLI; `gtv hook` chạy bằng JS thuần (nhanh), lệnh khác nạp src/daemon/cli.ts
src/
  shared/                   types, feature flags, utils (glob, git, hash), wrapper SQLite
  codeintel/                tree-sitter: languages, extract, diff, graph, indexer
  server/
    main.ts  config.ts      khởi động: config → hub → HTTP
    hub/                    nhiều project, tài khoản, máy, quyền theo project, thống kê Brain
    project/                runtime 1 project: engine, store, repo mirror, schema
    detect/                 L0, L1, L2 (L3 nằm trong project/engine.ts)
    qa/                     ticket hỏi đáp 3 bậc
    knowledge/              KB docs/ADR/Q&A (FTS5)
    brain/                  Pi/Null brain, metering, prompt + schema, tool chỉ-đọc cho Brain
    http/                   app, auth, agent-routes (/v1/p/:id), admin-routes (/api)
  daemon/                   daemon trên máy dev, hooks, decide, workspace, tools, snapshot, MCP stdio, install, CLI
  adapters/                 SKILL.md dùng chung
web/                        dashboard (Vite + React), xem web/README.md
docker/                     Dockerfile (operator + dashboard, Brain chạy bên trong), compose, gtv.config.yml
scripts/                    sandbox.ts, selftest/realworld.ts
test/                       node:test — codeintel, server, admin, e2e, pi, regressions
examples/sample-repo/       repo mẫu "mini-shop" cho sandbox
docs/                       tài liệu (docs/reports: báo cáo sinh tự động)
```

## Phụ thuộc giữa các vùng

```
                 ┌──────────── H Ops (docker, scripts) ───────────┐
                 │                                                 │
   G Dashboard ──┼─(HTTP /api, /v1)──► E Hub / HTTP / Project ◄────┼── F Daemon & adapters (HTTP /v1, SSE)
                 │                      │  │   │   │                │
                 │        ┌─────────────┘  │   │   └────────────┐   │
                 │        ▼                ▼   ▼                ▼   │
                 │   B Detection      C Q&A & Brain        D Knowledge
                 │        │                │                        │
                 │        └──────► A Code intelligence ◄────────────┘ (brain tools dùng graph)
                 │                         │
                 └────────────────► shared/ (types, features, util, db) ◄── mọi vùng
   I Evaluation (test/, scripts/selftest) — kiểm tra tất cả, không được import từ test vào src
```

**Quy tắc**

- `src/shared` không import gì ngoài chính nó.
- `src/codeintel` chỉ import `shared/` và **type** `Repo` từ `server/project/repo.ts` (không import `http`, `hub`, `daemon`).
- `src/server/detect`, `qa`, `knowledge`, `brain` không import `http` hay `hub`. Chỉ `project/engine.ts` ghép chúng lại.
- `src/daemon` chỉ dùng `shared/`; nói với server **chỉ qua HTTP**.
- `web/` chỉ nói với server qua HTTP; kiểu dữ liệu sao chép ở `web/src/api/types.ts`.
- Đổi shape JSON của API ⇒ cập nhật `web/src/api/types.ts` và [api.md](api.md) cùng lúc.

## Các vùng việc

### A — Code intelligence · `src/codeintel/`

|                |                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trách nhiệm    | Parse 5 ngôn ngữ, trích symbol/chữ ký/tham chiếu/import, diff symbol, code graph base + overlay, indexer đồng bộ với git                                                                                                           |
| File chính     | `languages.ts` (grammar + query tham chiếu), `extract.ts` (`indexFile`), `diff.ts` (`diffSymbols`, `BREAKING`), `graph.ts` (`CodeGraph`, `inView`, `importPointsTo`), `indexer.ts` (`syncBase`, `syncOverlay`, `workspaceChanges`) |
| Cung cấp       | `indexFile`, `diffSymbols`, `CodeGraph.whoCalls/impact/findSymbols/overview`, `syncBase/syncOverlay/workspaceChanges`                                                                                                              |
| Dùng           | `shared/db.ts`, `shared/util.ts`, type `Repo`                                                                                                                                                                                      |
| Test           | `test/codeintel.test.ts`                                                                                                                                                                                                           |
| Việc điển hình | thêm ngôn ngữ (C#, Rust…), phân giải tham chiếu chính xác hơn (SCIP), cải thiện phát hiện rename                                                                                                                                   |
| Làm độc lập    | chạy `node --test test/codeintel.test.ts`; không cần server/docker                                                                                                                                                                 |

### B — Detection · `src/server/detect/` + phần detect trong `src/server/project/engine.ts`

|                |                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trách nhiệm    | L0 (`detectL0`, `outOfScope`), L1 (`detectL1For`), L2 (`detectL2Pair`, `saveSymbolChanges`, `saveChangedLines`, `changedLineFilter`), L3 (`judgeRegistration` trong engine), áp feature mode (`applyLayer`), thông báo (`notifyConflicts`) |
| Cung cấp       | `FoundConflict[]` (id ổn định qua `key`), `Store.syncConflicts`                                                                                                                                                                            |
| Dùng           | A (graph, diff), `project/repo.ts`, `shared/`                                                                                                                                                                                              |
| Test           | `test/server.test.ts` (L0/L1/L2, shadow), `test/e2e.test.ts`, self-test RealWorld                                                                                                                                                          |
| Việc điển hình | lớp mới (vd chạy test khi gộp kiểu STALE), giảm báo nhầm, mức độ/hành động mới                                                                                                                                                             |
| Làm độc lập    | viết detector thuần trả `FoundConflict[]`, test bằng repo git tạm (`test/helpers.ts`)                                                                                                                                                      |

### C — Q&A & Brain · `src/server/qa/`, `src/server/brain/`

|                |                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trách nhiệm    | Ticket 3 bậc, timeout/leo thang; backend Brain; prompt + JSON schema; tool chỉ-đọc cho Brain; metering                                                  |
| File chính     | `qa/tickets.ts`, `brain/types.ts`, `brain/pi.ts`, `brain/tools.ts`, `brain/metered.ts`, `brain/prompts.ts`                                              |
| Cung cấp       | `TicketService.ask/reply/tick`, interface `Brain`, `ProjectScopedBackend`, `brainTools`                                                                 |
| Test           | `test/server.test.ts` (FakeBrain, 3 bậc, tool), `test/pi.test.ts` (Pi với model giả), `test/admin.test.ts` (metering), self-test (Brain thật, vài lượt) |
| Việc điển hình | tool mới cho Brain, chỉnh prompt, provider LLM mới (thường chỉ là cấu hình Pi)                                                                          |
| Làm độc lập    | dùng `FakeBrain` trong test; **không chạy vòng lặp gọi LLM thật**                                                                                       |

### D — Knowledge · `src/server/knowledge/`

|                |                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Trách nhiệm    | Nạp markdown từ `main` (glob `knowledge.doc_globs`), chia section, FTS5 BM25, Q&A `unverified` → `active` |
| Cung cấp       | `KnowledgeBase.search/upsert/setStatus/syncFromRepo/addQa`, `headingTitle`                                |
| Test           | `test/server.test.ts`, `test/admin.test.ts`                                                               |
| Việc điển hình | embedding + `sqlite-vec`, importer Notion/Google Docs, liên kết doc ↔ symbol                              |

### E — Hub / HTTP / Project runtime · `src/server/hub/`, `src/server/http/`, `src/server/project/`

|                |                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Trách nhiệm    | Nhiều project, token, settings; vòng đời runtime; registry (`store.ts`); mirror (`repo.ts`); toàn bộ route và auth |
| Cung cấp       | API trong [api.md](api.md)                                                                                         |
| Test           | `test/admin.test.ts`, `test/server.test.ts`                                                                        |
| Việc điển hình | endpoint mới cho dashboard, webhook GitHub, phân quyền theo project                                                |
| Làm độc lập    | test qua `srv.app.request(...)` (không cần mở cổng)                                                                |

### F — Daemon & agent adapters · `src/daemon/`, `src/adapters/`, `bin/`

|                |                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trách nhiệm    | Hook → quyết định local; SSE theo project; inbox; snapshot; tool `gtv_*`; cài đặt cho từng agent; CLI                                                                      |
| File chính     | `daemon.ts`, `hooks.ts` (normalize/format theo agent), `decide.ts`, `workspace.ts`, `tools.ts`, `snapshot.ts`, `mcp.ts`, `install.ts`, `cli.ts`, `adapters/skill/SKILL.md` |
| Test           | `test/e2e.test.ts` (2 daemon thật + server + git), self-test                                                                                                               |
| Việc điển hình | adapter Cursor/Grok, tối ưu độ trễ hook, statusline                                                                                                                        |

### G — Dashboard · `web/`

Xem [../web/README.md](../web/README.md). Chỉ dùng `/api/*` và `/v1/p/:id/*`. Kiểm tra: `npm --prefix web run build`.

### H — Ops · `docker/`, `scripts/sandbox.ts`

Compose 2 service (`operator`, `brain`), Dockerfile multi-stage (build dashboard), config YAML, sandbox. Xem [operations.md](operations.md).

### I — Evaluation · `test/`, `scripts/selftest/`

Test tự động và self-test trên repo thật. Xem [testing.md](testing.md).

## Gợi ý phân công cho nhóm 3 người

| Người | Vùng                                                                                     |
| ----- | ---------------------------------------------------------------------------------------- |
| 1     | A + B (phát hiện conflict)                                                               |
| 2     | C + D + E (Operator, Brain, API)                                                         |
| 3     | F + G + H (máy dev, dashboard, vận hành) · I chia đều: ai sửa vùng nào viết test vùng đó |
