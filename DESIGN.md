---
name: gtv-dashboard
description: >-
  The gtv Operator dashboard: a dispatch board for several developers' coding agents on one repo, read
  mostly by the team lead. Laid out like a work-management app (Linear, Height): a solid navy sidebar,
  a white work area, the logo blue for every action. Pictures first (icons, avatars, agent logos, rings),
  one or two words beside them. Evolved from the earlier Mercury-inspired draft: still one action colour,
  now the logo's own blue, and navy instead of a night-violet frame.

colors:
  navy: "#16224f" # sidebar and mobile top bar
  white: "#ffffff" # work area and cards: the dominant colour
  blue: "#476be0" # the gtv logo blue: primary button, active nav item, active tab, links, focus, rings
  ink: "#16181d" # text (not a brand colour)
  # derived neutrals lean cool so they sit with the blue
  sunken: "#f5f6f9"
  accent-soft: "#eef2fd"
  muted: "#5b6170"
  faint: "#6b7180" # ≥ 4.5:1 on white
  line: "#e7e9ee"
  line-strong: "#8d93a1" # control edges, ≥ 3:1
  on-navy: { text: "#ffffff", muted: "#b9c2db", faint: "#9aa5c4" } # 15:1, 8.5:1, 6.2:1

theme: light only (no dark mode, no toggle)

gtv-specific:
  agents: real logos in web/public/agents (Claude Code, Codex) from @lobehub/icons-static-svg (MIT)
  severity: { info: "#3f6390", warning: "#9a6200", high: "#c13b22", critical: "#9c1030", ok: "#1f7a50" }

icons: Lucide (lucide-react), stroke 1.75, 16px in text, 18px in nav and KPI tiles, 28px in empty states

typography:
  sans: Be Vietnam Pro # full Vietnamese support; do not swap for a font without it
  mono: JetBrains Mono # ids, paths, commands, contracts
  scale: { xs: 12px, sm: 13px, md: 14px, lg: 16px, xl: 20px, 2xl: 24px, num: 22px } # in rem in CSS
  weights: { body: 400, ui: 500, headings: 600 } # never 700+

rounded: { control: 6px, card: 10px, project-card: 14px } # no pill buttons
spacing: { s1: 4px, s2: 8px, s3: 12px, s4: 16px, s5: 24px, s6: 32px, s7: 48px }
---

# gtv dashboard design

Values: `web/src/styles/tokens.css`. Shell and shared controls: `web/src/styles/theme.css`. Visual
components (KPI tiles, rings, avatars, lanes, kanban cards): `web/src/styles/visual.css` with
`web/src/components/Visual.tsx`. This file says how to use them, so new pages look like the rest.

## The five-second test

A lead opening any project page must see, without reading a sentence:

1. **Who is working on what**: lanes with avatar + agent logo, task title, the files they touch.
2. **Where people collide**: red Zap icon and count, a red lane edge, the clashing file chip in red.
3. **Questions waiting for a person**: amber question icon and count.
4. **Progress**: a ring with the percentage, plus done/total.

The KPI row (`.kpis` of `<Kpi>`) answers those four in the first screen. Everything else is below it.

## Colour rules

- **Three brand colours: navy, white, logo blue.** Ink is the text colour; everything else is a tint or a
  state colour.
- **Navy is the frame only**: sidebar and the mobile top bar. Never inside the work area.
- **Blue means "act here" or "you are here"**: the one primary button per view, the active nav item
  (solid blue, white text), the active tab underline, links, focus ring, progress rings.
- **Red, amber, green are state only**: conflict severity, waiting, done. A count or KPI turns red only
  when something needs a person; zero stays grey.
- **Agents are identified by their real logo**, never by a colour we invent.
- Separate surfaces with 1px hairlines, not shadows. Soft fills only behind icons (KPI icon tiles,
  attention icons, empty-state circle).

## Shell

