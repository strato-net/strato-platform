import { AsyncLocalStorage } from "async_hooks";

// Set while a shared load runs. A node call that fails inside it marks the load, also when
// the code that made the call catches the error and carries on with a default.
export const sharedLoadContext = new AsyncLocalStorage<{ failedCall?: string }>();

const WARN_INTERVAL_MS = 60 * 1000;

/**
 * Promise cache for state that is the same for every caller. Concurrent callers share one
 * load, and its result is served for `ttlMs` after it arrived. A load that rejects, or
 * during which a node call failed, still answers the callers waiting for it but is not
 * kept, so the next caller loads again. Callers stop joining a load that has run for
 * `maxLoadMs` and start a new one, so a stuck load does not hold them once the node has
 * recovered; the earlier load's result is still kept when it arrives, unless a later
 * load's result was kept first. Only the node calls a load makes itself are seen: a fetch
 * it joins from another request (one deduplicated elsewhere) is not. A load must not call
 * another shared cache: the inner load's failures would not reach the outer one.
 */
export const createSharedPromiseCache = (ttlMs: number, maxLoadMs: number) => {
  const entries = new Map<string, { expiresAt: number; state: Promise<unknown> }>();
  const keptFrom = new Map<string, number>();
  const warnedAt = new Map<string, number>();
  let loads = 0;

  return <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    const cached = entries.get(key);
    if (cached && startedAt < cached.expiresAt) return cached.state as Promise<T>;
    const order = ++loads;

    const context: { failedCall?: string } = {};
    const state = sharedLoadContext.run(context, async () => load());
    const entry = { expiresAt: startedAt + maxLoadMs, state };
    entries.set(key, entry);
    // A dropped load is worth a line: if one fails every time, the state is never shared.
    const drop = (reason: string) => {
      if (entries.get(key) === entry) entries.delete(key);
      if (Date.now() - (warnedAt.get(key) ?? 0) >= WARN_INTERVAL_MS) {
        warnedAt.set(key, Date.now());
        console.warn(`Shared state ${key} not cached: ${reason}`);
      }
    };
    const failure = (error?: unknown) =>
      context.failedCall
        ? `node call failed: ${context.failedCall}`
        : `load failed: ${error instanceof Error ? error.message : String(error)}`;
    state.then(
      () => {
        if (context.failedCall) return drop(failure());
        // Loads overlap after maxLoadMs: a result does not replace one from a later load.
        if (order < (keptFrom.get(key) ?? 0)) return;
        keptFrom.set(key, order);
        entry.expiresAt = Date.now() + ttlMs;
        entries.set(key, entry);
      },
      (error) => drop(failure(error))
    );
    return state;
  };
};
