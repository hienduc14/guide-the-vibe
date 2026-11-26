# gtv dashboard

Web UI for the Operator, built for the team lead: who is working on what, where people collide, which questions wait
for a person, and how far the project is. Vite + React 18 + TypeScript. Icons from
[Lucide](https://lucide.dev) (`lucide-react`); charts are small inline SVGs, no chart library.

The Operator serves the built files from `web/dist` (`GTV_WEB_DIR`), so in production the dashboard lives at the
server's root URL. All data comes from `/api/*` (dashboard API) and `/v1/p/:project/*` (project API).

## Scripts

```bash
npm install          # inside web/
npm run dev          # http://localhost:5173, proxies /api /v1 /health /p to GTV_SERVER (default http://127.0.0.1:7390)
npm run build        # type-check (tsc -b) + bundle into web/dist
npm run typecheck
```

From the repo root: `npm run web:build`. To look at it with sample data and no LLM: `npm run demo` →
http://localhost:7395.

## Pages

| Page                | What it shows                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Tổng quan (`/`)     | KPI tiles across all projects, one card per project (progress ring, who is working, conflicts, questions)       |
| Project › Tổng quan | Charter strip, KPI tiles, "Cần xử lý", progress, one lane per agent session (avatar + agent logo, files, clash) |
| Project › Việc      | Kanban board; card = priority, due date, assignee with live agent, conflict, notes                              |
| Project › Trao đổi  | Agent questions, conflict notices, hand-offs as chat threads; count = questions waiting for a person            |
| Project › Conflict  | Open and past conflicts with evidence, per layer                                                                |
| Project › Thống kê  | Tasks left over time, done per day, status per person, upcoming deadlines; technical numbers collapsed below    |
| Project › Khác      | Thành viên, Tài liệu · Nhật ký hỏi đáp, Sơ đồ code, Lớp phát hiện · Cài đặt                                     |
| Brain, People       | Model providers and jobs; accounts, project access, activation links and computers (admin only)                 |

The project tabs are listed in `pages/project/ProjectLayout.tsx`; an item with `more: "<group>"` goes into the
"Khác" menu under that heading instead of the tab row.

## Structure

```
src/
  api/          types.ts (server JSON shapes) · client.ts (fetch, token, 401 → login) · endpoints.ts (one fn per endpoint)
  hooks/        usePoll (load + refresh while visible) · useAuth · useOverview (shared /api/overview) · useToast/useAction
  components/   Layout (navy sidebar, PageHead, BrandMark) · Tabs (icons + "Khác" menu) · Card/Stat · Badge · Table
                Visual (AgentLogo, DevAvatar, AvatarStack, Ring, Kpi, EmptyState, StatusDot)
                ProgressCharts (LineChart, BarsChart, StackBar) · Charts (older BarChart, HBars)
                Member (Avatar, LevelLadder) · Task (priority, due dates) · Empty/Loading/ErrorNotice · Field · Segmented …
  pages/
    overview/   OverviewPage, AddProjectForm
    project/    ProjectLayout (header, tabs, useProject context) + one file per tab:
                ProjectOverview · BoardTab/TaskDialog · ConversationsTab/Chat · ConflictsTab · StatsTab
                MembersTab · KnowledgeTab · TicketsTab · GraphTab/CodeMap · LayersTab · SettingsTab/ShareLinksCard
    brain/ devs/ users/ login/ share/
  lib/format.ts time/sha/duration helpers
  styles/       tokens.css · base.css · components.css · manager.css · theme.css · visual.css (loaded in that order)
public/
  gtv-logo.png  the logo, used as drawn
  agents/       Claude Code and Codex logos (@lobehub/icons-static-svg, MIT; see SOURCE.txt)
```

Rules of thumb: pages never call `fetch` directly (use `api.*`); every server shape lives in `api/types.ts`;
components stay presentational and typed; a page owns its data via `usePoll`.

## Adding a page or tab

1. Add the endpoint to `api/endpoints.ts` (and its type to `api/types.ts`).
2. Create `pages/<area>/MyPage.tsx`; load data with `usePoll(() => api.x(...), [deps])`; wrap mutations with
   `useAction()` for toasts.
3. Register the route in `App.tsx`. A project tab also gets an entry (label, Lucide icon, optional count) in
   `ProjectLayout.tsx`; put it in the row only if a lead needs it every day, otherwise give it `more: "<group>"`.
4. Lead with pictures: a `Kpi`, `Ring`, `DevAvatar` or `StatusDot` instead of a sentence; empty lists use
   `EmptyState` with an icon.

## Design

The rules live in [`DESIGN.md`](../DESIGN.md): three brand colours (navy sidebar, white work area, the logo blue
for actions), light theme only, Lucide icons at stroke 1.75, real agent logos, titles of one to three words and no
explanatory sentence under a heading. Values are in `src/styles/tokens.css`.

| Token                                                       | Use                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| `--bg` `--surface` `--sunken` `--fg`                        | white work area / cards / soft fills / text             |
| `--muted` `--faint`                                         | secondary text / hints and timestamps (both ≥ 4.5:1)    |
| `--line` `--line-strong` `--hover`                          | hairlines / control borders (≥ 3:1) / row hover         |
| `--accent` `--accent-hover` `--accent-soft`                 | the logo blue: primary button, active tab, links, rings |
| `--nav-bg` `--nav-fg` `--nav-muted` `--nav-active` …        | the navy sidebar and mobile top bar                     |
| `--info` `--warning` `--high` `--critical` `--ok`           | severity and status only (`-soft` for icon tiles)       |
| `--font` `--mono`                                           | Be Vietnam Pro / JetBrains Mono                         |
| `--text-*` `--s1…s7` `--radius` `--radius-lg` `--radius-xl` | type scale, spacing, corners                            |

Layout collapses to one column with a slide-in sidebar under 860px; KPI tiles go two per row under 560px.

## Auth

If `/api/overview` answers 401 the app shows a login screen (account name + password, or the admin token) and stores
the token in `localStorage` (`gtv.adminToken`). Every request sends `Authorization: Bearer <token>` and `X-Gtv-Dev`
(default `admin`, or the name typed when answering a ticket as a human). A read-only share link (`/s/:code`) shows
one project without signing in. In open dev mode (no admin token, no developers) no login is needed and the sidebar
shows an "open dev mode" badge.