- Navy sidebar: the logo image as drawn (`web/public/gtv-logo.png`, 30px, no tile or padding) and the
  name "Guide the Vibe", Lucide icons for each page, projects as a
  letter tile with a live dot (green = someone working, red = cannot load) and a red count when something
  needs a person.
- Work area: white, column up to 1200px. Page head: h1 and at most one primary action. A subtitle only
  when it is data (repo, branch, sync), never a sentence.
- Project tabs: icon + one word. The row holds only what a lead checks every day: Tổng quan, Việc, Trao đổi,
  Conflict, Thống kê. Everything else is in the "Khác" menu, grouped (Nhóm: Thành viên, Tài liệu · Kỹ thuật:
  Nhật ký hỏi đáp, Sơ đồ code, Lớp phát hiện · Quản trị: Cài đặt); it shows the current one's name when open and a
  red dot when an item inside needs a person.
- Light theme only: `color-scheme: light` on the page whatever the OS setting. Tokens are plain values.

## Components

- **KPI tile** (`Kpi`): icon tile, big number, one-word label, optional ring/avatars on the right. Links
  to the tab that explains the number.
- **Project card** (`.pcard`, overview): name, repo, ring; goal in two lines; avatar stack of who is
  working; footer of icon metrics (Zap conflicts, question, overdue) and sync/deadline.
- **Charter strip** (`.charter-strip`): goal on one line, quality badge, days left, stack; milestones and
  constraints behind "Chi tiết".
- **Work lanes** (`.lanes` > `.lane`): one row per agent session: `DevAvatar` (initials + agent logo),
  task title, file chips (red when clashing), status dot ("Đụng bob" / "Ổn"), files touched and age.
- **Kanban card** (`.tcard`): priority edge + icon + word (Flame Khẩn, ArrowUp Cao, Minus Thường,
  ArrowDown Thấp), due date with a clock, title, conflict dot, assignee avatar with the live agent's
  logo, note count. Column headers have a status icon.
- **Stats tab** (`StatsTab.tsx`, charts in `ProgressCharts.tsx`): KPI row (done ring, done this period
  with ▲▼ vs the previous period, median time from start to done, overdue, blocked), "Việc còn lại" line,
  "Xong mỗi ngày" bars, a status bar per person (xong / đang làm / bị chặn / cần làm, legend + numbers
  beside it), and "Sắp tới hạn". Brain, conflict, Q&A and event numbers sit in a collapsed "Số liệu kỹ
  thuật" section. Charts: one axis, 2px line, 4px rounded bar tops, 2px gaps, recessive grid, tooltip on
  hover and keyboard focus, axis text at real 11px.
- **Attention row**: severity-tinted icon tile per kind (Zap, question, calendar, octagon, user-x).
- **Status**: `StatusDot` = coloured dot + one or two words. `Badge` for short labels.
- **Empty state** (`EmptyState`, and `Empty` by default): 56px soft-blue circle with a Lucide icon, a bold
  title, at most one short line.
- **Buttons:** 6px radius, min 32px tall (28px small). Primary: logo-blue fill, white text. Secondary:
  white with a hairline. On touch, icon buttons are 44×44.
- **Notices:** leading icon, one sentence, one action; raw tool output behind `<details>`.

## Copy

Vietnamese for every label. Keep as loan words only the terms the product uses everywhere: project,
agent, conflict, brain, token, commit, merge. Titles of one to three words; no sentence under a heading.
Explanations and legends go in a `title` tooltip.

## Don't

- Don't add a fourth brand colour, a second solid primary button, gradients, glows, violet/lavender
  tints, or heavy shadows.
- Don't use pill-shaped buttons or rows of coloured pill chips.
- Don't draw our own icon for an agent; use its logo from `web/public/agents`.
- Don't mix icon sets; everything is Lucide at stroke 1.75.
- Don't use colour alone for meaning: pair it with an icon or a word.
- Don't print raw errors, local paths or stack traces as the main text of a page.
