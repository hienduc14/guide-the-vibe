// Sample data for the prototype, modelled on the real "Realworld API" project on gtv.tenantry.site
// (same people, files, tasks and questions), arranged as one busy evening so every state is visible.

const PEOPLE = {
  hoc: { name: "hoc", ini: "Ho", color: "amber", agent: "claude", agentName: "Claude Code", role: "Backend", level: "Senior", status: "running", seen: "vừa xong", branch: "bench/on/X1/a", task: "t-http" },
  hien: { name: "hien", ini: "Hi", color: "violet", agent: "codex", agentName: "Codex", role: "Backend", level: "Middle", status: "running", seen: "1 phút trước", branch: "bench/on/X1/c", task: "t-valid" },
  "hien-test": { name: "hien-test", ini: "HT", color: "green", agent: "codex", agentName: "Codex", role: "Backend", level: "Junior", status: "running", seen: "vừa xong", branch: "master", task: "t-bio" },
  khanh: { name: "khanh", ini: "Kh", color: "teal", agent: "claude", agentName: "Claude Code", role: "Backend", level: "Middle", status: "idle", seen: "12 phút trước", branch: "bench/on/X1/b", task: "t-article" },
};

const STATUS_LABEL = { running: "đang chạy", idle: "tạm nghỉ", ended: "đã thoát" };

// touches: state = editing (sửa trong phiên này) | edited (đã sửa trước đó) | declared (mới khai báo, chưa sửa)
const FILES = [
  { path: "src/app/models/http-exception.model.ts", watch: "i2", note: "hoc đổi chữ ký, hien-test đang gọi", symbols: ["HttpException"],
    touches: [{ who: "hoc", state: "editing", n: 6, ago: "2 phút" }] },
  { path: "src/app/routes/auth/auth.service.ts", clash: "i1", note: "đụng nhau: gộp code sẽ lỗi", symbols: ["createUser", "updateUser"],
    touches: [{ who: "hoc", state: "declared", n: 0, ago: "" }, { who: "hien", state: "editing", n: 20, ago: "1 phút" }, { who: "hien-test", state: "editing", n: 4, ago: "vừa xong" }] },
  { path: "src/app/routes/auth/token.utils.ts", symbols: ["generateToken"],
    touches: [{ who: "hien", state: "edited", n: 2, ago: "hôm qua" }] },
  { path: "src/app/routes/article/article.service.ts", symbols: ["createArticle", "addComment"],
    touches: [{ who: "hoc", state: "declared", n: 0, ago: "" }, { who: "hien", state: "edited", n: 8, ago: "3 giờ" }, { who: "khanh", state: "editing", n: 5, ago: "12 phút" }] },
  { path: "src/app/routes/profile/profile.service.ts", symbols: [],
    touches: [{ who: "hoc", state: "declared", n: 0, ago: "" }] },
  { path: "src/app/utils/validation.ts", clash: "i3", note: "đụng nhau: hai người làm cùng một việc", symbols: ["validateTitle", "validateCommentBody"],
    touches: [{ who: "hien", state: "editing", n: 4, ago: "4 phút" }, { who: "khanh", state: "editing", n: 3, ago: "12 phút" }] },
  { path: "src/main.ts", symbols: [],
    touches: [{ who: "hoc", state: "edited", n: 2, ago: "40 phút" }] },
];

