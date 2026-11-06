# gtv — Guide the Vibe

[![CI](https://github.com/hienduc14/guide-the-vibe/actions/workflows/ci.yml/badge.svg)](https://github.com/hienduc14/guide-the-vibe/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/guide-the-vibe)](https://www.npmjs.com/package/guide-the-vibe)

**A coordination server for small teams whose developers each code with an AI agent on the same repository.**

When two or three people each drive Claude Code or Codex on one repo, the agents cannot see each other. One
agent renames a function another is still calling, two of them rewrite the same file, and nobody finds out until
the merge. Developers also end up interrupting each other with questions their own agent could have answered.

gtv puts a **Project Operator** between the agents. Every agent reports what it is about to change. The Operator
warns about overlaps before code is written, watches work in progress for conflicts, and answers questions about
the codebase and the team's work. When only a teammate can answer, it routes the question to that teammate's agent.

## What it does

**Register work before editing.** Before touching code, an agent registers its task: goal, files, symbols and API
contracts. The Operator replies with overlapping work, relevant team decisions (docs, ADRs) and advice. This
happens before a single line is written.

**Detect conflicts while coding.** Detection runs in layers. Each layer can be switched `on`, `off` or to `shadow`
(runs and logs, but tells nobody) per project:

| Layer | Catches                                                                              | How                                                                    |
| ----- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| L0    | Same file, overlapping registered scope, declared symbol or contract, critical paths | Compares the task registry and edit footprints                         |
| L1    | Text conflicts before anyone opens a pull request                                    | `git merge-tree` on work-in-progress snapshots (`refs/gtv/<dev>/<ws>`) |
| L2    | "Alice changed `getUser`'s signature, and Bob's new code calls it"                   | Symbol diff with tree-sitter and a code graph of every workspace       |
| L3    | Two tasks that intend conflicting changes, even in different files                   | The Brain (an LLM) judges the registrations against each other         |

**Ask instead of guessing.** Mid-task, an agent can ask the Operator: who calls this function, what is Bob
changing, why was this decided. The Brain answers from the code graph, the team's documents and teammates'
work in progress. When only a person knows, the question is forwarded into the right teammate's agent and the
answer is delivered back automatically. Confirmed answers become part of the team's knowledge base.

**See the whole team at a glance.** A web dashboard shows a dispatch board per project: one strip per agent session,
with its task, the code it touches and who it clashes with. It also covers conflicts, questions, the knowledge base,
the code graph, detection layers and usage.

## How it works

```
 Each developer's machine                          Server (Docker)
 ┌────────────────────────────────┐   HTTPS   ┌───────────────────────────────────────────┐
 │ Claude Code / Codex            │   + SSE   │ Operator (Node.js 24, one process)        │
 │   hooks · gtv_* tools · skill  │◄─────────►│   projects, developers, invites           │
 │              │                 │           │   per project: task registry, L0–L3,      │
 │              ▼                 │           │   Q&A, knowledge base, code graph         │
 │ gtv daemon (127.0.0.1:7391)    │           │   dashboard (/), agent API (/v1)          │
 │   local decisions, inbox,      │           │   Brain: Pi agent loop with read-only     │
 │   WIP snapshots ──git push──┐  │           │   tools over the project's data           │
 └─────────────────────────────┼──┘           └──────────────┬─────────────────────┬──────┘
                               ▼                    git fetch│                     │ HTTPS
                        ┌─────────────┐                      │             ┌───────▼────────┐
                        │ Git remote  │◄─────────────────────┘             │ Any LLM        │
                        │ (GitHub…)   │                                    │ provider       │
                        └─────────────┘                                    └────────────────┘
```

- **Operator.** One server for the whole team. It hosts several projects (one per repository), stores its state
  in SQLite and mirrors each repository with git.
- **Daemon.** Runs in the background on each developer's machine. It receives the agents' hooks and answers most of
  them locally from a cached copy of the team state. It also pushes work-in-progress snapshots to a private git ref
  and wakes an idle agent when a message arrives.
- **Agent integration.** Uses each agent's own extension points. Hooks report sessions, prompts and edits. An MCP
  server gives the agent nine `gtv_*` tools, such as registering a task or asking a question. A skill tells the agent
  when to use them. Claude Code and Codex are supported.
- **Brain.** A [Pi](https://github.com/earendil-works/pi) agent loop that runs inside the Operator. It works with
  any model provider and is optional: without it, registration, L0–L2 and forwarding still work.

## Getting started

### 1. Run the server

You need Docker and a machine your team can reach.

```bash
git clone https://github.com/hienduc14/guide-the-vibe && cd guide-the-vibe
cp docker/.env.example docker/.env
# In docker/.env set two secrets, each generated with: openssl rand -hex 32
#   GTV_ADMIN_TOKEN   password for the dashboard
#   GTV_SECRET_KEY    encrypts the model credentials you add on the dashboard
docker compose -f docker/compose.yml --env-file docker/.env up -d --build
```

Open the dashboard on port 7390 and sign in with `GTV_ADMIN_TOKEN`. Put it behind HTTPS (a reverse proxy or a
tunnel) before sharing it with the team.

### 2. Connect a model

Go to **Brain › Providers** and connect one provider in any of three ways:

- **Sign in with an account.** Uses a subscription you already pay for: Claude Pro/Max, ChatGPT Plus/Pro,
  GitHub Copilot, Google Antigravity, and a few others.
- **Paste an API key.** Anthropic, OpenAI, Google, OpenRouter, Groq, DeepSeek, Mistral and about 30 more.
- **Point to a router or endpoint.** Any OpenAI- or Anthropic-compatible API, such as CLIProxyAPI, 9router,
  LiteLLM or Ollama.

Then pick the model and how much it should think. A small, fast model is enough: with Claude Haiku a question
takes about 10 seconds, with Sonnet 10 to 45 seconds.

### 3. Add a project and invite the team

On the overview page, choose **Thêm project** (add project) and enter the repository URL. Private repositories need a URL with a read token,
for example `https://x-access-token:<token>@github.com/org/repo.git`.

Under **Developers**, enter a name and choose **Tạo lệnh mời** (create invite). Send the command it shows to that developer. They
run it once, inside their clone of the repository (Node.js 20 or newer):

```bash
npx guide-the-vibe join https://<your-server>/j/<code>
```

The command saves the developer's token and matches the clone to its project. It asks whether they use Claude Code,
Codex or both, installs the hooks, MCP server and skill into the repository, and starts the daemon in the
background. To set up another repository later, run `npx guide-the-vibe install` inside it.

### 4. Work as usual

Developers keep prompting their agent as before. The agent registers its task, receives warnings and asks the
Operator when it needs to. The first time, Claude Code asks to approve the `gtv` MCP server, and Codex asks to trust
the project and review its hooks.

## Try it on one machine

The sandbox creates a sample repository with two clones, `alice` (Claude Code) and `bob` (Codex). Each clone has
its own daemon, so you can watch conflicts appear on the dashboard.

```bash
npm ci && npm run web:install
node scripts/sandbox.ts            # sandbox/origin.git plus sandbox/alice and sandbox/bob, with printed next steps
```

Requires Node.js 24, git 2.40 or newer, and Docker. See [docs/agents.md](docs/agents.md) for manual setup without
invites.

## Configuration

| Variable                        | Purpose                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `GTV_ADMIN_TOKEN`               | Dashboard and admin API password (required by the Docker setup)               |
| `GTV_SECRET_KEY`                | Encrypts model credentials in the database (required by the Docker setup)     |
| `GTV_PORT`, `GTV_HOST`          | Listen address, default `0.0.0.0:7390`                                        |
| `GTV_DATA`                      | Data directory: the hub database, one database per project, git mirrors       |
| `GTV_POLL_MS`                   | How often to fetch each repository: 30 s by default, 15 s in the Docker setup |
| `BRAIN_BACKEND`                 | `pi` turns the Brain on (the Docker setup does); unset or `null` keeps it off |
| `BRAIN_MODEL`, `BRAIN_THINKING` | Optional defaults; normally chosen on the dashboard                           |

The full list, deployment notes and troubleshooting are in [docs/operations.md](docs/operations.md).

## Security

- **Developer tokens.** Each developer has a personal token. Only its hash is stored. Invite links work once and
  expire after 24 hours.
- **Model credentials.** API keys and account logins are encrypted with `GTV_SECRET_KEY`. The API never returns
  them, only the last four characters.
- **Daemon.** Listens on `127.0.0.1` only and refuses requests from browsers.
- **Brain.** Its tools are read-only. It can look at code, documents and team state, but cannot change the
  repository.

## Documentation

The dashboard and the detailed documentation are in Vietnamese.

| Document                                       | Contents                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [Architecture](docs/architecture.md)           | Components, data flow, storage, security                          |
| [Features](docs/features.md)                   | Each feature and detection layer: behaviour, modes, limits        |
| [Agents](docs/agents.md)                       | Claude Code and Codex integration, files written by `install`     |
| [Hooks](docs/hooks.md)                         | What every hook does, step by step                                |
| [API](docs/api.md)                             | Server, daemon and MCP tool reference                             |
| [Operations](docs/operations.md)               | Deployment, environment variables, tokens, Brain, troubleshooting |
| [Project structure](docs/project-structure.md) | Source layout and module ownership                                |
| [Development](docs/development.md)             | Conventions, adding features, publishing the npm package          |
| [Testing](docs/testing.md)                     | Automated tests and the self-test on a real repository            |
| [Specification](SPEC.md)                       | Design rationale and evaluation                                   |
| [Contributing](CONTRIBUTING.md)                | Team workflow                                                     |

## Development

```bash
npm run check        # typecheck, formatting and the full test suite; run before pushing
npm test             # tests only
npm run web:dev      # dashboard with hot reload
npm run web:build    # build the dashboard into web/dist
npm run build:npm    # bundle the developer CLI into dist/npm
node bin/gtv.mjs     # CLI help
```

The server is TypeScript run directly by Node.js 24, with no build step. The dashboard is React with Vite.
CI runs on Ubuntu and Windows.

## Status

gtv is a university course project ("AI agents coordinating a coding project") and is still a prototype. The core
flows run end to end with real Claude Code and Codex sessions. In the
[self-test on a real Express codebase](docs/reports/selftest-realworld.md), two developers edit in parallel and
all 21 checks pass.

Not built yet:

- GitHub integration: pull request comments, a pre-push gate.
- Semantic search over the knowledge base.
- Support for more agents, such as Cursor.

See [SPEC.md](SPEC.md) for the roadmap.
