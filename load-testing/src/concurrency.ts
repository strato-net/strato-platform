/**
 * Small primitives for running bounded concurrent / rate-limited work.
 */

/**
 * Run `total` tasks with bounded `concurrency`.
 * `task(i)` is invoked for each index 0..total-1.
 */
export async function runBoundedConcurrent<T>(
  total: number,
  concurrency: number,
  task: (i: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(total);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      results[i] = await task(i);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Throttle submissions so that exactly `total` tasks are dispatched over
 * `timeWindowMs`, with up to `concurrency` running in parallel.
 * Tasks that overrun the window will continue to run but new ones stop.
 */
export async function runRateLimited<T>(
  total: number,
  timeWindowMs: number,
  concurrency: number,
  task: (i: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(total);
  const targetSpacingMs = timeWindowMs / Math.max(total, 1);
  const startAt = Date.now();

  // Each slot tracks when it may launch its next task.
  const slotPromises: Promise<void>[] = [];
  let submitted = 0;
  let scheduled = 0;

  const scheduleNext = (): Promise<void> | null => {
    if (scheduled >= total) return null;
    const i = scheduled++;
    const targetStart = startAt + i * targetSpacingMs;
    const delay = Math.max(0, targetStart - Date.now());
    return new Promise<void>((resolve) => {
      setTimeout(async () => {
        submitted++;
        try {
          results[i] = await task(i);
        } catch (err) {
          // Store error info — caller should handle within task.
          results[i] = err as any;
        }
        resolve();
      }, delay);
    });
  };

  const worker = async (): Promise<void> => {
    while (scheduled < total) {
      const p = scheduleNext();
      if (!p) return;
      await p;
    }
  };

  for (let k = 0; k < Math.min(concurrency, total); k++) {
    slotPromises.push(worker());
  }
  await Promise.all(slotPromises);
  return results;
}

/**
 * Run `count` parallel workers for up to `durationMs`. Each worker repeatedly
 * invokes `task` until the duration elapses. Returns when all workers have
 * voluntarily stopped.
 */
export async function runForDuration(
  workerCount: number,
  durationMs: number,
  task: (userId: number, iteration: number) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + durationMs;

  const worker = async (userId: number): Promise<void> => {
    let iteration = 0;
    while (Date.now() < deadline) {
      await task(userId, iteration++);
    }
  };

  const workers = Array.from({ length: workerCount }, (_, i) => worker(i));
  await Promise.all(workers);
}