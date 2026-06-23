import { useCallback, useEffect, useRef, useState } from "react";

/** Light/dark theme toggle, persisted to localStorage + the `dark` root class. */
export function useTheme(): ["light" | "dark", () => void] {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("strato-theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

/** Copy-to-clipboard with a transient "copied" flag. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    });
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [copied, copy];
}

/** Tiny hash-based router: returns the current route after "#/". */
export function useHashRoute(): [string, (to: string) => void] {
  const get = () => window.location.hash.replace(/^#\/?/, "") || "";
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const onChange = () => setRoute(get());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((to: string) => {
    window.location.hash = `#/${to.replace(/^\/?/, "")}`;
  }, []);
  return [route, navigate];
}

/** Generic async loader with manual refresh. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    setLoading(true);
    fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { data, error, loading, refresh: run };
}
