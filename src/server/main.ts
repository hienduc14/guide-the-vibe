// Operator server entry point: config → hub (projects, shared brain) → HTTP.

import { serve } from "@hono/node-server";
import { loadConfig, type ServerConfig } from "./config.ts";
import { Hub } from "./hub/hub.ts";
import { buildApp } from "./http/app.ts";
import { NullBrain } from "./brain/types.ts";
import { PiBrain } from "./brain/pi.ts";
import type { ProjectScopedBackend } from "./brain/metered.ts";
import { log } from "../shared/util.ts";

export interface Running {
  app: ReturnType<typeof buildApp>;
  hub: Hub;
  port: number;
  close(): Promise<void>;
}

export function createBrain(cfg: ServerConfig): ProjectScopedBackend {
  return cfg.brain.backend === "pi" ? new PiBrain(cfg.brain) : new NullBrain();
}

export async function startServer(cfg: ServerConfig, opts: { brain?: ProjectScopedBackend; listen?: boolean } = {}): Promise<Running> {
  const hub = new Hub(cfg, opts.brain ?? createBrain(cfg));
  await hub.init();
  const app = buildApp(hub);
  let port = cfg.port;
  let server: ReturnType<typeof serve> | undefined;
  if (opts.listen !== false) {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: cfg.port, hostname: cfg.host }, (info) => {
        port = info.port;
        resolve();
      });
    });
    log(
      "server",
      `gtv operator on ${cfg.host}:${port} — ${hub.records().length} project(s), brain=${hub.brain.name}${hub.brain.model ? ` (${hub.brain.model})` : ""}`,
    );
    if (!cfg.adminToken) log("server", "WARNING: GTV_ADMIN_TOKEN is not set — the dashboard (/api) is open to anyone who can reach this port");
  }
  return {
    app,
    hub,
    port,
    async close() {
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      await hub.close();
    },
  };
}

if (import.meta.main) {
  const running = await startServer(loadConfig());
  const stop = async () => {
    await running.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