// One "vụ đụng nhau" per pair of people and piece of code. Today the server stores 5–8 separate rows for each.
const INCIDENTS = [
  {
    id: "i1", level: "high", status: "open", a: "hien", b: "hien-test", ago: "3 phút trước",
    title: "Gộp code sẽ lỗi ở auth.service.ts",
    plain: "hien và hien-test cùng sửa hai hàm createUser, updateUser. Thử gộp hai bản đang làm dở thì Git báo xung đột. Cả hai bản đều đã được lưu, chưa mất gì.",
    where: ["src/app/routes/auth/auth.service.ts"],
    evidence: [
      { ic: "merge", t: "Thử gộp code: xung đột", s: "Dòng 41–58 của auth.service.ts, hai bản sửa chồng lên nhau", lay: "L1" },
      { ic: "code", t: "Cùng sửa hàm createUser và updateUser", s: "hien thêm validateImage, hien-test thêm kiểm tra bio", lay: "L2" },
      { ic: "file", t: "Cùng sửa một file", s: "hien 20 lần sửa, hien-test 4 lần sửa trong 1 giờ qua", lay: "L0" },
    ],
    plans: [
      { k: "hien làm trước", texts: [
        "hien đẩy validateImage trước. hien-test đợi bản đó, kéo về, rồi đặt kiểm tra bio ngay dưới dòng validateImage(image) trong createUser và updateUser. Không ai sửa thêm dòng nào khác quanh đó.",
        "Thứ tự: hien trước, hien-test sau. hien-test dừng sửa auth.service.ts cho tới khi hien đẩy xong validateImage, sau đó thêm kiểm tra bio vào ngay dưới lời gọi validateImage ở cả hai hàm." ] },
      { k: "Chuyển cả hai sang validation.ts", texts: [
        "Cả hai không chèn thẳng vào thân hàm nữa. hien thêm validateBio(bio) vào utils/validation.ts, cạnh validateImage; createUser và updateUser chỉ gọi hai hàm đó. hien-test bỏ hai đoạn if đang viết và chuyển sang viết test cho validateBio.",
        "Gom kiểm tra về một chỗ: hien viết validateBio trong utils/validation.ts, hai hàm createUser và updateUser gọi validateImage rồi validateBio. hien-test xoá phần if bio đã thêm, viết test thay vào." ] },
      { k: "hien-test làm trước", texts: [
        "hien-test đẩy kiểm tra bio trước. hien kéo về rồi thêm validateImage(image) ngay phía trên đoạn kiểm tra bio ở cả hai hàm.",
        "Thứ tự: hien-test trước, hien sau. hien tạm dừng ở auth.service.ts, đợi hien-test đẩy xong rồi chèn validateImage(image) lên trên đoạn kiểm tra bio." ] },
    ],
    log: ["21:58  gtv báo cho agent của hien-test trước khi nó sửa file", "22:01  gtv báo cho agent của hien", "22:02  Agent của hien-test hỏi hoc về chữ ký HttpException"],
  },
  {
    id: "i2", level: "high", status: "open", a: "hoc", b: "hien-test", ago: "9 phút trước",
    title: "hoc đổi chữ ký HttpException, hien-test đang gọi nó",
    plain: "hoc đang đổi HttpException sang dạng (mã HTTP, mã lỗi, chi tiết). hien-test vừa viết hai chỗ gọi theo dạng cũ. Code của hien-test sẽ sai sau khi việc của hoc được merge.",
    where: ["src/app/models/http-exception.model.ts", "src/app/routes/auth/auth.service.ts"],
    evidence: [
      { ic: "code", t: "hoc khai báo đổi chữ ký HttpException", s: "Trong đăng ký việc “X1: mã lỗi cho HttpException”", lay: "L0" },
      { ic: "link", t: "2 chỗ gọi mới theo chữ ký cũ", s: "createUser và updateUser trong bản đang làm của hien-test", lay: "L2" },
    ],
    plans: [
      { k: "hien-test viết theo chữ ký mới", texts: [
        "hien-test viết hai chỗ ném lỗi bio theo chữ ký mới: new HttpException(422, 'VALIDATION_FAILED', { bio: [...] }). hoc merge việc X1 trước, hien-test rebase rồi mới đẩy.",
        "hoc merge X1 trước. hien-test đổi hai lời gọi sang dạng (422, 'VALIDATION_FAILED', { bio: [...] }), rebase lên master mới rồi đẩy." ] },
      { k: "Giữ chữ ký cũ thêm một thời gian", texts: [
        "hoc giữ thêm dạng gọi cũ (errorCode, { errors }) cho tới khi các việc đang dở merge xong. hien-test giữ nguyên code, và tạo một việc mới để đổi sang chữ ký mới sau khi X1 merge.",
        "hoc để HttpException nhận cả hai dạng gọi trong lúc chuyển tiếp. hien-test không phải sửa gì bây giờ; việc đổi sang dạng mới được ghi thành một việc riêng trên bảng." ] },
    ],
    log: ["21:55  gtv báo cho agent của hien-test", "22:02  Agent của hien-test hỏi hoc, đang chờ trả lời"],
  },
  {
    id: "i3", level: "high", status: "acked", a: "khanh", b: "hien", ago: "32 phút trước",
    title: "Hai việc làm cùng một tính năng kiểm tra đầu vào",
    plain: "Việc của khanh (kiểm tra tiêu đề và bình luận bài viết) trùng với module validation dùng chung mà hien đang viết. Nếu cả hai cùng xong sẽ có hai bộ kiểm tra khác nhau.",
    where: ["src/app/utils/validation.ts", "src/app/routes/article/article.service.ts"],
    evidence: [
      { ic: "ai", t: "AI so hai việc và thấy trùng mục tiêu", s: "Cả hai đều thêm validateTitle và validateCommentBody", lay: "L3" },
      { ic: "file", t: "Cùng sửa validation.ts và article.service.ts", s: "hien 12 lần sửa, khanh 8 lần sửa", lay: "L0" },
    ],
    ai: "khanh dùng lại hàm của hien sau khi hien merge, chỉ giữ phần hien chưa làm: trả 404 khi bình luận không tồn tại.",
    log: ["21:32  gtv báo cho cả hai agent", "21:40  khanh bấm Đã biết: “đợi hien merge rồi dùng lại”"],
  },
  {
    id: "i4", level: "info", status: "acked", a: "hoc", b: "hien", ago: "3 giờ trước",
    title: "Sửa gần nhau trong article.service.ts",
    plain: "hoc đổi các dòng ném lỗi, hien thêm lời gọi validate ngay bên cạnh. Khác dòng nên ít rủi ro, người merge sau cần rebase.",
    where: ["src/app/routes/article/article.service.ts"],
    evidence: [{ ic: "file", t: "Cùng phạm vi đã đăng ký", s: "Hai đăng ký việc đều có article.service.ts", lay: "L0" }],
    ai: "Không cần phối hợp thêm. Ai merge sau thì rebase và chạy lại build.",
    log: ["18:49  gtv báo cho cả hai agent", "18:52  hien bấm Đã biết"],
  },
];

