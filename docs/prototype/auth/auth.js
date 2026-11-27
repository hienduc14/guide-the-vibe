// Prototype: accounts, sign-up, project invites, members, computers, server admin. Plain JS, no build step.
// Each screen is a function returning HTML; the hash picks the screen; the picker at the bottom right lists them all.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- icons (Lucide paths) ----------
const ICON = {
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  laptop: '<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 2-1.73Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
  pulse: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  kanban: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
  chat: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  ai: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  panelOpen: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
  panelClose: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ""}</svg>`;

// ---------- sample data (all names and numbers are examples) ----------
const SERVER = "gtv.tenantry.site";
const USERS = {
  hoc: { display: "Thái Học", ini: "TH", color: "amber" },
  bob: { display: "Bob Trần", ini: "BT", color: "violet" },
  khanh: { display: "Khánh", ini: "Kh", color: "teal" },
  hien: { display: "Hiền", ini: "Hi", color: "pink" },
  lan: { display: "Cô Lan", ini: "La", color: "sky" },
  minh: { display: "Minh", ini: "Mi", color: "green" },
};
const ACCESS = { manager: "Quản lý", developer: "Developer", viewer: "Người xem" };
const ACCESS_HINT = {
  developer: "Agent trên máy người đó làm việc trong project. Trả lời câu hỏi, tạo và sửa việc của mình, sửa tài liệu.",
  viewer: "Chỉ xem: hợp với giảng viên, người theo dõi. Agent của họ không làm việc trong project.",
};
const AGENT = { claude: { name: "Claude Code", logo: "../assets/claude.svg" }, codex: { name: "Codex", logo: "../assets/codex.svg" } };

const PROJECTS = [
  { id: "realworld-api", name: "Realworld API", tile: "R", color: "#476be0", repo: "hienduc14/realworld-gtv-bench", access: "manager", members: ["hoc", "bob", "khanh", "lan"], clash: 2, ask: 1, live: 2 },
  { id: "shop-btl", name: "Shop BTL", tile: "S", color: "#0f8a7e", repo: "thaihoc1310/shop-btl", access: "developer", members: ["hien", "hoc"], clash: 0, ask: 0, live: 0, tasks: 1 },
];

const S = {
  route: "login",
  menu: false,
  pnav: false,
  pw: {}, // password fields shown as text
  empty: false,
  wide: (() => { try { return localStorage.getItem("gtv.proto.rail") === "wide"; } catch { return false; } })(),
  modal: null, // new | invite | addName | connectGuide
  // Tạo project
  np: { name: "", id: "", idEdited: false, url: "", check: "idle", branch: "" },
  created: false,
  // Nhận lời mời / duyệt máy
  joined: false,
  connect: "ask", // ask | approved | denied
  // Máy của tôi
  devices: [
    {
      id: "d1", name: "thaihoc-laptop", os: "linux", ver: "0.2.0", online: true, seen: "vừa xong", since: "20/11",
      agents: [{ k: "claude", v: "2.4.1" }, { k: "codex", v: "0.99.0" }],
      repos: [
        { path: "~/code/realworld-api", project: "Realworld API", agents: ["claude", "codex"], live: "1 phiên Codex đang chạy" },
        { path: "~/code/shop-btl", project: "Shop BTL", agents: ["claude"], live: "" },
      ],
    },
    { id: "d2", name: "lab-pc", os: "win32", ver: "0.1.2", online: false, seen: "3 ngày trước", since: "02/11", agents: null, repos: [] },
  ],
  renaming: null,
  unplug: null,
  guide: false,
  // Thành viên
  members: [
    { u: "hoc", access: "manager", job: "Backend · Senior", machines: 2, seen: "đang làm", live: true },
    { u: "bob", access: "developer", job: "Backend · Middle", machines: 1, seen: "2 giờ trước" },
    { u: "khanh", access: "developer", job: "Frontend · Middle", machines: 1, seen: "đang làm", live: true },
    { u: "lan", access: "viewer", job: "Giảng viên hướng dẫn", machines: 0, seen: "hôm qua" },
  ],
  invites: [{ id: "i1", access: "developer", by: "hoc", used: 3, max: null, exp: "04/12" }],
  inv: { access: "developer", days: 7, max: null },
  made: null,
  rmMember: null,
  // Tài khoản
  sessions: [
    { id: "s1", ua: "Chrome · Windows", ip: "113.190.x.x", last: "đang dùng", cur: true },
    { id: "s2", ua: "Firefox · Ubuntu", ip: "14.232.x.x", last: "hôm qua" },
    { id: "s3", ua: "Safari · iPhone", ip: "27.72.x.x", last: "5 ngày trước" },
  ],
  // Quản trị
  q: "",
  resetFor: null,
  users: [
    { u: "hoc", admin: true, projects: 2, devices: 2, seen: "vừa xong" },
    { u: "bob", admin: false, projects: 1, devices: 1, seen: "2 giờ trước" },
    { u: "khanh", admin: false, projects: 2, devices: 1, seen: "vừa xong" },
    { u: "hien", admin: false, projects: 1, devices: 2, seen: "hôm qua" },
    { u: "lan", admin: false, projects: 1, devices: 0, seen: "hôm qua" },
    { u: "minh", admin: false, projects: 0, devices: 0, seen: "12 ngày trước", locked: true },
  ],
  registration: "open",
};

// ---------- small pieces ----------
function av(u, size = "") {
  const p = USERS[u];
  return `<span class="av ${size}" style="--p:var(--c-${p.color})" title="${esc(p.display)} (${u})">${p.ini}</span>`;
}
const tile = (p, size = "") => `<span class="tile ${size}" style="background:${p.color}">${p.tile}</span>`;
const chipAccess = (a) => `<span class="chip ${a === "manager" ? "accent" : ""}">${ACCESS[a]}</span>`;
const logo = (k) => `<img src="${AGENT[k].logo}" alt="${AGENT[k].name}" title="${AGENT[k].name}">`;
const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
const themeBtn = () => `<button class="iconbtn" data-act="theme" title="Đổi nền sáng tối" aria-label="Đổi nền sáng tối">${ic(isDark() ? "sun" : "moon")}</button>`;
function pwField(id, label, opts = {}) {
  const shown = S.pw[id];
  return `<label class="field"><span>${label}</span><div class="pw"><input class="input" id="${id}" type="${shown ? "text" : "password"}" autocomplete="${opts.ac || "current-password"}" ${opts.value ? `value="${opts.value}"` : ""} required minlength="8" />
    <button type="button" data-act="pw" data-arg="${id}" aria-label="${shown ? "Ẩn mật khẩu" : "Hiện mật khẩu"}">${ic(shown ? "eyeoff" : "eye")}</button></div>${opts.hint ? `<small>${opts.hint}</small>` : ""}</label>`;
}
function cmd(text, prompt = true) {
  return `<div class="cmd">${prompt ? '<span class="p">$</span>' : ""}<span>${esc(text)}</span><button class="btn sm quiet" type="button" data-act="toast" data-arg="Đã chép">${ic("copy")}Chép</button></div>`;
}
function toast(text) {
  $$(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.innerHTML = ic("check") + esc(text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- the gate (guests) ----------
function gate(main) {
  return `<div class="gate">
    <aside class="gate-side">
      <div class="brand"><img src="../assets/gtv-logo.png" alt="" />Guide the Vibe</div>
      <div class="pitch">
        <h2>Agent của cả nhóm biết nhau đang sửa gì.</h2>
        <p>gtv đứng giữa Claude Code và Codex của mọi người trong project: báo đụng nhau trước khi thành conflict, và để agent hỏi đồng đội thay bạn.</p>
      </div>
      <figure class="peek">
        <figcaption><span class="dot"></span>gtv → agent của hoc · 22:06</figcaption>
        <p><b>bob</b> đang đổi chữ ký <code>refund(orderId, reason)</code> trong <code>src/orders/service.ts</code>. File bạn sắp sửa có gọi hàm này.</p>
        <div class="acts"><span class="chip clash">đụng nhau · mức cao</span><span class="chip">hỏi bob trước khi sửa?</span></div>
      </figure>
      <span class="foot">${SERVER} · gtv 0.2.0</span>
    </aside>
    <main class="gate-main">${main}</main>
  </div>`;
}

function screenLogin() {
  return gate(`<form class="formcard" data-submit="login">
    <div><h1>Đăng nhập</h1><p class="sub">Vào gtv bằng tên đăng nhập của bạn.</p></div>
    ${S.next === "join" ? `<div class="note accent">${ic("link")}<span>Đăng nhập xong bạn quay lại lời mời vào <b>Chatbot KLTN</b>.</span></div>` : ""}
    <label class="field"><span>Tên đăng nhập</span><input class="input" id="li-name" autocomplete="username" value="hoc" required /></label>
    ${pwField("li-pw", "Mật khẩu", { value: "••••••••••" })}
    <button class="btn primary block">Đăng nhập</button>
    <p class="swap">Chưa có tài khoản? <a href="#signup">Tạo tài khoản</a></p>
    <p class="swap faint">Quên mật khẩu? Nhờ quản trị server tạo link đặt lại cho bạn.</p>
  </form>`);
}

const RESERVED = ["admin", "root", "gtv", "system", "everyone", "all", "share", "me", "api"];
function nameCheck(v) {
  if (!v) return ["", "Chữ thường, số và . _ - (3–32 ký tự). Tên này hiện trong mọi việc của bạn và không đổi được."];
  if (!/^[a-z0-9._-]+$/.test(v)) return ["err", "Chỉ dùng chữ thường không dấu, số và . _ -"];
  if (v.length < 3) return ["err", "Ít nhất 3 ký tự"];
  if (RESERVED.includes(v)) return ["err", "Tên này dành cho hệ thống, chọn tên khác"];
  if (USERS[v]) return ["err", `Đã có người dùng tên ${v}`];
  return ["ok", "Dùng được. Tên này không đổi được sau khi tạo."];
}

function screenSignup(invite = false) {
  const [cls, msg] = nameCheck(S.suName || "");
  return gate(`<form class="formcard" data-submit="${invite ? "signupJoin" : "signup"}">
    <div><h1>Tạo tài khoản</h1><p class="sub">Một tài khoản cho bạn: đăng nhập dashboard, và là danh tính của agent trên các máy của bạn.</p></div>
    ${invite ? `<div class="note accent">${av("khanh", "sm")}<span><b>khanh</b> mời bạn vào <b>Chatbot KLTN</b> với quyền <b>Developer</b>. Tạo tài khoản xong là bạn ở trong project.</span></div>` : ""}
    <label class="field"><span>Tên hiển thị</span><input class="input" id="su-display" autocomplete="name" placeholder="Nguyễn Minh" required /><small>Tên mọi người thấy. Đổi lúc nào cũng được.</small></label>
    <label class="field"><span>Tên đăng nhập</span><input class="input mono" id="su-name" autocomplete="username" placeholder="minh" value="${esc(S.suName || "")}" required spellcheck="false" autocapitalize="off" /><small class="${cls}" id="su-name-msg">${msg}</small></label>
    ${pwField("su-pw", "Mật khẩu", { ac: "new-password", hint: "Ít nhất 8 ký tự." })}
    ${pwField("su-pw2", "Nhập lại mật khẩu", { ac: "new-password" })}
    <button class="btn primary block">${invite ? "Tạo tài khoản và tham gia" : "Tạo tài khoản"}</button>
    <p class="swap">Đã có tài khoản? <a href="#login">Đăng nhập</a></p>
  </form>`);
}

function screenSetup() {
  return gate(`<form class="formcard" data-submit="setup">
    <div><h1>Tạo tài khoản quản trị</h1><p class="sub">Server này chưa có ai. Tài khoản đầu tiên quản lý server: cấu hình AI, các tài khoản và ai được đăng ký.</p></div>
    <label class="field"><span>Tên hiển thị</span><input class="input" value="Thái Học" required /></label>
    <label class="field"><span>Tên đăng nhập</span><input class="input mono" value="hoc" required /></label>
    ${pwField("st-pw", "Mật khẩu", { ac: "new-password", hint: "Ít nhất 8 ký tự." })}
    ${pwField("st-token", "Mã quản trị của server", { ac: "off", hint: "Giá trị <span class=mono>GTV_ADMIN_TOKEN</span> trong <span class=mono>docker/.env</span> của server. Chỉ hỏi lần này, để người lạ không giành quyền quản trị trước bạn." })}
    <button class="btn primary block">Tạo và đăng nhập</button>
  </form>`);
}

function screenReset() {
  return gate(`<form class="formcard" data-submit="reset">
    <div><h1>Đặt mật khẩu mới</h1><p class="sub">Cho tài khoản <b class="mono">bob</b>. Link này dùng một lần.</p></div>
    ${pwField("rs-pw", "Mật khẩu mới", { ac: "new-password", hint: "Ít nhất 8 ký tự." })}
    ${pwField("rs-pw2", "Nhập lại", { ac: "new-password" })}
    <div class="note">${ic("info")}<span>Các trình duyệt đang đăng nhập sẽ bị đăng xuất. Máy đã kết nối vẫn chạy, không phải <span class="mono">gtv login</span> lại.</span></div>
    <button class="btn primary block">Lưu và đăng nhập</button>
  </form>`);
}

const INVITE = { from: "khanh", project: { name: "Chatbot KLTN", tile: "C", color: "#b2477d" }, access: "developer", exp: "04/12/2026" };
function inviteCard(actions) {
  return `<div class="invite">
    <div class="from">${av(INVITE.from)}<span><b>${USERS[INVITE.from].display}</b> mời bạn vào</span></div>
    <div class="proj">${tile(INVITE.project)}<div><b>${INVITE.project.name}</b><span class="muted">project trên ${SERVER}</span></div></div>
    <dl><dt>Quyền</dt><dd>${chipAccess(INVITE.access)}</dd><dt>Được làm</dt><dd>${ACCESS_HINT[INVITE.access]}</dd><dt>Hết hạn</dt><dd>${INVITE.exp}</dd></dl>
    ${actions}
  </div>`;
}

function screenJoinGuest() {
  return gate(`<div class="formcard">
    ${inviteCard(`<div class="stack" style="gap:10px">
      <a class="btn primary block" href="#signup-invite">Tạo tài khoản để tham gia</a>
      <button class="btn block" data-act="loginThenJoin">Tôi đã có tài khoản · Đăng nhập</button>
    </div>`)}
    <p class="swap faint">Bạn chưa đăng nhập, nên trang này chỉ hiện tên project và người mời.</p>
  </div>`);
}

function screenJoinBad() {
  return gate(`<div class="formcard">
    <div class="big-bad">${ic("x")}</div>
    <div><h1>Link mời này không dùng được nữa</h1><p class="sub">Link có thể đã hết hạn, đã đủ số người dùng, hoặc người quản lý project đã thu hồi.</p></div>
    <div class="note">${ic("info")}<span>Nhờ người mời gửi link mới. Nếu bạn đã ở trong project, cứ <a href="#login">đăng nhập</a>.</span></div>
  </div>`);
}

// ---------- the app shell (logged in) ----------
const RAIL_ACTIVE = { home: "home", "home-empty": "home", new: "home", "admin-users": "admin", "admin-server": "admin" };
function rail() {
  const on = RAIL_ACTIVE[S.route];
  const item = (href, icon, label, active, extra = "") => `<a class="ri ${active ? "on" : ""}" href="${href}" title="${label}" ${extra}>${icon}<span class="lbl">${label}</span></a>`;
  return `<nav class="rail" aria-label="Ứng dụng">
    <div class="rail-brand"><img class="logo" src="../assets/gtv-logo.png" alt="Guide the Vibe" /><span class="lbl">Guide the Vibe</span></div>
    ${item("#home", ic("grid"), "Project của tôi", on === "home")}
    <hr />
    <span class="rail-sect lbl">Project</span>
    ${(S.empty ? [] : PROJECTS)
      .map((p) => {
        const active = S.route === "members" && p.id === "realworld-api";
        const n = p.clash + p.ask;
        return item(p.id === "realworld-api" ? "#members" : "#home", `<span class="proj ${active ? "on" : ""}">${p.tile}${n ? `<span class="badge">${n}</span>` : ""}</span>`, p.name, active);
      })
      .join("")}
    <button class="ri" data-act="modal" data-arg="new" title="Tạo project"><span class="proj add">${ic("plus")}</span><span class="lbl">Tạo project</span></button>
    <span class="grow"></span>
    ${item("#admin-users", ic("shield"), "Quản trị server", on === "admin")}
    <button class="ri me-row" data-act="menu" title="Thái Học (hoc)" aria-haspopup="menu" aria-expanded="${S.menu}"><span class="me">TH</span><span class="lbl">Thái Học<small>hoc</small></span></button>
    <button class="ri" data-act="rail" title="${S.wide ? "Thu gọn thanh bên" : "Mở rộng thanh bên"}" aria-label="${S.wide ? "Thu gọn thanh bên" : "Mở rộng thanh bên"}">${ic(S.wide ? "panelClose" : "panelOpen")}<span class="lbl">Thu gọn</span></button>
  </nav>`;
}
function menu() {
  if (!S.menu) return "";
  return `<div class="menu" role="menu">
    <div class="who"><b>Thái Học</b><small>hoc · quản trị server</small></div>
    <button role="menuitem" data-act="nav" data-arg="account">${ic("user")}Tài khoản</button>
    <button role="menuitem" data-act="nav" data-arg="devices">${ic("laptop")}Máy của tôi</button>
    <button role="menuitem" data-act="theme">${ic(isDark() ? "sun" : "moon")}${isDark() ? "Nền sáng" : "Nền tối"}</button>
    <button role="menuitem" data-act="nav" data-arg="login">${ic("logout")}Đăng xuất</button>
  </div>`;
}
function shell(top, body) {
  return `<div class="app ${S.wide ? "wide" : ""}">${rail()}<div class="main"><header class="top">${top}</header><main class="screen">${body}</main></div></div>${menu()}${modal()}`;
}
function simpleTop(title, icon, tabs) {
  return `<div class="top-row" style="padding-bottom:${tabs ? 0 : 12}px"><div class="top-title">${ic(icon)}${title}</div><div class="top-tools">${themeBtn()}<button class="iconbtn top-me" data-act="menu" aria-label="Tài khoản">${ic("user")}</button></div></div>
    ${tabs ? `<div class="tabs" role="tablist">${tabs.map(([r, l, i]) => `<a class="tab ${S.route === r ? "on" : ""}" href="#${r}" role="tab">${ic(i)}${l}</a>`).join("")}</div>` : ""}`;
}

// ---------- Project của tôi ----------
function pcard(p) {
  const wait = [
    p.clash ? `<span class="chip clash">${p.clash} vụ đụng nhau</span>` : "",
    p.ask ? `<span class="chip warn">${p.ask} câu hỏi chờ bạn</span>` : "",
    p.tasks ? `<span class="chip">${p.tasks} việc của bạn đang làm</span>` : "",
  ].join("");
  return `<a class="panel pcard" href="${p.id === "realworld-api" ? "../index.html#now" : "#home"}">
    <div class="t">${tile(p, "sm")}<div><b>${p.name}</b><small>${p.repo}</small></div>${chipAccess(p.access)}</div>
    <div class="w">${wait || `<span class="chip ok">${ic("check")}Không có gì chờ bạn</span>`}</div>
    <div class="f"><span class="avs">${p.members.map((u) => av(u, "sm")).join("")}</span><span>${p.members.length} thành viên${p.live ? ` · <span class="state running">${p.live} agent đang chạy</span>` : ""}</span></div>
  </a>`;
}
function screenHome() {
  if (S.empty) return screenHomeEmpty();
  const waiting = PROJECTS.reduce((n, p) => n + p.clash + p.ask, 0);
  return shell(
    simpleTop("Project của tôi", "grid"),
    `<div class="page">
      <div class="head"><div><h1>Chào Học</h1><p class="lead">${PROJECTS.length} project · <b>${waiting} thứ đang chờ bạn</b></p></div>
        <div class="tools"><button class="btn primary" data-act="modal" data-arg="new">${ic("plus")}Tạo project</button></div></div>
      <div class="pgrid">${PROJECTS.map(pcard).join("")}</div>
      <div class="strip"><span class="dv">${ic("laptop")}<b>Máy của bạn</b></span>
        <span class="dv"><span class="mono">thaihoc-laptop</span><span class="state running">đang kết nối</span></span>
        <span class="dv"><span class="mono">lab-pc</span><span class="state">thấy 3 ngày trước</span></span>
        <a href="#devices" class="more">Máy của tôi →</a></div>
    </div>`,
  );
}
function screenHomeEmpty() {
  return shell(
    simpleTop("Project của tôi", "grid"),
    `<div class="page">
      <div class="head"><div><h1>Chào Minh</h1><p class="lead">Bạn chưa ở project nào. Bắt đầu bằng một trong hai cách.</p></div></div>
      <div class="choices">
        <div class="panel choice"><span class="ic">${ic("plus")}</span><h2>Tạo project cho nhóm</h2><p>Có sẵn repo trên GitHub? Tạo project, bạn là Quản lý, rồi gửi link mời cho cả nhóm.</p><div><button class="btn primary" data-act="modal" data-arg="new">Tạo project</button></div></div>
        <div class="panel choice"><span class="ic">${ic("link")}</span><h2>Vào project của nhóm</h2><p>Bấm vào link mời bạn nhận được, như mọi link khác: nó mở trang tham gia. Chưa có link thì nhờ người quản lý project thêm bạn theo tên <b class="mono">minh</b>.</p></div>
      </div>
    </div>`,
  );
}

// ---------- Tạo project ----------
const slug = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
function checkLine() {
  const c = S.np.check;
  if (c === "wait") return `<div class="check-line wait"><span class="spin"></span>Đang đọc repo…</div>`;
  if (c === "ok") return `<div class="check-line ok">${ic("check")}Đọc được · nhánh mặc định <b class="mono">${S.np.branch}</b> · 3 nhánh</div>`;
  if (c === "bad") return `<div class="check-line err">${ic("x")}gtv chỉ nhận repo qua <span class="mono">https://</span> hoặc <span class="mono">git@host:owner/repo</span>, không nhận đường dẫn trên máy hay localhost.</div>`;
  if (c === "private") return `<div class="check-line err">${ic("lock")}Không đọc được repo này. Repo riêng tư thì dán URL có token chỉ đọc: <span class="mono">https://&lt;token&gt;@github.com/owner/repo.git</span></div>`;
  return `<small>Bấm Kiểm tra trước khi tạo. Server cần đọc được repo để so phần việc của mọi người.</small>`;
}
function modalNew() {
  const n = S.np;
  return {
    title: "Tạo project",
    sub: "Một project = một repo và nhóm người cùng làm trên nó. Bạn sẽ là Quản lý.",
    body: `<form id="np-form" data-submit="createProject"><div class="formgrid">
        <label>Tên project<input class="input" id="np-name" value="${esc(n.name)}" placeholder="Realworld API" required /></label>
        <label>Mã project<input class="input mono" id="np-id" value="${esc(n.id)}" placeholder="realworld-api" required /><small>${SERVER}/p/${esc(n.id || "…")} · không đổi được</small></label>
        <label class="wide"><span>URL repo</span>
          <div class="repo-check"><input class="input mono" id="np-url" value="${esc(n.url)}" placeholder="https://github.com/owner/repo.git" required spellcheck="false" /><button type="button" class="btn" data-act="checkRepo">Kiểm tra</button></div>
          ${checkLine()}</label>
        <label>Nhánh chính<input class="input mono" id="np-branch" value="${esc(n.branch)}" placeholder="main" /></label>
        <label><span>Mô tả <span class="faint">(không bắt buộc)</span></span><input class="input" placeholder="API cho môn INT3507" /></label>
      </div></form>
      <p class="m-note">Sau khi tạo: gửi link mời cho nhóm ở Thiết lập › Thành viên, rồi mỗi người chạy <span class="mono">gtv on</span> trong bản clone của repo.</p>`,
    foot: `<button class="btn quiet" data-act="closeModal">Huỷ</button><button class="btn primary" form="np-form" ${n.check === "ok" ? "" : "disabled"}>Tạo project</button>`,
  };
}

