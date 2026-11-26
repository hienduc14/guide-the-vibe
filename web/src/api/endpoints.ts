// One function per server endpoint, grouped by area. Pages only talk to the server through here.

import { del, get, patch, post, put } from "./client";
import type {
  ActivityEvent,
  AiSummary,
  CallMap,
  StructureMap,
  AttentionItem,
  Thread,
  BrainInfo,
  BrainProvider,
  CallerHit,
  Conflict,
  FileDetail,
  Incident,
  Plan,
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
  OAuthSession,
  BoardDetail,
  BoardInput,
  BoardNote,
  BoardTask,
  BoardView,
  Charter,
  Me,
  Member,
  MemberLevel,
  Role,
  ShareLink,
  User,
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
  charter?: Charter;
}

export const api = {
  overview: () => get<Overview>("/api/overview"),

  auth: {
    me: () => get<Me>("/api/me"),
    login: (name: string, password: string) => post<{ token: string; name: string; role: Role; expires_at: string }>("/api/login", { name, password }),
    logout: () => post<{ ok: boolean }>("/api/logout"),
  },

  users: {
    list: () => get<User[]>("/api/users"),
    save: (name: string, input: { role?: Role; password?: string }) => put<User>(`/api/users/${encodeURIComponent(name)}`, input),
    remove: (name: string) => del<{ ok: boolean }>(`/api/users/${encodeURIComponent(name)}`),
  },

  board: {
    list: (id: string, scope: "open" | "all" = "all") => get<BoardView[]>(`${p(id)}/board?scope=${scope}`),
    get: (id: string, taskId: string) => get<BoardDetail>(`${p(id)}/board/${encodeURIComponent(taskId)}`),
    create: (id: string, input: BoardInput) => post<BoardTask>(`${p(id)}/board`, input),
    update: (id: string, taskId: string, input: BoardInput) => patch<BoardTask>(`${p(id)}/board/${encodeURIComponent(taskId)}`, input),
    remove: (id: string, taskId: string) => del<{ ok: boolean }>(`${p(id)}/board/${encodeURIComponent(taskId)}`),
    note: (id: string, taskId: string, body: string) => post<BoardNote>(`${p(id)}/board/${encodeURIComponent(taskId)}/notes`, { body }),
  },

  members: {
    list: (id: string) => get<Member[]>(`${a(id)}/members`),
    save: (id: string, dev: string, input: { role?: string; level?: MemberLevel; note?: string }) =>
      put<Member>(`${a(id)}/members/${encodeURIComponent(dev)}`, input),
    remove: (id: string, dev: string) => del<{ ok: boolean }>(`${a(id)}/members/${encodeURIComponent(dev)}`),
  },

  shareLinks: {
    list: (id: string) => get<ShareLink[]>(`${a(id)}/share-links`),
    create: (id: string, label: string, days?: number) => post<ShareLink & { code: string }>(`${a(id)}/share-links`, { label, days }),
    revoke: (id: string, linkId: string) => del<{ ok: boolean }>(`${a(id)}/share-links/${encodeURIComponent(linkId)}`),
  },

  projects: {
    create: (input: ProjectInput) => post<ProjectSummary>("/api/projects", input),
    detail: (id: string) => get<ProjectDetail>(a(id)),
    update: (id: string, input: Partial<ProjectInput>) => patch<ProjectRecord>(a(id), input),
    archive: (id: string) => del<{ ok: boolean }>(a(id)),
    sync: (id: string) => post<{ last_sync: ProjectDetail["last_sync"]; main: string | null }>(`${a(id)}/sync`),
    state: (id: string) => get<TeamState>(`${a(id)}/state`),
    file: (id: string, path: string, context = 3) => get<FileDetail>(`${a(id)}/file?path=${encodeURIComponent(path)}&context=${context}`),
    stats: (id: string, days: number) => get<ProjectStats>(`${a(id)}/stats?days=${days}`),
    layers: (id: string) => get<Layer[]>(`${a(id)}/layers`),
    activity: (id: string, limit = 60, type?: string) =>
      get<ActivityEvent[]>(`${a(id)}/activity?limit=${limit}${type ? `&type=${encodeURIComponent(type)}` : ""}`),
    message: (id: string, to_dev: string, body: string, ref_id?: string) => post(`${a(id)}/messages`, { to_dev, body, ref_id }),
    conversations: (id: string, limit = 40, kinds?: string[]) =>
      get<Thread[]>(`${a(id)}/conversations?limit=${limit}${kinds?.length ? `&kinds=${kinds.join(",")}` : ""}`),
    attention: (id: string) => get<AttentionItem[]>(`${a(id)}/attention`),
    digest: (id: string) => get<{ digest: AiSummary | null }>(`${a(id)}/digest`),
  },

  incidents: {
    list: (id: string, all = false) => get<Incident[]>(`${p(id)}/incidents${all ? "?all=1" : ""}`),
    act: (id: string, iid: string, action: "ack" | "dismiss" | "reopen") => post<Incident>(`${p(id)}/incidents/${encodeURIComponent(iid)}/${action}`),
    guide: (id: string, iid: string, body: string, to: string[]) => post<Incident>(`${p(id)}/incidents/${encodeURIComponent(iid)}/guide`, { body, to }),
    plans: (id: string, iid: string) => get<{ plans: Plan[] }>(`${a(id)}/incidents/${encodeURIComponent(iid)}/plans`),
    rewrite: (id: string, iid: string, text: string) => post<{ text: string }>(`${a(id)}/incidents/${encodeURIComponent(iid)}/rewrite`, { text }),
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
    add: (id: string, doc: { title: string; body: string; type: string; pinned?: boolean; path?: string }) => post<KbDoc>(`${p(id)}/kb`, doc),
    edit: (id: string, docId: string, changes: { title?: string; body?: string; type?: string; pinned?: boolean }) =>
      patch<KbDoc>(`${p(id)}/kb/${encodeURIComponent(docId)}`, changes),
    remove: (id: string, docId: string) => del<{ ok: boolean }>(`${p(id)}/kb/${encodeURIComponent(docId)}`),
    review: (id: string, docId: string, action: "confirm" | "reject") => post<KbDoc>(`${p(id)}/kb/${encodeURIComponent(docId)}/${action}`),
  },

  graph: {
    stats: (id: string) => get<{ base: { files: number; symbols: number; refs: number }; main: string | null }>(`${p(id)}/graph/stats`),
    map: (id: string, view: string, level: "dir" | "file", focus?: string) =>
      get<StructureMap>(`${p(id)}/graph/map?view=${encodeURIComponent(view)}&level=${level}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}`),
    calls: (id: string, q: string, view: string) => get<CallMap>(`${p(id)}/graph/calls?q=${encodeURIComponent(q)}&view=${encodeURIComponent(view)}`),
    symbols: (id: string, q: string, view: string) => get<SymbolRow[]>(`${p(id)}/graph/symbols?q=${encodeURIComponent(q)}&view=${encodeURIComponent(view)}`),
    callers: (id: string, q: string, view: string) =>
      get<{ symbol: string; callers: CallerHit[] }[]>(`${p(id)}/graph/callers?q=${encodeURIComponent(q)}&view=${encodeURIComponent(view)}`),
  },

  devs: {
    list: () => get<Dev[]>("/api/devs"),
    issue: (name: string) => post<{ name: string; token: string }>("/api/devs", { name }),
    invite: (name: string) => post<{ name: string; code: string; expires_at: string }>("/api/devs/invite", { name }),
    remove: (name: string) => del<{ ok: boolean }>(`/api/devs/${encodeURIComponent(name)}`),
  },

  brain: {
    info: (days: number) => get<BrainInfo>(`/api/brain?days=${days}`),
    setModel: (model: string | null, thinking?: string) => put<{ model: string | null; thinking: string | null }>("/api/brain", { model, thinking }),
    providers: () => get<{ secrets_encrypted: boolean; providers: BrainProvider[] }>("/api/brain/providers"),
    setKey: (id: string, key: string) => put<{ ok: boolean }>(`/api/brain/providers/${encodeURIComponent(id)}/key`, { key }),
    clearKey: (id: string) => del<{ ok: boolean }>(`/api/brain/providers/${encodeURIComponent(id)}/key`),
    testProvider: (id: string, model?: string) =>
      post<{ ok: boolean; model?: string; ms: number; detail: string }>(`/api/brain/providers/${encodeURIComponent(id)}/test`, { model }),
    addEndpoint: (e: { id: string; name?: string; base_url: string; api?: string; key?: string }) => post<{ id: string }>("/api/brain/endpoints", e),
    removeEndpoint: (id: string) => del<{ ok: boolean }>(`/api/brain/endpoints/${encodeURIComponent(id)}`),
    oauthStart: (provider: string) => post<OAuthSession>(`/api/brain/oauth/${encodeURIComponent(provider)}/start`, {}),
    oauthStatus: (id: string) => get<OAuthSession>(`/api/brain/oauth/sessions/${encodeURIComponent(id)}`),
    oauthInput: (id: string, value: string) => post<OAuthSession>(`/api/brain/oauth/sessions/${encodeURIComponent(id)}/input`, { value }),
    oauthCancel: (id: string) => del<{ ok: boolean }>(`/api/brain/oauth/sessions/${encodeURIComponent(id)}`),
  },
};