const QUESTIONS = [
  {
    id: "q1", from: "hien-test", to: "hoc", task: "t-bio", ago: "2 phút trước", status: "waiting", linked: "i2",
    summary: "Tôi viết hai chỗ ném lỗi bio theo chữ ký HttpException nào?",
    body: "Bản tôi đang có vẫn dùng HttpException(errorCode, { errors }). Tôi định giữ dạng đó cho hai kiểm tra bio, đến khi việc X1 của hoc merge thì chuyển sang (422, 'VALIDATION_FAILED', { bio: [...] }). Tôi không sửa HttpException và các lỗi cũ.",
    options: ["Giữ chữ ký cũ, đổi sau khi X1 merge", "Viết luôn theo chữ ký mới của hoc"],
  },
  {
    id: "q2", from: "hien", to: "hoc", task: "t-valid", ago: "18 phút trước", status: "waiting",
    summary: "Tôi chuẩn hoá email trong createUser có đụng phần anh đang sửa không?",
    body: "Trong auth.service.ts tôi chỉ đổi input.email?.trim() thành .trim().toLowerCase() ở createUser và updateUser, không đụng tới các dòng throw new HttpException. Nếu anh cũng đang sửa quanh dòng 40–60 thì tôi đợi.",
    options: null,
  },
  {
    id: "q3", from: "hien", to: "cả nhóm", task: "t-valid", ago: "34 phút trước", status: "waiting",
    summary: "Ảnh đại diện không phải URL http(s): báo lỗi 422 hay bỏ qua giá trị đó?",
    body: "Trường image ở createUser và updateUser hiện nhận mọi chuỗi. Không tài liệu nào trong project nói rõ, và đây là quyết định về hành vi của API nên tôi không tự chọn.",
    options: ["Báo lỗi 422", "Bỏ qua giá trị image sai"],
  },
];

const OTHER_ATTENTION = [
  { id: "a1", kind: "unassigned", t: "Viết test e2e cho luồng đăng ký", s: "Ưu tiên cao, hạn 28/11, chưa ai nhận", task: "t-e2e" },
  { id: "a2", kind: "stale", t: "X1: kiểm tra đầu vào bài viết", s: "Agent của khanh nghỉ 12 phút, việc đang đụng với hien", task: "t-article" },
];

const BOARD_COLS = [
  { key: "todo", label: "Cần làm", icon: "circle" },
  { key: "in_progress", label: "Đang làm", icon: "play" },
  { key: "blocked", label: "Bị chặn", icon: "ban" },
  { key: "review", label: "Chờ merge", icon: "merge" },
  { key: "done", label: "Xong", icon: "check" },
];

