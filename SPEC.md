# SPEC — Project Operator cho nhóm vibe code (tên mã: **gtv** / Guide the Vibe)

| | |
|---|---|
| **Phiên bản** | v0.5 — nhiều project, dashboard, tự kiểm thử trên repo thật (mục 22); v0.4: bản cài đặt đầu tiên |
| **Ngày** | 24/10/2026 |
| **Loại dự án** | Đồ án môn học |
| **Tên đề tài** | AI Agent điều phối dự án trong Coding |
| **Trạng thái** | Bản nháp để phản biện. Các chỗ ❓ là câu hỏi mở (mục 19) |

> **Thay đổi so với v0.2:**
> - Trung tâm là **một agent Project Operator trên server**, không còn là một service chạy thuần bằng code.
> - Có thêm chức năng **hỏi đáp giữa lúc code** và **chuyển câu hỏi sang agent khác**.
> - Có thêm **tri thức**: code graph (GraphRAG trên code) và RAG cho tài liệu nghiệp vụ.
> - Giữ L2 (tree-sitter). Mọi lớp đều **bật/tắt được, có chế độ shadow** (mục 8).
> - Bảng hook được cập nhật theo tài liệu đã kiểm chứng.
> - Đổi cách dùng LLM cho đúng điều khoản subscription.

---

## 1. Tóm tắt

2–3 developer cùng dùng AI coding agent (Claude Code, Codex, omp…) trên một repo GitHub. Mỗi agent làm trên branch hoặc worktree riêng. Không ai biết người khác đang làm gì, và muốn biết thì dev phải nhắn hỏi nhau. Cả conflict lẫn việc chờ trả lời đều làm chậm nhóm.

**gtv đặt một Project Operator trên server.** Đây là một agent đóng vai "người điều phối dự án", có 3 chức năng:

1. **Đăng ký task.** Trước khi làm, agent đăng ký task (mục tiêu, phạm vi, symbol định đổi) lên Operator. Operator đối chiếu với các task đang chạy, có bằng chứng từ bộ phát hiện conflict L0–L3, rồi báo lại để agent **điều chỉnh từ trước khi code**.
2. **Hỏi Operator giữa lúc code.** Khi agent thấy một đoạn không ổn hoặc cần biết thêm, nó hỏi Operator qua tool/skill. Operator trả lời dựa trên **tri thức dự án**: code graph, tài liệu nghiệp vụ, task và code WIP của mọi người, các quyết định đã chốt. Câu trả lời luôn **kèm nguồn**.
3. **Chuyển câu hỏi sang agent khác.** Khi câu hỏi cần **người khác quyết định**, Operator chuyển câu hỏi vào hộp thư agent của người đó. Câu hỏi được chèn vào agent bên kia ngay ở lần gọi tool kế tiếp. Câu trả lời đi ngược lại tới agent hỏi, và dev không phải nhắn nhau thủ công.

Merge cuối cùng vẫn qua GitHub PR + CI. gtv không thay Git.

**Thông điệp:** từ *sửa conflict sau khi xảy ra* và *dev phải hỏi nhau* sang *biết trước, hỏi Operator và tự phối hợp ngay trong lúc code*.

---

## 2. Bối cảnh và vấn đề

### 2.1 Pain points
| # | Pain point | Bằng chứng |
|---|---|---|
| P1 | Conflict vốn đã thường xuyên; AI code nhanh và sửa lan rộng | 10–20% số lần merge gặp conflict (Brun et al. 2011: 16%; Ghiotto et al.: 11,9% trên 960 nghìn merge) |
| P2 | Phát hiện quá muộn nên sửa rất đắt | Trung bình khoảng 10 ngày mới giải quyết xong (Brun et al.) |
| P3 | AI tạo ra conflict, người phải dọn | 96,1% conflict trong PR do AI agent tạo là do người giải quyết (SBES 2026) |
| P4 | Xung đột logic: Git merge sạch nhưng chạy sai | STALE (arXiv 2609.25396): xuất hiện ở 97% số lần chạy trên task dựng sẵn, nhưng hiếm trên cặp PR thật (1/834). **Một tin nhắn mô tả thay đổi song song đã sửa được 82% số trường hợp** → awareness có tác dụng |
| P5 | **Giao tiếp là nút thắt**: agent dừng lại chờ dev hỏi dev | Stack Overflow: 53% dev cho biết chờ câu trả lời làm gián đoạn công việc. CooperBench (ICLR 2026): hai agent cùng làm có tỷ lệ thành công **thấp hơn khoảng 30%** so với một agent làm cả hai, do tin nhắn mơ hồ, cam kết bị phá vỡ, giả định sai về đồng đội |

⚠️ Không dùng con số "59,1% PR bị conflict". ⚠️ Kết quả trên task dựng sẵn luôn cao hơn thực tế (bài học từ STALE). Cần nói rõ điều này trong báo cáo.

### 2.2 Nguyên nhân gốc
Branch và worktree cô lập code, nhưng cũng **cô lập thông tin**. Không có nơi nào để agent hỏi: "ai đang làm gì?", "hàm này ai phụ trách, sắp đổi không?", "nghiệp vụ này đã chốt thế nào?".

### 2.3 Khoảng trống
| Nhóm | Ví dụ | Thiếu gì so với gtv |
|---|---|---|
| Quy trình | Trunk-based, CODEOWNERS | Dựa vào kỷ luật; không có thời gian thực |
| Phát hiện sớm | GitKraken, Crystal | Báo cho người, không báo cho agent; không hỏi đáp được |
| Xử lý lúc merge | Merge Queue, Mergiraf, Copilot | Chữa cháy |
| Công cụ cho agent | MCP Agent Mail, scoped, Claude Code Agent Teams | Chủ yếu một máy và mức file; không có Operator mang tri thức dự án |
| Nghiên cứu 2026 | Claim Plane, NP-Bench, MPAC | Một loại agent, thí nghiệm nhỏ; không có hỏi đáp dựa trên tri thức |
| Code graph cho agent | codebase-memory-mcp, GitNexus, Serena | Phục vụ một agent, một máy; không nắm việc đang dở của người khác |

**gtv = điều phối nhiều dev, nhiều loại agent + Operator có tri thức dự án (code graph + nghiệp vụ + trạng thái WIP sống) + phát hiện conflict nhiều lớp + chuyển câu hỏi giữa các agent.**

---

## 3. Mục tiêu, ngoài phạm vi, ràng buộc

### 3.1 Mục tiêu
- **G1 Đăng ký và điều chỉnh:** mọi task được đăng ký trước khi sửa; conflict được báo **trước khi code**.
- **G2 Hỏi đáp:** agent hỏi được Operator giữa lúc code; câu trả lời có nguồn và đúng phần lớn thời gian.
- **G3 Chuyển câu hỏi:** câu hỏi cần quyết định của người khác tới đúng agent hoặc đúng người, rồi quay về, không cần dev nhắn tay.
- **G4 Phát hiện conflict nhiều lớp:** L0 path → L1 thử merge ngầm → L2 tree-sitter symbol → L3 LLM.
- **G5 Tri thức dự án:** code graph tất định (dựng bằng code, không bằng LLM) + RAG nghiệp vụ + trạng thái sống.
- **G6 Đa agent:** demo Claude Code, Codex, omp; kiến trúc cho phép thêm Cursor, Grok Build.
- **G7 Module hóa:** mọi lớp và tính năng có cờ `off | shadow | on`; lỗi ở một lớp không làm sập hệ thống.
- **G8 Chứng minh được:** đánh giá conflict + đánh giá hỏi đáp (mục 14).

### 3.2 Ngoài phạm vi
- Thay Git, CI hay review; tự resolve conflict; dashboard quản lý tiến độ; tự chia task.
- Operator **không** tự thương lượng thay người khi cần quyết định thật sự. Nó chỉ chuyển câu hỏi và tóm tắt.
- Operator **không** sửa code. Nó chỉ đọc.
- Khóa cứng file hay module.

### 3.3 Ràng buộc
- **Chỉ dùng gói subscription, không có API key trả theo token**, và **phải đúng điều khoản** (mục 7.2.1).
- Deadline đồ án khoảng 4 tuần. Spec này **liệt kê đủ tính năng**; lộ trình chia theo giai đoạn và có vạch "demo tối thiểu" (mục 16).
- Nhóm dùng Windows. Server khuyến nghị chạy Linux hoặc WSL2 (❓).

### 3.4 Tiêu chí thành công
| Hạng mục | Mục tiêu |
|---|---|
| Phát hiện conflict | Recall ≥ 80%, precision ≥ 70% trên bộ kịch bản |
| Hỏi đáp | ≥ 70% câu trả lời đúng; ≥ 90% câu trả lời đúng có nguồn đúng; Operator nói "không biết" thay vì bịa |
| Chuyển câu hỏi | ≥ 80% câu cần quyết định được chuyển đúng người; câu tự trả lời được thì không làm phiền người khác |
| Hiệu năng | Hook p95 < 100 ms; câu trả lời bậc 1 p50 < 30 s |
| Độ bền | Server hoặc Operator chết thì agent vẫn làm việc bình thường (fail-open) |

---

## 4. User stories

| ID | Là… | Tôi muốn… | Để… |
|---|---|---|---|
| US1 | agent của dev | đăng ký task và nhận phản hồi conflict trước khi sửa | điều chỉnh phạm vi hoặc cách làm từ đầu |
| US2 | agent | được báo khi bắt đầu sửa ngoài phạm vi đã đăng ký | cập nhật đăng ký, tránh đụng người khác |
| US3 | agent | hỏi "hàm X dùng ở đâu, ai đang sửa, nghiệp vụ Y quy định gì?" | làm tiếp mà không phải dừng chờ dev |
| US4 | agent | hỏi một câu cần dev B quyết định và **không bị treo** chờ | làm phần khác trong lúc chờ |
| US5 | agent của dev B | nhận câu hỏi từ Operator giữa lượt làm việc và trả lời | B không phải mở chat |
| US6 | dev | được hỏi xác nhận khi conflict ở mức High/Critical | giữ quyền quyết định |
| US7 | dev | xem `gtv status` / statusline: ai làm gì, câu hỏi nào đang chờ mình | nắm tình hình nhanh |
| US8 | dev | thêm hoặc sửa tài liệu nghiệp vụ và quyết định (ADR) | Operator trả lời đúng nghiệp vụ |
| US9 | nhóm đồ án | bật/tắt hoặc shadow từng lớp, phát lại log để đo | đánh giá ablation và tắt lớp chưa ổn |

---

