// Thiết lập (managers only): members, how much gtv steps in, repository, share links, and the raw system log.

import { useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { Check, GitBranch, Link2, ScrollText, ShieldCheck, Users } from "lucide-react";
import { api } from "../../api/endpoints";
import type { FeatureMode, Layer } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useAuth } from "../../hooks/useAuth";
import { useProject } from "./ProjectLayout";
import { Seg } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { CopyCommand } from "../../components/CopyCommand";
import { FEATURE_GROUPS, FEATURE_TEXT, PRESETS } from "../../lib/featureText";
import { MembersTab } from "./MembersTab";
import { RepoSettings } from "./SettingsTab";
import { ShareLinksCard } from "./ShareLinksCard";
import { ActivityFeed } from "./ActivityFeed";
import { TechStats } from "./StatsTab";

function Invite() {
  const run = useAction();
  const [name, setName] = useState("");
  const [cmd, setCmd] = useState<string>();
  return (
    <div className="block">
      <span className="sect">Mời thêm người</span>
      <form
        className="acts"
        style={{ marginTop: 0 }}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => api.devs.invite(name.trim()), "Đã tạo lệnh mời, có hiệu lực 24 giờ");
          if (r) setCmd(`npx guide-the-vibe join ${location.origin}/j/${r.code}`);
        }}
      >
        <input
          className="p-input"
          style={{ maxWidth: 240 }}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên developer"
          aria-label="Tên developer"
        />
        <button type="submit" className="p-btn primary">
          Tạo lệnh mời
        </button>
      </form>
      {cmd && (
        <div style={{ marginTop: 10 }}>
          <CopyCommand text={cmd} />
          <p className="faint" style={{ marginTop: 6 }}>
            Người đó chạy lệnh này một lần trong bản clone của repo.
          </p>
        </div>
      )}
    </div>
  );
}

const MODES: [FeatureMode, string][] = [
  ["off", "Tắt"],
  ["shadow", "Chạy thử"],
  ["on", "Bật"],
];

function metricText(l: Layer): string {
  const m = l.metrics;
  const parts: string[] = [];
  if (typeof m.total === "number") parts.push(`${m.total} lần báo`);
  if (typeof m.tasks === "number") parts.push(`${m.tasks} lần đăng ký`);
  if (typeof m.tickets === "number") parts.push(`${m.tickets} câu`);
  if (typeof m.drift_events === "number") parts.push(`${m.drift_events} lần`);
  if (typeof m.documents === "number") parts.push(`${m.documents} tài liệu`);
  if (typeof m.files === "number") parts.push(`${m.files} file, ${m.symbols} hàm và lớp`);
  if (l.errors) parts.push(`${l.errors} lần lỗi`);
  return parts.join(", ");
}