const PRI = { urgent: "Khẩn", high: "Cao", normal: "Thường", low: "Thấp" };

const TASKS = {
  "t-e2e": { title: "Viết test e2e cho luồng đăng ký", status: "todo", pri: "high", due: "28/11", who: null, by: "admin", notes: 0,
    goal: "Phủ các ca đăng ký: thiếu trường, email trùng, username quá dài, bio quá 300 ký tự.", scope: [], timeline: [] },
  "t-docs": { title: "Cập nhật tài liệu mã lỗi API", status: "todo", pri: "normal", due: "02/12", who: "hoc", by: "admin", notes: 1,
    goal: "Bảng mã lỗi mới (VALIDATION_FAILED, NOT_FOUND…) trong tài liệu cốt lõi.", scope: [], timeline: [] },
  "t-http": { title: "X1: mã lỗi cho HttpException", status: "in_progress", pri: "high", due: "30/11", who: "hoc", by: "agent", notes: 3, clash: "i2",
    goal: "HttpException nhận thêm mã lỗi dạng chữ. Mọi chỗ ném lỗi trả về cùng một dạng body { errors, code }.",
    scope: ["HttpException · đổi chữ ký", "http-exception.model.ts", "auth.service.ts", "article.service.ts", "profile.service.ts", "main.ts", "contract: error response body shape"],
    timeline: [
      { who: "hoc", tag: "decision", at: "21:20", text: "Chữ ký mới: HttpException(status, code, details?). Giữ tương thích một phiên bản bằng overload." },
      { who: "hoc", tag: "progress", at: "21:48", text: "Đã đổi model và main.ts. Còn ba service." },
      { who: "gtv", tag: "clash", at: "21:55", text: "hien-test đang gọi HttpException theo chữ ký cũ.", ref: "i2" },
    ] },
  "t-valid": { title: "X1: module validation dùng chung", status: "in_progress", pri: "normal", due: "30/11", who: "hien", by: "agent", notes: 4, clash: "i1",
    goal: "Gom các kiểm tra đầu vào về utils/validation.ts để service chỉ gọi hàm.",
    scope: ["validation.ts", "auth.service.ts", "article.service.ts", "token.utils.ts"],
    timeline: [
      { who: "hien", tag: "progress", at: "18:40", text: "Thêm validateTitle, validateCommentBody; article.service.ts đã gọi." },
      { who: "hien", tag: "decision", at: "21:50", text: "Thêm isHttpUrl và validateImage vào validation.ts. Ảnh rỗng vẫn bỏ qua như cũ." },
      { who: "hien", tag: "question", at: "21:30", text: "Ảnh đại diện không phải URL http(s): báo lỗi 422 hay bỏ qua?", ref: "q3" },
      { who: "gtv", tag: "clash", at: "22:01", text: "Gộp với bản của hien-test sẽ lỗi ở auth.service.ts.", ref: "i1" },
    ] },
  "t-article": { title: "X1: kiểm tra đầu vào bài viết", status: "in_progress", pri: "normal", due: null, who: "khanh", by: "agent", notes: 2, clash: "i3",
    goal: "Tiêu đề tối đa 200 ký tự, nội dung bình luận tối đa 1000, không cho để trống.",
    scope: ["article.service.ts", "validation.ts"],
    timeline: [
      { who: "gtv", tag: "clash", at: "21:32", text: "Trùng mục tiêu với việc của hien.", ref: "i3" },
      { who: "khanh", tag: "decision", at: "21:40", text: "Đợi hien merge rồi dùng lại hàm của hien. Chỉ giữ phần trả 404 khi bình luận không tồn tại." },
    ] },
  "t-bio": { title: "Giới hạn bio 300 ký tự khi tạo và sửa người dùng", status: "blocked", pri: "normal", due: "29/11", who: "hien-test", by: "agent", notes: 7, clash: "i1", waits: "q1",
    goal: "Bio dài hơn 300 ký tự trả 422 với errors.bio, kiểm tra trước khi ghi dữ liệu.",
    scope: ["auth.service.ts", "createUser", "updateUser"],
    timeline: [
      { who: "hien-test", tag: "decision", at: "21:44", text: "Kiểm tra bio trước khi ghi dữ liệu; quá 300 ký tự trả 422 với errors.bio." },
      { who: "hien-test", tag: "progress", at: "21:52", text: "10 ca kiểm tra service đều đạt. Jest chưa chạy được vì checkout thiếu node_modules." },
      { who: "gtv", tag: "clash", at: "21:58", text: "hien cũng đang sửa createUser và updateUser.", ref: "i1" },
      { who: "hien-test", tag: "question", at: "22:02", text: "Tôi viết hai chỗ ném lỗi bio theo chữ ký HttpException nào?", ref: "q1" },
      { who: "hien-test", tag: "blocker", at: "22:02", text: "Dừng ở đây, chờ hoc trả lời." },
    ] },
  "t-user": { title: "Giới hạn độ dài username khi tạo và sửa người dùng", status: "review", pri: "normal", due: null, who: "hien-test", by: "agent", notes: 2,
    goal: "Username 3–20 ký tự, trả 422 khi sai.", scope: ["auth.service.ts"],
    timeline: [{ who: "hien-test", tag: "done", at: "20:10", text: "Đã thêm hai kiểm tra username 3–20 ký tự. Đã đẩy nhánh, chờ merge." }] },
  "t-token": { title: "T1: token mang username", status: "done", pri: "normal", due: null, who: "hoc", by: "agent", notes: 1,
    goal: "JWT chứa thêm username.", scope: ["token.utils.ts", "auth.service.ts"], timeline: [{ who: "hoc", tag: "done", at: "24/11", text: "generateToken(user) thay cho generateToken(user.id). Đã merge." }] },
  "t-email": { title: "Chuẩn hoá email khi đăng ký", status: "done", pri: "low", due: null, who: "hien", by: "admin", notes: 1,
    goal: "Email được trim và viết thường.", scope: ["auth.service.ts"], timeline: [] },
  "t-ci": { title: "Thiết lập CI cho nhánh bench", status: "done", pri: "normal", due: null, who: "khanh", by: "admin", notes: 1,
    goal: "Chạy lint và test trên mọi nhánh bench/*.", scope: [], timeline: [] },
};