// ---------- Nhận lời mời (đã đăng nhập) ----------
function screenJoin() {
  if (S.joined)
    return shell(
      simpleTop("Lời mời", "link"),
      `<div class="page narrow"><div class="invite">
        <div class="big-ok">${ic("check")}</div>
        <div><h1 style="font-size:22px">Bạn đã vào ${INVITE.project.name}</h1><p class="muted">Quyền Developer. khanh và mọi người trong project đã thấy bạn.</p></div>
        <div class="note accent">${ic("laptop")}<span>Máy <b>thaihoc-laptop</b> của bạn đã kết nối. Mở terminal trong bản clone của repo <span class="mono">khanh/chatbot-kltn</span> và chạy:</span></div>
        ${cmd("gtv on")}
        <p class="muted" style="font-size:13px">Máy khác chưa kết nối? <a href="#devices">Xem cách kết nối máy</a>.</p>
        <div class="hrow"><a class="btn primary" href="#home">Mở project</a></div>
      </div></div>`,
    );
  return shell(
    simpleTop("Lời mời", "link"),
    `<div class="page narrow">${inviteCard(`<div class="hrow"><button class="btn primary" data-act="join">Tham gia ${INVITE.project.name}</button><a class="btn quiet" href="#home">Không, cảm ơn</a></div>`)}</div>`,
  );
}

