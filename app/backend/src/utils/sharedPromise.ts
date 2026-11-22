import { AsyncLocalStorage } from "async_hooks";

// Set while a shared load, or other work whose result must not rest on a failed read (the
// net balance), runs. A node call that fails inside it marks the work, also when the code
// that made the call catches the error and carries on with a default.
export const nodeCallWatch = new AsyncLocalStorage<{ failedCall?: string }>();

// Marks watched work with a node call that failed. A 4xx answer other than 429 is the node's
// answer, not a failure: it would be the same next time. An error that is not a node call's
// (no request config) is not marked.
export const markFailedNodeCall = (watch: { failedCall?: string } | undefined, error: any) => {
  const status = error?.response?.status;
  if (watch && error?.config && (!status || status >= 500 || status === 429)) {
    watch.failedCall ??= `${error.config.url} ${status ?? error.code}`;
  }
};

const WARN_INTERVAL_MS = 60 * 1000;

/**
 * Promise cache for state that is the same for every caller. Concurrent callers share one
 * load, and its result is served for `ttlMs` after it arrived. A load that rejects, or
 * during which a node call failed, still answers the callers waiting for it but is not
 * kept, so the next caller loads again. Callers stop joining a load that has run for
 * `maxLoadMs` and start a new one, so a stuck load does not hold them once the node has
 * recovered; the earlier load's result is still kept when it arrives, unless a later
 * load's result was kept first. Only the node calls a load makes itself are seen: a fetch
 * it joins from another request (one deduplicated elsewhere) is not. A watched caller (a
 * net balance request, or a load that calls another shared cache) is marked with a failed
 * call of the load it is answered from.
 */
export const createSharedPromiseCache = (ttlMs: number, maxLoadMs: number) => {
  type Entry = { expiresAt: number; state: Promise<unknown>; context: { failedCall?: string } };
  const entries = new Map<string, Entry>();
  const keptFrom = new Map<string, number>();
  const warnedAt = new Map<string, number>();
  let loads = 0;

  return <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const watcher = nodeCallWatch.getStore();
    const join = (entry: Entry) => {
      if (watcher) entry.state.then(() => { watcher.failedCall ??= entry.context.failedCall; }, () => {});
      return entry.state as Promise<T>;
    };
    const startedAt = Date.now();
    const cached = entries.get(key);
    if (cached && startedAt < cached.expiresAt) return join(cached);
    const order = ++loads;

    const context: { failedCall?: string } = {};
    const state = nodeCallWatch.run(context, async () => load());
    const entry = { expiresAt: startedAt + maxLoadMs, state, context };
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
    return join(entry);
  };
};
