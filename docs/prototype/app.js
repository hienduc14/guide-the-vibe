// Prototype of the gtv project page. Plain JS, no build step: each screen is a function that returns HTML.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- icons (Lucide paths) ----------
const ICON = {
  pulse: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  kanban: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
  chat: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  ask: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  ai: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.03.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  star: '<path d="M11.52 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  cal: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  redo: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  note: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ""}</svg>`;

// ---------- small pieces ----------
const pc = (who) => (PEOPLE[who] ? `style="--p:var(--c-${PEOPLE[who].color})"` : "");
function av(who, size = "", logo = true) {
  if (who === "gtv") return `<span class="av ${size}"><img src="assets/gtv-logo.png" alt="gtv" style="width:62%;height:62%"></span>`;
  const p = PEOPLE[who];
  if (!p) return `<span class="av ${size}">?</span>`;
  const badge = logo ? `<span class="logo"><img src="assets/${p.agent}.svg" alt="${p.agentName}"></span>` : "";
  return `<span class="av ${size}" ${pc(who)} title="${p.name} · ${p.agentName}">${p.ini}${badge}</span>`;
}
const state = (who) => `<span class="state ${PEOPLE[who].status}">${STATUS_LABEL[PEOPLE[who].status]}</span>`;
const base = (path) => path.split("/").pop();
const dir = (path) => path.split("/").slice(0, -1).join("/") || "(gốc repo)";
const openIncidents = () => INCIDENTS.filter((i) => i.status === "open");
const waiting = () => QUESTIONS.filter((q) => q.status === "waiting");
const openOther = () => OTHER_ATTENTION.filter((a) => !a.done);
const needCount = () => openIncidents().length + waiting().length + openOther().length;
function blockers(id) {
  const t = TASKS[id];
  const out = [];
  const q = QUESTIONS.find((x) => x.id === t.waits && x.status === "waiting");
  if (q) out.push(`Chờ ${q.to} trả lời`);
  if (t.who && PEOPLE[t.who].task === id) {
    const others = [...new Set(openIncidents().filter((i) => i.level === "high" && (i.a === t.who || i.b === t.who)).map((i) => (i.a === t.who ? i.b : i.a)))];
    if (others.length) out.push(`Đụng ${others.join(", ")}`);
  }
  return out;
}
// the column a task sits in: work that is in progress moves to "Bị chặn" while something blocks it
const colOf = (id) => (["in_progress", "blocked"].includes(TASKS[id].status) ? (blockers(id).length ? "blocked" : "in_progress") : TASKS[id].status);
const bumps = (who) => openIncidents().filter((i) => i.a === who || i.b === who).map((i) => (i.a === who ? i.b : i.a));

const S = {
  route: "now",
  sel: null, // agent selected on the map: { who }
  sheet: null, // path of the file open in the file sheet
  sheetMode: "split",
  sheetFix: false, // the resolution block in the sheet starts folded, so the code gets the room
  mapOnly: false,
  mapDetail: false,
  inbox: "i1",
  inboxWho: null,
  workView: "board",
  task: null,
  talk: "t-bio",
  talkFilter: "all",
  know: "charter",
  set: "members",
  answers: {},
  draft: {}, // per clash: the chosen plan, the edited text, who receives it
};

function toast(text) {
  $$(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.innerHTML = ic("check") + esc(text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- shell ----------
const TABS = [
  ["now", "Hiện trường", "pulse"],
  ["inbox", "Cần xử lý", "inbox"],
  ["work", "Việc", "kanban"],
  ["talk", "Trao đổi", "chat"],
  ["know", "Tri thức", "book"],
];

function renderShell() {
  $("#rail").innerHTML = `
    <img class="logo" src="assets/gtv-logo.png" alt="Guide the Vibe" />
    <button class="ri" title="Tổng quan các project">${ic("grid")}</button>
    <button class="ri" title="AI trả lời">${ic("ai")}</button>
    <button class="ri" title="Developers">${ic("users")}</button>
    <button class="ri" title="Tài khoản">${ic("shield")}</button>
    <hr />
    <button class="proj" title="GTV">G</button>
    <button class="proj on" title="Realworld API">R${needCount() ? `<span class="badge">${needCount()}</span>` : ""}</button>
    <span class="grow"></span>
    <span class="me" title="admin">Ad</span>`;
  const done = Object.values(TASKS).filter((t) => t.status === "done").length;
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  $("#top").innerHTML = `
    <div class="top-row">
      <button class="pname" title="Đổi project"><span class="tile">R</span><b>Realworld API</b>${ic("down")}</button>
      <div class="repo">
        <span class="mono">${ic("branch")}master · 30b68e1</span>
        <span>đồng bộ 1 phút trước</span>
        <span>${done}/${Object.keys(TASKS).length} việc xong · ${CHARTER.left}</span>
      </div>
      <div class="top-tools">
        <span class="pill" title="AI trả lời câu hỏi của agent và so mục tiêu các việc"><span class="state running">AI trả lời</span></span>
        <button class="iconbtn" data-act="theme" title="${dark ? "Chuyển sang nền sáng" : "Chuyển sang nền tối"}" aria-label="Đổi nền sáng tối">${ic(dark ? "sun" : "moon")}</button>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map(([k, label, icon]) => `<button class="tab ${S.route === k ? "on" : ""}" role="tab" aria-selected="${S.route === k}" data-act="go" data-arg="${k}">${ic(icon)}${label}${k === "inbox" && needCount() ? `<span class="n">${needCount()}</span>` : ""}</button>`).join("")}
      <span class="gap"></span>
      <button class="tab ${S.route === "settings" ? "on" : ""}" data-act="go" data-arg="settings">${ic("sliders")}Thiết lập</button>
    </div>`;
}

// ---------- screen 1: Hiện trường ----------
function screenNow() {
  const running = Object.values(PEOPLE).filter((p) => p.status === "running").length;
  const idle = Object.values(PEOPLE).filter((p) => p.status === "idle").length;
  const files = FILES.filter((f) => !S.mapOnly || f.clash || f.watch);
  const groups = {};
  for (const f of files) (groups[dir(f.path)] ||= []).push(f);
  const hidden = 38 - FILES.length;

  const agents = Object.values(PEOPLE)
    .map((p) => {
      const t = TASKS[p.task];
      const b = [...new Set(bumps(p.name))];
      const mine = FILES.filter((f) => f.touches.some((x) => x.who === p.name));
      return `<button class="agent ${S.sel?.who === p.name ? "sel" : ""}" ${pc(p.name)} data-who="${p.name}" data-act="selWho" data-arg="${p.name}">
        ${av(p.name, "lg")}
        <span class="who"><b>${p.name}</b><span class="ag">${p.agentName}</span></span>
        <span class="task ${t ? "" : "none"}">${t ? esc(t.title) : "Chưa nói đang làm gì"}</span>
        <span class="meta">${state(p.name)}${b.length ? `<span class="bump">đụng ${b.join(", ")}</span>` : ""}${t && waiting().some((q) => q.id === t.waits) ? `<span>chờ trả lời</span>` : ""}</span>
        <span class="more"><span class="mono">${p.branch}</span> · ${mine.length} file · thấy lần cuối ${p.seen}</span>
        <span class="inline-files">${mine.map((f) => `<span class="chip ${f.clash ? "clash" : ""} mono">${base(f.path)}</span>`).join("")}</span>
      </button>`;
    })
    .join("");

  const fileRows = Object.entries(groups)
    .map(
      ([d, list]) => `<div class="folder">${ic("folder")}${d}</div>` +
        list
          .map((f) => {
            const edits = f.touches.reduce((n, t) => n + t.n, 0);
            return `<button class="file ${f.clash ? "clash" : f.watch ? "watch" : ""} ${S.sheet === f.path ? "sel" : ""}" data-file="${f.path}" data-act="selFile" data-arg="${f.path}">
              <span><span class="fname">${base(f.path)}</span>${f.note ? `<span class="fsub">${f.note}</span>` : ""}<span class="fsub sy">${f.symbols.length ? f.symbols.join(", ") + " · " : ""}${edits} lần sửa</span></span>
              <span class="avs">${f.touches.map((t) => av(t.who, "sm", false)).join("")}</span>
            </button>`;
          })
          .join(""),
    )
    .join("");

  return `
  <div class="head">
    <div>
      <h1>Ai đang làm gì</h1>
      <p class="lead"><b>${running} agent</b> đang chạy, ${idle} tạm nghỉ. <span class="hot">${openIncidents().length} chỗ đang đụng nhau</span>, ${waiting().length} câu hỏi chờ người quyết.</p>
    </div>
    <div class="tools">
      <div class="seg" role="group" aria-label="Lọc sơ đồ">
        <button class="${S.mapOnly ? "" : "on"}" data-act="mapOnly" data-arg="0">Mọi file</button>
        <button class="${S.mapOnly ? "on" : ""}" data-act="mapOnly" data-arg="1">Chỉ chỗ đụng nhau</button>
      </div>
      <div class="seg" role="group" aria-label="Mức chi tiết">
        <button class="${S.mapDetail ? "" : "on"}" data-act="mapDetail" data-arg="0">Gọn</button>
        <button class="${S.mapDetail ? "on" : ""}" data-act="mapDetail" data-arg="1">Chi tiết</button>
      </div>
    </div>
  </div>
  <div class="now">
    <section class="panel">
      <div class="mapwrap">
        <div class="map ${S.mapDetail ? "detail" : ""}" id="map">
          <svg class="wires" aria-hidden="true"></svg>
          <div class="agents">${agents}</div>
          <div></div>
          <div class="files">${fileRows}</div>
        </div>
      </div>
      <div class="legend">
        <span><i></i>đang sửa</span>
        <span><i class="thin"></i>đã sửa trước đó</span>
        <span><i class="dots"></i>mới khai báo, chưa sửa</span>
        <span><i class="box"></i>đụng nhau</span>
        <span class="right">${hidden} file chưa ai chạm tới được ẩn</span>
      </div>
    </section>
    <aside class="side">${S.sel?.who ? sideWho(S.sel.who) : sideHome()}</aside>
  </div>`;
}

function sideHome() {
  const rows = [
    ...openIncidents().map((i) => `<button class="need" data-act="openInbox" data-arg="${i.id}"><span class="ic">${ic("zap")}</span><b>${i.a} và ${i.b} đụng nhau</b><small>${esc(i.title)}</small><span class="go">${ic("right")}</span></button>`),
    ...waiting().slice(0, 2).map((q) => `<button class="need" data-act="openInbox" data-arg="${q.id}"><span class="ic q">${ic("ask")}</span><b>${q.from} hỏi ${q.to}</b><small>${esc(q.summary)}</small><span class="go">${ic("right")}</span></button>`),
  ].join("");
  const more = needCount() - openIncidents().length - Math.min(2, waiting().length);
  return `
    <div class="panel">
      <h3>Cần người xử lý<a class="all" href="#inbox">Xem cả ${needCount()}</a></h3>
      ${rows || `<p class="muted">Không có gì đang chờ.</p>`}
      ${more > 0 ? `<p class="faint" style="padding:8px 10px 0">và ${more} mục khác</p>` : ""}
    </div>
    <div class="panel">
      <h3>Hôm nay<span class="byai">${ic("ai")}AI tóm tắt lúc 22:00</span></h3>
      <ul class="digest">${DIGEST.map((d) => `<li>${d}</li>`).join("")}</ul>
    </div>`;
}

// ---------- the file sheet: a large dialog with each person's changes side by side ----------
const TOKEN = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(const|let|export|default|async|await|if|else|throw|new|return|function|import|from|class|extends|public|readonly|constructor|super|this)\b/g;
function hl(src) {
  let out = "", last = 0;
  for (const m of src.matchAll(TOKEN)) {
    out += esc(src.slice(last, m.index)) + `<span class="tk-${m[1] ? "c" : m[2] ? "s" : "k"}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}
const ln = (cls, no, mark, text, who) => `<div class="ln ${cls}" ${who ? pc(who) : ""}><span class="no">${no}</span><span class="mk">${mark}</span><code>${hl(text) || " "}</code></div>`;

function sheetCode(f, code) {
  const cols = [...new Set(code.hunks.flatMap((h) => h.segs.flatMap((s) => Object.keys(s.chg || {}))))];
  const count = (w, k) => code.hunks.reduce((n, h) => n + h.segs.reduce((m, s) => m + (s.chg?.[w]?.[k].length || 0), 0), 0);
  const clashes = code.hunks.reduce((n, h) => n + h.segs.filter((s) => s.clash).length, 0);
  const merge = S.sheetMode === "merge";

  const head = merge
    ? `<div class="cols" style="--k:1"><div class="colh"><div><b>Nếu gộp tất cả vào master</b><small>${clashes ? `Git không tự gộp được ${clashes} chỗ. Ở các chỗ đó là gợi ý của AI.` : "Git gộp sạch, không có chỗ nào đụng."}</small></div><span class="who-keys">${cols.map((w) => `<span ${pc(w)}><i></i>${w}</span>`).join("")}</span></div></div>`
    : `<div class="cols" style="--k:${cols.length}">${cols.map((w) => `<div class="colh" ${pc(w)}>${av(w)}<div><b>${w}</b><small>${esc(TASKS[PEOPLE[w].task].title)}</small></div><span class="pm"><b class="plus">+${count(w, "add")}</b> <b class="minus">−${count(w, "del")}</b><small>bản lưu ${code.saved[w]}</small></span></div>`).join("")}</div>`;

  const body = code.hunks.map((h, hi) => {
    let n = h.start;
    const segs = h.segs.map((s) => {
      if (s.fold) { n += s.fold; return `<div class="fold">${s.label}</div>`; }
      if (s.ctx) {
        const from = n; n += s.ctx.length;
        const cell = `<div class="cell">${s.ctx.map((t, i) => ln("", from + i, "", t)).join("")}</div>`;
        return `<div class="cseg" style="--k:${merge ? 1 : cols.length}">${merge ? cell : cols.map(() => cell).join("")}</div>`;
      }
      const from = n; n += s.base.length;
      if (merge) {
        if (s.clash) return `<div class="cseg clash" style="--k:1"><div class="clashbar ai">${ic("ai")}AI gợi ý gộp chỗ này. ${esc(s.note)}</div><div class="cell">${s.merged.map(([w, t]) => ln("add", "", "+", t, w)).join("")}</div></div>`;
        const lines = Object.entries(s.chg).flatMap(([w, c]) => c.add.map((t) => ln("add", "", "+", t, w)));
        return `<div class="cseg" style="--k:1"><div class="cell">${lines.join("")}</div></div>`;
      }
      const cells = cols.map((w) => {
        const c = s.chg[w];
        if (!c) return s.base.length ? `<div class="cell">${s.base.map((t, i) => ln("", from + i, "", t)).join("")}</div>` : `<div class="cell void"></div>`;
        return `<div class="cell">${c.del.map((t, i) => ln("del", from + i, "−", t)).join("")}${c.add.map((t) => ln("add", "", "+", t, w)).join("")}</div>`;
      });
      return `<div class="cseg ${s.clash ? "clash" : ""}" style="--k:${cols.length}">${s.clash ? `<div class="clashbar">${ic("zap")}${esc(s.note)}</div>` : ""}${cells.join("")}</div>`;
    }).join("");
    return `<div class="hunk-h" id="hk-${hi}">${ic("code")}${esc(h.sym)}<span>dòng ${h.start}</span></div>${segs}`;
  }).join("");

  return `<div class="sbs" style="--k:${merge ? 1 : cols.length}">${head}${body}</div>`;
}

function sheetHTML(path) {
  const f = FILES.find((x) => x.path === path);
  const code = CODE[path];
  const inc = INCIDENTS.find((i) => i.id === (f.clash || f.watch));
  const label = { editing: "đang sửa", edited: "đã sửa trước đó", declared: "mới khai báo, chưa sửa" };
  const lv = inc && (inc.status !== "open" ? `<span class="chip ok">${ic("check")}${INC_DONE[inc.status]}</span>` : `<span class="chip ${f.clash ? "clash" : "warn"}">${ic("zap")}${f.clash ? "đụng nhau" : "cần để ý"}</span>`);
  const rail = `
    ${inc ? `<div class="verdict ${f.clash && inc.status === "open" ? "" : inc.status === "open" ? "warn" : "calm"}"><b>${ic("zap")}${esc(inc.title)}</b>${esc(inc.plain)}</div>` : `<div class="verdict calm"><b>${ic("check")}Chưa đụng ai</b>${f.touches.length > 1 ? "Nhiều người chạm file này nhưng khác hàm." : "Chỉ một người đang chạm file này."}</div>`}
    <div class="block"><span class="sect">Ai chạm vào file này</span>
      ${f.touches.map((t) => `<div class="touch">${av(t.who)}<div><b>${t.who}</b><small>${esc(TASKS[PEOPLE[t.who].task].title)}</small></div><div class="when">${label[t.state]}${t.n ? `<br>${t.n} lần · ${t.ago}` : ""}</div></div>`).join("")}
    </div>
    ${code ? `<div class="block"><span class="sect">Trong file này</span>
      ${code.outline.map((o) => { const hi = code.hunks.findIndex((h) => h.sym === o.name); return `<button class="sym ${o.clash ? "clash" : ""}" ${hi < 0 ? "disabled" : `data-act="jump" data-arg="${hi}"`}><span class="mono">${esc(o.name)}</span><span class="faint">dòng ${o.line}</span><span class="dots">${o.who.map((w) => `<i ${pc(w)} title="${w}"></i>`).join("")}${o.clash ? ic("zap") : ""}</span></button>`; }).join("")}
    </div>` : ""}
    ${code?.usedBy ? `<div class="block"><span class="sect">Ai đang gọi theo chữ ký cũ</span>${code.usedBy.map((u) => `<div class="touch">${av(u.who, "sm", false)}<div><b>${u.who}</b><small>${esc(u.where)}</small><small class="mono">${esc(u.text)}</small></div><div></div></div>`).join("")}</div>` : ""}
    ${inc ? `<div class="block"><span class="sect">Vì sao gtv báo</span><ul class="evid">${inc.evidence.map((e) => `<li><span class="ic">${ic(e.ic)}</span><div>${esc(e.t)}<small>${esc(e.s)}</small></div><span></span></li>`).join("")}</ul></div>` : ""}
    ${inc ? `<div class="acts"><button class="btn quiet sm" data-act="openInbox" data-arg="${inc.id}">${ic("inbox")}Mở vụ này ở Cần xử lý</button></div>` : ""}`;

  return `
    <header class="sh-head">
      <div><div class="faint mono">${dir(path)}</div><h2>${base(path)}</h2></div>
      ${lv || ""}
      ${code ? `<span class="faint">${code.lines} dòng · so với master · 30b68e1</span>` : ""}
      <span style="flex:1"></span>
      ${code ? `<div class="seg" role="group" aria-label="Cách xem"><button class="${S.sheetMode === "split" ? "on" : ""}" data-act="sheetMode" data-arg="split">Cạnh nhau</button><button class="${S.sheetMode === "merge" ? "on" : ""}" data-act="sheetMode" data-arg="merge">Gộp thử</button></div>` : ""}
      <button class="iconbtn" data-act="closeSheet" aria-label="Đóng">${ic("x")}</button>
    </header>
    <div class="sh-body">
      <aside class="sh-rail">${rail}</aside>
      <section class="sh-code">${code ? sheetCode(f, code) : `<div class="empty"><b>Chưa có thay đổi nào</b>${f.touches.map((t) => t.who).join(", ")} đã khai báo sẽ sửa file này nhưng chưa sửa. Khi agent bắt đầu sửa, thay đổi hiện ở đây.</div>`}</section>
    </div>
    ${inc ? `<footer class="sh-foot">${inc.status !== "open" || S.sheetFix ? fixBox(inc) : `<div class="fixbar"><b>${ic("ai")}Hướng xử lý</b><span class="muted">${esc(draftOf(inc).text)}</span><button class="btn primary" data-act="sheetFix" data-arg="1">Xử lý vụ này</button></div>`}</footer>` : ""}`;
}

function renderSheet() {
  const dlg = $("#sheet");
  if (!S.sheet) return dlg.open && dlg.close();
  const top = $(".sh-code", dlg)?.scrollTop || 0;
  dlg.innerHTML = sheetHTML(S.sheet);
  if (!dlg.open) dlg.showModal();
  $(".sh-code", dlg).scrollTop = top;
}

function sideWho(who) {
  const p = PEOPLE[who];
  const t = TASKS[p.task];
  const last = t.timeline.filter((e) => e.who === who).slice(-2);
  return `<div class="panel">
    <div class="dhead">${av(who, "lg")}<div><h2>${p.name}</h2><div class="muted">${p.agentName} · ${state(who)}</div></div><button class="iconbtn x" data-act="clearSel" aria-label="Đóng">${ic("x")}</button></div>
    <dl class="kv">
      <dt>Việc</dt><dd><a href="#work" data-act="openTask" data-arg="${p.task}">${esc(t.title)}</a></dd>
      <dt>Nhánh</dt><dd class="mono">${p.branch}</dd>
      <dt>Thấy lần cuối</dt><dd>${p.seen}</dd>
    </dl>
    <div class="block"><span class="sect">Mục tiêu agent đã đăng ký</span><p>${esc(t.goal)}</p></div>
    <div class="block"><span class="sect">Phạm vi đã đăng ký</span><div class="scope">${t.scope.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div></div>
    ${last.length ? `<div class="block"><span class="sect">Agent ghi lại gần đây</span><ul class="tl">${last.map((e) => `<li><span></span><div class="h"><span class="chip">${TAGS[e.tag]}</span>${e.at}</div><p>${esc(e.text)}</p></li>`).join("")}</ul></div>` : ""}
    <div class="block"><span class="sect">Nhắn vào agent của ${p.name}</span>
      <textarea class="textarea" id="note-${who}" placeholder="Ví dụ: dừng sửa auth.service.ts, đợi hien đẩy xong"></textarea>
      <div class="acts" style="margin-top:8px"><button class="btn primary" data-act="toast" data-arg="Đã gửi. Agent của ${p.name} sẽ đọc ở lượt kế tiếp">${ic("send")}Gửi</button></div>
    </div>
  </div>`;
}

// threads from each agent card to the files it touches
function drawWires() {
  const map = $("#map");
  if (!map) return;
  const svg = $(".wires", map);
  const R = map.getBoundingClientRect();
  const incoming = {};
  let out = "";
  for (const a of $$(".agent", map)) {
    const who = a.dataset.who;
    const ar = a.getBoundingClientRect();
    const mine = FILES.filter((f) => f.touches.some((t) => t.who === who))
      .map((f) => ({ f, el: map.querySelector(`.file[data-file="${f.path}"]`) }))
      .filter((x) => x.el);
    mine.forEach(({ f, el }, i) => {
      const t = f.touches.find((x) => x.who === who);
      const fr = el.getBoundingClientRect();
      const k = (incoming[f.path] = (incoming[f.path] ?? -1) + 1);
      const spread = Math.min(7, (ar.height - 28) / Math.max(1, mine.length));
      const x1 = ar.right - R.left, y1 = ar.top - R.top + ar.height / 2 + (i - (mine.length - 1) / 2) * spread;
      const x2 = fr.left - R.left, y2 = fr.top - R.top + fr.height / 2 + (k - (f.touches.length - 1) / 2) * 5;
      const dx = (x2 - x1) * 0.55;
      const cls = `${t.state} ${f.clash && t.state !== "declared" ? "hot" : ""}`;
      const col = `style="--p:var(--c-${PEOPLE[who].color})"`;
      out += `<path class="${cls}" ${col} data-who="${who}" data-file="${f.path}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/>`;
      out += `<circle ${col} data-who="${who}" data-file="${f.path}" cx="${x1}" cy="${y1}" r="2.5"/><circle ${col} data-who="${who}" data-file="${f.path}" cx="${x2}" cy="${y2}" r="2.5"/>`;
    });
  }
  svg.innerHTML = out;
  light();
}

// dim everything except one agent's or one file's threads
function light(kind, id) {
  const map = $("#map");
  if (!map) return;
  if (!kind && S.sheet) [kind, id] = ["file", S.sheet];
  else if (!kind && S.sel) [kind, id] = ["who", S.sel.who];
  $$(".lit", map).forEach((e) => e.classList.remove("lit"));
  map.classList.toggle("focus", !!kind);
  if (!kind) return;
  for (const w of $$(`.wires [data-${kind}="${id}"]`, map)) {
    w.classList.add("lit");
    map.querySelector(`.agent[data-who="${w.dataset.who}"]`)?.classList.add("lit");
    map.querySelector(`.file[data-file="${w.dataset.file}"]`)?.classList.add("lit");
  }
  map.querySelector(kind === "who" ? `.agent[data-who="${id}"]` : `.file[data-file="${id}"]`)?.classList.add("lit");
}

// ---------- screen 2: Cần xử lý ----------
function involves(item, who) {
  if (!who) return true;
  if (item.a) return item.a === who || item.b === who;
  if (item.from) return item.to === who || item.to === "cả nhóm" || item.from === who;
  return TASKS[item.task]?.who === who || !TASKS[item.task]?.who;
}

function screenInbox() {
  const w = S.inboxWho;
  const inc = openIncidents().filter((i) => involves(i, w));
  const qs = waiting().filter((q) => involves(q, w));
  const oth = openOther().filter((a) => involves(a, w));
  const done = [...INCIDENTS.filter((i) => i.status !== "open"), ...QUESTIONS.filter((q) => q.status !== "waiting")].filter((i) => involves(i, w));
  const row = (id, icon, cls, title, sub, when) => `<button class="row ${S.inbox === id ? "sel" : ""}" data-act="inbox" data-arg="${id}"><span class="ic ${cls}">${ic(icon)}</span><span class="t">${title}</span><span class="when">${when || ""}</span><span class="s">${sub}</span></button>`;
  const total = inc.length + qs.length + oth.length;

  const list = `
    ${inc.length ? `<div class="gh">Đụng nhau <span class="n">${inc.length}</span></div>` + inc.map((i) => row(i.id, "zap", "", esc(i.title), `${av(i.a, "sm", false)}${av(i.b, "sm", false)} ${i.a} và ${i.b}`, i.ago)).join("") : ""}
    ${qs.length ? `<div class="gh">Câu hỏi chờ người quyết <span class="n">${qs.length}</span></div>` + qs.map((q) => row(q.id, "ask", "q", esc(q.summary), `${av(q.from, "sm")} agent của ${q.from} hỏi ${q.to}`, q.ago)).join("") : ""}
    ${oth.length ? `<div class="gh">Việc cần để ý <span class="n">${oth.length}</span></div>` + oth.map((a) => row(a.id, a.kind === "unassigned" ? "user" : "clock", "t", esc(a.t), esc(a.s), "")).join("") : ""}
    ${total === 0 ? `<div class="empty"><span class="ring">${ic("check")}</span><b>Không còn gì chờ ${w || "nhóm"}</b>Mọi vụ đụng nhau và câu hỏi đã có người xử lý.</div>` : ""}
    ${done.length ? `<div class="gh">Đã xử lý hôm nay <span class="n">${done.length}</span></div>` + done.map((i) => row(i.id, "check", "done", esc(i.title || i.summary), i.a ? `${i.a} và ${i.b} · ${INC_DONE[i.status]}` : `đã trả lời agent của ${i.from}`, "")).join("") : ""}`;

  const history = `<button class="btn quiet sm" style="margin:8px 10px 6px" data-act="toast" data-arg="Mở lịch sử: 27 vụ đụng nhau và 14 câu hỏi đã đóng">${ic("clock")}Xem lịch sử đã đóng</button>`;
  const cur = INCIDENTS.find((i) => i.id === S.inbox) || QUESTIONS.find((q) => q.id === S.inbox) || OTHER_ATTENTION.find((a) => a.id === S.inbox);
  return `
  <div class="head">
    <div><h1>Cần xử lý</h1><p class="lead">Mọi thứ đang chờ một người quyết, gom về một chỗ. Xử lý xong thì mục đó rời khỏi danh sách.</p></div>
    <div class="tools">
      <span class="faint">Liên quan tới</span>
      <div class="seg" role="group" aria-label="Lọc theo người">
        <button class="${w ? "" : "on"}" data-act="inboxWho" data-arg="">Mọi người</button>
        ${Object.keys(PEOPLE).map((n) => `<button class="${w === n ? "on" : ""}" data-act="inboxWho" data-arg="${n}">${n}</button>`).join("")}
      </div>
    </div>
  </div>
  <div class="split">
    <section class="panel list">${list}${history}</section>
    <section class="panel detail">${cur ? (cur.a ? detailIncident(cur) : cur.from ? detailQuestion(cur) : detailOther(cur)) : `<div class="empty"><b>Chọn một mục bên trái</b></div>`}</section>
  </div>`;
}

// ---------- how a clash gets resolved: one block, used in the inbox and in the file sheet ----------
const INC_DONE = { guided: "đã gửi hướng xử lý", acked: "hai bên tự phối hợp", dismissed: "báo nhầm, đã đóng" };
const plansOf = (i) => i.plans || [{ k: "Gợi ý của AI", texts: [i.ai] }];
const draftOf = (i) => (S.draft[i.id] ||= { plan: 0, v: 0, text: plansOf(i)[0].texts[0], to: { [i.a]: true, [i.b]: true } });

function fixBox(i) {
  if (i.status !== "open") {
    const g = i.sent;
    return `<section class="outcome"><b>${ic("check")}${g ? `Đã gửi hướng xử lý lúc ${g.at}` : i.status === "acked" ? "Hai bên tự phối hợp" : "Đã đóng, coi là báo nhầm"}</b>
      ${g ? `<p class="quote">${esc(g.text)}</p><p class="muted">${g.to.map((w, n) => `${av(w, "sm", false)} ${w}: ${n ? "chưa đọc, agent sẽ thấy ở lượt kế tiếp" : "đã đọc"}`).join(" &nbsp; ")}</p>` : `<p class="muted">${i.status === "acked" ? "gtv thôi nhắc và thôi chặn hai agent ở chỗ này. Nếu vụ nặng lên, gtv mở lại." : "gtv không báo lại, trừ khi code ở chỗ này đổi khác."}</p>`}
      <div class="acts" style="margin-top:10px"><button class="btn sm" data-act="reopenIncident" data-arg="${i.id}">Mở lại vụ này</button></div></section>`;
  }
  const d = draftOf(i);
  const plans = plansOf(i);
  const to = [i.a, i.b].filter((w) => d.to[w]);
  return `<section class="fix">
    <div class="fix-draft">
      <div class="fix-h"><b>${ic("ai")}Hướng xử lý</b><span class="faint">AI soạn sẵn. Bạn chọn phương án, sửa lời, rồi gửi.</span>${S.sheet ? `<button class="btn quiet sm" style="margin-left:auto" data-act="sheetFix" data-arg="0">Thu gọn</button>` : ""}</div>
      <div class="plans" role="group" aria-label="Phương án">${plans.map((p, n) => `<button class="plan ${d.plan === n ? "on" : ""}" data-act="plan" data-arg="${i.id}:${n}">${esc(p.k)}</button>`).join("")}</div>
      <textarea class="textarea" data-draft="${i.id}" aria-label="Nội dung gửi cho agent">${esc(d.text)}</textarea>
      <div class="fix-tools">
        <button class="btn sm" data-act="rewrite" data-arg="${i.id}" title="AI viết lại cùng phương án bằng lời khác">${ic("redo")}Viết lại cách khác</button>
        <span class="faint" style="margin-left:auto">Gửi tới</span>
        ${[i.a, i.b].map((w) => `<button class="rcpt ${d.to[w] ? "on" : ""}" ${pc(w)} aria-pressed="${!!d.to[w]}" data-act="rcpt" data-arg="${i.id}:${w}">${av(w, "sm", false)}${w}</button>`).join("")}
      </div>
    </div>
    <div class="fix-do">
      <button class="btn primary" ${to.length ? "" : "disabled"} data-act="sendFix" data-arg="${i.id}">${ic("send")}${to.length === 2 ? "Gửi cho hai agent" : to.length ? `Gửi cho agent của ${to[0]}` : "Chọn người nhận"}</button>
      <p class="hint">Agent đọc ở lượt kế tiếp và làm theo. Vụ này rời danh sách chờ, gtv thôi chặn hai agent.</p>
      <div class="or">Hoặc không gửi gì</div>
      <button class="alt" data-act="ackIncident" data-arg="${i.id}"><b>Để hai bên tự phối hợp</b><small>Đánh dấu đã biết. gtv thôi nhắc và thôi chặn; vụ nặng lên thì báo lại.</small></button>
      <button class="alt" data-act="dismissIncident" data-arg="${i.id}"><b>Báo nhầm, đóng lại</b><small>gtv không báo lại, trừ khi code ở chỗ này đổi khác.</small></button>
    </div>
  </section>`;
}

function detailIncident(i) {
  const lv = { high: "mức cao", info: "mức thấp", warning: "mức vừa", critical: "nghiêm trọng" }[i.level];
  const card = (who) => `<div class="sidecard" ${pc(who)}>${av(who)}<b>${who}</b><small>${esc(TASKS[PEOPLE[who].task].title)}</small></div>`;
  return `
    <div class="eyebrow"><span class="chip ${i.level === "info" ? "" : "clash"}">${ic("zap")}Đụng nhau · ${lv}</span><span>${i.ago}</span>${i.status !== "open" ? `<span class="chip ok">${ic("check")}${INC_DONE[i.status]}</span>` : ""}</div>
    <h2>${esc(i.title)}</h2>
    <p>${esc(i.plain)}</p>
    <div class="vs">${card(i.a)}<span class="mid">${ic("zap")}</span>${card(i.b)}</div>
    <div class="block"><span class="sect">Vì sao gtv báo</span>
      <ul class="evid">${i.evidence.map((e) => `<li><span class="ic">${ic(e.ic)}</span><div>${esc(e.t)}<small>${esc(e.s)}</small></div><span class="lay" title="Lớp phát hiện ${e.lay}">${e.lay}</span></li>`).join("")}</ul>
    </div>
    <div class="block"><span class="sect">Ở đâu</span><div class="scope">${i.where.map((p) => `<button class="chip mono" style="border:0;cursor:pointer" data-act="openFile" data-arg="${p}">${p}</button>`).join("")}<span class="faint" style="align-self:center">Bấm để xem code của hai bên</span></div></div>
    <div class="block">${fixBox(i)}</div>
    <div class="block"><details><summary>gtv đã làm gì (${i.log.length} bước)</summary>${i.log.map((l) => `<p class="mono">${esc(l)}</p>`).join("")}</details></div>`;
}

function detailQuestion(q) {
  const picked = S.answers[q.id];
  const t = TASKS[q.task];
  const linked = INCIDENTS.find((i) => i.id === q.linked);
  if (q.status !== "waiting")
    return `<div class="eyebrow"><span class="chip ok">${ic("check")}Đã trả lời</span></div><h2>${esc(q.summary)}</h2><p class="muted">Trả lời: ${esc(q.answer || "")}</p>`;
  return `
    <div class="eyebrow"><span class="chip warn">${ic("ask")}Câu hỏi</span>${av(q.from, "sm")}<span>agent của <b>${q.from}</b> hỏi <b>${q.to}</b></span><span>${q.ago}</span></div>
    <h2>${esc(q.summary)}</h2>
    <div class="quote" ${pc(q.from)}>${esc(q.body)}</div>
    <dl class="kv" style="margin-top:16px">
      <dt>Trong việc</dt><dd><a href="#work" data-act="openTask" data-arg="${q.task}">${esc(t.title)}</a></dd>
      ${linked ? `<dt>Liên quan</dt><dd><a href="#inbox" data-act="inbox" data-arg="${linked.id}">Vụ đụng nhau ${linked.a} và ${linked.b}</a></dd>` : ""}
      <dt>Vì sao tới người</dt><dd>AI và agent của ${q.to === "cả nhóm" ? "đồng đội" : q.to} không đủ căn cứ để tự trả lời.</dd>
    </dl>
    <div class="block"><span class="sect">Trả lời</span>
      ${q.options ? `<div class="opts">${q.options.map((o, n) => `<button class="opt ${picked === n ? "on" : ""}" data-act="pick" data-arg="${q.id}:${n}"><span class="k">${"AB"[n]}</span>${esc(o)}</button>`).join("")}</div>` : ""}
      <textarea class="textarea" style="margin-top:8px" id="ans-${q.id}" placeholder="${q.options ? "Hoặc viết câu trả lời khác" : "Viết câu trả lời cho agent"}"></textarea>
      <label class="check"><input type="checkbox" id="save-${q.id}" checked /> Lưu vào Tri thức, lần sau AI tự trả lời câu tương tự</label>
    </div>
    <div class="acts">
      <button class="btn primary" data-act="answer" data-arg="${q.id}">${ic("send")}Gửi trả lời cho agent của ${q.from}</button>
      ${q.to !== "cả nhóm" ? `<button class="btn" data-act="toast" data-arg="Đã nhắc ${q.to} qua thông báo trên máy">Nhắc ${q.to}</button>` : ""}
    </div>`;
}

function detailOther(a) {
  const t = TASKS[a.task];
  const who = Object.keys(PEOPLE);
  return `
    <div class="eyebrow"><span class="chip">${ic(a.kind === "unassigned" ? "user" : "clock")}${a.kind === "unassigned" ? "Chưa ai nhận" : "Việc im lặng"}</span></div>
    <h2>${esc(t.title)}</h2>
    <p>${esc(t.goal)}</p>
    <dl class="kv" style="margin-top:16px"><dt>Ưu tiên</dt><dd>${PRI[t.pri]}</dd><dt>Hạn</dt><dd>${t.due || "chưa đặt"}</dd><dt>Tình trạng</dt><dd>${esc(a.s)}</dd></dl>
    <div class="acts">
      ${a.kind === "unassigned" ? who.map((n) => `<button class="btn" data-act="assign" data-arg="${a.id}:${n}">${av(n, "sm", false)}Giao cho ${n}</button>`).join("") : `<button class="btn primary" data-act="toast" data-arg="Đã nhắc khanh">Nhắc khanh</button><button class="btn" data-act="doneOther" data-arg="${a.id}">Trả về Cần làm</button>`}
      <button class="btn quiet" data-act="openTask" data-arg="${a.task}">Mở việc</button>
    </div>`;
}

// ---------- screen 3: Việc ----------
function taskCard(id) {
  const t = TASKS[id];
  const p = t.who && PEOPLE[t.who];
  const why = colOf(id) === "blocked" ? blockers(id) : [];
  const live = p && p.task === id && t.status !== "done" && t.status !== "review";
  return `<button class="card ${S.task === id ? "sel" : ""}" data-act="task" data-arg="${id}">
    ${why.map((w) => `<span class="why ${w.startsWith("Chờ") ? "q" : ""}">${ic(w.startsWith("Chờ") ? "ask" : "zap")}${w}</span>`).join("")}
    <span class="ct">${esc(t.title)}</span>
    <span class="cf">
      ${p ? `${av(t.who, "sm", live)}<span>${t.who}</span>${live ? state(t.who) : ""}` : `<span class="chip warn">chưa ai nhận</span>`}
      <span class="sp">${t.pri === "high" || t.pri === "urgent" ? `<span class="pri ${t.pri}">${ic("up")}${PRI[t.pri]}</span>` : ""}${t.due ? `<span class="pri">${ic("cal")}${t.due}</span>` : ""}</span>
    </span>
  </button>`;
}

function taskDrawer(id) {
  const t = TASKS[id];
  const p = t.who && PEOPLE[t.who];
  const col = BOARD_COLS.find((c) => c.key === colOf(id));
  const why = colOf(id) === "blocked" ? blockers(id) : [];
  return `<aside class="panel drawer">
    <div class="dhead"><h2>${esc(t.title)}</h2><button class="iconbtn x" data-act="task" data-arg="" aria-label="Đóng">${ic("x")}</button></div>
    <dl class="kv">
      <dt>Trạng thái</dt><dd>${col.label}${why.length ? ` · ${why.join(", ").toLowerCase()}` : ""}</dd>
      <dt>Người làm</dt><dd>${p ? `${t.who} · ${p.agentName} ${p.task === id ? state(t.who) : ""}` : "chưa ai nhận"}</dd>
      <dt>Ưu tiên</dt><dd>${PRI[t.pri]}${t.due ? ` · hạn ${t.due}` : ""}</dd>
      <dt>Nguồn</dt><dd>${t.by === "agent" ? "agent tự đăng ký khi bắt đầu làm" : `${t.by} giao trên bảng`}</dd>
    </dl>
    <div class="block"><span class="sect">Mục tiêu</span><p>${esc(t.goal)}</p></div>
    ${t.scope.length ? `<div class="block"><span class="sect">Phạm vi đã đăng ký</span><div class="scope">${t.scope.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div></div>` : ""}
    <div class="block"><span class="sect">Diễn biến</span>
      ${t.timeline.length ? `<ul class="tl">${t.timeline.map((e) => `<li>${av(e.who, "sm", false)}<div class="h"><b>${e.who}</b><span class="chip ${e.tag === "clash" || e.tag === "blocker" ? "clash" : e.tag === "question" ? "warn" : e.tag === "done" ? "ok" : ""}">${TAGS[e.tag]}</span>${e.at}</div><p>${esc(e.text)}${e.ref ? ` <a href="#inbox" data-act="openInbox" data-arg="${e.ref}">Mở</a>` : ""}</p></li>`).join("")}</ul>` : `<p class="muted">Chưa có ghi chú. Agent sẽ ghi lại tiến độ và quyết định ở đây khi bắt đầu làm.</p>`}
    </div>
    ${why.length ? `<div class="acts"><button class="btn primary" data-act="go" data-arg="inbox">${ic("inbox")}Gỡ chặn ở Cần xử lý</button></div>` : ""}
    <div class="acts"><button class="btn" data-act="toast" data-arg="Đã mở khung sửa việc">Sửa việc</button><button class="btn quiet" data-act="openTalk" data-arg="${id}">Xem trao đổi</button></div>
  </aside>`;
}

function screenWork() {
  const all = Object.entries(TASKS);
  const done = all.filter(([, t]) => t.status === "done").length;
  const blocked = all.filter(([id]) => colOf(id) === "blocked").length;
  const board = `<div class="withdrawer ${S.task ? "open" : ""}">
    <div class="board">${BOARD_COLS.map((c) => {
      const ids = all.filter(([id]) => colOf(id) === c.key).map(([id]) => id);
      return `<section class="col ${c.key}"><h3>${ic(c.icon)}${c.label}<span class="n">${ids.length}</span></h3>${ids.map(taskCard).join("") || `<p class="hint">Trống</p>`}</section>`;
    }).join("")}</div>
    ${S.task ? taskDrawer(S.task) : ""}
  </div>`;

  const per = Object.keys(PEOPLE).map((n) => {
    const mine = all.filter(([, t]) => t.who === n).map(([id]) => colOf(id));
    const c = (s) => mine.filter((x) => s.includes(x)).length;
    return { n, d: c(["done"]), p: c(["in_progress", "review"]), k: c(["blocked"]), w: c(["todo"]), total: mine.length };
  });
  const pts = [6, 6, 7, 7, 6, 6, 6, 8, 8, 7, 7, 6, 6, 6];
  const line = pts.map((v, i) => `${30 + i * 28},${130 - v * 13}`).join(" ");
  const progress = `
    <div class="prog">
      <div class="panel stat"><div class="big num">${done}/${all.length}</div><small>việc đã xong</small></div>
      <div class="panel stat"><div class="big num">3 <span class="delta">▲ 2</span></div><small>xong trong 7 ngày, so với tuần trước</small></div>
      <div class="panel stat"><div class="big num">1,4 ngày</div><small>từ lúc bắt đầu tới lúc xong (trung vị)</small></div>
      <div class="panel stat"><div class="big num">${blocked}</div><small>bị chặn · 0 quá hạn</small></div>
    </div>
    <div class="two">
      <div class="panel chart"><h3>Việc còn lại, 14 ngày</h3>
        <svg viewBox="0 0 420 150" role="img" aria-label="Số việc còn lại 14 ngày qua, hiện còn 6">
          ${[0, 4, 8].map((v) => `<line x1="30" x2="400" y1="${130 - v * 13}" y2="${130 - v * 13}" stroke="var(--line)"/><text x="6" y="${134 - v * 13}">${v}</text>`).join("")}
          <polygon points="30,130 ${line} 394,130" fill="var(--accent)" opacity="0.1"/>
          <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>
          <circle cx="394" cy="${130 - 6 * 13}" r="4" fill="var(--accent)"/>
          <text x="30" y="147">13/11</text><text x="198" y="147">20/11</text><text x="366" y="147">26/11</text>
        </svg></div>
      <div class="panel chart"><h3>Theo người</h3>
        <div class="bars">${per.map((r) => `<div class="b"><span class="who">${av(r.n, "sm", false)}${r.n}</span><span class="track">${["d", "p", "k", "w"].map((k) => (r[k] ? `<i class="${k}" style="flex:${r[k]}"></i>` : "")).join("")}</span><span class="num muted">${r.d}/${r.total}</span></div>`).join("")}</div>
        <div class="keys"><span><i style="background:var(--ok)"></i>xong</span><span><i style="background:var(--accent)"></i>đang làm</span><span><i style="background:var(--clash)"></i>bị chặn</span><span><i style="background:var(--line-strong)"></i>cần làm</span></div>
      </div>
    </div>`;

  return `
  <div class="head">
    <div><h1>Việc</h1><p class="lead"><b>${done}/${all.length}</b> xong, ${blocked} bị chặn. Hạn project ${CHARTER.deadline}, ${CHARTER.left}.</p></div>
    <div class="tools">
      <div class="seg"><button class="${S.workView === "board" ? "on" : ""}" data-act="workView" data-arg="board">Bảng</button><button class="${S.workView === "progress" ? "on" : ""}" data-act="workView" data-arg="progress">Tiến độ</button></div>
      <button class="btn primary" data-act="toast" data-arg="Đã mở khung thêm việc">${ic("plus")}Thêm việc</button>
    </div>
  </div>
  ${S.workView === "board" ? board : progress}`;
}

// ---------- screen 4: Trao đổi ----------
function screenTalk() {
  const has = (t, tag) => t.timeline.some((e) => e.tag === tag);
  const threads = Object.entries(TASKS).filter(([, t]) => t.timeline.length && (S.talkFilter === "all" || has(t, S.talkFilter)));
  const cur = TASKS[S.talk] && threads.some(([id]) => id === S.talk) ? S.talk : threads[0]?.[0];
  const t = cur && TASKS[cur];
  const F = [["all", "Tất cả"], ["question", "Có câu hỏi"], ["clash", "Có đụng nhau"], ["decision", "Có quyết định"]];
  const list = threads.map(([id, x]) => {
    const last = x.timeline[x.timeline.length - 1];
    const people = [...new Set(x.timeline.map((e) => e.who).filter((w) => w !== "gtv"))];
    return `<button class="row ${id === cur ? "sel" : ""}" data-act="talk" data-arg="${id}">
      <span class="avs" style="grid-row:span 2;align-self:center">${people.map((w) => av(w, "sm", false)).join("")}</span>
      <span class="t">${esc(x.title)}</span><span class="when">${last.at}</span>
      <span class="s">${has(x, "question") ? `<span class="chip warn">${ic("ask")}câu hỏi</span>` : ""}${has(x, "clash") ? `<span class="chip clash">${ic("zap")}đụng nhau</span>` : ""}<span>${x.timeline.length} tin</span></span>
    </button>`;
  }).join("");

  const msgs = t ? t.timeline.map((e) => {
    const kind = e.tag === "question" ? "q" : e.tag === "clash" ? "sys" : "";
    const who = e.who === "gtv" ? "gtv" : `${e.who}`;
    return `<div class="msg ${kind}" ${pc(e.who)}>${av(e.who)}
      <div class="h"><b>${who}</b>${e.who !== "gtv" ? `<span>agent</span>` : ""}<span class="chip ${e.tag === "blocker" ? "clash" : e.tag === "done" ? "ok" : ""}">${TAGS[e.tag]}</span><span>${e.at}</span></div>
      <div class="bub">${esc(e.text)}${e.ref ? `<br><button class="link" data-act="openInbox" data-arg="${e.ref}">${e.tag === "question" ? "Trả lời" : "Xem vụ đụng nhau"} ${ic("right")}</button>` : ""}</div>
    </div>`;
  }).join("") : "";

  const sums = {
    "t-bio": "hien-test đã thêm kiểm tra bio và 10 ca thử đều đạt. Việc đang dừng vì hai lý do: hien cũng sửa createUser, và chưa biết viết theo chữ ký HttpException cũ hay mới. Cần hoc trả lời.",
    "t-valid": "hien đã gom kiểm tra tiêu đề, bình luận và ảnh về validation.ts. Còn một câu hỏi về hành vi khi ảnh sai URL, và đang đụng hien-test ở auth.service.ts.",
    "t-http": "hoc chốt chữ ký mới của HttpException và đã đổi xong model, main.ts. Còn ba service chưa đổi.",
    "t-article": "khanh dừng phần trùng với hien và chỉ giữ phần trả 404 khi bình luận không tồn tại.",
  };

  return `
  <div class="head">
    <div><h1>Trao đổi</h1><p class="lead">Agent ghi gì, hỏi gì, gtv báo gì, xếp theo từng việc.</p></div>
    <div class="tools"><div class="filters">${F.map(([k, l]) => `<button class="fchip ${S.talkFilter === k ? "on" : ""}" data-act="talkFilter" data-arg="${k}">${l}</button>`).join("")}</div></div>
  </div>
  <div class="talk">
    <section class="panel list">${list || `<div class="empty"><b>Không có trao đổi nào khớp bộ lọc</b></div>`}</section>
    ${t ? `<section class="panel chat">
      <div class="chead"><div><h2>${esc(t.title)}</h2><span class="muted">${BOARD_COLS.find((c) => c.key === colOf(cur)).label} · ${t.who}</span></div><button class="btn sm" style="margin-left:auto" data-act="openTask" data-arg="${cur}">Mở việc</button></div>
      ${sums[cur] ? `<div class="aibox sum"><b>${ic("ai")}Tóm tắt</b>${sums[cur]}</div>` : ""}
      <div class="stream"><div class="day">Hôm nay</div>${msgs}</div>
      <div class="composer"><select aria-label="Gửi tới">${Object.keys(PEOPLE).map((n) => `<option ${n === t.who ? "selected" : ""}>${n}</option>`).join("")}</select><input class="input" placeholder="Nhắn vào agent của người này" aria-label="Tin nhắn" /><button class="btn primary" data-act="toast" data-arg="Đã gửi. Agent sẽ đọc ở lượt kế tiếp">${ic("send")}Gửi</button></div>
    </section>` : ""}
  </div>`;
}

// ---------- screen 5: Tri thức ----------
function screenKnow() {
  const nav = [["charter", "Tiêu chí project", "target", ""], ["docs", "Tài liệu", "book", DOCS.length], ["review", "Chờ xác nhận", "ask", UNVERIFIED.filter((u) => !u.done).length]]; 
  const C = CHARTER;
  const pages = {
    charter: `<h2>Tiêu chí project</h2><p class="lede">Agent đọc phần này mỗi lần bắt đầu một việc, nên viết ngắn và cụ thể.</p>
      <div class="charter">
        <div class="f wide"><span class="sect">Mục tiêu</span><p>${C.goal}</p></div>
        <div class="f"><span class="sect">Người dùng</span><p>${C.users}</p></div>
        <div class="f"><span class="sect">Hạn</span><p>${C.deadline} · ${C.left}</p></div>
        <div class="f"><span class="sect">Mức hoàn thiện</span><p>${C.quality}</p></div>
        <div class="f"><span class="sect">Ngôn ngữ của nhóm</span><p>${C.language}</p></div>
        <div class="f wide"><span class="sect">Công nghệ</span><div class="scope">${C.stack.map((s) => `<span class="chip">${s}</span>`).join("")}</div></div>
        <div class="f wide"><span class="sect">Ràng buộc</span><p>${C.constraints}</p></div>
        <div class="f wide"><span class="sect">Không làm</span><p>${C.non_goals}</p></div>
      </div>
      <div class="acts"><button class="btn" data-act="toast" data-arg="Đã mở khung sửa tiêu chí">Sửa tiêu chí</button></div>`,
    docs: `<h2>Tài liệu</h2><p class="lede">Tài liệu cốt lõi được đưa cho AI trong mọi câu trả lời. Các tài liệu khác được tìm khi cần.</p>
      <div style="display:flex;gap:8px;max-width:900px;margin-bottom:14px"><input class="input" placeholder="Tìm trong tài liệu, ADR, hỏi đáp" aria-label="Tìm tài liệu" /><button class="btn primary" data-act="toast" data-arg="Đã mở khung thêm tài liệu">${ic("plus")}Thêm tài liệu</button></div>
      <div class="doclist">${DOCS.map((d) => `<button class="docrow" data-act="toast" data-arg="Mở tài liệu: ${esc(d.title)}"><span class="ic ${d.core ? "core" : ""}">${ic(d.core ? "star" : d.kind === "Hỏi đáp" ? "ask" : "file")}</span><b>${esc(d.title)}</b><small>${esc(d.src)}</small><span class="r">${d.core ? `<span class="chip accent">cốt lõi</span>` : ""}<span class="chip">${d.kind}</span></span></button>`).join("")}</div>`,
    review: `<h2>Chờ xác nhận</h2><p class="lede">Câu trả lời của AI và của agent đồng đội nằm ở đây cho tới khi có người xác nhận. Sau đó AI dùng chúng để trả lời lần sau.</p>
      <div class="doclist">${UNVERIFIED.filter((u) => !u.done).map((u) => `<div class="docrow"><span class="ic">${ic("ask")}</span><b>${esc(u.title)}</b><small>${esc(u.src)}</small><span class="r"><button class="btn sm primary" data-act="verify" data-arg="${u.id}">${ic("check")}Đúng, lưu lại</button><button class="btn sm" data-act="verify" data-arg="${u.id}">Sai, bỏ</button></span></div>`).join("") || `<div class="empty"><span class="ring">${ic("check")}</span><b>Không còn câu nào chờ xác nhận</b></div>`}</div>`,
  };
  return `
  <div class="head"><div><h1>Tri thức</h1><p class="lead">Những gì AI và các agent dựa vào khi làm việc trong project này.</p></div></div>
  <div class="know">
    <nav class="panel subnav">${nav.map(([k, l, i, n]) => `<button class="${S.know === k ? "on" : ""}" data-act="know" data-arg="${k}">${ic(i)}${l}${n !== "" ? `<span class="n ${k === "review" && n ? "warn" : ""}">${n}</span>` : ""}</button>`).join("")}</nav>
    <section class="panel doc">${pages[S.know]}</section>
  </div>`;
}

// ---------- Thiết lập ----------
function screenSettings() {
  const nav = [["members", "Thành viên", "users"], ["watch", "Mức giám sát", "shield"], ["repo", "Repo và đồng bộ", "branch"], ["share", "Link chia sẻ", "link"]];
  const modes = [["off", "Tắt"], ["shadow", "Chạy thử"], ["on", "Bật"]];
  const pages = {
    members: `<h2>Thành viên</h2><p class="lede">Mỗi thành viên cài gtv một lần trong bản clone của mình. Vai trò và trình độ giúp AI chọn cách trả lời và người để hỏi.</p>
      <div class="members">${Object.values(PEOPLE).map((p) => `<div class="member">${av(p.name)}<div><b>${p.name}</b><small>${p.role} · ${p.agentName}</small></div><div class="work"><small>đang làm</small>${esc(TASKS[p.task].title)}</div><span class="chip lvl">${p.level}</span>${state(p.name)}</div>`).join("")}</div>
      <div class="block" style="max-width:980px"><span class="sect">Mời thêm người</span>
        <div style="display:flex;gap:8px;margin-bottom:10px"><input class="input" style="max-width:240px" placeholder="Tên developer" aria-label="Tên developer" /><button class="btn primary" data-act="toast" data-arg="Đã tạo lệnh mời, có hiệu lực 24 giờ">Tạo lệnh mời</button></div>
        <div class="cmd"><span>npx guide-the-vibe join https://gtv.tenantry.site/j/k7Qm2xPd</span><button class="btn sm quiet" style="margin-left:auto" data-act="toast" data-arg="Đã chép lệnh">${ic("copy")}Chép</button></div></div>`,
    watch: `<h2>Mức giám sát</h2><p class="lede">Chọn gtv can thiệp tới đâu. “Chạy thử” nghĩa là gtv vẫn kiểm tra và ghi lại, nhưng không báo cho ai.</p>
      <div class="presets">
        <button class="preset" data-act="toast" data-arg="Đã chuyển sang Chỉ quan sát"><b>Chỉ quan sát</b><p>Ghi lại mọi thứ lên dashboard, không chen vào agent.</p></button>
        <button class="preset on"><b>${ic("check")}Cân bằng</b><p>Báo cho agent khi đụng nhau. Bắt hỏi lại ở mức cao.</p></button>
        <button class="preset" data-act="toast" data-arg="Đã chuyển sang Chặt"><b>Chặt</b><p>Chặn agent sửa file đang đụng nhau cho tới khi có người cho phép.</p></button>
      </div>
      <div class="block"><span class="sect">Tuỳ chỉnh từng phần</span>
      <div class="layers">${LAYERS.map((l, n) => `${l.g !== LAYERS[n - 1]?.g ? `<div class="gh" style="padding-left:0">${l.g}</div>` : ""}<div class="layer"><div title="${l.key}">${l.t}<small>${[l.s, l.n].filter(Boolean).join(" · ")}</small></div><div class="seg">${modes.map(([k, lab]) => `<button class="${l.mode === k ? "on" : ""}" data-act="layer" data-arg="${l.key}:${k}">${lab}</button>`).join("")}</div></div>`).join("")}</div></div>`,
    repo: `<h2>Repo và đồng bộ</h2><p class="lede">gtv kéo repo về mỗi 15 giây để so với phần đang làm dở của từng người.</p>
      <div class="formgrid">
        <label>Tên hiển thị<input class="input" value="Realworld API" /></label>
        <label>Nhánh chính<input class="input mono" value="master" /></label>
        <label class="wide">URL repo<input class="input mono" value="https://github.com/hienduc14/realworld-gtv-bench.git" /><small>Repo private: dán URL kèm token chỉ đọc. Token không bao giờ hiện lại.</small></label>
        <label class="wide">Đường dẫn quan trọng<textarea class="textarea mono">prisma/schema.prisma
package-lock.json</textarea><small>Hai người cùng chạm vào các đường dẫn này thì gtv báo mức nghiêm trọng.</small></label>
      </div>
      <div class="acts"><button class="btn primary" data-act="toast" data-arg="Đã lưu">Lưu thay đổi</button><button class="btn" data-act="toast" data-arg="Đã đồng bộ, master ở 30b68e1">Đồng bộ ngay</button><button class="btn quiet" style="color:var(--clash)">Lưu trữ project</button></div>`,
    share: `<h2>Link chia sẻ</h2><p class="lede">Link chỉ xem, không cần tài khoản. Dùng để gửi giảng viên hoặc người ngoài nhóm.</p>
      <div style="display:flex;gap:8px;max-width:620px"><input class="input" placeholder="Ghi chú, ví dụ: demo cho giảng viên" aria-label="Ghi chú" /><select class="input" style="max-width:130px" aria-label="Hết hạn sau"><option>30 ngày</option><option>7 ngày</option></select><button class="btn primary" data-act="toast" data-arg="Đã tạo link, có hiệu lực 30 ngày">Tạo link</button></div>
      <div class="empty"><b>Chưa có link nào</b>Tạo một link để người khác xem project mà không sửa được gì.</div>`,
  };
  return `
  <div class="head"><div><h1>Thiết lập</h1><p class="lead">Chỉ quản lý của project mới sửa được phần này.</p></div></div>
  <div class="know">
    <nav class="panel subnav">${nav.map(([k, l, i]) => `<button class="${S.set === k ? "on" : ""}" data-act="set" data-arg="${k}">${ic(i)}${l}</button>`).join("")}</nav>
    <section class="panel doc">${pages[S.set]}</section>
  </div>`;
}

// ---------- render and events ----------
const SCREENS = { now: screenNow, inbox: screenInbox, work: screenWork, talk: screenTalk, know: screenKnow, settings: screenSettings };

function render() {
  renderShell();
  $("#screen").innerHTML = SCREENS[S.route]();
  if (S.route === "now") drawWires();
  renderSheet();
}

function go(route) {
  S.route = SCREENS[route] ? route : "now";
  if (location.hash !== "#" + S.route) history.replaceState(null, "", "#" + S.route);
  render();
  window.scrollTo(0, 0);
}

const ACT = {
  go,
  theme() {
    const r = document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    r.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("gtv.proto.theme", r.dataset.theme); } catch {}
    render();
  },
  toast,
  mapOnly(v) { S.mapOnly = v === "1"; render(); },
  mapDetail(v) { S.mapDetail = v === "1"; render(); },
  selFile(p) { S.sheet = p; S.sheetMode = "split"; S.sheetFix = false; render(); },
  sheetFix(v) { S.sheetFix = v === "1"; renderSheet(); },
  closeSheet() { $("#sheet").close(); },
  sheetMode(m) { S.sheetMode = m; renderSheet(); },
  jump(i) { $(`#hk-${i}`)?.scrollIntoView({ block: "start", behavior: "smooth" }); },
  selWho(w) { S.sel = S.sel?.who === w ? null : { who: w }; render(); },
  clearSel() { S.sel = null; render(); },
  openInbox(id) { S.sheet = null; S.inbox = id; S.inboxWho = null; go("inbox"); },
  openFile(p) { ACT.selFile(p); },
  openTask(id) { S.task = id; S.workView = "board"; go("work"); },
  openTalk(id) { S.talk = id; S.talkFilter = "all"; go("talk"); },
  inbox(id) { S.inbox = id; render(); },
  inboxWho(w) { S.inboxWho = w || null; render(); },
  pick(arg) { const [id, n] = arg.split(":"); S.answers[id] = Number(n); render(); },
  answer(id) {
    const q = QUESTIONS.find((x) => x.id === id);
    const text = $(`#ans-${id}`)?.value.trim();
    const picked = S.answers[id];
    if (!text && picked == null) return toast("Chọn một phương án hoặc viết câu trả lời");
    q.status = "answered";
    q.answer = text || q.options[picked];
    if (TASKS[q.task].waits === id) TASKS[q.task].status = "in_progress";
    S.inbox = waiting()[0]?.id || openIncidents()[0]?.id || id;
    render();
    toast(`Đã gửi trả lời cho agent của ${q.from}`);
  },
  plan(arg) { const [id, n] = arg.split(":"); const i = INCIDENTS.find((x) => x.id === id); Object.assign(draftOf(i), { plan: +n, v: 0, text: plansOf(i)[+n].texts[0] }); render(); },
  rewrite(id) { const i = INCIDENTS.find((x) => x.id === id), d = draftOf(i), t = plansOf(i)[d.plan].texts; d.v = (d.v + 1) % t.length; d.text = t[d.v]; render(); },
  rcpt(arg) { const [id, w] = arg.split(":"); const d = draftOf(INCIDENTS.find((x) => x.id === id)); d.to[w] = !d.to[w]; render(); },
  sendFix(id) {
    const i = INCIDENTS.find((x) => x.id === id), d = draftOf(i);
    const to = [i.a, i.b].filter((w) => d.to[w]);
    if (!d.text.trim()) return toast("Viết nội dung trước khi gửi");
    i.status = "guided"; i.sent = { at: "22:06", text: d.text.trim(), to };
    i.log.push(`22:06  admin gửi hướng xử lý cho ${to.join(", ")}`);
    render(); toast(`Đã gửi cho agent của ${to.join(" và ")}`);
  },
  ackIncident(id) { const i = INCIDENTS.find((x) => x.id === id); i.status = "acked"; i.log.push("22:06  admin: để hai bên tự phối hợp"); render(); toast("Đã ghi nhận. gtv thôi nhắc hai agent ở chỗ này"); },
  dismissIncident(id) { const i = INCIDENTS.find((x) => x.id === id); i.status = "dismissed"; i.log.push("22:06  admin đóng vụ này: báo nhầm"); render(); toast("Đã đóng vụ này"); },
  reopenIncident(id) { const i = INCIDENTS.find((x) => x.id === id); i.status = "open"; delete i.sent; render(); },
  assign(arg) {
    const [id, who] = arg.split(":");
    const a = OTHER_ATTENTION.find((x) => x.id === id);
    a.done = true; TASKS[a.task].who = who;
    S.inbox = openIncidents()[0]?.id || waiting()[0]?.id || null;
    render(); toast(`Đã giao cho ${who}. Agent của ${who} sẽ thấy việc này`);
  },
  doneOther(id) { OTHER_ATTENTION.find((x) => x.id === id).done = true; S.inbox = null; render(); toast("Đã trả việc về Cần làm"); },
  workView(v) { S.workView = v; render(); },
  task(id) { S.task = S.task === id || !id ? null : id; render(); },
  talk(id) { S.talk = id; render(); },
  talkFilter(k) { S.talkFilter = k; render(); },
  know(k) { S.know = k; render(); },
  set(k) { S.set = k; render(); },
  verify(id) { UNVERIFIED.find((u) => u.id === id).done = true; render(); toast("Đã cập nhật Tri thức"); },
  layer(arg) { const [key, mode] = arg.split(":"); LAYERS.find((l) => l.key === key).mode = mode; render(); },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  if (el.tagName === "A") e.preventDefault();
  ACT[el.dataset.act]?.(el.dataset.arg);
});
// keep what is typed into a draft across re-renders
document.addEventListener("input", (e) => {
  const id = e.target.dataset?.draft;
  if (id) draftOf(INCIDENTS.find((i) => i.id === id)).text = e.target.value;
});
document.addEventListener("mouseover", (e) => {
  const a = e.target.closest("#map .agent"), f = e.target.closest("#map .file");
  if (a) light("who", a.dataset.who);
  else if (f) light("file", f.dataset.file);
});
document.addEventListener("mouseout", (e) => {
  if (e.target.closest("#map .agent, #map .file")) light();
});
// the dialog closes itself on Esc; a click on the dimmed backdrop closes it too
$("#sheet").addEventListener("close", () => { S.sheet = null; light(); $$(".file.sel").forEach((e) => e.classList.remove("sel")); });
$("#sheet").addEventListener("click", (e) => e.target.id === "sheet" && e.target.close());
addEventListener("resize", () => S.route === "now" && drawWires());
addEventListener("hashchange", () => go(location.hash.slice(1)));
document.fonts?.ready.then(() => S.route === "now" && drawWires());

go(location.hash.slice(1) || "now");