## 5. Thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| **Operator** | Agent trên server, gồm Operator Service (phần chạy bằng code) + Brain (LLM agent) |
| **Brain** | Nền tảng agent (OpenCode, Codex…) mà Operator dùng để suy luận và trả lời; thay được |
| **Task registration** | Bản đăng ký task: mục tiêu, base commit, tài nguyên định chạm, thao tác chắc chắn/có thể (theo mẫu Claim Plane/MPAC) |
| **Footprint** | Những gì session đã thực sự sửa (từ hook + git) |
| **Drift** | Footprint vượt ra ngoài phạm vi đã đăng ký |
| **WIP snapshot** | Commit tạm của working tree, đẩy lên `refs/gtv/<dev>/<session>` |
| **Code graph** | Đồ thị File/Module/Symbol/quan hệ, dựng bằng tree-sitter, gồm lớp nền `main` + lớp phủ (overlay) theo từng dev |
| **Doc KB** | Kho tri thức nghiệp vụ: tài liệu, ADR, lịch sử hỏi đáp |
| **Ticket** | Một câu hỏi gửi Operator, có trạng thái và bậc xử lý |
| **Mode** | Trạng thái của một tính năng: `off` / `shadow` (chạy và ghi log, không báo ai) / `on` |

---

## 6. Kiến trúc tổng quan

```
 Máy mỗi dev                                         Server
┌──────────────────────────────────────┐   ┌────────────────────────────────────────────┐
│ Claude Code │ Codex │ omp │ (Cursor…)│   │            OPERATOR SERVICE (Bun)          │
│   hooks / extension / skill / MCP    │   │  ┌────────────┐  ┌───────────────────────┐ │
│              │                       │   │  │ Task &     │  │ Conflict Detector     │ │
│              ▼                       │   │  │ Session    │  │ L0 path   L1 merge    │ │
│ Adapter (mỏng, mỗi agent một bản)    │   │  │ Registry   │  │ L2 symbol L3 LLM      │ │
│              │ localhost             │   │  ├────────────┤  └───────────────────────┘ │
│              ▼                       │   │  │ Ticket &   │  ┌───────────────────────┐ │
│ gtv daemon ── cache, MCP server ─────┼──►│  │ Inbox      │  │ Knowledge             │ │
│   ├ statusline / notify              │SSE│  └────────────┘  │ K1 Code Graph (SQLite)│ │
│   └ WIP snapshot ──git push──┐       │◄──┤                  │ K2 Doc KB (FTS+vec)   │ │
└──────────────────────────────┼───────┘   │                  │ K3 Live state         │ │
                               ▼           │                  └───────────────────────┘ │
                          ┌─────────┐ fetch│  Feature flags · Event log · Replay         │
                          │ GitHub  │◄─────┤          │ MCP (tools cho Brain)            │
                          └─────────┘      │          ▼                                  │
                                           │   BRAIN (pluggable): OpenCode server │       │
                                           │   Codex app-server │ Claude Agent SDK│ AI SDK│
                                           │   — chỉ đọc, sandbox, có repo mirror —      │
                                           └────────────────────────────────────────────┘
```

### Nguyên tắc kiến trúc
1. **Operator = Service + Brain.** Mọi thứ cần chính xác và đo được (registry, inbox, detector, code graph, RAG) nằm trong Service, chạy bằng code. **Brain chỉ suy luận và diễn đạt**, và gọi các phần trên qua MCP tools. Nhờ vậy Brain thay được khi điều khoản, quota hay chất lượng có vấn đề.
2. **Hook gọi daemon local, không gọi server.** Hook phải nhanh và fail-open.
3. **Bằng chứng trước, LLM sau.** L0–L2 và code graph đưa ra bằng chứng; Brain/L3 chỉ phán đoán dựa trên bằng chứng đó.
4. **Mọi tính năng có cờ và cầu dao tự ngắt (circuit breaker).**
5. **GitHub là nguồn sự thật cho code; Operator là nguồn sự thật cho công việc đang dở và tri thức dự án.**

---

## 7. Thành phần chi tiết

### 7.1 Operator Service
- **Runtime:** Bun + Hono, SQLite (`bun:sqlite`). Một file DB chứa registry, graph, KB và log.
- **Kết nối:** REST + SSE cho daemon; MCP server (HTTP) cho Brain; bare mirror của repo để fetch `refs/gtv/*`.
- **Xác thực:** token riêng cho từng dev; Brain dùng token nội bộ chỉ có quyền đọc.

#### Mô hình dữ liệu (chính)
| Bảng | Trường chính |
|---|---|
| `developer` | id, name, github_login, git_emails[], token_hash |
| `session` | id, dev_id, agent_kind, machine, branch, base_sha, status, last_heartbeat, capabilities (ask/inject/rewake) |
| `task` | id, session_id, title, goal, base_sha, status (registered/active/pr_open/done/abandoned), registration (JSON), pr_number |
| `task_resource` | task_id, kind (path/glob/module/symbol/contract/data), value, op (read/modify/create/delete/rename/sig_change), certainty (committed/contingent), source (declared/plan/footprint) |
| `footprint` | session_id, path, first_edit_at, last_edit_at, count, in_scope (bool) |
| `wip_snapshot` | session_id, ref, sha, base_sha, created_at |
| `symbol_change` | session_id, symbol_id, change (added/sig_changed/body_changed/deleted/renamed), old_sig, new_sig |
| `conflict` | id, session_a, session_b, layer (L0–L3), kind, level, evidence (JSON), status (open/acked/resolved/dismissed) |
| `ticket` | id, from_session, question, context (JSON), tier (1/2/3), status (answering/answered/forwarded/waiting_human/closed/expired), answer, sources (JSON), confidence, to_session/to_dev |
| `message` | id, ticket_id?, conflict_id?, from, to_session/to_dev, body, delivered_at, read_at |
| `kb_doc`, `kb_chunk` | Tài liệu nghiệp vụ, ADR, Q&A (mục 7.3.2) |
| `graph_*` | Code graph (mục 7.3.1) |
| `feature_state` | feature, mode, auto_disabled_reason, error_count |
| `event_log` | Mọi event, input/output của detector và Brain, phục vụ replay |

### 7.2 Brain: nền tảng agent cho Operator

#### 7.2.1 Điều khoản subscription (quyết định lớn nhất)
| Nhà cung cấp | Tình trạng 10/2026 | Hệ quả cho gtv |
|---|---|---|
| **Anthropic, gói Pro/Max** | Điều khoản: OAuth của subscription chỉ dùng cho Claude Code và app gốc của Anthropic; nhà phát triển (kể cả khi dùng Agent SDK) phải dùng API key; cấm dùng credentials Free/Pro/Max để phục vụ người khác. `claude -p` trên máy mình cho chính mình thì được. | **Không dùng** subscription Claude làm Brain cho server phục vụ cả nhóm, kể cả qua `claude -p`. Đây là sửa đổi so với v0.2 (L3 qua `claude -p`). |
| **Anthropic, Max 5x/20x** | Từ 07/10/2026 có **$100–$200 API credit mỗi tháng**, không cần thẻ, dùng được cho Agent SDK, hết thì dừng (Pro không có) | Nếu nhóm có người dùng Max → **đường hợp lệ** để dùng Claude làm Brain |
| **OpenAI, ChatGPT Plus/Pro** | Hỗ trợ chính thức đăng nhập ChatGPT cho Codex app-server/SDK và OpenCode; "Sign in with ChatGPT" mở cho dự án open-source hoặc cá nhân chạy local | **Đường chính.** Lưu ý: server phục vụ cả nhóm nằm gần ranh giới "hosted"; chạy trên máy trong nhóm sẽ an toàn hơn VPS công khai |
| **Local (Ollama)** | Không ràng buộc | Dự phòng cho L3 phân loại và cho embedding |

❓ Nhóm đang có những gói nào? Có ai dùng Claude Max không? (Q-A)

#### 7.2.2 So sánh nền tảng
| Nền tảng | Ngôn ngữ | API dạng server | MCP/custom tools | Subscription hợp lệ | Đa session | Phù hợp |
|---|---|---|---|---|---|---|
| **OpenCode** (`opencode serve` + `@opencode-ai/sdk`) | TS/Bun | **HTTP + OpenAPI, SSE, prompt_async** | MCP (thêm lúc chạy), custom agents, structured output | ChatGPT Plus/Pro ✅ chính thức; Claude OAuth ❌ bị cấm; Ollama ✅ | Nhiều session, lưu lại | ⭐⭐⭐⭐⭐ |
| **Codex app-server / Codex SDK** | Rust lõi, SDK TS/Py | JSON-RPC stdio (WebSocket chưa hỗ trợ chính thức) | MCP; `dynamicTools` (thử nghiệm) | ChatGPT ✅ chính thức (có device code) | thread start/resume/fork | ⭐⭐⭐⭐⭐ |
| **Claude Agent SDK** (TS) | TS | Thư viện, tự viết HTTP | MCP trong tiến trình, hooks, subagents | Chỉ với API key (Max credits) | resume/fork | ⭐⭐⭐⭐ nếu có Max, ⭐⭐ nếu không |
| **omp SDK / RPC** | TS/Bun | SDK, RPC qua stdio, ACP; không có HTTP | MCP, extensions | ChatGPT ✅; Anthropic OAuth ❌; 60+ providers | Có | ⭐⭐⭐⭐ (nhóm đã dùng omp) |
| Goose (`goose serve`) | Rust | ACP qua SSE | MCP | qua claude-acp/codex-acp | Không resume với ACP | ⭐⭐⭐ |
| OpenHands agent-server | Python | REST + WebSocket | MCP | ChatGPT login (chưa rõ qua server) | Có, Docker | ⭐⭐⭐ |
| Mastra / LangGraph / Letta… | TS/Py | Có | Có | Chủ yếu API key | Có | ⭐⭐ |
| `claude -p` | CLI | Một tiến trình mỗi request | `--mcp-config` | Chỉ hợp lệ cho cá nhân | resume theo ID | ⭐⭐ (vướng điều khoản) |

#### 7.2.3 Lựa chọn
- **Mặc định: OpenCode server + đăng nhập ChatGPT.** Đây là nền tảng duy nhất đã sẵn server HTTP đa session, có SDK TS, SSE, structured output và gắn MCP lúc chạy. Cùng stack Bun/TS với gtv. Đổi sang Ollama hay API key chỉ cần sửa config.
- **Phương án 2: Codex app-server/SDK + ChatGPT.** Chính thức nhất về auth, có đọc được hạn mức (`account/rateLimits/read`). Nhược điểm: giao tiếp qua stdio, phải tự quản một pool tiến trình.
- **Phương án 3: Claude Agent SDK + Max API credits**, nếu nhóm có người dùng Max.
- **Phương án cuối, tự build: Vercel AI SDK v7 (TS).** Không phụ thuộc nhà cung cấp, có MCP client và structured output bằng Zod. Khi đó gtv tự lo vòng lặp agent, lưu trữ và chạy song song.