const TAGS = { progress: "tiến độ", decision: "quyết định", blocker: "vướng", question: "câu hỏi", done: "hoàn thành", clash: "đụng nhau" };

const DIGEST = [
  "<b>hoc</b> đổi chữ ký HttpException; model và main.ts đã xong, còn ba service.",
  "<b>hien</b> và <b>hien-test</b> cùng sửa createUser, gộp code đang lỗi.",
  "<b>khanh</b> dừng phần trùng với hien, đợi hien merge.",
  "3 câu hỏi đang chờ người quyết, 2 câu gửi cho hoc.",
];

// Code of each touched file, as the file sheet shows it: per hunk, segments that are unchanged (ctx),
// changed by one or more people (chg), or folded (fold). A chg with clash:true is where Git cannot merge.
const CODE = {
  "src/app/routes/auth/auth.service.ts": {
    lines: 214, saved: { hien: "22:03", "hien-test": "22:04" },
    outline: [
      { name: "createUser", line: 38, who: ["hien", "hien-test"], clash: true },
      { name: "login", line: 74, who: [] },
      { name: "getCurrentUser", line: 88, who: [] },
      { name: "updateUser", line: 96, who: ["hien", "hien-test"], clash: true },
    ],
    hunks: [
      { sym: "createUser", start: 38, segs: [
        { ctx: ["export const createUser = async (input: RegisterInput): Promise<RegisteredUser> => {"] },
        { base: ["  const email = input.email?.trim();"], chg: { hien: { del: ["  const email = input.email?.trim();"], add: ["  const email = input.email?.trim().toLowerCase();"] } } },
        { ctx: ["  const username = input.username?.trim();", "  const password = input.password?.trim();", "  const { image, bio, demo } = input;"] },
        { clash: true, note: "Cả hai cùng chèn code vào sau dòng 42, Git không biết xếp bản nào trước.", base: [],
          chg: { hien: { del: [], add: ["  validateImage(image);"] }, "hien-test": { del: [], add: ["  if (bio && bio.length > 300) {", "    throw new HttpException(422, { errors: { bio: ['tối đa 300 ký tự'] } });", "  }"] } },
          merged: [["hien", "  validateImage(image);"], ["hien-test", "  if (bio && bio.length > 300) {"], ["hien-test", "    throw new HttpException(422, { errors: { bio: ['tối đa 300 ký tự'] } });"], ["hien-test", "  }"]] },
        { ctx: ["", "  if (!email) {", "    throw new HttpException(422, { errors: { email: [\"can't be blank\"] } });", "  }"] },
        { fold: 49, label: "49 dòng không đổi, gồm login và getCurrentUser" },
      ] },
      { sym: "updateUser", start: 96, segs: [
        { ctx: ["export const updateUser = async (userPayload: any, id: number) => {", "  const { email, username, password, image, bio } = userPayload;"] },
        { clash: true, note: "Cùng kiểu đụng như ở createUser: hai bản chèn vào cùng một chỗ.", base: [],
          chg: { hien: { del: [], add: ["  validateImage(image);"] }, "hien-test": { del: [], add: ["  if (bio && bio.length > 300) {", "    throw new HttpException(422, { errors: { bio: ['tối đa 300 ký tự'] } });", "  }"] } },
          merged: [["hien", "  validateImage(image);"], ["hien-test", "  if (bio && bio.length > 300) {"], ["hien-test", "    throw new HttpException(422, { errors: { bio: ['tối đa 300 ký tự'] } });"], ["hien-test", "  }"]] },
        { ctx: ["  let hashedPassword;", "  if (password) {", "    hashedPassword = await bcrypt.hash(password, 10);", "  }"] },
        { fold: 112, label: "112 dòng không đổi" },
      ] },
    ],
  },
  "src/app/models/http-exception.model.ts": {
    lines: 12, saved: { hoc: "22:02" },
    outline: [{ name: "HttpException", line: 1, who: ["hoc"] }],
    usedBy: [
      { who: "hien-test", where: "auth.service.ts, hàm createUser", text: "new HttpException(422, { errors: { bio: [...] } })" },
      { who: "hien-test", where: "auth.service.ts, hàm updateUser", text: "new HttpException(422, { errors: { bio: [...] } })" },
    ],
    hunks: [
      { sym: "HttpException", start: 1, segs: [
        { ctx: ["class HttpException extends Error {"] },
        { base: ["  errorCode: number;"], chg: { hoc: { del: ["  errorCode: number;"], add: ["  status: number;", "  code: string;"] } } },
        { ctx: ["  constructor("] },
        { base: ["    errorCode: number,", "    public readonly message: string | any,"], chg: { hoc: { del: ["    errorCode: number,", "    public readonly message: string | any,"], add: ["    status: number,", "    code: string,", "    public readonly details?: Record<string, unknown>,"] } } },
        { ctx: ["  ) {"] },
        { base: ["    super(message);", "    this.errorCode = errorCode;"], chg: { hoc: { del: ["    super(message);", "    this.errorCode = errorCode;"], add: ["    super(code);", "    this.status = status;", "    this.code = code;"] } } },
        { ctx: ["  }", "}", "", "export default HttpException;"] },
      ] },
    ],
  },
  "src/app/utils/validation.ts": {
    lines: 31, saved: { hien: "22:00", khanh: "21:52" },
    outline: [
      { name: "validateTitle", line: 3, who: ["hien", "khanh"], clash: true },
      { name: "validateImage", line: 8, who: ["hien"] },
    ],
    hunks: [
      { sym: "validateTitle", start: 1, segs: [
        { ctx: ["import HttpException from '../models/http-exception.model';", ""] },
        { clash: true, note: "Hai người viết hai bản khác nhau của cùng hàm validateTitle: giới hạn 255 và 200 ký tự.", base: [],
          chg: { hien: { del: [], add: ["export function validateTitle(title: string) {", "  if (!title?.trim() || title.length > 255) fail('title', 'tối đa 255 ký tự');", "}"] },
                 khanh: { del: [], add: ["export const validateTitle = (title: string) => {", "  if (!title?.trim() || title.length > 200) {", "    throw new HttpException(422, { errors: { title: ['tối đa 200 ký tự'] } });", "  }", "};"] } },
          merged: [["hien", "export function validateTitle(title: string) {"], ["khanh", "  if (!title?.trim() || title.length > 200) fail('title', 'tối đa 200 ký tự');"], ["hien", "}"]] },
        { ctx: [""] },
        { base: [], chg: { hien: { del: [], add: ["export function validateImage(image?: string) {", "  if (image && !isHttpUrl(image)) fail('image', 'phải là URL http(s)');", "}"] } } },
        { fold: 22, label: "22 dòng không đổi" },
      ] },
    ],
  },
  "src/app/routes/article/article.service.ts": {
    lines: 340, saved: { hien: "19:10", khanh: "21:52" },
    outline: [
      { name: "createArticle", line: 112, who: ["hien"] },
      { name: "addComment", line: 176, who: ["khanh"] },
    ],
    hunks: [
      { sym: "createArticle", start: 112, segs: [
        { ctx: ["export const createArticle = async (article: any, id: number) => {", "  const { title, description, body, tagList } = article;"] },
        { base: [], chg: { hien: { del: [], add: ["  validateTitle(title);"] } } },
        { ctx: ["  const tags = Array.isArray(tagList) ? tagList : [];"] },
        { fold: 61, label: "61 dòng không đổi" },
      ] },
      { sym: "addComment", start: 176, segs: [
        { ctx: ["export const addComment = async (body: string, slug: string, id: number) => {"] },
        { base: ["  if (!body) {", "    throw new HttpException(422, { errors: { body: [\"can't be blank\"] } });", "  }"], chg: { khanh: { del: ["  if (!body) {", "    throw new HttpException(422, { errors: { body: [\"can't be blank\"] } });", "  }"], add: ["  validateCommentBody(body);"] } } },
        { ctx: ["  const article = await prisma.article.findUnique({ where: { slug }, select: { id: true } });"] },
        { base: [], chg: { khanh: { del: [], add: ["  if (!article) {", "    throw new HttpException(404, { errors: { article: ['not found'] } });", "  }"] } } },
        { fold: 158, label: "158 dòng không đổi" },
      ] },
    ],
  },
  "src/app/routes/auth/token.utils.ts": {
    lines: 9, saved: { hien: "hôm qua" },
    outline: [{ name: "generateToken", line: 3, who: ["hien"] }],
    hunks: [
      { sym: "generateToken", start: 1, segs: [
        { ctx: ["import * as jwt from 'jsonwebtoken';", ""] },
        { base: ["const generateToken = (id: number): string =>", "  jwt.sign({ user: { id } }, process.env.JWT_SECRET || 'superSecret', {"], chg: { hien: { del: ["const generateToken = (id: number): string =>", "  jwt.sign({ user: { id } }, process.env.JWT_SECRET || 'superSecret', {"], add: ["const generateToken = (user: { id: number; username: string }): string =>", "  jwt.sign({ user: { id: user.id, username: user.username } }, process.env.JWT_SECRET || 'superSecret', {"] } } },
        { ctx: ["    expiresIn: '60d',", "  });", "", "export default generateToken;"] },
      ] },
    ],
  },
  "src/main.ts": {
    lines: 58, saved: { hoc: "21:24" },
    outline: [{ name: "xử lý lỗi chung", line: 41, who: ["hoc"] }],
    hunks: [
      { sym: "xử lý lỗi chung", start: 41, segs: [
        { ctx: ["app.use((err: Error | HttpException, req: express.Request, res: express.Response, next: express.NextFunction) => {"] },
        { base: ["  if (err && err.errorCode) {", "    res.status(err.errorCode).json(err.message);"], chg: { hoc: { del: ["  if (err && err.errorCode) {", "    res.status(err.errorCode).json(err.message);"], add: ["  if (err instanceof HttpException) {", "    res.status(err.status).json({ code: err.code, errors: err.details });"] } } },
        { ctx: ["  } else if (err) {", "    res.status(500).json(err.message);", "  }", "});"] },
      ] },
    ],
  },
};

