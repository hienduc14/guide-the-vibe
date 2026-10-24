import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export function shortHash(text: string, len = 12): string {
  return sha1(text).slice(0, len);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Normalize to forward slashes, no leading "./". */
export function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Minimal glob matcher supporting **, * and ?. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  const g = normPath(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        i++;
        if (g[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

export function globMatch(glob: string, path: string): boolean {
  const g = normPath(glob);
  const p = normPath(path);
  // A bare directory ("src/auth" or "src/auth/") covers everything below it.
  if (!/[*?]/.test(g)) return p === g.replace(/\/$/, "") || p.startsWith(g.replace(/\/$/, "") + "/");
  return globToRegExp(g).test(p);
}

/** Do two path patterns (glob or plain path) possibly cover a common file? Conservative. */
export function patternsOverlap(a: string, b: string): boolean {
  const pa = normPath(a);
  const pb = normPath(b);
  const literalA = !/[*?]/.test(pa);
  const literalB = !/[*?]/.test(pb);
  if (literalA && literalB) return globMatch(pa, pb) || globMatch(pb, pa);
  if (literalA) return globMatch(pb, pa);
  if (literalB) return globMatch(pa, pb);
  // Both globs. With static prefixes on both sides compare the prefixes; otherwise (e.g. "**/migrations/**")
  // test a concrete example path of each glob against the other. Misses some exotic overlaps, never invents one.
  const prefix = (s: string) => s.slice(0, s.search(/[*?]/));
  const xa = prefix(pa);
  const xb = prefix(pb);
  if (xa && xb) return xa.startsWith(xb) || xb.startsWith(xa);
  const sample = (g: string) => g.replace(/\*\*/g, "x").replace(/\*/g, "x").replace(/\?/g, "x");
  return globMatch(pa, sample(pb)) || globMatch(pb, sample(pa));
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined;
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export async function git(cwd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string; allowFail?: boolean } = {}): Promise<RunResult> {
  const res = await run("git", args, { cwd, env: opts.env ? { ...process.env, ...opts.env } : undefined, input: opts.input });
  if (res.code !== 0 && !opts.allowFail) {
    throw new Error(`git ${args.join(" ")} failed (${res.code}): ${res.stderr.trim()}`);
  }
  return res;
}

export function log(scope: string, ...args: unknown[]): void {
  if (process.env.GTV_QUIET) return;
  console.error(`[${new Date().toISOString().slice(11, 19)}] [${scope}]`, ...args);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + `… (${text.length - max} more chars)`;
}