#### 7.2.4 Giao diện Brain (để thay được)
```ts
interface Brain {
  // Một "job" là một lượt suy luận có tool, trả JSON theo schema
  run(job: {
    kind: "judge_registration" | "answer_question" | "judge_semantic_conflict"
        | "summarize_for_relay" | "extract_intent_from_plan";
    sessionKey: string;           // tái dùng ngữ cảnh theo task/dev
    input: object;                // câu hỏi + bằng chứng đã gom sẵn
    schema: JSONSchema;           // bắt buộc structured output
    budget: { maxTurns: number; timeoutMs: number };
  }): Promise<{ output: object; usage: Usage; trace: ToolCall[] }>;
}
```
Adapter có sẵn: `OpenCodeBrain`, `CodexBrain`, `ClaudeSdkBrain`, `AiSdkBrain`, `NullBrain` (tắt LLM; chỉ trả bằng chứng thô).

#### 7.2.5 Hợp đồng trả lời của Brain (prompt + schema)
- Bắt buộc có: `answer`, `sources[]` (file:dòng, symbol, task_id, doc_id/ADR), `confidence` (high/medium/low), `tier_suggestion` (tự trả lời / cần chuyển cho ai / cần người).
- **Được phép, và được khuyến khích, nói "không biết".** Thiếu nguồn thì không được khẳng định.
- **Chỉ đọc:** Brain chỉ có tool đọc (read file, grep, graph, KB, registry). Không có quyền ghi hay chạy shell tùy ý.
- **Chống prompt injection:** code WIP và tài liệu được coi là dữ liệu không tin cậy. Prompt hệ thống nói rõ không làm theo chỉ dẫn nằm trong dữ liệu. Brain chạy trong thư mục sandbox, không nạp hook hay `.mcp.json` của repo.

#### 7.2.6 Tool (MCP) cấp cho Brain
`registry.tasks()`, `registry.task(id)`, `wip.diff(session)`, `wip.read_file(session, path)`, `repo.read_file(ref, path)`, `repo.grep(ref, pattern)`, `graph.who_calls(symbol, depth, view)`, `graph.impact(symbol|file, view)`, `graph.owner(path|feature)`, `graph.tests_for(symbol)`, `graph.overview(budget)`, `graph.diff_conflicts(devA, devB)`, `kb.search(query, filters)`, `kb.get(doc_id)`, `conflicts.list(session)`, `history.similar_questions(q)`.

### 7.3 Knowledge (tri thức dự án)

#### 7.3.1 K1 — Code graph tất định ("GraphRAG trên code")
**Phản biện quan trọng:** "GraphRAG" kiểu Microsoft (LLM trích thực thể → đồ thị → tóm tắt cộng đồng) **không phù hợp** cho code ở đây:
- Tốn nhiều lượt LLM, không hợp với ràng buộc subscription.
- Kém chính xác hơn phân tích cú pháp.
- Lợi ích chủ yếu ở các câu hỏi tổng quan trên văn bản dài.

Đề xuất thay thế: **code graph dựng bằng tree-sitter, không dùng LLM**, rồi truy xuất có hướng dẫn bằng graph.

Bằng chứng từ nghiên cứu:
- RepoGraph (ICLR 2025): +2–3 điểm % trên SWE-bench Lite; 2-hop kém hơn 1-hop, nên giữ ngữ cảnh truy xuất nhỏ.
- LocAgent: graph dir/file/class/function với các cạnh contain/import/invoke/inherit cho 92,7% định vị đúng file.
- KGCompass: 69,7% lần định vị đúng cần duyệt nhiều bước → nên liên kết cả tài liệu/Q&A với code.
- Codebase-Memory (2026, tác giả tự đánh giá): chất lượng 83% so với 92% của agent đọc file, nhưng ít hơn khoảng 10 lần token → **graph là bước rẻ đầu tiên, không thay việc đọc code**. Brain vẫn phải có `read_file` và `grep`.

**Thiết kế:**
- **Parser dùng chung với L2:** `web-tree-sitter` (WASM). Mỗi lần parse một file ra: symbols (kind, tên đầy đủ, range, `sig_hash`, `body_hash`, exported), imports, các điểm gọi/tham chiếu, liên kết test. Truy vấn theo kiểu `tags.scm`. Ngôn ngữ giai đoạn đầu: TS/JS (❓ thêm Python?).
- **Phân giải tên:** import → file (theo tsconfig paths + quy tắc phân giải module); lời gọi → symbol theo 3 lượt (phạm vi local → tên được import → tên duy nhất toàn repo). Mỗi cạnh có `confidence` (exact/import/name). *Tùy chọn:* chạy `scip-typescript` mỗi khi `main` đổi để nâng cạnh lên exact.
- **Lưu trữ:** SQLite, bảng kề + recursive CTE. Repo cỡ nhóm 2–3 người có khoảng 10⁴–10⁵ cạnh, nên **không cần graph DB**. Kuzu đã bị archive (10/2025); FalkorDB dùng license SSPL; Neo4j quá nặng.
- **Schema:**
  - Nút: `File`, `Module`, `Symbol`, `Person`, `Task`, `Doc`, `Decision`.
  - Cạnh: `CONTAINS`, `IMPORTS`, `CALLS`/`REFERENCES` (kèm confidence), `EXTENDS`/`IMPLEMENTS`, `TESTS`, `OWNED_BY` (từ git blame + CODEOWNERS), `CO_CHANGES` (từ git log), `TOUCHES` (Task→Symbol/File), `MENTIONS` (Doc/Decision→Symbol/File).
- **Cập nhật tăng dần:** so hash nội dung → chỉ parse lại file đổi (vài chục ms mỗi file) → xóa rồi chèn lại symbol và cạnh của file đó → phân giải lại các cạnh "treo" theo tên. Debounce khoảng 5–10 s mỗi dev.
- **Lớp phủ theo dev:** lớp nền `main@sha` + lớp phủ của mỗi dev (chỉ file khác base + tombstone cho file đã xóa). View của dev X = lớp phủ X ∪ phần base không bị che. Từ đó có các truy vấn chéo:
  - A đổi `sig_hash` của `login`, và view của B có `CALLS` vào `login` → **xung đột logic**.
  - Cả hai lớp phủ cùng sửa thân một symbol → **xung đột trực tiếp**.
  - Hai lớp phủ chạm các file có `CO_CHANGES` cao → **cảnh báo mềm**.
- **Bản tham chiếu / dự phòng:** `codebase-memory-mcp` (MIT, SQLite, có watcher, có `detect_changes`). Có thể chạy kèm làm sidecar nếu indexer tự viết chậm tiến độ. Không dùng GitNexus (license PolyForm Noncommercial).

#### 7.3.2 K2 — Doc KB (RAG nghiệp vụ, đơn giản)
- **Nguồn:** thư mục `docs/` trong repo (markdown), `docs/adr/*.md` (quyết định), lịch sử ticket Q&A. ❓ Tài liệu nghiệp vụ hiện đang nằm ở đâu: repo, Notion hay Google Docs? (Q-C)
- **Chia đoạn** theo heading (khoảng 300–800 token), giữ front-matter: `type` (req/adr/qa/glossary), `status` (active/superseded/unverified), `supersedes`, `task_id`, `date`.
- **Tìm kiếm lai:** SQLite FTS5 (BM25) + `sqlite-vec`, gộp bằng Reciprocal Rank Fusion. Vài trăm tài liệu thì KNN brute-force là đủ. Dự phòng: Orama (thuần TS) nếu không nạp được extension SQLite trên máy chủ.
- **Embedding chạy local, không cần key:**
  - EmbeddingGemma-300M qua transformers.js (ONNX, dùng fp32/q8).
  - Hoặc Qwen3-Embedding-0.6B / nomic-embed-text qua Ollama.
- **Liên kết với code:** cạnh `MENTIONS` từ tài liệu tới symbol/file, dò bằng regex trên tên định danh và đường dẫn, cộng thêm độ tương đồng embedding. Nhờ đó Brain đi được từ "nghiệp vụ hoàn tiền" sang `RefundService`.
- **Quyết định và Q&A theo thời gian:** ADR có `status` + `supersedes`; khi truy vấn thì lọc bỏ bản đã bị thay thế.
  - Câu trả lời mới của Operator được lưu với `status: unverified`.
  - Chỉ thành `active` khi dev hoặc owner xác nhận (👍 qua `gtv kb confirm`), hoặc câu trả lời đến từ bậc 2/3 (người thật trả lời).
  - Mục đích: tránh để một câu trả lời sai lan rộng (❓ Q-D).
- **Không dùng** Graphiti, Cognee, Mem0, LightRAG, Microsoft GraphRAG: đều cần LLM để trích thực thể (tốn quota), và model local nhỏ hay hỏng schema.

#### 7.3.3 K3 — Trạng thái sống
Registry task, footprint, WIP snapshot, conflict đang mở, ticket đang chờ. Brain truy cập qua tool (mục 7.2.6).

### 7.4 Bộ phát hiện conflict (L0–L3)

| Lớp | Đầu vào | Cách làm | Bắt được |
|---|---|---|---|
| **L0 Path/Module** | đăng ký + footprint | Giao nhau giữa các tập path/glob, ánh xạ sang module | Trùng file, trùng module; **drift** (sửa ngoài phạm vi) |
| **L1 Speculative merge** | WIP snapshot | `git merge-tree --write-tree -z --name-only A B`, chạy hàng loạt qua `--stdin`. **Dựa vào exit code**: 0 = sạch, 1 = conflict; với `--stdin` thì ngược lại (status 1 = sạch). Lấy loại conflict từ phần messages. Chạy lại khi `main` đổi | Conflict text chính xác, trước khi có PR |
| **L2 Symbol (tree-sitter)** | diff snapshot + code graph | So symbol của base với WIP: **xóa** (mất key), **đổi tên** (mất key + key mới cùng `body_hash`, hoặc tương đồng vượt ngưỡng), **đổi chữ ký** (cùng key, khác `sig_hash`). Sau đó tra `CALLS`/`REFERENCES` trong **view của dev kia** (cả code base lẫn overlay) | Xung đột logic kiểu `getUser → fetchUser`; hai bên cùng sửa thân một hàm |
| **L3 Semantic (LLM)** | đăng ký/plan của hai task + bằng chứng L0–L2 + đoạn graph liên quan | Brain job `judge_semantic_conflict`, trả JSON {related, level, reason, suggestion, sources} | Xung đột ý định trước khi có code; phân loại các trường hợp L2 báo nhầm do trùng tên |

- **Đối chứng ngoài cho L2:** `sem` (Ataraxy Labs, diff ở mức entity, có npm và MCP). Dùng làm baseline trong thí nghiệm và làm phương án dự phòng.
- **Trigger L3:** có đăng ký hoặc plan mới, **và** (L0 cùng module **hoặc** L2 có symbol liên quan **hoặc** L2 có kết quả trùng tên cần phân loại). Cache theo `(task_a, task_b, hash)`.
- **Giới hạn đã biết của L2:** dynamic dispatch, re-export, overload và DI làm phân giải theo tên sai lệch. Giảm bằng confidence, SCIP trên `main` và L3.