const DOCS = [
  { id: "d1", title: "Quy ước mã lỗi API", kind: "Tài liệu", core: true, src: "admin thêm 20/11", status: "active" },
  { id: "d2", title: "ADR-001: kiểm tra đầu vào đặt ở tầng service", kind: "ADR", core: true, src: "docs/adr/001.md trong repo", status: "active" },
  { id: "d3", title: "README.md", kind: "Từ repo", core: false, src: "đồng bộ từ repo", status: "active" },
  { id: "d4", title: "Token mang những trường nào?", kind: "Hỏi đáp", core: false, src: "hoc trả lời 24/11", status: "active" },
];
const UNVERIFIED = [
  { id: "u1", title: "Email được chuẩn hoá ở đâu: service hay controller?", src: "AI trả lời 21:10, dựa trên auth.service.ts" },
  { id: "u2", title: "Tiêu đề bài viết tối đa bao nhiêu ký tự?", src: "Agent của khanh trả lời 21:36" },
];

const CHARTER = {
  goal: "API blog theo chuẩn RealWorld, dùng làm bài đo: nhiều agent cùng sửa một repo thì đụng nhau ở đâu và gtv bắt được bao nhiêu.",
  users: "Nhóm 4 người của môn INT3507, mỗi người lái một agent (Claude Code hoặc Codex).",
  deadline: "15/12/2026", left: "còn 19 ngày",
  quality: "MVP",
  stack: ["Node.js", "Express", "Prisma", "TypeScript", "Jest"],
  constraints: "Không đổi schema Prisma khi chưa báo nhóm. Mọi lỗi trả về theo dạng { errors: { field: [msg] } }.",
  non_goals: "Không làm giao diện web, không tối ưu hiệu năng.",
  language: "Tiếng Việt",
};

