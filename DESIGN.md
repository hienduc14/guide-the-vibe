---
name: gtv-dashboard
description: >-
  The gtv Operator dashboard: where a team lead sees several developers' coding agents on one repo, and acts
  on what needs a person. A navy rail frames it; the work area is calm, with one action colour, and every
  person has their own colour for their threads, avatars and lines of code. Light and dark themes.

colors: # light / dark, defined once in web/src/styles/tokens.css
  rail: "#16224f / #0a0e1a" # app rail, the same frame in both themes
  bg: "#f3f5fa / #0e1322"
  surface: "#ffffff / #161c2f"
  accent: "#3657d0 / #7f9cff" # the one action colour: primary button, active tab, links, focus
  people: [amber, violet, teal, green, pink, sky] # --c-*: one per member, in the order they joined
  state: { high: "#c2341d / #ff7d6e", warning: "#8a5600 / #f2b750", ok: "#17704a / #52d3a2" }

theme: light and dark; follows the OS until the person picks one (button in the project header, saved in localStorage)

icons: Lucide (lucide-react), stroke 1.75, 16px
typography:
  sans: Be Vietnam Pro # full Vietnamese support
  mono: JetBrains Mono # paths, code, branches
---

# gtv dashboard design

Tokens: `web/src/styles/tokens.css`. The project page (everything under `/p/:id`): `web/src/styles/project.css`,
scoped under `.pj`, with the prototype it came from in `docs/prototype/`. Older pages still use `components.css`,
`theme.css` and `visual.css`, which read the same tokens, so they follow the theme too.

## The project page: five places and settings

| Tab         | Answers                                       | Main element                                                          |
| ----------- | --------------------------------------------- | --------------------------------------------------------------------- |
| Hiện trường | Who works on what, and where they collide     | Work map: agent cards, file rows, a coloured thread per touch         |
| Cần xử lý   | What waits for a person                       | One list (clashes, questions, work to check) and the detail beside it |
| Việc        | The plan and progress                         | Five-column board; blocked cards say why; task drawer                 |
| Trao đổi    | What agents wrote, asked and were told        | One thread per task, with questions and clashes inside it             |
| Tri thức    | What the AI and agents rely on                | Charter, documents, answers waiting for confirmation                  |
| Thiết lập   | Members, how much gtv steps in, repo, sharing | Managers only                                                         |

Clicking a file anywhere opens the **file sheet** (`?file=` in the URL): each person's unmerged change side by
side, or merged into one column, with the clashing spots boxed, and the incident's resolution at the bottom.

## Rules

- **One number for "needs a person"**: `attention()` on the server. The tab, the rail badge and the list agree.
- **A clash is an incident**: all conflict rows about one pair of people. The layers L0–L3 are evidence inside
  it, shown as small labels, never as headings.
- **Every action sits next to its data**: answer a question, settle a clash, assign a task where it is shown.
- **Say what a button does to people**: "Gửi cho hai agent", "Để hai bên tự phối hợp" with one line on the effect.
- **Person colours identify people, state colours carry state**: red is only for clashes and blocks, amber for
  waiting, green for done. A person colour never means a state.
- **Agents are identified by their real logo** (`web/public/agents`), as a badge on the person's avatar.
- **Plain Vietnamese** in the interface; feature keys and layer names only in tooltips.
- Light and dark: components read tokens only. Every text colour is at least 4.5:1 on its background in both.