#### Mức và hành động
| Mức | Ví dụ điều kiện | Agent có `ask` (Claude) | Agent không có `ask` (Codex, Grok, Cursor) | Người |
|---|---|---|---|---|
| Info | Cùng module, khác file | — | — | statusline |
| Warning | Trùng file nhưng L1 sạch; L3 thấy liên quan | chèn context **một lần** | chèn context một lần | statusline + notify |
| High | L1 conflict; L2 có symbol bị đổi mà bên kia dùng | `ask` khi sửa vùng đó | **`deny` kèm lý do** + hướng dẫn: "hỏi người dùng rồi gọi `gtv_ack`" | notify cả hai |
| Critical | Cả hai chạm path nhạy cảm theo `.gtv/policy.yml` | `ask` ngay lần sửa đầu | `deny` cho tới khi có ack | bắt buộc ack từ bên kia (có `override`, ghi audit) |

Chống spam: mỗi cặp (conflict, session) chỉ chèn một lần, trừ khi mức tăng; đã `dismiss` thì không báo lại cho tới khi bằng chứng đổi.

### 7.5 Chức năng 1 — Đăng ký task

**Schema đăng ký** (học theo Claim Plane ChangeIntent và MPAC Intent):
```yaml
title: "Chuyển login sang JWT"
goal: "…"
base_sha: abc123
resources:
  - { kind: module, value: auth,                   op: modify,     certainty: committed }
  - { kind: path,   value: "src/auth/**",           op: modify,     certainty: committed }
  - { kind: symbol, value: "AuthService.login",     op: sig_change, certainty: contingent }
  - { kind: contract, value: "POST /api/login",     op: modify,     certainty: contingent }
questions_for_others: []   # tùy chọn
```

**Ba cách đăng ký** (kết hợp, không loại trừ nhau):
1. **Chủ động:** skill hướng dẫn agent gọi `gtv_register_task` sau khi lập kế hoạch và trước khi sửa. Đây là đường chính, đúng ý ban đầu.
2. **Tự động từ plan:** hook bắt plan (Claude: `PreToolUse(ExitPlanMode)`; các agent khác: lấy từ prompt hoặc turn đầu) → Brain job `extract_intent_from_plan` → đăng ký nháp, agent xác nhận.
3. **Lưới an toàn:** lần sửa đầu tiên mà chưa có đăng ký → hook chèn context "hãy đăng ký task" (kèm phạm vi suy từ prompt).

**Phản hồi khi đăng ký** (đồng bộ, dưới 30 s; quá thời gian thì trả kết quả L0 trước, phần còn lại chèn vào sau):
```json
{ "status": "ok | adjust_suggested | needs_coordination",
  "overlaps": [{ "with": "dev-b/codex: task SSO", "layer": "L2", "level": "high",
                 "evidence": "B đang gọi AuthService.login ở src/sso/google.ts:42" }],
  "suggestions": ["Giữ chữ ký login(); thêm loginWithJwt()", "Hoặc hỏi B qua gtv_ask"],
  "relevant_knowledge": ["ADR-007: session phải tương thích mobile app v1"] }
```
**Drift:** footprint ra ngoài `resources` → chèn context "cập nhật đăng ký" → đăng ký được mở rộng (học theo cơ chế "scope promotion" của Claim Plane) → chạy lại kiểm tra.

### 7.6 Chức năng 2 và 3 — Hỏi đáp và chuyển câu hỏi (3 bậc)

```
agent A ──gtv_ask(question, context)──► Operator
   │                                     ├─ Bậc 1: Brain tự trả lời từ code graph, KB, đăng ký và WIP của người khác
   │◄── trả lời ngay (≤ 30–45 s) ────────┤        (vd "B đổi login thế nào?" → đọc WIP của B, không làm phiền B)
   │                                     ├─ Bậc 2: cần B QUYẾT ĐỊNH → tóm tắt rồi đưa vào inbox agent B
   │◄── {ticket: #12, status: forwarded} ┤        → hook chèn câu hỏi vào lần gọi tool kế tiếp của B
   │    (A làm phần khác trong lúc chờ)  │        → agent B trả lời bằng gtv_reply (hoặc chuyển lên bậc 3)
   │                                     └─ Bậc 3: agent B không tự quyết được / B offline / quá thời gian
   │                                              → notify người B; B trả lời bằng `gtv answer 12 "…"`
   │◄── câu trả lời được chèn vào A (PostToolUse; Claude asyncRewake đánh thức cả khi A đang rảnh)
```

- **`gtv_ask` không bao giờ treo lâu.** Chờ tối đa khoảng 45 s cho bậc 1; nếu chưa xong thì trả về số ticket. Không dựa vào MCP Tasks hay long-poll (MCP 2026 đã chuyển sang stateless, Tasks thành extension).
- **Brain chọn bậc** qua `tier_suggestion`, kèm luật cứng: câu hỏi chứa yêu cầu đồng ý hoặc đổi contract của người khác thì ít nhất là bậc 2; `confidence: low` thì không trả lời như sự thật.
- **Tóm tắt khi chuyển câu hỏi:** Brain viết lại câu hỏi cho B, kèm ngữ cảnh tối thiểu (task của A, đoạn diff liên quan). Rút từ CooperBench: thất bại thường đến từ tin nhắn mơ hồ.
- **Ghi nhớ:** mỗi ticket đã đóng trở thành tài liệu `qa` trong KB (mục 7.3.2), dùng cho `history.similar_questions`.
- **Hết hạn:** ticket bậc 2 quá N phút → bậc 3; bậc 3 quá M giờ → `expired` và báo lại cho A.

### 7.7 Daemon và CLI (`gtv`)
- `gtv init`: đăng ký dev, cài adapter, tạo `.gtv/` (config, policy, modules).
- `gtv daemon`: lắng nghe localhost, giữ cache trạng thái từ SSE, phục vụ MCP cho agent, chụp WIP snapshot (index tạm + `commit-tree`, đẩy `+…:refs/gtv/<dev>/<session>`), chuyển thông báo.
- `gtv status [--watch]`, `gtv inbox`, `gtv answer <ticket> "<text>"`, `gtv ack|dismiss|override <conflict>`, `gtv kb add|confirm`, `gtv features [set <f> <mode>]`, `gtv statusline`.
- **Fetch phía server** phải có refspec rõ ràng `+refs/gtv/*:refs/gtv/*` (ref tùy biến không được fetch mặc định). ❓ Kiểm tra GitHub có nhận push lên `refs/gtv/*` không; nếu không, dùng branch `gtv/<dev>/<session>`.

### 7.8 Adapter và hook (đã đối chiếu tài liệu 10/2026)

| Khả năng | Claude Code | Codex CLI | omp / pi | Cursor | Grok Build |
|---|---|---|---|---|---|
| Kiểu hook | command, **http**, mcp_tool, prompt, agent | command, mcp_tool (**không có http**) | Extension TS | command | command, http |
| Chặn trước khi sửa | PreToolUse: allow/deny/**ask**/defer | PreToolUse bắt được `apply_patch`/Edit/Write: **deny** (**không hỗ trợ `ask`**) | `tool_call` → `{block, reason}` | preToolUse allow/deny (`ask` không được áp dụng) | PreToolUse deny |
| Chèn context giữa lượt | `additionalContext` ở Pre/PostToolUse, **PostToolBatch** | `additionalContext` ở Pre/PostToolUse | `pi.sendMessage(…, deliverAs: "steer")` | chỉ postToolUse `additional_context` | chưa có tài liệu |
| Đánh thức khi agent đang rảnh | **`asyncRewake`** (exit 2) | không (async chỉ tới ở lần gọi model kế tiếp) | `sendMessage(triggerTurn)` | không | không |
| Skill | có | có (chuẩn SKILL.md) | có (dùng chung thư mục `.claude`/`.codex`) | rules | đọc `.claude/settings.json` |
| MCP | có | có | có | có | có |
| Ghi chú | Hook gọi thẳng daemon qua HTTP | Cần shim CLI; hook phải được trust bằng `/hooks` | ❓ tên event của omp có giống pi không | CLI chỉ hỗ trợ một phần | Cần `/hooks-trust` |

**Mẫu số chung:** PreToolUse trên tool sửa file → kiểm tra (`ask` nếu agent hỗ trợ, nếu không thì `deny` + lý do); PostToolUse → rút inbox vào context; MCP cho mọi tool chủ động.

### 7.9 MCP tools cho agent của dev và skill
| Tool | Mục đích |
|---|---|
| `gtv_register_task(registration)` / `gtv_update_task(id, patch)` / `gtv_finish_task(id)` | Chức năng 1 |
| `gtv_ask(question, context?)` → answer hoặc ticket | Chức năng 2 |
| `gtv_reply(ticket_id, answer)` / `gtv_escalate(ticket_id)` | Agent B trả lời hoặc chuyển lên người |
| `gtv_status()` / `gtv_check(paths?, symbols?)` | Awareness |
| `gtv_inbox()` / `gtv_ack(conflict_id, note)` | Hộp thư, xác nhận |

**Skill `gtv-collaboration`** (một SKILL.md dùng chung cho Claude, Codex, omp):
- Khi nào đăng ký task.
- **Khi nào nên hỏi Operator:** đụng code ngoài phạm vi đăng ký, đọc thấy symbol người khác đang sửa, không rõ nghiệp vụ, sắp đổi contract dùng chung.
- Cách trả lời câu hỏi được chuyển tới.
- Không bịa câu trả lời thay người dùng; câu cần người quyết thì escalate.

### 7.10 Thông báo
- Cho agent: context chèn qua hook; inbox qua MCP.
- Cho người: statusline (Claude, omp), thông báo desktop (Windows toast), `gtv status --watch`; tùy chọn webhook Discord/Slack.

### 7.11 Tích hợp GitHub
- Polling `git fetch` mỗi 30 s: `main` đổi → task có branch đã merge chuyển `done`; chạy lại L1/L2 giữa WIP và `main` mới; cập nhật lớp nền của code graph.
- Tùy chọn: webhook PR; GitHub Action `gtv-check` comment danh sách conflict đang mở lên PR.

---

## 8. Cờ tính năng và chế độ vận hành

Mọi tính năng có ba mode:

| Mode | Hành vi |
|---|---|
| `off` | Không chạy |
| `shadow` | **Chạy và ghi `event_log`, không báo ai.** Dùng để đánh giá lớp còn chưa ổn trên dữ liệu thật mà không làm phiền người dùng |
| `on` | Chạy và báo |

**Cầu dao tự ngắt:** một tính năng lỗi hoặc timeout quá K lần trong T phút thì tự hạ xuống `off`, kèm lý do. Hệ thống tiếp tục với các lớp còn lại.