// Detection features, in plain words. key = the server's feature key, shown only as a tooltip.
const LAYERS = [
  { g: "Phát hiện đụng nhau", key: "detect.l0_path", t: "Cùng file hoặc cùng phạm vi", s: "So đăng ký việc và file từng agent đã sửa", mode: "on", n: "22 lần báo" },
  { g: "Phát hiện đụng nhau", key: "detect.l1_merge", t: "Thử gộp code đang làm dở", s: "Chạy git merge trên bản lưu tạm của mỗi người", mode: "on", n: "1 lần báo" },
  { g: "Phát hiện đụng nhau", key: "detect.l2_symbol", t: "Đổi hàm mà người khác đang dùng", s: "So chữ ký hàm, lớp giữa các bản đang làm", mode: "on", n: "2 lần báo" },
  { g: "Phát hiện đụng nhau", key: "detect.l3_semantic", t: "AI so mục tiêu hai việc", s: "Bắt hai việc mâu thuẫn dù khác file. Cần AI trả lời", mode: "on", n: "6 lần báo, 4 lần lỗi" },
  { g: "Đăng ký việc", key: "registration", t: "Agent đăng ký việc trước khi sửa", s: "Nền của mọi phần khác", mode: "on", n: "11 lần đăng ký" },
  { g: "Đăng ký việc", key: "registration.auto_from_plan", t: "Tự đăng ký việc từ kế hoạch của agent", s: "Khi agent quên đăng ký. Cần AI trả lời", mode: "shadow", n: "" },
  { g: "Đăng ký việc", key: "drift_check", t: "Báo khi agent sửa ra ngoài phạm vi đã đăng ký", s: "", mode: "on", n: "0 lần" },
  { g: "Đăng ký việc", key: "policy.ask", t: "Bắt agent hỏi lại trước khi sửa chỗ đang đụng nặng", s: "Áp dụng cho mức cao và nghiêm trọng", mode: "on", n: "" },
  { g: "Hỏi đáp", key: "qa.tier1_answer", t: "AI tự trả lời câu hỏi của agent", s: "Dựa trên code, tài liệu và việc của cả nhóm", mode: "on", n: "1 câu" },
  { g: "Hỏi đáp", key: "qa.tier2_relay", t: "Chuyển câu hỏi tới agent của đồng đội", s: "Khi AI không đủ căn cứ", mode: "on", n: "10 câu" },
  { g: "Hỏi đáp", key: "qa.tier3_human", t: "Hỏi người khi các agent không tự quyết được", s: "Câu hỏi hiện ở Cần xử lý", mode: "on", n: "6 câu" },
  { g: "Tri thức và hệ thống", key: "knowledge.code_graph", t: "Chỉ mục code: hàm, lớp, ai gọi ai", s: "Dùng để bắt việc đổi hàm người khác đang dùng. 38 file, 42 hàm và lớp", mode: "on", n: "" },
  { g: "Tri thức và hệ thống", key: "knowledge.doc_kb", t: "Tìm trong tài liệu và hỏi đáp", s: "", mode: "on", n: "12 tài liệu" },
  { g: "Tri thức và hệ thống", key: "brain.summary", t: "AI tóm tắt trao đổi và tóm tắt ngày", s: "Tối đa 80 lượt mỗi ngày", mode: "on", n: "" },
  { g: "Tri thức và hệ thống", key: "notify.desktop", t: "Thông báo trên máy của developer", s: "", mode: "on", n: "" },
];
