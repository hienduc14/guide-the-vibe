import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = { text: string; error: boolean } | null;

const ToastContext = createContext<(text: string, error?: boolean) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<number>(undefined);
  const show = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), error ? 6000 : 2500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast${toast.error ? " error" : ""}`} role="status">
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Run an async action and report success/failure as a toast. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const res = await fn();
        if (success) toast(success);
        return res;
      } catch (e) {
        toast((e as Error).message, true);
        return undefined;
      }
    },
    [toast],
  );
}