```yaml
# .gtv/config.yml
features:
  registration:        { mode: on }
  registration.auto_from_plan: { mode: shadow }
  drift_check:         { mode: on }
  detect.l0_path:      { mode: on }
  detect.l1_merge:     { mode: on,     interval_s: 30 }
  detect.l2_symbol:    { mode: on,     languages: [ts, tsx, js] }
  detect.l3_semantic:  { mode: shadow, daily_budget_jobs: 200 }
  knowledge.code_graph:{ mode: on,     scip_on_main: false }
  knowledge.doc_kb:    { mode: on,     embed: embeddinggemma }
  qa.tier1_answer:     { mode: on }
  qa.tier2_relay:      { mode: on,     timeout_min: 15 }
  qa.tier3_human:      { mode: on,     timeout_h: 4 }
  policy.ask:          { mode: on }
  notify.desktop:      { mode: on }
  github.webhook:      { mode: off }
brain:
  backend: opencode            # opencode | codex | claude_sdk | ai_sdk | null
  model: "…"
  readonly_sandbox: true
eval_mode: false               # true: ask → allow + context; người giả lập
```

**Phụ thuộc giữa các tính năng** (kiểm khi khởi động):
- L2 cần `code_graph`.
- `qa.tier1_answer` cần `brain` ≠ null. Nếu `brain` là null thì trả bằng chứng thô kèm "cần người trả lời".
- L3 cần `brain`.

---

## 9. Các luồng chính

- **F1 Bắt đầu phiên:** `session_start` → đăng ký session → trả context gồm task đang chạy, câu hỏi đang chờ mình, ADR liên quan module hiện tại.
- **F2 Đăng ký task:** agent lập kế hoạch → `gtv_register_task` → L0 + L2 (dựa trên symbol đã khai) + L3 → phản hồi "ok / nên điều chỉnh / cần phối hợp" → agent sửa kế hoạch.
- **F3 Sửa file:** `pre_edit` → daemon tra cache → drift/conflict → allow, context, ask hoặc deny theo mức và theo khả năng của agent.
- **F4 Snapshot:** khoảng 30 s sau lần sửa cuối → push ref → server cập nhật overlay của graph → L1 + L2 → nếu có conflict mới thì đẩy SSE xuống các daemon liên quan.
- **F5 Hỏi bậc 1:** `gtv_ask` → Brain (graph, KB, WIP) → trả lời kèm nguồn → lưu vào KB với `status: unverified`.
- **F6 Hỏi bậc 2/3:** ticket → inbox của B → chèn vào B → B trả lời → chèn vào A (Claude: rewake) → lưu vào KB với `status: active`.
- **F7 Merge:** `main` đổi → đóng task, giải quyết conflict, cập nhật lớp nền graph, chạy lại L1/L2 cho các WIP còn lại.
- **F8 Sự cố:** server hoặc Brain chết → daemon dùng cache, mọi hook `allow`, `gtv_ask` trả "Operator offline"; khi có lại kết nối thì gửi bù event.

---

## 10. API (tóm tắt)

| Method | Path | Mô tả |
|---|---|---|
| POST | `/v1/sessions`, `/v1/sessions/:id/heartbeat` | Session |
| POST | `/v1/tasks` · PATCH `/v1/tasks/:id` | Đăng ký và cập nhật task |
| POST | `/v1/events` | Event chuẩn hóa từ daemon (batch) |
| GET | `/v1/stream` | SSE: trạng thái, conflict, tin nhắn, câu trả lời |
| POST | `/v1/tickets` · GET `/v1/tickets/:id` · POST `/v1/tickets/:id/{reply,escalate}` | Hỏi đáp |
| POST | `/v1/conflicts/:id/{ack,dismiss,override}` | Conflict |
| GET/POST | `/v1/kb/*` | Quản lý tài liệu, xác nhận Q&A |
| GET/PUT | `/v1/features` | Xem và đổi mode |
| POST | `/mcp` | MCP server cho Brain (token nội bộ) |
| POST | `/v1/replay` | Phát lại `event_log` với cấu hình feature khác (đánh giá) |

**Hợp đồng adapter ↔ daemon:** `POST http://127.0.0.1:<port>/hook`, gửi `{type, agent, session_id, cwd, payload}` và nhận `{decision: allow|ask|deny, context?, statusline?}`. Timeout 150 ms thì `allow`. Adapter tự chuyển `ask` thành `deny` + lý do với agent không hỗ trợ `ask`.

---

## 11. Yêu cầu phi chức năng

| Hạng mục | Yêu cầu |
|---|---|
| Độ trễ | Hook p95 < 100 ms (không bao giờ chờ server hay Brain); đăng ký p50 < 30 s; hỏi bậc 1 p50 < 30 s |
| Fail-open | Mọi lỗi phía gtv không chặn agent, trừ Critical khi dev bật strict |
| Độ tươi | L0 < 5 s; L1/L2 < 60 s; graph overlay < 60 s |
| Bảo mật | Token theo dev; Brain chỉ đọc, chạy trong sandbox; deploy key read-only; không nạp hook hay MCP của repo vào Brain; dữ liệu repo là **không tin cậy** (chống prompt injection) |
| Điều khoản | Không dùng OAuth subscription Claude cho Brain; Brain dùng ChatGPT login, Max API credits hoặc local model |
| Quota | Theo dõi hạn mức (Codex `account/rateLimits/read`); hàng đợi Brain; giới hạn job mỗi ngày cho từng loại; ưu tiên hỏi đáp hơn L3 |
| Riêng tư | Code đi qua GitHub (đã tin cậy) và Brain (nhà cung cấp subscription); embedding chạy local |
| Quan sát | `event_log` đầy đủ, xuất CSV, `replay` |
| Nền tảng | Client: Windows/macOS/Linux. Server: khuyến nghị Linux/WSL2 (❓) |

---

## 12. Công nghệ

| Phần | Lựa chọn |
|---|---|
| Ngôn ngữ | TypeScript chạy trực tiếp trên **Node 24** (type stripping), thay Bun vì máy đã có Node và Node 24 có sẵn `node:sqlite` |
| Server | Hono + `node:sqlite`; FTS5 (BM25). `sqlite-vec` + embedding: chưa làm |
| Parse | `web-tree-sitter` 0.27 (WASM), grammar chính thức: TypeScript/TSX, JavaScript, Python, Go, Java |
| Git | `git` ≥ 2.40 (`merge-tree --write-tree`, `--stdin`, `--merge-base`) |
| Brain | OpenCode server (mặc định) / Codex app-server / Claude Agent SDK / Vercel AI SDK v7 |
| Embedding | EmbeddingGemma-300M (transformers.js) hoặc Ollama |
| MCP | `@modelcontextprotocol/sdk` (TS) |
| Baseline đối chứng | `sem` (L2), MCP Agent Mail (giữ chỗ file), `codebase-memory-mcp` (graph) |

---

## 13. Bảo mật và rủi ro riêng của Operator
- **Prompt injection qua code hoặc tài liệu WIP:** người ta có thể cài chỉ dẫn vào comment. Brain chỉ đọc, không có tool ghi, và có prompt hệ thống tách bạch dữ liệu với chỉ dẫn. Câu trả lời chỉ là gợi ý, agent của dev vẫn tự quyết.
- **Operator trả lời sai mà tự tin:** bắt buộc có nguồn; `confidence` thấp thì chuyển sang bậc 2; Q&A chưa xác nhận không được dùng như sự thật.
- **Rò quota:** một tài khoản phục vụ 3 người → hàng đợi, ngân sách theo loại job, cache câu hỏi tương tự.

---

## 14. Đánh giá

### 14.1 Câu hỏi nghiên cứu
- **RQ1** Đăng ký + phát hiện có giảm conflict và lỗi tích hợp không?
- **RQ2** Độ chính xác và độ sớm của từng lớp L0–L3 (ablation)?
- **RQ3** Operator trả lời có đúng và có nguồn không? Có biết nói "không biết" không?
- **RQ4** Chuyển câu hỏi có giảm số lần người phải can thiệp không?
- **RQ5** Chi phí: độ trễ, quota, thời gian hoàn thành task.

### 14.2 Thí nghiệm A: conflict (RQ1, RQ2)
- **Nhánh chạy agent thật:** A0 (worktree, gtv tắt) và A-full (gtv bật).
- **Ablation không chạy lại agent:** chạy A0 với mọi lớp ở mode **shadow** → phát lại log qua detector với các cấu hình L0 / L0–L1 / L0–L2 / L0–L3 / `sem`-baseline.
- **Kịch bản:** repo mẫu TypeScript có test; các cặp task gồm trùng file, trùng contract và độc lập (số lượng tùy quota, tối thiểu 6 cặp).
- **Chỉ số:**
  - Tỷ lệ merge sạch; **lỗi chỉ xuất hiện khi gộp** (kiểu STALE: test pass ở từng nhánh riêng, fail khi gộp).
  - Precision và recall theo ground truth; lead time.

### 14.3 Thí nghiệm B: hỏi đáp (RQ3)
- **Bộ câu hỏi tự dựng:** 30–50 câu trên repo mẫu, mỗi câu có đáp án và nguồn đúng, chia 4 loại:
  - code (ai gọi X, X ảnh hưởng gì);
  - nghiệp vụ (theo docs/ADR);
  - trạng thái (ai đang làm gì, B đổi gì);
  - **không trả lời được** (để đo khả năng nói "không biết").
- **Ablation tri thức:** Brain chỉ có grep/đọc file; + code graph; + Doc KB; đầy đủ.
- **Chỉ số:** độ chính xác (LLM-judge + người kiểm tra mẫu), độ đúng của nguồn, tỷ lệ từ chối đúng, token/thời gian. *Tùy chọn:* chạy thêm một tập con SWE-QA để có số so sánh với bên ngoài.

### 14.4 Thí nghiệm C: chuyển câu hỏi (RQ4)
- **Kịch bản cặp task phụ thuộc:** A cần thông tin hoặc quyết định từ B (vd A cần biết format token mới của B).
- **So sánh:**
  - Không có gtv: agent đoán, hoặc dừng hỏi người.
  - Có gtv: dùng bậc 1/2/3.
- **"Người giả lập":** một script trả lời câu hỏi bậc 3 theo đáp án dựng sẵn (học theo Ambig-SWE).
- **Chỉ số:** số lần người phải can thiệp trên mỗi task; precision/recall của việc chọn bậc (câu tự trả lời được có bị chuyển không cần thiết không, câu cần quyết định có bị Operator trả lời thay không); thời gian từ lúc hỏi tới lúc có trả lời; tỷ lệ task thành công.

### 14.5 Công trình phải trích dẫn và so sánh
NP-Bench, Claim Plane, MPAC, CooperBench, STALE, MCP Agent Mail, Crystal/Palantír, GitKraken; RepoGraph, LocAgent, KGCompass, Codebase-Memory; SWE-QA, Ambig-SWE.

---

