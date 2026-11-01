// Server configuration from environment variables plus an optional YAML file (GTV_CONFIG).

import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { FeatureMode, Policy } from "../shared/types.ts";

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  /** Optional single-repo bootstrap: creates project `defaultProject` on first start. */
  repoUrl?: string;
  mainBranch: string;
  defaultProject: string;
  /** Protects /api (dashboard). Unset + no developers = open dev mode. */
  adminToken?: string;
  /** How the OpenCode brain reaches this server, e.g. http://operator:7390 inside docker (Hermes has it in its own config). */
  internalUrl: string;
  /** Built dashboard (web/dist). */
  webDir: string;
  pollMs: number;
  tokens: Map<string, string>;
  authOpen: boolean;
  brainToken?: string;
  brain: {
    backend: "hermes" | "opencode" | "null";
    url: string;
    /** Hermes: API_SERVER_KEY of the gateway. */
    apiKey?: string;
    /** OpenCode: server password and agent. */
    password?: string;
    agent?: string;
    model?: string;
    concurrency: number;
    timeoutMs: number;
  };
  features: Partial<Record<string, FeatureMode>>;
  policy: Policy;
  docGlobs?: string[];
  askWaitMs: number;
  registrationWaitMs: number;
  tier2TimeoutMs: number;
  tier3TimeoutMs: number;
  l3DailyBudget: number;
}

interface FileConfig {
  features?: Record<string, FeatureMode>;
  policy?: Partial<Policy>;
  knowledge?: { doc_globs?: string[] };
  qa?: { ask_wait_s?: number; tier2_timeout_min?: number; tier3_timeout_h?: number };
  registration?: { wait_s?: number };
  l3?: { daily_budget?: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const file: FileConfig = env.GTV_CONFIG && existsSync(env.GTV_CONFIG) ? ((parseYaml(readFileSync(env.GTV_CONFIG, "utf8")) as FileConfig) ?? {}) : {};
  const tokens = new Map<string, string>();
  for (const pair of (env.GTV_TOKENS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [dev, token] = pair.split(":");
    if (dev && token) tokens.set(token, dev);
  }
  return {
    port: Number(env.GTV_PORT ?? 7390),
    host: env.GTV_HOST ?? "0.0.0.0",
    dataDir: env.GTV_DATA ?? ".gtv-data",
    repoUrl: env.GTV_REPO_URL || undefined,
    mainBranch: env.GTV_MAIN_BRANCH ?? "main",
    defaultProject: env.GTV_DEFAULT_PROJECT ?? "default",
    adminToken: env.GTV_ADMIN_TOKEN || undefined,
    internalUrl: env.GTV_INTERNAL_URL ?? `http://127.0.0.1:${env.GTV_PORT ?? 7390}`,
    webDir: env.GTV_WEB_DIR ?? "web/dist",
    pollMs: Number(env.GTV_POLL_MS ?? 30_000),
    tokens,
    authOpen: env.GTV_AUTH === "open",
    brainToken: env.GTV_BRAIN_TOKEN || undefined,
    brain: {
      backend: env.BRAIN_BACKEND === "hermes" || env.BRAIN_BACKEND === "opencode" ? env.BRAIN_BACKEND : "null",
      url: env.BRAIN_BACKEND === "opencode" ? (env.OPENCODE_URL ?? "http://127.0.0.1:4096") : (env.HERMES_URL ?? "http://127.0.0.1:8642"),
      apiKey: env.HERMES_API_KEY || undefined,
      password: env.OPENCODE_SERVER_PASSWORD || undefined,
      model: env.BRAIN_MODEL || undefined,
      agent: env.BRAIN_AGENT ?? "operator",
      concurrency: Number(env.BRAIN_CONCURRENCY ?? 2),
      timeoutMs: Number(env.BRAIN_TIMEOUT_MS ?? 180_000),
    },
    features: file.features ?? {},
    policy: { critical_paths: file.policy?.critical_paths ?? [], modules: file.policy?.modules ?? {} },
    docGlobs: file.knowledge?.doc_globs,
    askWaitMs: (file.qa?.ask_wait_s ?? 60) * 1000,
    registrationWaitMs: (file.registration?.wait_s ?? 30) * 1000,
    tier2TimeoutMs: (file.qa?.tier2_timeout_min ?? 15) * 60_000,
    tier3TimeoutMs: (file.qa?.tier3_timeout_h ?? 4) * 3_600_000,
    l3DailyBudget: file.l3?.daily_budget ?? 100,
  };
}