// ---------- Duyệt máy (gtv login) ----------
function screenConnect() {
  const head = simpleTop("Kết nối máy", "laptop");
  if (S.connect === "approved")
    return shell(head, `<div class="page narrow"><div class="invite">
      <div class="big-ok">${ic("check")}</div>
      <div><h1 style="font-size:22px">Đã kết nối lab-pc-2</h1><p class="muted">Quay lại terminal: gtv đã nhận khoá của máy, bước tiếp là <span class="mono">gtv on</span> trong repo.</p></div>
      ${cmd("gtv on")}
      <div class="hrow"><a class="btn" href="#devices">Máy của tôi</a></div></div></div>`);
  if (S.connect === "denied")
    return shell(head, `<div class="page narrow"><div class="invite">
      <div class="big-bad">${ic("x")}</div><div><h1 style="font-size:22px">Đã từ chối</h1><p class="muted">Máy đó không vào được tài khoản của bạn. Nếu bạn không chạy <span class="mono">gtv login</span>, có người đang thử: đổi mật khẩu ở trang Tài khoản cho chắc.</p></div>
      <div class="hrow"><a class="btn" href="#account">Tài khoản</a></div></div></div>`);
  return shell(head, `<div class="page narrow"><div class="invite">
    <div class="hrow" style="gap:14px"><span class="dev-h" style="padding:0"><span class="ic">${ic("monitor")}</span></span><div><b style="font-size:17px">lab-pc-2</b><div class="muted">Windows · gtv 0.2.0 · yêu cầu lúc 09:41, vừa xong</div></div></div>
    <p>Máy này muốn kết nối vào tài khoản <b>hoc</b>. Sau khi cho phép, agent trên máy đó làm việc thay bạn ở mọi project bạn là Developer hoặc Quản lý.</p>
    <dl><dt>Mã</dt><dd><span class="mono" style="font-size:20px;letter-spacing:0.08em">KQ7M-2XPD</span><br><small class="muted">So với mã đang hiện trong terminal.</small></dd></dl>
    <div class="note warn">${ic("alert")}<span>Chỉ cho phép nếu chính bạn vừa chạy <span class="mono">gtv login</span> trên máy đó.</span></div>
    <div class="hrow"><button class="btn primary" data-act="connect" data-arg="approved">Cho phép</button><button class="btn" data-act="connect" data-arg="denied">Từ chối</button></div>
  </div></div>`);
}