## 15. Kịch bản demo
1. Ba terminal: A dùng Claude Code, B dùng Codex, C dùng omp. Màn hình thứ tư mở `gtv status --watch`.
2. B đăng ký "thêm Google SSO" và bắt đầu code.
3. A: "chuyển login sang JWT" → `gtv_register_task` → Operator: "trùng với B ở `AuthService.login` (L2), ADR-007 yêu cầu tương thích mobile v1, đề xuất thêm `loginWithJwt()`" → A điều chỉnh kế hoạch.
4. A hỏi: "refresh token hết hạn bao lâu?" → bậc 1 trả lời từ `docs/auth.md`, kèm nguồn.
5. A hỏi: "B có cần claim `email` trong JWT không?" → bậc 2 → câu hỏi được chèn vào Codex của B giữa lượt → B trả lời → câu trả lời tới Claude của A (rewake).
6. C sửa UI độc lập → không có cảnh báo nào.
7. So sánh với lần chạy không có gtv (video quay sẵn).
8. Bật/tắt L2 trực tiếp bằng `gtv features set detect.l2_symbol off` để cho thấy tính module.

---

## 16. Lộ trình theo giai đoạn

| Giai đoạn | Nội dung | Phụ thuộc |
|---|---|---|
| **P0 Spike** | Thử hook thật của Claude/Codex/omp; thử push `refs/gtv/*`; thử OpenCode serve + ChatGPT login + MCP; thử web-tree-sitter trên Bun và sqlite-vec trên server | — |
| **P1 Lõi** | Service, daemon, CLI, feature flags, event log; adapter Claude; L0; đăng ký task chủ động; statusline | P0 |
| **P2 Tri thức** | Parser dùng chung, code graph (base + overlay), Doc KB (FTS + vec), MCP cho Brain; Brain adapter OpenCode | P1 |
| **P3 Hỏi đáp** | `gtv_ask` bậc 1; ticket, inbox, bậc 2/3; inject/rewake; skill | P2 |
| **P4 Phát hiện nâng cao** | WIP snapshot + L1; L2 (đổi chữ ký/đổi tên/xóa + tra graph); L3; drift; ask/deny theo agent | P1, P2 |
| **P5 Đa agent** | Adapter Codex (shim), omp (extension); thử Cursor/Grok nếu còn thời gian | P1 |
| **P6 Đánh giá** | Repo mẫu, kịch bản A/B/C, người giả lập, replay, báo cáo | P3, P4 |

**Vạch demo tối thiểu** (nếu phải nộp sớm):
- Gồm: P1 + P2 (graph, chưa cần vec) + P3 bậc 1–2 + L1 + L2 + Claude & Codex + thí nghiệm A thu nhỏ + B.
- Các phần ngoài vạch vẫn nằm trong spec và bật được sau qua feature flag.

---

## 17. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Vi phạm điều khoản subscription | Brain = ChatGPT login (chính thức) hoặc Max API credits; không dùng Claude OAuth cho server |
| Rate limit khi một tài khoản phục vụ 3 dev + benchmark | Hàng đợi, ngân sách theo loại job, cache; chạy L3 ở shadow; ưu tiên hỏi đáp |
| Operator trả lời sai | Bắt buộc nguồn, cho phép "không biết", escalate, Q&A chưa xác nhận không dùng như sự thật |
| Prompt injection | Brain chỉ đọc, sandbox, prompt tách bạch dữ liệu |
| Phân giải tên trong L2/graph sai | Gắn confidence; SCIP trên main; L3 phân loại |
| Codex không có `ask`, Cursor không chèn context ở pre | Ma trận khả năng theo agent (mục 7.8); dùng deny + lý do |
| Phạm vi lớn, trễ deadline | Feature flags + vạch demo tối thiểu; đồ án chỉ cần chứng minh trên các lớp đã `on` |
| Nền tảng Brain thay đổi liên tục | Interface `Brain`, ghim phiên bản, MCP là giao diện ổn định |
| Kết quả trên kịch bản tự dựng bị thổi phồng (bài học STALE) | Nêu rõ giới hạn; tùy chọn chạy tập con SWE-QA |

---

## 18. Quyết định đã chốt

| # | Quyết định | Nguồn |
|---|---|---|
| D1 | Đồ án môn học; GitHub; demo Claude Code, Codex, omp | Người dùng |
| D2 | **Trung tâm là Project Operator (agent trên server)** với 3 chức năng: đăng ký, hỏi đáp, chuyển câu hỏi | Người dùng (v0.3) |
| D3 | Phạm vi: conflict + awareness **+ giảm nút thắt giao tiếp**; không review, không chia task | Người dùng (v0.3) |
| D4 | Giữ đủ L0–L3, **có L2 tree-sitter** | Người dùng (v0.3) |
| D5 | Làm đủ tính năng; mỗi lớp có cờ `off/shadow/on` + cầu dao tự ngắt | Người dùng (v0.3) |
| D6 | Brain dùng nền tảng open-source có sẵn, thay được qua interface; mặc định OpenCode | Người dùng + nghiên cứu |
| D7 | Code graph tất định bằng tree-sitter trong SQLite, **không** dùng GraphRAG kiểu LLM trích thực thể | Nghiên cứu (❓ người dùng xác nhận) |
| D8 | Doc KB: FTS5 + sqlite-vec + embedding local | Người dùng + nghiên cứu |
| D9 | Hỏi đáp 3 bậc; `gtv_ask` không treo | Đề xuất, người dùng chưa phản đối (❓ xác nhận) |
| D10 | Đăng ký task chủ động là đường chính; plan/footprint là lưới an toàn | Người dùng |
| D11 | Chỉ dùng subscription; không dùng Claude OAuth cho Brain trên server | Ràng buộc + điều khoản |
| D12 | High/Critical: `ask` nếu agent hỗ trợ, nếu không thì `deny` + lý do | Người dùng + nghiên cứu hook |
| D13 | WIP snapshot đẩy lên `refs/gtv/*` (fallback là branch) | Đề xuất |
| D14 | TypeScript/Bun cho toàn bộ | Đề xuất |

---

## 19. Câu hỏi mở ❓

| # | Câu hỏi | Đề xuất |
|---|---|---|
| **Q-A** | Nhóm có những gói subscription nào (ChatGPT Plus/Pro? Claude Pro hay Max 5x/20x? SuperGrok?) | Quyết định Brain: có ChatGPT → OpenCode/Codex; có Max → có thể dùng Claude Agent SDK |
| **Q-B** | Server chạy ở đâu: laptop Windows, WSL2, hay VPS Linux? | WSL2 hoặc Linux; chạy trên máy trong nhóm để giữ tính "local/personal" |
| **Q-C** | Tài liệu nghiệp vụ đang nằm ở đâu (repo, Notion, Google Docs)? | Đưa vào `docs/` dạng markdown; importer cho nguồn khác để sau |
| **Q-D** | Câu trả lời của Operator có tự thành tri thức không, hay phải có người xác nhận? | Lưu với `status: unverified`; chỉ thành `active` khi có xác nhận hoặc khi người thật trả lời |
| **Q-E** | Bạn đồng ý dùng **code graph tất định** thay cho GraphRAG kiểu Microsoft không? | Có (lý do ở mục 7.3.1) |
| **Q-F** | Tree-sitter hỗ trợ những ngôn ngữ nào: chỉ TS/JS, hay thêm Python? | TS/JS trước; repo mẫu viết bằng TS |
| **Q-G** | Nhóm có mấy người, ai làm phần nào? | 3 người: (1) Service + detector + graph; (2) daemon + adapter + hỏi đáp; (3) Brain + KB + đánh giá |
| **Q-H** | Tên dự án: giữ "gtv / Guide the Vibe"? | Giữ làm tên mã |

---

## 20. Tài liệu tham khảo

**Pain points và nghiên cứu điều phối**
- Brun et al., *Proactive Detection of Collaboration Conflicts*, ESEC/FSE 2011
- Campos Junior & Murta, *How AI Coding Agents Resolve Merge Conflicts*, SBES 2026
- *STALE: Passes Alone, Fails Together* — https://arxiv.org/abs/2609.25396
- *NP-Bench* — https://arxiv.org/abs/2610.07261
- *Claim Plane* — https://arxiv.org/abs/2607.21909
- *MPAC* — https://arxiv.org/pdf/2604.09744
- *CooperBench* (ICLR 2026) — https://arxiv.org/abs/2601.13295
- MCP Agent Mail — https://github.com/Dicklesworthstone/mcp_agent_mail

**Code graph và RAG**
- RepoGraph — https://arxiv.org/html/2410.14684
- LocAgent — https://arxiv.org/abs/2503.09089
- KGCompass — https://arxiv.org/abs/2503.21710
- Codebase-Memory — https://arxiv.org/abs/2603.27277 · https://github.com/DeusData/codebase-memory-mcp
- RAG vs GraphRAG — https://arxiv.org/abs/2502.11371 · LazyGraphRAG — https://www.microsoft.com/en-us/research/blog/lazygraphrag/
- Aider repo map — https://aider.chat/docs/repomap.html · SCIP — https://github.com/sourcegraph/scip
- Kuzu bị archive — https://www.theregister.com/2025/10/14/kuzudb_abandoned/
- sqlite-vec — https://github.com/asg017/sqlite-vec · EmbeddingGemma ONNX — https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX

**Tree-sitter, merge**
- git merge-tree — https://git-scm.com/docs/git-merge-tree
- Mergiraf — https://mergiraf.org/architecture.html
- sem — https://docs.rs/sem-cli/0.9.0/sem/
- web-tree-sitter — https://cdn.jsdelivr.net/npm/web-tree-sitter@0.27.0/README.md

**Hook của agent**
- Claude Code — https://code.claude.com/docs/en/hooks
- Codex — https://learn.chatgpt.com/docs/hooks.md · app-server — https://learn.chatgpt.com/docs/app-server
- pi extensions — https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md · omp — https://github.com/can1357/oh-my-pi
- Cursor — https://cursor.com/docs/hooks · Grok Build — https://docs.x.ai/build/features/hooks
- MCP 2026-07-28 — https://blog.modelcontextprotocol.io/posts/2026-07-28/

**Nền tảng Brain và điều khoản**
- Claude Code legal — https://code.claude.com/docs/en/legal-and-compliance
- API credits cho subscriber — https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
- OpenCode server/SDK/providers — https://opencode.ai/docs/server/ · https://opencode.ai/docs/sdk/ · https://opencode.ai/docs/providers/
- Codex auth/SDK — https://learn.chatgpt.com/docs/auth · https://learn.chatgpt.com/docs/codex-sdk
- Sign in with ChatGPT — https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- Goose ACP — https://goose-docs.ai/docs/guides/acp-providers · OpenHands — https://docs.openhands.dev/sdk/getting-started

