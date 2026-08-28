type DepositLatencyStage =
  | "detection"
  | "verification"
  | "stratoSubmission"
  | "completion";

interface LatencyMetric {
  count: number;
  totalMs: number;
  maxMs: number;
}

const metrics: Record<DepositLatencyStage, LatencyMetric> = {
  detection: { count: 0, totalMs: 0, maxMs: 0 },
  verification: { count: 0, totalMs: 0, maxMs: 0 },
  stratoSubmission: { count: 0, totalMs: 0, maxMs: 0 },
  completion: { count: 0, totalMs: 0, maxMs: 0 },
};

export const depositMetricsService = {
  observe(stage: DepositLatencyStage, durationMs: number): void {
    const value = Math.max(0, durationMs);
    const metric = metrics[stage];
    metric.count += 1;
    metric.totalMs += value;
    metric.maxMs = Math.max(metric.maxMs, value);
  },

  snapshot() {
    return Object.fromEntries(
      Object.entries(metrics).map(([stage, metric]) => [
        stage,
        {
          ...metric,
          averageMs: metric.count ? metric.totalMs / metric.count : 0,
        },
      ]),
    );
  },
};