// ---------- Tài khoản ----------
const ACCOUNT_TABS = [["account", "Hồ sơ và bảo mật", "user"], ["devices", "Máy của tôi", "laptop"]];
function screenAccount() {
  return shell(
    simpleTop("Tài khoản của tôi", "user", ACCOUNT_TABS),
    `<div class="page narrow stack">
      <form class="panel pad" data-submit="saveProfile"><h2>Hồ sơ</h2><p class="lede">Tên hiển thị là thứ mọi người thấy. Tên đăng nhập gắn với mọi việc bạn đã làm nên không đổi được.</p>
        <div class="hrow" style="align-items:flex-start;gap:18px">${av("hoc", "lg")}
          <div class="formgrid grow">
            <label>Tên hiển thị<input class="input" value="Thái Học" /></label>
            <label>Tên đăng nhập<input class="input mono" value="hoc" readonly /><small>Quản trị server · tạo ngày 27/11/2026</small></label>
          </div></div>
        <div class="acts"><button class="btn primary">Lưu</button></div></form>

      <form class="panel pad" data-submit="changePw"><h2>Mật khẩu</h2><p class="lede">Đổi mật khẩu sẽ đăng xuất các trình duyệt khác. Máy đã kết nối vẫn chạy.</p>
        <div class="formgrid">${pwField("ac-cur", "Mật khẩu hiện tại")}<span></span>${pwField("ac-new", "Mật khẩu mới", { ac: "new-password", hint: "Ít nhất 8 ký tự." })}${pwField("ac-new2", "Nhập lại", { ac: "new-password" })}</div>
        <div class="acts"><button class="btn primary">Đổi mật khẩu</button></div></form>

      <div class="panel pad"><div class="hrow"><div class="grow"><h2>Phiên đăng nhập</h2><p class="lede" style="margin-bottom:8px">Các trình duyệt đang đăng nhập bằng tài khoản này.</p></div>
        ${S.sessions.length > 1 ? `<button class="btn" data-act="logoutOthers">Đăng xuất mọi nơi khác</button>` : ""}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Trình duyệt</th><th>Địa chỉ</th><th>Lần dùng cuối</th><th></th></tr></thead><tbody>
        ${S.sessions.map((s) => `<tr><td>${s.ua}</td><td class="mono">${s.ip}</td><td>${s.cur ? `<span class="chip ok">phiên này</span>` : s.last}</td><td style="text-align:right">${s.cur ? "" : `<button class="btn sm" data-act="dropSession" data-arg="${s.id}">Đăng xuất</button>`}</td></tr>`).join("")}
        </tbody></table></div></div>

      <div class="panel pad"><h2>Xoá tài khoản</h2><p class="lede">Xoá phiên, máy và tư cách thành viên của bạn. Việc đã làm vẫn giữ tên <span class="mono">hoc</span>, và tên này không cấp lại cho ai.</p>
        <div class="note warn">${ic("alert")}<span>Bạn đang là <b>Quản lý duy nhất</b> của <b>Realworld API</b>. Nâng một thành viên khác lên Quản lý, hoặc lưu trữ project, rồi mới xoá được tài khoản.</span></div>
        <div class="acts"><button class="btn danger" disabled>Xoá tài khoản</button></div></div>
    </div>`,
  );
}

