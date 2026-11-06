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
  /** Built dashboard (web/dist). */
  webDir: string;
  pollMs: number;
  tokens: Map<string, string>;
  authOpen: boolean;
  brain: {
    backend: "pi" | "null";
    /** "provider/model"; "custom/<id>" (or a bare id) uses baseUrl. */
    model?: string;
    /** OpenAI-compatible endpoint for "custom" models, e.g. http://127.0.0.1:8317/v1. */
    baseUrl?: string;
    apiKey?: string;
    api?: "openai-completions" | "anthropic-messages";
    /** GTV_SECRET_KEY: encrypts LLM keys entered on the dashboard. */
    secretKey?: string;
    /** BRAIN_THINKING: off | low | medium | high (dashboard overrides). */
    thinking?: "off" | "low" | "medium" | "high";
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
    webDir: env.GTV_WEB_DIR ?? "web/dist",
    pollMs: Number(env.GTV_POLL_MS ?? 30_000),
    tokens,
    authOpen: env.GTV_AUTH === "open",
    brain: {
      backend: env.BRAIN_BACKEND === "pi" ? "pi" : "null",
      model: env.BRAIN_MODEL || undefined,
      baseUrl: env.BRAIN_BASE_URL || undefined,
      apiKey: env.BRAIN_API_KEY || undefined,
      api: env.BRAIN_API === "anthropic-messages" ? "anthropic-messages" : "openai-completions",
      secretKey: env.GTV_SECRET_KEY || undefined,
      thinking: (["off", "low", "medium", "high"] as const).find((l) => l === env.BRAIN_THINKING),
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