**Đánh giá hỏi đáp**
- SWE-QA — https://arxiv.org/html/2509.14635v1 · CodeRepoQA — https://arxiv.org/abs/2412.14764v1
- Ambig-SWE — https://huggingface.co/papers/2502.13069.md · Ask or Assume — https://www.alphaxiv.org/abs/2603.26233

---

## 21. Trạng thái triển khai (v0.4, 24/10/2026)

### 21.1 Quyết định bổ sung
| # | Quyết định | Nguồn |
|---|---|---|
| D15 | Server chạy bằng **Docker** khi phát triển (Operator + Brain trong `docker/compose.yml`) | Người dùng (Q-B) |
| D16 | Câu trả lời của Operator chỉ thành tri thức khi **có người xác nhận** (`gtv kb confirm`) | Người dùng (Q-D) |
| D17 | Không dùng GraphRAG; dùng **code graph tất định bằng tree-sitter** | Người dùng (Q-E) |
| D18 | Ngôn ngữ: **TypeScript/TSX, JavaScript, Python, Go, Java** | Người dùng (Q-F) |
| D19 | Brain = **OpenCode server + đăng nhập ChatGPT** (phương thức "ChatGPT Pro/Plus (headless)") | Người dùng |
| D20 | Runtime: Node 24 thay vì Bun (xem mục 12) | Môi trường thực tế |
| D21 | Codex không hỗ trợ `ask` → High: `deny` **một lần** để agent dừng lại phối hợp, lần thử lại thì cho qua; Critical: `deny` cho tới khi có ack | Tài liệu hook Codex |
| D22 | omp: nạp extension bằng `omp -e`; gtv tools đăng ký trực tiếp trong extension (không cần MCP) | API extension omp |

### 21.2 Đã cài đặt
| Phần | Trạng thái | Ghi chú |
|---|---|---|
| Registry (session, workspace, task, footprint), SSE, event log | ✅ | `src/server/store.ts`, `app.ts` |
| Feature flags `off/shadow/on` + cầu dao tự ngắt + phụ thuộc | ✅ | `src/shared/features.ts`, `engine.ts` |
| L0 path/scope/symbol/contract/critical + "kế hoạch đổi chữ ký mà bên kia đang dùng" | ✅ | `detect/l0.ts` |
| L1 `git merge-tree` giữa các snapshot và với `main` | ✅ | `detect/l1.ts` |
| L2 symbol diff (đổi chữ ký / đổi tên / xóa / sửa thân) + tra caller trong overlay | ✅ | `codeintel/*`, `detect/l2.ts` |
| L3 Brain đánh giá đăng ký task | ✅ | mặc định `on` trong `docker/gtv.config.yml` |
| Trích intent từ plan (Claude `ExitPlanMode`, Codex `update_plan`) | ✅ | mặc định `shadow` |
| Hỏi đáp 3 bậc, ticket, timeout, leo thang | ✅ | `tickets.ts` |
| KB: docs/ADR từ `main`, FTS5, Q&A `unverified` → confirm | ✅ | `kb.ts` |
| MCP chỉ-đọc cho Brain (13 tools) | ✅ | `server/mcp.ts` |
| Daemon: hook Claude (HTTP) / Codex (shim) / omp (extension), quyết định local, inbox, `asyncRewake`, snapshot | ✅ | `src/daemon/*` |
| MCP stdio cho agent (9 tools) + skill `gtv-collaboration` | ✅ | `daemon/mcp.ts`, `adapters/skill` |
| `gtv install claude/codex/omp`, sandbox 3 dev | ✅ | `daemon/install.ts`, `scripts/sandbox.ts` |
| Docker (Operator + OpenCode) | ✅ | đã build và chạy trên máy dev |
| Test tự động | ✅ 20/20 | codeintel, server (Brain giả lập), end-to-end 2 daemon + server + git |

### 21.3 Số đo trên máy dev (Windows, Docker Desktop)
| Đường đi | Độ trễ |
|---|---|
| Hook Claude (HTTP → daemon), gồm khởi động `curl` | ~115–150 ms |
| Hook Codex (shim `node bin/gtv.mjs hook`) | ~270 ms (khởi động Node ~160 ms) |
| Edit → snapshot → server Docker → conflict L2 | ≤ 25 s (debounce 20 s) |

### 21.4 Chưa làm
- Embedding + `sqlite-vec` cho KB (hiện chỉ có BM25).
- `/v1/replay` và harness cho thí nghiệm A/B/C (mục 14).
- Webhook / GitHub Action (đang dùng polling).
- SCIP để nâng độ chính xác cạnh trên `main`.
- Adapter Cursor, Grok Build.
- Chạy thật với Brain (cần đăng nhập ChatGPT) và với Claude Code/Codex/omp thật (giới hạn vài lượt).

---

## 22. v0.5 — nhiều project, dashboard, tự kiểm thử (24/10/2026)

### 22.1 Thay đổi
| Hạng mục | Nội dung |
|---|---|
| Nhiều project | Một server phục vụ nhiều project (mỗi project = một repo). Hub giữ project, dev/token, thống kê Brain (`data/hub.db`); mỗi project có DB, mirror git, code graph, KB, registry riêng (`data/projects/<id>/`). API project: `/v1/p/:project/*`; daemon tự tìm project qua `.git/gtv-project` hoặc so remote URL (`/v1/resolve`). |
| Brain theo project | Một OpenCode dùng chung; mỗi project có MCP server riêng `gtv_<id>` → `/p/<id>/mcp` (đăng ký lúc chạy), mỗi job chỉ bật tool của project đó. Mọi job được đo (số lượt, thời gian, lỗi) để báo cáo. |
| Dashboard | `web/` (React + Vite, đen trắng tối giản): tổng quan, project (người đang làm, conflict, layers bật/tắt, Q&A, knowledge, code graph, thống kê, cài đặt), Brain (đổi model), Developers (cấp token). Phục vụ ở `/`. |
| Bảo mật | Token riêng mỗi dev (hash trong hub), admin token cho dashboard (`GTV_ADMIN_TOKEN`). |
| Cấu trúc | Mã chia theo vùng (codeintel, detect, qa, brain, knowledge, hub/http/project, daemon/adapters, web, ops, evaluation) — xem `docs/project-structure.md`. |
| Docs | `docs/` (kiến trúc, cấu trúc + chia việc, API, tính năng, agent, vận hành, phát triển, kiểm thử). |

### 22.2 Tự kiểm thử trên repo thật
Repo `gothinkster/node-express-realworld-example-app`, 2 dev (Claude/Codex giả lập bằng payload hook thật, daemon/git/Operator/Brain thật).
Kết quả lần cuối: **21/21 check**, 3 job Brain (p50 ≈ 9,7 s), L2 phát hiện sau khoảng 23 s kể từ lần sửa (debounce snapshot 20 s). Báo cáo: `docs/reports/selftest-realworld.md`.

Bug do self-test tìm ra và đã sửa:
| Bug | Hậu quả | Sửa |
|---|---|---|
| Import `../profile/profile.utils` bị cắt thành `../profile/profile` | Mọi caller chỉ được độ tin cậy `name` → L2 hạ xuống warning, không `ask` | Chỉ cắt đuôi code thật (`graph.ts`) |
| L2 tính cả dòng gốc của main trong file B đã sửa | Báo B "đang viết" code B không đụng tới | Chỉ dòng B thêm/sửa (`git diff -U0`, bảng `wip_lines`) |
| Glob `**/migrations/**` coi là trùng với mọi scope | Cảnh báo **critical** nhầm (Codex bị chặn) | So khớp bằng đường dẫn mẫu (`patternsOverlap`) |
| Task không tự đóng khi snapshot đến sau lần đổi `main` | Task treo sau merge | Kiểm tra cả lúc nhận snapshot; chỉ đóng khi commit mới hơn lúc đăng ký |
| Conflict L3 không đóng khi task xong | Conflict mở mãi | `tasksClosed()` |
| Cảnh báo "sửa trong scope người khác" chỉ đến sau khi server chạy L0 | Agent sửa xong mới biết | Daemon cảnh báo ngay ở pre-edit từ cache |
| Dashboard tự khóa khi cấp token dev đầu tiên (không có admin token) | Mất quyền vào dashboard | `/api` mở khi chưa đặt `GTV_ADMIN_TOKEN`, cảnh báo lúc khởi động |

---

## 23. v0.6 — Brain chuyển sang Hermes Agent, sửa lỗi sau review (01/11/2026)

### 23.1 Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| D23 | Brain mặc định = **Hermes Agent** (`nousresearch/hermes-agent:v0.22.2`, `hermes gateway run`, API server tương thích OpenAI). **LLM phía sau tùy chọn** (gói ChatGPT `openai-codex`, endpoint tương thích OpenAI như CLIProxyAPI, OpenRouter…) — không phải việc của gtv. OpenCode giữ lại làm backend thay thế (`BRAIN_BACKEND=opencode`). | Yêu cầu nhóm |
| D24 | Hermes có cấu hình MCP tĩnh, không chọn tool theo request ⇒ thêm endpoint **`/mcp` dùng chung mọi project**, mỗi tool có tham số `project`; prompt mỗi job nêu đúng project. | Hermes không có `tools` theo request như OpenCode |
| D25 | Hermes bỏ qua `response_format` ⇒ schema nằm trong prompt, gtv tự kiểm JSON và nhắc lại một lần. Lỗi có thể đến dạng HTTP 200 ⇒ chỉ `finish_reason: stop` + JSON hợp lệ là thành công. Mỗi job một session, xóa sau khi xong. | Đọc mã nguồn Hermes v0.22 |
| D26 | Compose bắt buộc `GTV_ADMIN_TOKEN`, `GTV_BRAIN_TOKEN`, `HERMES_API_KEY`. | Cổng 7390 mở ra ngoài; `/mcp` đọc được code |

### 23.2 Lỗi đã sửa (mỗi lỗi có test hồi quy, test fail trên code cũ)
| Lỗi | Hậu quả | Sửa |
|---|---|---|
| `git grep` nhận pattern bắt đầu bằng `-` như option | Brain (hoặc prompt injection) truyền được option cho git, vd `--open-files-in-pager=<lệnh>` | `-e <pattern>` (`repo.ts`) |
| `onSnapshot` không bắt lỗi | `git fetch` lỗi (mạng, hết hạn token) ⇒ unhandled rejection ⇒ **server chết** | `.catch` + log (`engine.ts`) |
| `/events` không kiểm tra quyền sở hữu | Dev B kết thúc session, ghi footprint, chiếm workspace, gửi snapshot thay dev A | kiểm tra session/workspace như các route khác (`agent-routes.ts`) |
| Daemon nhận request từ trình duyệt | Trang web bất kỳ (hoặc DNS rebinding) gọi được daemon: ép push snapshot, trả lời ticket thay dev | từ chối `Origin` và `Host` lạ (`daemon.ts`) |
| `git pull` main mới (chưa sửa gì) bị coi là "đã merge" | Task của người pull bị đóng `done`, mất bảo vệ scope | chỉ đóng khi workspace đã có footprint (`engine.ts`) |
| Snapshot che mất lần đổi main của `pollRepo` | Docs/ADR mới không được index, việc đã merge không đóng | so với `polledMain` riêng (`engine.ts`) |
| ADR bị thay thế "sống lại" khi main đổi | Brain trích quyết định cũ | áp lại `supersedes` mỗi lần sync (`kb.ts`) |
| Thư mục trần (`src/payments`) không trùng glob con (`src/payments/**`) | Không báo critical/scope overlap lúc đăng ký | `patternsOverlap` xét tiền tố thư mục (`util.ts`) |

