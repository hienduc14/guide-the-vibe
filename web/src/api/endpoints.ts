// One function per server endpoint, grouped by area. Pages only talk to the server through here.

import { del, get, patch, post, put } from "./client";
import type {
  ActivityEvent,
  BrainInfo,
  CallerHit,
  Conflict,
  Dev,
  FeatureMode,
  KbDoc,
  KbHit,
  KbListItem,
  Layer,
  Overview,
  Policy,
  ProjectDetail,
  ProjectRecord,
  ProjectStats,
  ProjectSummary,
  SymbolRow,
  TeamState,
  Ticket,
} from "./types";

const p = (id: string) => `/v1/p/${encodeURIComponent(id)}`;
const a = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export interface ProjectInput {
  id: string;
  name?: string;
  repo_url: string;
  main_branch?: string;
  aliases?: string[];
  description?: string;
  policy?: Partial<Policy>;
}

export const api = {
  overview: () => get<Overview>("/api/overview"),

  projects: {
    create: (input: ProjectInput) => post<ProjectSummary>("/api/projects", input),
    detail: (id: string) => get<ProjectDetail>(a(id)),
    update: (id: string, input: Partial<ProjectInput>) => patch<ProjectRecord>(a(id), input),
    archive: (id: string) => del<{ ok: boolean }>(a(id)),
    sync: (id: string) => post<{ last_sync: ProjectDetail["last_sync"]; main: string | null }>(`${a(id)}/sync`),
    state: (id: string) => get<TeamState>(`${a(id)}/state`),
    stats: (id: string, days: number) => get<ProjectStats>(`${a(id)}/stats?days=${days}`),
    layers: (id: string) => get<Layer[]>(`${a(id)}/layers`),
    activity: (id: string, limit = 60, type?: string) =>
      get<ActivityEvent[]>(`${a(id)}/activity?limit=${limit}${type ? `&type=${encodeURIComponent(type)}` : ""}`),
    message: (id: string, to_dev: string, body: string) => post(`${a(id)}/messages`, { to_dev, body }),
  },

  conflicts: {
    list: (id: string, all: boolean) => get<Conflict[]>(`${p(id)}/conflicts${all ? "?all=1" : ""}`),
    act: (id: string, conflictId: string, action: "ack" | "dismiss" | "reopen") =>
      post<Conflict>(`${p(id)}/conflicts/${encodeURIComponent(conflictId)}/${action}`),
  },

  features: {
    set: (id: string, feature: string, mode: FeatureMode | null) => put<Record<string, FeatureMode>>(`${p(id)}/features`, { feature, mode }),
  },

  tickets: {
    list: (id: string) => get<Ticket[]>(`${p(id)}/tickets`),
    reply: (id: string, ticketId: string, answer: string, as?: string) =>
      post<Ticket>(`${p(id)}/tickets/${encodeURIComponent(ticketId)}/reply`, { answer }, { as }),
  },

  kb: {
    list: (id: string) => get<KbListItem[]>(`${p(id)}/kb`),
    search: (id: string, q: string) => get<KbHit[]>(`${p(id)}/kb?q=${encodeURIComponent(q)}&limit=20`),
    get: (id: string, docId: string) => get<KbDoc>(`${p(id)}/kb/${encodeURIComponent(docId)}`),
    add: (id: string, doc: { title: string; body: string; type: string }) => post<KbDoc>(`${p(id)}/kb`, doc),
    review: (id: string, docId: string, action: "confirm" | "reject") => post<KbDoc>(`${p(id)}/kb/${encodeURIComponent(docId)}/${action}`),
  },

  graph: {
    stats: (id: string) => get<{ base: { files: number; symbols: number; refs: number }; main: string | null }>(`${p(id)}/graph/stats`),
    symbols: (id: string, q: string, view: string) => get<SymbolRow[]>(`${p(id)}/graph/symbols?q=${encodeURIComponent(q)}&view=${encodeURIComponent(view)}`),
    callers: (id: string, q: string, view: string) =>
      get<{ symbol: string; callers: CallerHit[] }[]>(`${p(id)}/graph/callers?q=${encodeURIComponent(q)}&view=${encodeURIComponent(view)}`),
  },

  devs: {
    list: () => get<Dev[]>("/api/devs"),
    issue: (name: string) => post<{ name: string; token: string }>("/api/devs", { name }),
    remove: (name: string) => del<{ ok: boolean }>(`/api/devs/${encodeURIComponent(name)}`),
  },

  brain: {
    info: (days: number) => get<BrainInfo>(`/api/brain?days=${days}`),
    setModel: (model: string | null) => put<{ model: string | null }>("/api/brain", { model }),
  },
};
