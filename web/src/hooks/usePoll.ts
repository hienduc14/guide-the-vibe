import { useCallback, useEffect, useRef, useState } from "react";

export interface Poll<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads `fn` now and every `intervalMs` while the tab is visible. `deps` restart the cycle.
 * Pass intervalMs = 0 to load once (reload() still works).
 */
export function usePoll<T>(fn: () => Promise<T>, deps: unknown[], intervalMs = 5000): Poll<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const value = await fnRef.current();
      if (mine === seq.current) {
        setData(value);
        setError(undefined);
      }
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setData(undefined);
    void reload();
    if (!intervalMs) return;
    const tick = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const timer = window.setInterval(tick, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload };
}