### 23.3 Chạy thật với Hermes (01/11/2026)
Hermes Agent v0.22.0 (cài sẵn, `HERMES_HOME` riêng, không Docker) + LLM qua CLIProxyAPI (`provider: custom`) + gtv server local trên repo mẫu mini-shop:
- Hermes kết nối `/mcp` bằng `Bearer GTV_BRAIN_TOKEN`, đăng ký đúng 13 tool `mcp__gtv__*`; toolset built-in đều tắt.
- Câu hỏi bậc 1 "Which functions call getUser, and does refund() respect the refund policy in the docs?" (`custom/gemini-3-flash`, chọn qua `PUT /api/brain`): trả lời sau **12 s**, `confidence: high`, đúng (caller `placeOrder`; `refund()` thiếu hạn 14/30 ngày, duyệt > 5.000.000 VND), 3 nguồn. Hermes gọi `team_status`, `who_calls`, `grep`, `kb_search`, `read_file` ×2. Session của job bị xóa sau đó.
- Model bị rate limit (`claude-sonnet-5-5`, 429 cooldown): Hermes tự thử lại sau 600 s; gtv cắt sau 180 s, ticket đóng "Operator could not answer" — fail-open đúng thiết kế. Session của run đó còn lại trong Hermes tới khi run kết thúc.
- **Self-test RealWorld với Hermes** (`custom/gemini-3.8-flash-high` qua CLIProxyAPI, server + 2 daemon chạy bằng node thay cho Docker): **21/21 check**, 3 job Brain, p50 33 s (`docs/reports/selftest-realworld.md`). Job L3 mất 62 s > `registration.wait_s` (30 s) nên phản hồi đăng ký trả `l3: pending`, đánh giá L3 (có lời khuyên đúng) đến sau thành conflict HIGH gửi vào agent cả hai bên — đúng thiết kế; với model chậm có thể tăng `registration.wait_s`. Trước đây với OpenCode + `gpt-6-luna`: p50 9,7 s.
- Trích ý định từ plan (Claude `ExitPlanMode`, mode `shadow`): Hermes trả đăng ký đúng (title, goal, 3 file, symbol `createUser`, contract `POST /api/users/login` tìm được bằng tool).
- Cả 3 loại job Brain (`answer_question`, `judge_registration`, `extract_intent_from_plan`) đều chạy thật, 0 lỗi.
- **Stack Docker thật** (`docker/compose.yml`, image `nousresearch/hermes-agent:v0.22.2` + image operator build từ repo; override chỉ đổi sang mạng host vì firewall máy test chặn container → host): config Hermes được chép vào volume ở lần chạy đầu, Hermes đăng ký 13 tool qua `Bearer GTV_BRAIN_TOKEN`, `/api` và `/mcp` trả 401 khi thiếu token, compose từ chối chạy khi thiếu `GTV_ADMIN_TOKEN`/`GTV_BRAIN_TOKEN`/`HERMES_API_KEY`. Self-test RealWorld trên stack này: **21/21**.

### 23.4 Chạy với agent thật (02/11/2026)
Cùng stack Docker, repo RealWorld, 3 dev, mỗi dev một daemon:
| Dev | Agent | Model | Kết quả |
|---|---|---|---|
| alice | **Claude Code 2.1.316** (`claude -p`, hook HTTP + MCP do `gtv install claude` ghi) | haiku | `gtv_register_task` qua MCP; đổi chữ ký `profileMapper` + caller; hook PostToolUse chèn cảnh báo "sửa ngoài scope" (drift) vào agent và agent báo lại cho người dùng; snapshot đẩy lên `refs/gtv/alice/*` |
| bob | **Codex CLI 0.163.0** (`codex exec`, hook command + MCP do `gtv install codex` ghi, hook được trust qua app-server `hooks/list` + `config/batchWrite` như nút Trust của `/hooks`) | gemini-3.8-flash-high qua CLIProxyAPI | Đăng ký → `needs_coordination`, HIGH: alice đổi chữ ký `profileMapper` mà bob định dùng — **trước khi viết code**; `gtv_ask` → Brain đọc WIP của alice, trả lời "dùng `id ? { id } : undefined`"; bob viết `getCommentAuthors` theo chữ ký mới; `gtv_ack` 5 conflict |
| carol | **omp 18.12.2** (`omp -p -e src/adapters/omp/gtv-extension.ts`) | gemini-3.8-flash-high qua CLIProxyAPI | `gtv_status` + `gtv_ask` qua tool của extension; Brain trả lời ai đang đổi gì và xác nhận code của bob khớp chữ ký mới của alice, 4 nguồn |

Lỗi tìm ra và đã sửa: Codex coi mọi tool MCP là cần duyệt; với `approval_policy = "never"` (`codex exec`) lời gọi `gtv_register_task` bị từ chối. `gtv install codex` giờ ghi `default_tools_approval_mode = "approve"` cho server `gtv` (tool gtv chỉ nói với Operator, không sửa code).

Chưa kiểm tra: phiên tương tác (TUI) của Codex/omp, `asyncRewake` của Claude khi rảnh (chỉ chạy `-p`), Cursor/Grok (chưa có adapter).

## 24. v0.7 — Brain chuyển sang Pi, tập trung Claude Code + Codex (06/11/2026)

### 24.1 Quyết định

| #   | Quyết định | Lý do |
| --- | ---------- | ----- |
| D27 | Brain = **vòng lặp agent của Pi** (`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`, ghim 1.5.0) chạy **trong tiến trình Operator**. Thay D23 (Hermes). Bỏ luôn backend OpenCode. | Pi là thư viện TypeScript nhúng được vào Node: bớt một service (container Hermes, khóa `HERMES_API_KEY`, gateway Python), bớt một bước mạng. Chỉ dùng phần lõi (agent loop + provider), không dùng `pi-coding-agent` (TUI, bash, edit, quét `~/.pi`). |
| D28 | Tool của Brain gọi **thẳng** `Engine` của project (`brain/tools.ts`), không qua MCP. Bỏ `/mcp`, `/p/:id/mcp` và `GTV_BRAIN_TOKEN`. Thay D24, D26. | Không còn endpoint nào trên cổng 7390 mở tool đọc code ra mạng. Mỗi job một agent mới trong RAM, chỉ có 13 tool chỉ-đọc; tham số kiểm bằng zod. |
| D29 | LLM chọn bằng `BRAIN_MODEL=provider/model`: `custom/<id>` (hoặc chỉ `<id>`) đi tới `BRAIN_BASE_URL` (endpoint tương thích OpenAI, hoặc Anthropic với `BRAIN_API=anthropic-messages`); provider khác là provider có sẵn trong Pi, lấy key từ biến môi trường của nó. | Provider nào cũng được (yêu cầu của nhóm). Đổi model trên dashboard như trước. |
| D30 | Như D25: Pi không ép schema ⇒ schema trong prompt, gtv tự kiểm JSON, nhắc lại một lần **trong cùng lịch sử**. Lỗi tạm thời (429/5xx, mất kết nối, quá giờ) ⇒ `BrainUnavailable` (không nhảy cầu dao); key/model sai ⇒ lỗi thật. | Giữ hành vi fail-open của các bản trước. |
| D31 | **Bỏ adapter omp** (thay D22). Agent được hỗ trợ: Claude Code và Codex. | Nhóm tập trung hai agent này; ít mã và ít ma trận test hơn. Session cũ có `agent = omp` rơi về khả năng `other`. |

### 24.2 Kiểm tra

- `npm run check`: typecheck, prettier, **41/41 test**. `test/pi.test.ts` dùng endpoint tương thích OpenAI giả lập (SSE): model giả gọi `find_symbol`, tool chạy thật trên engine, ticket `answered` có nguồn; model chỉ thấy 13 tool chỉ-đọc; thử lại JSON; key sai/400 là lỗi, không kết nối/quá giờ là `BrainUnavailable`; `/mcp` trả 404.
- **Brain thật** (`gemini-3.8-flash-high` qua CLIProxyAPI, `BRAIN_BASE_URL`): câu hỏi trên repo nhỏ → Pi gọi tool, trả lời đúng với nguồn `file:dòng` (36 s).
- **Stack Docker** (1 container `operator`; override chỉ đổi sang mạng host vì firewall máy test chặn container → host): `/health` báo `brain: pi, ok`. Self-test RealWorld **21/21** (`docs/reports/selftest-realworld.md`, 3 job Brain: 24 s, 42 s, 114 s). Lần chạy trước đó 20/21: câu trả lời bậc 1 mất 60,4 s, quá `ask_wait_s` = 60 s nên đến sau qua hộp thư (đúng thiết kế, nhưng check đòi trả lời ngay). Đánh giá L3 lúc đăng ký (114 s) cũng quá `registration.wait_s`, nên kết quả đến sau dưới dạng tin `HIGH · L3`. Model "high" này chậm; muốn trả lời ngay thì chọn model nhanh hơn trên dashboard.
- **Agent thật**, cùng stack, repo RealWorld:

| Dev   | Agent                                         | Kết quả |
| ----- | --------------------------------------------- | ------- |
| alice | **Claude Code 2.1.318** (`claude -p`, haiku) | `gtv_register_task` qua MCP; đổi chữ ký `profileMapper` và caller; hook báo sửa ngoài scope đã đăng ký, agent báo lại cho người dùng; snapshot đẩy lên `refs/gtv/alice/*`. |
| bob   | **Codex CLI 0.163.0** (`codex exec`, gemini-3.8-flash-high qua CLIProxyAPI) | Đăng ký → `needs_coordination`, HIGH: alice đổi chữ ký `profileMapper` — **trước khi viết code**; `gtv_ask` → Pi đọc WIP của alice, trả lời "truyền `{ id }`" kèm nguồn; câu hỏi chậm hơn đến sau qua `gtv_inbox`; `gtv_check`, `gtv_ack`; viết `getCommentAuthors` theo chữ ký mới. |

Chưa kiểm tra: provider có sẵn của Pi với key thật (chỉ thử qua endpoint `custom`), `BRAIN_API=anthropic-messages` với endpoint thật, phiên tương tác (TUI) của Codex, `asyncRewake` của Claude khi rảnh.
