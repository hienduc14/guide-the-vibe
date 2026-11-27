// Thin fetch wrapper. A logged-in person's session is an httpOnly cookie the browser sends by itself (the page never
// sees it); a 401 tells the app to show the login screen. A share link's token lives in sessionStorage and is sent as
// a Bearer while it is set, so opening a link does not log anyone out in other tabs.

const SHARE_KEY = "gtv.shareToken";

export function getShareToken(): string | null {
  try {
    return sessionStorage.getItem(SHARE_KEY);
  } catch {
    return null;
  }
}

export function setShareToken(code: string | null): void {
  try {
    if (code) sessionStorage.setItem(SHARE_KEY, code);
    else sessionStorage.removeItem(SHARE_KEY);
  } catch {
    // storage unavailable: the link works for this page only
  }
  shareToken = code;
}

let shareToken: string | null = getShareToken();

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const UNAUTHORIZED_EVENT = "gtv:unauthorized";

export interface RequestOptions {
  /** Acting developer for project calls (X-Gtv-Dev). Defaults to the logged-in user. */
  as?: string;
}

export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.as) headers["x-gtv-dev"] = opts.as;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (shareToken) headers.authorization = `Bearer ${shareToken}`;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const msg = (json as { error?: string } | undefined)?.error ?? `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg);
  }
  if (json && typeof json === "object" && "error" in json && Object.keys(json).length === 1) {
    throw new ApiError(404, String((json as { error: unknown }).error));
  }
  return json as T;
}

export const get = <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts);
export const post = <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, body ?? {}, opts);
export const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
export const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
export const del = <T>(path: string) => request<T>("DELETE", path);