// ---------- Máy của tôi ----------
function devCard(d) {
  const head = `<div class="dev-h"><span class="ic">${ic(d.os === "win32" ? "monitor" : "laptop")}</span>
    ${S.renaming === d.id
      ? `<form class="rename" data-submit="rename" data-arg="${d.id}"><input class="input mono" id="rn-${d.id}" value="${esc(d.name)}" aria-label="Tên máy" /><button class="btn sm primary">Lưu</button><button type="button" class="btn sm quiet" data-act="renaming">Huỷ</button></form>`
      : `<div><b>${esc(d.name)}</b><small>${d.os === "win32" ? "Windows" : d.os === "darwin" ? "macOS" : "Linux"} · gtv ${d.ver} · kết nối từ ${d.since}</small></div>`}
    <div class="acts"><span class="state ${d.online ? "running" : ""}">${d.online ? "đang kết nối" : `thấy ${d.seen}`}</span>
      <button class="btn sm quiet" data-act="renaming" data-arg="${d.id}">${ic("pencil")}Đổi tên</button>
      <button class="btn sm danger" data-act="unplug" data-arg="${d.id}">Ngắt</button></div></div>`;
  const confirm = S.unplug === d.id
    ? `<div class="confirm">${ic("alert")}<span class="grow">Ngắt <b>${esc(d.name)}</b>? Khoá của máy bị thu hồi ngay. Agent trên máy đó thôi báo cho gtv tới khi bạn chạy lại <span class="mono">gtv login</span>.</span><button class="btn sm danger" data-act="doUnplug" data-arg="${d.id}">Ngắt máy</button><button class="btn sm quiet" data-act="unplug">Huỷ</button></div>`
    : "";
  const body = d.agents
    ? `<div class="dev-b">
        <div class="agentlist"><span class="sect" style="margin-right:4px">Agent trên máy</span>${d.agents.map((a) => `<span class="agentchip">${logo(a.k)}${AGENT[a.k].name}<span class="v">${a.v}</span></span>`).join("")}</div>
        ${d.repos.length
          ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Repo đã bật</th><th>Project</th><th>Agent</th><th>Bây giờ</th></tr></thead><tbody>
            ${d.repos.map((r) => `<tr><td class="mono">${r.path}</td><td>${r.project}</td><td><span class="logos">${r.agents.map(logo).join("")}</span></td><td>${r.live ? `<span class="state running">${r.live}</span>` : `<span class="faint">không có phiên</span>`}</td></tr>`).join("")}
            </tbody></table></div>`
          : `<p class="muted">Chưa bật repo nào. Chạy <span class="mono">gtv on</span> trong bản clone của một project.</p>`}
      </div>`
    : `<div class="dev-b"><div class="note">${ic("info")}<span>Máy này chạy gtv ${d.ver}, bản chưa gửi danh sách agent và repo. Cập nhật trên máy đó: <span class="mono">npx guide-the-vibe@latest</span></span></div></div>`;
  return `<div class="panel dev">${head}${confirm}${body}</div>`;
}
function screenDevices() {
  return shell(
    simpleTop("Tài khoản của tôi", "user", ACCOUNT_TABS),
    `<div class="page stack">
      <div class="head" style="margin:0"><div><h1>Máy của tôi</h1><p class="lead">Mỗi máy có một khoá riêng, dùng được ở mọi project bạn tham gia. Vào project mới không cần kết nối lại.</p></div>
        <div class="tools"><button class="btn primary" data-act="modal" data-arg="connectGuide">${ic("plus")}Kết nối máy mới</button></div></div>
      ${S.devices.length ? S.devices.map(devCard).join("") : `<div class="panel empty"><b>Chưa có máy nào</b>Bấm Kết nối máy mới để bắt đầu.</div>`}
      <p class="muted" style="font-size:13px">Thành viên trong project chỉ thấy tên máy của bạn, không thấy đường dẫn trên máy.</p>
    </div>`,
  );
}

// ---------- Thiết lập › Thành viên ----------
const PROJECT_TABS = [["Hiện trường", "pulse"], ["Cần xử lý", "inbox"], ["Việc", "kanban"], ["Trao đổi", "chat"], ["Tri thức", "book"]];
function projectTop() {
  return `<div class="top-row"><span class="pname">${tile(PROJECTS[0], "sm")}<b>Realworld API</b></span>
      <div class="repo"><span class="mono">${ic("branch")}master · 30b68e1</span><span>bạn là Quản lý</span></div>
      <div class="top-tools">${themeBtn()}<button class="iconbtn top-me" data-act="menu" aria-label="Tài khoản">${ic("user")}</button></div></div>
    <div class="tabs" role="tablist">${PROJECT_TABS.map(([l, i]) => `<a class="tab" href="../index.html" role="tab">${ic(i)}${l}</a>`).join("")}<span class="gap"></span><span class="tab on">${ic("sliders")}Thiết lập</span></div>`;
}
const managers = () => S.members.filter((m) => m.access === "manager");
function memberRow(m) {
  const u = USERS[m.u];
  const lastMgr = m.access === "manager" && managers().length === 1;
  const me = m.u === "hoc";
  const sel = `<select class="input" data-act-change="access" data-arg="${m.u}" aria-label="Quyền của ${u.display}" ${lastMgr ? 'disabled title="Project cần ít nhất một Quản lý"' : ""}>
    ${Object.entries(ACCESS).map(([k, l]) => `<option value="${k}" ${m.access === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const confirm = S.rmMember === m.u
    ? `<div class="confirm" style="grid-column:1/-1;border-radius:10px;border:0">${ic("alert")}<span class="grow">Xoá <b>${u.display}</b> khỏi project? Máy của họ thôi làm việc ở đây ngay. Việc đã làm vẫn giữ tên ${m.u}.</span><button class="btn sm danger" data-act="doRemove" data-arg="${m.u}">Xoá khỏi project</button><button class="btn sm quiet" data-act="rmMember">Huỷ</button></div>`
    : "";
  return `<div class="mrow">${av(m.u)}<div><b>${u.display} ${me ? '<span class="you">(bạn)</span>' : ""}</b><small><span class="mono">${m.u}</span> · ${m.job}</small></div>
    <div>${sel}${lastMgr ? `<small class="faint" style="margin-top:3px">Quản lý duy nhất</small>` : ""}</div>
    <div class="seen">${m.machines ? `${m.machines} máy · ` : "chưa kết nối máy · "}${m.live ? `<span class="state running">đang làm</span>` : m.seen}</div>
    <div class="rm">${me || lastMgr ? "" : `<button class="btn sm quiet" data-act="rmMember" data-arg="${m.u}" aria-label="Xoá ${u.display}">${ic("trash")}</button>`}</div>${confirm}</div>`;
}
function modalInvite() {
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" class="${String(S.inv[key]) === String(v) ? "on" : ""}" data-act="inv" data-arg="${key}:${v}">${l}</button>`).join("")}</div>`;
  if (S.made)
    return {
      title: "Đã tạo link mời",
      sub: `${ACCESS[S.made.access]} · hết hạn ${S.made.exp}${S.made.max ? ` · ${S.made.max} người` : ""}. Ai có link đều vào được, nên chỉ gửi cho người trong nhóm.`,
      body: `<div class="stack">${cmd(`https://${SERVER}/join/Xk3pQ9vLm2aT`, false)}
        <label class="field"><span>Tin nhắn gửi kèm</span><textarea class="textarea" id="inv-msg">Mời bạn vào project Realworld API trên gtv (quyền ${ACCESS[S.made.access]}). Mở link, đăng nhập hoặc tạo tài khoản rồi bấm Tham gia: https://${SERVER}/join/Xk3pQ9vLm2aT (hết hạn ${S.made.exp}).</textarea></label></div>`,
      foot: `<button class="btn quiet" data-act="closeModal">Xong</button><button class="btn primary" data-act="toast" data-arg="Đã chép tin nhắn">${ic("copy")}Chép tin nhắn</button>`,
    };
  return {
    title: "Mời bằng link",
    sub: "Người nhận bấm link, đăng nhập hoặc tạo tài khoản, rồi bấm Tham gia.",
    body: `<form id="inv-form" data-submit="makeInvite" class="stack">
      <div class="iopt"><span>Quyền</span>${seg("access", [["developer", "Developer"], ["viewer", "Người xem"]])}<small>${ACCESS_HINT[S.inv.access]} Muốn ai làm Quản lý thì nâng sau khi họ vào.</small></div>
      <div class="iopt"><span>Hết hạn sau</span>${seg("days", [[1, "1 ngày"], [7, "7 ngày"], [30, "30 ngày"]])}</div>
      <div class="iopt"><span>Số người dùng được</span>${seg("max", [[1, "1 người"], [10, "10 người"], [null, "Không giới hạn"]])}</div></form>`,
    foot: `<button class="btn quiet" data-act="closeModal">Huỷ</button><button class="btn primary" form="inv-form">Tạo link mời</button>`,
  };
}
function modalAddName() {
  const outside = Object.keys(USERS).filter((u) => !S.members.some((m) => m.u === u));
  return {
    title: "Thêm người đã có tài khoản",
    sub: "Người đó vào project ngay, không cần bấm gì, và thấy project trong trang Project của tôi.",
    body: `<form id="add-form" data-submit="addByName" class="formgrid">
      <label>Tên đăng nhập<input class="input mono" id="add-name" list="add-list" placeholder="ví dụ hien" spellcheck="false" required />
        <datalist id="add-list">${outside.map((u) => `<option value="${u}">${USERS[u].display}</option>`).join("")}</datalist></label>
      <label>Quyền<select class="input" id="add-access"><option value="developer">Developer</option><option value="viewer">Người xem</option><option value="manager">Quản lý</option></select></label></form>`,
    foot: `<button class="btn quiet" data-act="closeModal">Huỷ</button><button class="btn primary" form="add-form">Thêm vào project</button>`,
  };
}
function modalConnectGuide() {
  return {
    title: "Kết nối một máy",
    sub: "Làm trên máy muốn kết nối. Một lần cho mỗi máy, dùng được ở mọi project của bạn.",
    body: `<ol class="steps">
      <li><div>Cài lệnh <span class="mono">gtv</span><small>Cần Node.js 20 trở lên.</small>${cmd("npx guide-the-vibe")}</div></li>
      <li><div>Đăng nhập trên máy đó<small>gtv mở trình duyệt tới trang duyệt máy; bấm Cho phép.</small>${cmd(`gtv login ${SERVER}`)}</div></li>
      <li><div>Bật trong repo của project<small>Cài cho Claude Code và Codex trên máy, không đụng tới git của nhóm.</small>${cmd("gtv on")}</div></li>
    </ol>`,
    foot: `<button class="btn" data-act="closeModal">Đóng</button>`,
  };
}
const MODALS = { new: modalNew, invite: modalInvite, addName: modalAddName, connectGuide: modalConnectGuide };
function modal() {
  if (!S.modal) return "";
  const m = MODALS[S.modal]();
  return `<div class="overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
    <div class="m-head"><div><h2 id="m-title">${m.title}</h2>${m.sub ? `<p>${m.sub}</p>` : ""}</div><button class="iconbtn" data-act="closeModal" aria-label="Đóng">${ic("x")}</button></div>
    <div class="m-body">${m.body}</div>
    <div class="m-foot">${m.foot}</div></div></div>`;
}
function screenMembers() {
  const nav = [["Thành viên", "users", true], ["Mức giám sát", "shield"], ["Repo và đồng bộ", "branch"], ["Link chia sẻ", "link"]];
  return shell(
    projectTop(),
    `${S.created ? `<div class="banner"><span class="big-ok">${ic("check")}</span><div class="grow"><b>Đã tạo Realworld API. Bạn là Quản lý.</b><small>Bước tiếp: mời nhóm bằng link, rồi mỗi người chạy <span class="mono">gtv on</span> trong bản clone của repo.</small></div><button class="btn primary" data-act="modal" data-arg="invite">${ic("link")}Mời bằng link</button></div>` : ""}
    <div class="know">
      <nav class="panel subnav">${nav.map(([l, i, on]) => `<button class="${on ? "on" : ""}" ${on ? "" : 'data-act="toast" data-arg="Màn này có sẵn ở prototype trang project"'}>${ic(i)}${l}</button>`).join("")}</nav>
      <section class="panel doc">
        <div class="hrow" style="align-items:flex-start"><div class="grow"><h2>Thành viên <span class="faint" style="font-weight:500">${S.members.length}</span></h2>
          <p class="lede">Quyền quyết định ai làm gì trong project. Vai trò công việc và trình độ giúp AI chọn người để hỏi.</p></div>
          <div class="hrow"><button class="btn" data-act="modal" data-arg="addName">${ic("user")}Thêm theo tên</button><button class="btn primary" data-act="modal" data-arg="invite">${ic("link")}Mời bằng link</button></div></div>
        <div>${S.members.map(memberRow).join("")}</div>

        <div class="sec"><span class="sect">Link mời đang hiệu lực</span>
          ${S.invites.length
            ? S.invites.map((i) => `<div class="irow">${ic("link")}<div>${ACCESS[i.access]} · đã dùng ${i.used}${i.max ? `/${i.max}` : ""} lượt<small>tạo bởi ${i.by} · hết hạn ${i.exp}</small></div><div class="hrow"><button class="btn sm" data-act="toast" data-arg="Đã chép link">${ic("copy")}Chép</button><button class="btn sm quiet" data-act="revoke" data-arg="${i.id}">Thu hồi</button></div></div>`).join("")
            : `<p class="muted">Không có link nào. Link đã thu hồi hoặc hết hạn không vào được nữa.</p>`}
        </div>

        <div class="sec"><span class="sect">Rời project</span>
          <div class="hrow"><p class="muted grow" style="max-width:60ch">Bạn là Quản lý duy nhất. Nâng một người khác lên Quản lý trước khi rời.</p><button class="btn danger" disabled>Rời project</button></div></div>
      </section>
    </div>`,
  );
}

