import {
  TxMetric,
  BatchMetric,
  PercentileStats,
  ScenarioStats,
  TimelineBucket,
} from "../types";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computePercentiles(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: Math.round(sum / sorted.length),
  };
}

export function computeScenarioStats(
  txMetrics: TxMetric[],
  batchMetrics: BatchMetric[],
  scenario: string,
  nodeName: string,
): ScenarioStats {
  const txs = txMetrics.filter((m) => m.scenario === scenario && m.nodeName === nodeName);
  const successTxs = txs.filter((m) => m.status === "confirmed");
  const failedTxs = txs.filter((m) => m.status === "failed");
  const timeoutTxs = txs.filter((m) => m.status === "timeout");

  const submitLatencies = txs.map((m) => m.submitDuration);
  const confirmLatencies = successTxs
    .filter((m) => m.confirmDuration !== undefined)
    .map((m) => m.confirmDuration!);
  const totalLatencies = successTxs
    .filter((m) => m.totalDuration !== undefined)
    .map((m) => m.totalDuration!);

  const startTime = txs.length > 0 ? Math.min(...txs.map((m) => m.submitTime)) : 0;
  const endTime = txs.length > 0
    ? Math.max(...txs.map((m) => m.confirmTime ?? m.submitTime + m.submitDuration))
    : 0;
  const wallClockDuration = endTime - startTime;

  const submitTps =
    wallClockDuration > 0 ? (txs.length / wallClockDuration) * 1000 : 0;
  const confirmedTps =
    wallClockDuration > 0 ? (successTxs.length / wallClockDuration) * 1000 : 0;

  return {
    scenario,
    nodeName,
    totalTxCount: txs.length,
    successCount: successTxs.length,
    failureCount: failedTxs.length,
    timeoutCount: timeoutTxs.length,
    errorRate: txs.length > 0 ? (failedTxs.length + timeoutTxs.length) / txs.length : 0,
    submitLatency: computePercentiles(submitLatencies),
    confirmLatency: computePercentiles(confirmLatencies),
    totalLatency: computePercentiles(totalLatencies),
    submitTps: Math.round(submitTps * 100) / 100,
    confirmedTps: Math.round(confirmedTps * 100) / 100,
    startTime,
    endTime,
    wallClockDuration,
  };
}

export function computeTimeline(
  txMetrics: TxMetric[],
  bucketSizeMs: number = 1000,
): TimelineBucket[] {
  if (txMetrics.length === 0) return [];

  const startTime = Math.min(...txMetrics.map((m) => m.submitTime));
  const endTime = Math.max(
    ...txMetrics.map((m) => m.confirmTime ?? m.submitTime + m.submitDuration),
  );

  const bucketCount = Math.ceil((endTime - startTime) / bucketSizeMs) + 1;
  const buckets: TimelineBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    timestamp: startTime + i * bucketSizeMs,
    submitted: 0,
    confirmed: 0,
    failed: 0,
  }));

  for (const tx of txMetrics) {
    const submitBucket = Math.floor((tx.submitTime - startTime) / bucketSizeMs);
    if (submitBucket >= 0 && submitBucket < buckets.length) {
      buckets[submitBucket].submitted++;
    }

    if (tx.confirmTime) {
      const confirmBucket = Math.floor((tx.confirmTime - startTime) / bucketSizeMs);
      if (confirmBucket >= 0 && confirmBucket < buckets.length) {
        if (tx.status === "confirmed") {
          buckets[confirmBucket].confirmed++;
        } else if (tx.status === "failed") {
          buckets[confirmBucket].failed++;
        }
      }
    }
  }

  return buckets;
}
