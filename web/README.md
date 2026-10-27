# gtv dashboard

Web UI for the Operator: projects, who is working, conflicts per layer, feature modes, Q&A, knowledge,
code graph, statistics, brain and developer tokens. Vite + React 18 + TypeScript, no UI or chart library.

The Operator serves the built files from `web/dist` (`GTV_WEB_DIR`), so in production the dashboard lives at
the server's root URL. All data comes from `/api/*` (dashboard API) and `/v1/p/:project/*` (project API).

## Scripts

```bash
npm install          # inside web/
npm run dev          # http://localhost:5173, proxies /api /v1 /health /p to GTV_SERVER (default http://127.0.0.1:7390)
npm run build        # type-check (tsc -b) + bundle into web/dist
npm run typecheck
```

From the repo root: `npm --prefix web run build`.

## Structure

```
src/
  api/          types.ts (server JSON shapes) · client.ts (fetch, token, 401 → login) · endpoints.ts (one fn per endpoint)
  hooks/        usePoll (load + refresh every 5s while visible) · useAuth · useOverview (shared /api/overview) · useToast/useAction
  components/   Layout+Sidebar+PageHead · Card/Stat · Badge/LevelBadge/StatusBadge · Table · Tabs · Segmented
                ConfirmButton · JsonView · Field · Charts (BarChart, HBars) · Empty/Loading/ErrorNotice
  pages/
    overview/   OverviewPage, AddProjectForm
    project/    ProjectLayout (header, tabs, useProject context) + one file per tab:
                ProjectOverview · ConflictsTab · LayersTab · TicketsTab · KnowledgeTab · GraphTab · StatsTab · SettingsTab
    brain/      BrainPage, BrainJobsTable
    devs/       DevsPage, IssuedToken
    login/      LoginPage
  lib/format.ts time/sha/duration helpers
  styles/       tokens.css (design tokens) · base.css (reset, controls, helpers) · components.css
```

Rules of thumb: pages never call `fetch` directly (use `api.*`); every server shape lives in `api/types.ts`;
components stay presentational and typed; a page owns its data via `usePoll`.

## Adding a page or tab

1. Add the endpoint to `api/endpoints.ts` (and its type to `api/types.ts`).
2. Create `pages/<area>/MyPage.tsx`; load data with `usePoll(() => api.x(...), [deps])`; wrap mutations with `useAction()` for toasts.
3. Register the route in `App.tsx` (project tabs go under `p/:id` and get a `Tabs` entry in `ProjectLayout.tsx`).

## Design tokens

Black & white first. The only accent is a muted red (`--accent`) reserved for severity and errors.
Light theme by default; dark follows `prefers-color-scheme`.

| Token                           | Use                                            |
| ------------------------------- | ---------------------------------------------- |
| `--bg` `--fg`                   | page background / text and primary buttons     |
| `--muted` `--faint`             | secondary text / hints, inactive dots          |
| `--line` `--line-strong`        | 1px borders (cards, tables) / control borders  |
| `--subtle` `--hover`            | quiet fills: bar tracks, selected rows / hover |
| `--accent` `--accent-soft`      | critical level, errors, "danger" buttons       |
| `--font` `--mono`               | system sans / monospace for ids, paths, code   |
| `--text-*` `--s1…s7` `--radius` | type scale, spacing scale, corner radius       |

Severity badges: `info` outline · `warning` bold outline · `high` inverted (black) · `critical` red.
No shadows, no gradients; layout collapses to a single column with a slide-in sidebar under 860px.

## Auth

If `/api/overview` answers 401 the app shows a login screen and stores the admin token in `localStorage`
(`gtv.adminToken`). Every request sends `Authorization: Bearer <token>` and `X-Gtv-Dev` (default `admin`,
or the name typed when answering a ticket as a human). In open dev mode (no admin token, no developers)
no login is needed and the sidebar shows an "open dev mode" badge.