// ---------- Quản trị server ----------
const ADMIN_TABS = [["admin-users", "Tài khoản", "users"], ["admin-server", "Đăng ký", "key"], ["admin-ai", "AI trả lời", "ai"]];
function screenAdminUsers() {
  const q = S.q.trim().toLowerCase();
  const rows = S.users.filter((r) => !q || r.u.includes(q) || USERS[r.u].display.toLowerCase().includes(q));
  const admins = S.users.filter((r) => r.admin).length;
  return shell(
    simpleTop("Quản trị server", "shield", ADMIN_TABS),
    `<div class="page stack">
      <div class="head" style="margin:0"><div><h1>Tài khoản</h1><p class="lead kpis"><span><b>${S.users.length}</b> tài khoản</span><span><b>${admins}</b> quản trị</span><span><b>${S.users.filter((r) => r.locked).length}</b> đã khoá</span><span>Đăng ký: <b>${{ open: "mở", invite: "chỉ khi có link mời", closed: "đóng" }[S.registration]}</b></span></p></div>
        <div class="tools"><label class="hrow" style="gap:6px">${ic("search")}<input class="input" id="q" value="${esc(S.q)}" placeholder="Tìm người" style="width:200px" aria-label="Tìm người" /></label></div></div>
      <div class="panel pad"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Người</th><th>Quản trị</th><th class="num">Project</th><th class="num">Máy</th><th>Thấy lần cuối</th><th></th></tr></thead><tbody>
        ${rows.map((r) => {
          const u = USERS[r.u];
          const lastAdmin = r.admin && admins === 1;
          return `<tr class="${r.locked ? "locked" : ""}"><td><div class="hrow" style="gap:10px;flex-wrap:nowrap">${av(r.u)}<div><b>${u.display}</b><div class="mono faint" style="font-size:12px">${r.u}</div></div></div></td>
            <td><input type="checkbox" class="switch" ${r.admin ? "checked" : ""} ${lastAdmin ? "disabled title=\"Server cần ít nhất một quản trị\"" : ""} data-act-change="admin" data-arg="${r.u}" aria-label="Quản trị: ${u.display}" /></td>
            <td class="num">${r.projects}</td><td class="num">${r.devices}</td>
            <td>${r.locked ? `<span class="chip warn">${ic("lock")}đã khoá</span>` : r.seen}</td>
            <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-act="resetFor" data-arg="${r.u}">${ic("key")}Đặt lại mật khẩu</button>
              ${r.u === "hoc" ? "" : `<button class="btn sm quiet" data-act="lock" data-arg="${r.u}">${r.locked ? "Mở khoá" : "Khoá"}</button>`}</td></tr>
            ${S.resetFor === r.u ? `<tr class="expand"><td colspan="6"><div class="made"><div class="head2">${ic("key")}Link đặt lại mật khẩu cho ${r.u} · dùng một lần, hết hạn sau 1 giờ</div>${cmd(`https://${SERVER}/reset/b7Tq2LmX9pQe`, false)}<small class="muted">Gửi cho ${u.display} qua tin nhắn. Đặt lại xong, các trình duyệt của họ bị đăng xuất; máy vẫn chạy.</small></div></td></tr>` : ""}`;
        }).join("")}
        </tbody></table></div></div>
      <p class="muted" style="font-size:13px">Khoá: người đó không đăng nhập được và máy của họ bị từ chối; mở khoá là chạy lại như cũ. Quản trị không cần là thành viên project để xem và cứu project.</p>
    </div>`,
  );
}
function screenAdminServer() {
  const opts = [
    ["open", "Mở cho mọi người", "Ai vào trang này cũng tạo được tài khoản và project của riêng mình."],
    ["invite", "Chỉ khi có link mời", "Chỉ người mở link mời vào một project mới tạo được tài khoản."],
    ["closed", "Đóng", "Không ai tạo thêm tài khoản. Người đã có vẫn đăng nhập bình thường."],
  ];
  return shell(
    simpleTop("Quản trị server", "shield", ADMIN_TABS),
    `<div class="page stack">
      <div class="head" style="margin:0"><div><h1>Ai được tạo tài khoản</h1><p class="lead">Áp dụng ngay cho trang Đăng ký.</p></div></div>
      <div class="presets">${opts.map(([k, t, d]) => `<button class="preset ${S.registration === k ? "on" : ""}" data-act="registration" data-arg="${k}"><b>${S.registration === k ? ic("check") : ""}${t}</b><p>${d}</p></button>`).join("")}</div>
      <div class="note">${ic("info")}<span>Server chưa gửi được email, nên người quên mật khẩu nhờ quản trị tạo link đặt lại ở tab Tài khoản.</span></div>
    </div>`,
  );
}

// ---------- routing ----------
const SCREENS = {
  setup: ["Khách", "Tạo quản trị đầu tiên", screenSetup],
  login: ["Khách", "Đăng nhập", screenLogin],
  signup: ["Khách", "Đăng ký", () => screenSignup(false)],
  "signup-invite": ["Khách", "Đăng ký từ link mời", () => screenSignup(true)],
  "join-guest": ["Khách", "Mở link mời (chưa đăng nhập)", screenJoinGuest],
  "join-bad": ["Khách", "Link mời hết hạn", screenJoinBad],
  reset: ["Khách", "Đặt lại mật khẩu", screenReset],
  home: ["Người dùng", "Project của tôi", screenHome],
  "home-empty": ["Người dùng", "Project của tôi (người mới)", screenHomeEmpty],
  new: ["Người dùng", "Tạo project (popup)", () => ((S.modal ||= "new"), screenHome())],
  join: ["Người dùng", "Nhận lời mời", screenJoin],
  connect: ["Người dùng", "Duyệt máy (gtv login)", screenConnect],
  account: ["Người dùng", "Tài khoản", screenAccount],
  devices: ["Người dùng", "Máy của tôi", screenDevices],
  members: ["Project", "Thiết lập › Thành viên", screenMembers],
  "admin-users": ["Quản trị server", "Tài khoản", screenAdminUsers],
  "admin-server": ["Quản trị server", "Đăng ký", screenAdminServer],
};

function renderNav() {
  let g = "";
  const list = Object.entries(SCREENS)
    .map(([k, [group, label]]) => {
      const h = group !== g ? `<div class="g">${group}</div>` : "";
      g = group;
      return `${h}<a href="#${k}" class="${S.route === k ? "on" : ""}">${label}</a>`;
    })
    .join("");
  $("#pnav").innerHTML = `${S.pnav ? `<div class="list">${list}<div class="g">Khác</div><a href="../index.html">Prototype trang project</a></div>` : ""}
    <button data-act="pnav" aria-expanded="${S.pnav}">${ic("layers")}Màn hình: ${SCREENS[S.route][1]}</button>`;
}
function render() {
  const focus = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  S.empty = S.route === "home-empty";
  $("#root").innerHTML = SCREENS[S.route][2]();
  renderNav();
  if (focus && $("#" + focus)) {
    const el = $("#" + focus);
    el.focus();
    if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret);
  }
}
function go(route) {
  S.route = SCREENS[route] ? route : "login";
  S.menu = false;
  S.pnav = false;
  if (route !== "new") S.modal = null;
  if (location.hash !== "#" + S.route) history.replaceState(null, "", "#" + S.route);
  render();
  scrollTo(0, 0);
}

// ---------- actions ----------
const ACT = {
  nav: go,
  toast,
  theme() {
    const r = document.documentElement;
    r.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("gtv.proto.theme", r.dataset.theme); } catch {}
    render();
  },
  menu() { S.menu = !S.menu; render(); },
  pnav() { S.pnav = !S.pnav; renderNav(); },
  pw(id) { S.pw[id] = !S.pw[id]; render(); },
  loginThenJoin() { S.next = "join"; go("login"); },
  rail() { S.wide = !S.wide; try { localStorage.setItem("gtv.proto.rail", S.wide ? "wide" : "narrow"); } catch {} render(); },
  modal(k) { S.modal = k; S.made = null; S.menu = false; render(); $(".modal input:not([type=hidden]), .modal textarea")?.focus(); },
  closeModal() { S.modal = null; S.made = null; if (S.route === "new") go("home"); else render(); },
  checkRepo() {
    const url = $("#np-url").value.trim();
    S.np.url = url;
    if (!url) return toast("Dán URL repo trước");
    if (/^(file:|\/|~|\.)|localhost|127\.0\.0\.1|192\.168\./.test(url)) { S.np.check = "bad"; return render(); }
    S.np.check = "wait";
    render();
    setTimeout(() => {
      S.np.check = /private|secret/.test(url) ? "private" : "ok";
      if (S.np.check === "ok" && !S.np.branch) S.np.branch = "main";
      render();
    }, 900);
  },
  join() { S.joined = true; render(); toast("Đã tham gia Chatbot KLTN"); },
  connect(v) { S.connect = v; render(); },
  logoutOthers() { S.sessions = S.sessions.filter((s) => s.cur); render(); toast("Đã đăng xuất các trình duyệt khác"); },
  dropSession(id) { S.sessions = S.sessions.filter((s) => s.id !== id); render(); toast("Đã đăng xuất phiên đó"); },
  renaming(id) { S.renaming = id || null; render(); },
  unplug(id) { S.unplug = id || null; render(); },
  doUnplug(id) { const d = S.devices.find((x) => x.id === id); S.devices = S.devices.filter((x) => x.id !== id); S.unplug = null; render(); toast(`Đã ngắt ${d.name}`); },
  inv(arg) { const [k, v] = arg.split(":"); S.inv[k] = k === "access" ? v : v === "null" ? null : Number(v); render(); },
  rmMember(u) { S.rmMember = u || null; render(); },
  doRemove(u) { S.members = S.members.filter((m) => m.u !== u); S.rmMember = null; render(); toast(`Đã xoá ${u} khỏi project`); },
  revoke(id) { S.invites = S.invites.filter((i) => i.id !== id); render(); toast("Đã thu hồi link mời"); },
  resetFor(u) { S.resetFor = S.resetFor === u ? null : u; render(); },
  lock(u) { const r = S.users.find((x) => x.u === u); r.locked = !r.locked; render(); toast(r.locked ? `Đã khoá ${u}` : `Đã mở khoá ${u}`); },
  registration(k) { S.registration = k; render(); toast("Đã lưu"); },
};
const CHANGE = {
  access(u, v) {
    const m = S.members.find((x) => x.u === u);
    m.access = v;
    render();
    toast(`${USERS[u].display} giờ là ${ACCESS[v]}`);
  },
  admin(u, v) { S.users.find((x) => x.u === u).admin = v; render(); toast(v ? `${u} giờ là quản trị` : `${u} thôi làm quản trị`); },
};
const SUBMIT = {
  login() { go(S.next === "join" ? "join" : "home"); S.next = null; },
  signup() { go("home-empty"); toast("Đã tạo tài khoản"); },
  signupJoin() { S.joined = true; go("join"); },
  setup() { go("home"); toast("Đã tạo tài khoản quản trị"); },
  reset() { go("home"); toast("Đã đổi mật khẩu"); },
  createProject() { S.modal = null; S.created = true; go("members"); },
  saveProfile() { toast("Đã lưu hồ sơ"); },
  changePw() { toast("Đã đổi mật khẩu. Các trình duyệt khác đã bị đăng xuất"); },
  rename(id) { const d = S.devices.find((x) => x.id === id); d.name = $(`#rn-${id}`).value.trim() || d.name; S.renaming = null; render(); toast("Đã đổi tên máy"); },
  makeInvite() {
    const exp = { 1: "28/11", 7: "04/12", 30: "27/12" }[S.inv.days];
    S.made = { access: S.inv.access, exp, max: S.inv.max };
    S.invites.unshift({ id: "i" + Date.now(), access: S.inv.access, by: "hoc", used: 0, max: S.inv.max, exp });
    render();
  },
  addByName() {
    const u = $("#add-name").value.trim();
    if (!USERS[u]) return toast(`Không có tài khoản tên ${u || "…"}`);
    if (S.members.some((m) => m.u === u)) return toast(`${u} đã ở trong project`);
    S.members.push({ u, access: $("#add-access").value, job: "chưa điền hồ sơ", machines: 2, seen: "hôm qua" });
    S.modal = null;
    render();
    toast(`Đã thêm ${USERS[u].display}`);
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (S.menu && !e.target.closest(".menu, [data-act=menu]")) { S.menu = false; render(); }
  if (e.target.classList?.contains("overlay")) return ACT.closeModal();
  if (!el || el.tagName === "SELECT" || el.tagName === "INPUT") return;
  ACT[el.dataset.act]?.(el.dataset.arg);
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-act-change]");
  if (el) CHANGE[el.dataset.actChange](el.dataset.arg, el.type === "checkbox" ? el.checked : el.value);
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  SUBMIT[f.dataset.submit]?.(f.dataset.arg);
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "su-name") {
    S.suName = t.value = t.value.toLowerCase();
    const [cls, msg] = nameCheck(S.suName);
    const m = $("#su-name-msg");
    m.className = cls;
    m.textContent = msg;
  }
  if (t.id === "np-name") {
    S.np.name = t.value;
    if (!S.np.idEdited) { S.np.id = slug(t.value); $("#np-id").value = S.np.id; }
  }
  if (t.id === "np-id") { S.np.id = t.value; S.np.idEdited = true; }
  if (t.id === "np-url") { S.np.url = t.value; if (S.np.check !== "idle") { S.np.check = "idle"; render(); } }
  if (t.id === "np-branch") S.np.branch = t.value;
  if (t.id === "q") { S.q = t.value; render(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.modal) return ACT.closeModal();
  if (e.key === "Escape" && (S.menu || S.pnav)) { S.menu = S.pnav = false; render(); }
});
addEventListener("hashchange", () => go(location.hash.slice(1)));
go(location.hash.slice(1) || "login");
