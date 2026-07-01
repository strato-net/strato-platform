import { useEffect, useState } from "react";

/**
 * Like useState, but persisted to localStorage under `key` so the value survives
 * unmounts (tab switches) and page reloads. Falls back to `initial` when nothing is
 * stored or storage is unavailable.
 */
export function usePersistentState<T>(
  key: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore (quota exceeded / storage disabled)
    }
  }, [key, state]);

  return [state, setState];
}