function Watch() {
  const { id } = useProject();
  const run = useAction();
  const { data, reload } = usePoll(() => api.projects.layers(id), [id], 10_000);
  if (!data) return <Loading />;
  const by = new Map(data.map((l) => [l.key, l]));
  const set = async (key: string, mode: FeatureMode | null) => {
    await run(() => api.features.set(id, key, mode));
    void reload();
  };
  const presetKeys = new Set(Object.keys(PRESETS.watch.set));
  const isWatch = Object.entries(PRESETS.watch.set).every(([k, v]) => by.get(k)?.override === v);
  const isBalanced = [...presetKeys].every((k) => !by.get(k)?.override);
  const custom = data.some((l) => l.override && !presetKeys.has(l.key));
  const apply = async (p: keyof typeof PRESETS) => {
    for (const [k, v] of Object.entries(PRESETS[p].set)) await api.features.set(id, k, v as FeatureMode | null).catch(() => undefined);
    void reload();
  };
  return (
    <>
      <h2>Mức giám sát</h2>
      <p className="lede">Chọn gtv can thiệp tới đâu. “Chạy thử” nghĩa là gtv vẫn kiểm tra và ghi lại, nhưng không báo cho ai.</p>
      <div className="presets">
        {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => {
          const on = k === "watch" ? isWatch : isBalanced;
          return (
            <button key={k} type="button" className={`preset${on ? " on" : ""}`} aria-pressed={on} onClick={() => void apply(k)}>
              <b>
                {on && <Check />}
                {PRESETS[k].label}
              </b>
              <p>{PRESETS[k].text}</p>
            </button>
          );
        })}
        <div className={`preset static${custom ? " on" : ""}`}>
          <b>{custom && <Check />}Tuỳ chỉnh</b>
          <p>{custom ? "Có phần đã chỉnh tay bên dưới." : "Chỉnh từng phần bên dưới."}</p>
        </div>
      </div>
      <div className="block">
        <span className="sect">Tuỳ chỉnh từng phần</span>
        <div className="layers">
          {FEATURE_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="gh" style={{ paddingLeft: 0 }}>
                {g.title}
              </div>
              {g.keys
                .map((k) => by.get(k))
                .filter((l): l is Layer => !!l)
                .map((l) => {
                  const txt = FEATURE_TEXT[l.key] ?? { t: l.description, s: "" };
                  const why = [
                    ...(l.blocked_by ?? []).map((b) =>
                      b === "circuit breaker"
                        ? "tự ngắt sau nhiều lần lỗi"
                        : b === "brain" || b.startsWith("BRAIN_BACKEND")
                          ? "đang tắt vì AI trả lời tắt"
                          : `đang tắt vì ${FEATURE_TEXT[b]?.t ?? b} tắt`,
                    ),
                  ];
                  return (
                    <div key={l.key} className="layer">
                      <div title={l.key}>
                        {txt.t}
                        <small>{[txt.s, metricText(l), ...why].filter(Boolean).join(" · ")}</small>
                      </div>
                      <div className="row-right">
                        {l.override && (
                          <button type="button" className="linkbtn" onClick={() => void set(l.key, null)} title={`Mặc định: ${l.default}`}>
                            về mặc định
                          </button>
                        )}
                        <Seg label={txt.t} value={l.mode} onChange={(m) => void set(l.key, m)} options={MODES} />
                      </div>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Log() {
  const { id } = useProject();
  const events = usePoll(() => api.projects.activity(id, 200), [id], 10_000);
  const [days, setDays] = useState<"7" | "14" | "30">("14");
  return (
    <>
      <h2>Nhật ký hệ thống</h2>
      <p className="lede">Mọi sự kiện gtv ghi lại, và số liệu kỹ thuật của AI, phát hiện đụng nhau, hỏi đáp.</p>
      <div className="legacy">{events.data ? <ActivityFeed events={events.data} /> : <Loading />}</div>
      <div className="block">
        <div className="acts" style={{ marginTop: 0, alignItems: "center" }}>
          <span className="sect">Số liệu kỹ thuật</span>
          <Seg
            label="Khoảng ngày"
            value={days}
            onChange={setDays}
            options={[
              ["7", "7 ngày"],
              ["14", "14 ngày"],
              ["30", "30 ngày"],
            ]}
          />
        </div>
        <div className="legacy">
          <TechStats days={days} />
        </div>
      </div>
    </>
  );
}

export function SettingsPage() {
  const { id } = useProject();
  const { can } = useAuth();
  const { section = "members" } = useParams();
  const nav: [string, string, JSX.Element][] = [
    ["members", "Thành viên", <Users key="u" />],
    ["watch", "Mức giám sát", <ShieldCheck key="s" />],
    ["repo", "Repo và đồng bộ", <GitBranch key="g" />],
    ["share", "Link chia sẻ", <Link2 key="l" />],
    ["log", "Nhật ký hệ thống", <ScrollText key="n" />],
  ];
  return (
    <>
      <div className="head">
        <div>
          <h1>Thiết lập</h1>
          <p className="lead">Chỉ quản lý của project mới sửa được phần này.</p>
        </div>
      </div>
      <div className="know">
        <nav className="panel subnav" aria-label="Thiết lập">
          {nav.map(([k, label, icon]) => (
            <NavLink key={k} to={`/p/${id}/settings/${k}`} className={() => (section === k ? "on" : "")}>
              {icon}
              {label}
            </NavLink>
          ))}
        </nav>
        <section className="panel doc">
          {section === "watch" ? (
            <Watch />
          ) : section === "repo" ? (
            <>
              <h2>Repo và đồng bộ</h2>
              <p className="lede">gtv kéo repo về định kỳ để so với phần đang làm dở của từng người.</p>
              <div className="legacy">
                <RepoSettings />
              </div>
            </>
          ) : section === "share" ? (
            <>
              <h2>Link chia sẻ</h2>
              <p className="lede">Link chỉ xem, không cần tài khoản. Dùng để gửi giảng viên hoặc người ngoài nhóm.</p>
              <div className="legacy">
                <ShareLinksCard id={id} />
              </div>
            </>
          ) : section === "log" ? (
            <Log />
          ) : (
            <>
              <h2>Thành viên</h2>
              <p className="lede">Mỗi thành viên cài gtv một lần trong bản clone của mình. Vai trò và trình độ giúp AI chọn cách trả lời và người để hỏi.</p>
              <div className="legacy">
                <MembersTab />
              </div>
              {can("admin") && <Invite />}
            </>
          )}
        </section>
      </div>
    </>
  );
}
