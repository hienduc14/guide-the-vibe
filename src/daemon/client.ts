// HTTP + SSE client from the daemon to the Operator server.

import type { DaemonConfig } from "./config.ts";
import { log } from "../shared/util.ts";

export class ServerClient {
  readonly cfg: DaemonConfig;

  constructor(cfg: DaemonConfig) {
    this.cfg = cfg;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json", "x-gtv-dev": this.cfg.dev };
    if (this.cfg.token) h.authorization = `Bearer ${this.cfg.token}`;
    return h;
  }

  async call<T = any>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.cfg.server + path, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : undefined;
      if (!res.ok) throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
      return json as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Long-lived SSE subscription with reconnects. Returns a stop function. */
  subscribe(path: string, onEvent: (event: string, data: string) => void, onStatus: (connected: boolean) => void): () => void {
    let stopped = false;
    let ctrl: AbortController | undefined;
    const loop = async () => {
      let delay = 1000;
      while (!stopped) {
        ctrl = new AbortController();
        try {
          const res = await fetch(this.cfg.server + path, { headers: this.headers(), signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          onStatus(true);
          delay = 1000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = "";
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let idx: number;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              let event = "message";
              const data: string[] = [];
              for (const line of block.split("\n")) {
                if (line.startsWith("event:")) event = line.slice(6).trim();
                else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
              }
              if (data.length) onEvent(event, data.join("\n"));
            }
          }
        } catch (e) {
          if (!stopped) log("daemon", `server stream error: ${(e as Error).message}`);
        }
        onStatus(false);
        if (stopped) break;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    };
    void loop();
    return () => {
      stopped = true;
      ctrl?.abort();
    };
  }
}
