// Repo addresses a project may use. Anyone can create a project and the server then clones its repo, so people may
// give only https:// and git@host:path addresses: no local paths, file://, ext:: or other transports, and no host
// that resolves to this machine or a private network. Server admins may also use local paths (demos, sandboxes).

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { run } from "../../shared/util.ts";

const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv6");

const FORMS = "use an https:// address or git@host:owner/repo";

/** The host of an allowed repo address; throws for any other form. */
export function repoHost(url: string): string {
  if (!url || /\s/.test(url) || url.startsWith("-")) throw new Error(`repo address: ${FORMS}`);
  const ssh = /^git@([a-z0-9][a-z0-9.-]*):(?![/-])[\w.~/-]+$/i.exec(url);
  if (ssh) return ssh[1];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`repo address: ${FORMS}`);
  }
  if (u.protocol !== "https:" || !u.hostname) throw new Error(`repo address: ${FORMS}`);
  return u.hostname.replace(/^\[|\]$/g, "");
}

/** Refuses addresses outside the allowed forms or whose host is this machine or a private network (after DNS). */
export async function checkRepoAddress(url: string): Promise<void> {
  const host = repoHost(url);
  const addrs = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true }).catch(() => {
        throw new Error(`repo address: cannot find the host ${host}`);
      });
  if (addrs.some((a) => PRIVATE.check(a.address, a.family === 6 ? "ipv6" : "ipv4")))
    throw new Error(`repo address: ${host} is this server or a private network, which projects cannot use`);
}

/** Reads the repo's refs (15 s at most, never asking for a password) and its default branch. */
export async function lsRemote(url: string, opts: { local?: boolean } = {}): Promise<{ default_branch: string | null }> {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10",
    // Redirects or submodule-style tricks cannot switch to another transport.
    GIT_ALLOW_PROTOCOL: opts.local ? "https:ssh:file" : "https:ssh",
  };
  const r = await run("git", ["ls-remote", "--symref", "--", url, "HEAD"], { env, timeoutMs: 15_000 }).catch(() => ({ code: -1, stdout: "" }));
  if (r.code !== 0) throw new Error("cannot read this repo: if it is private, paste an https URL with a read-only token");
  return { default_branch: /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(r.stdout)?.[1] ?? null };
}
