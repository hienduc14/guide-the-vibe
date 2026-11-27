// Thiết lập (managers only): members, how much gtv steps in, repository, share links, and the raw system log.

import { useState } from "react";
import { Navigate, NavLink, useParams } from "react-router-dom";
import { Check, GitBranch, Link2, ScrollText, ShieldCheck, Users } from "lucide-react";
import { api } from "../../api/endpoints";
import type { FeatureMode, Layer } from "../../api/types";
import { usePoll } from "../../hooks/usePoll";
import { useAction } from "../../hooks/useToast";
import { useProject } from "./ProjectLayout";
import { Seg } from "../../components/pj";
import { Loading } from "../../components/Empty";
import { FEATURE_GROUPS, FEATURE_TEXT, PRESETS } from "../../lib/featureText";
import { TechStats } from "./Progress";
import { LogList, MembersSection, RepoSection, ShareSection } from "./SettingsSections";

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
      {events.data ? <LogList events={events.data} /> : <Loading />}
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
        <TechStats days={days} />
      </div>
    </>
  );
}

export function SettingsPage() {
  const { id, manage } = useProject();
  const { section = "members" } = useParams();
  const all: [string, string, JSX.Element][] = [
    ["members", "Thành viên", <Users key="u" />],
    ["watch", "Mức giám sát", <ShieldCheck key="s" />],
    ["repo", "Repo và đồng bộ", <GitBranch key="g" />],
    ["share", "Link chia sẻ", <Link2 key="l" />],
    ["log", "Nhật ký hệ thống", <ScrollText key="n" />],
  ];
  // Everyone sees the members (and can leave); the rest is for managers.
  const nav = manage ? all : all.slice(0, 1);
  if (!manage && section !== "members") return <Navigate to={`/p/${id}/settings/members`} replace />;
  return (
    <div className="page-col">
      <div className="head">
        <div>
          <h1>Thiết lập</h1>
          <p className="lead">
            {manage ? "Chỉ quản lý của project mới sửa được phần này." : "Bạn xem được thành viên và rời project ở đây; phần còn lại do quản lý project sửa."}
          </p>
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
            <RepoSection />
          ) : section === "share" ? (
            <ShareSection />
          ) : section === "log" ? (
            <Log />
          ) : (
            <MembersSection />
          )}
        </section>
      </div>
    </div>
  );
}
