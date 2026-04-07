import { TxMetric, BatchMetric } from "../types";

export class MetricsCollector {
  private txMetrics: TxMetric[] = [];
  private batchMetrics: BatchMetric[] = [];

  recordTx(metric: TxMetric): void {
    this.txMetrics.push(metric);
  }

  recordBatch(metric: BatchMetric): void {
    this.batchMetrics.push(metric);
  }

  getTxMetrics(filter?: { scenario?: string; nodeName?: string }): TxMetric[] {
    let results = this.txMetrics;
    if (filter?.scenario) {
      results = results.filter((m) => m.scenario === filter.scenario);
    }
    if (filter?.nodeName) {
      results = results.filter((m) => m.nodeName === filter.nodeName);
    }
    return results;
  }

  getBatchMetrics(filter?: { scenario?: string; nodeName?: string }): BatchMetric[] {
    let results = this.batchMetrics;
    if (filter?.scenario) {
      results = results.filter((m) => m.scenario === filter.scenario);
    }
    if (filter?.nodeName) {
      results = results.filter((m) => m.nodeName === filter.nodeName);
    }
    return results;
  }

  getErrors(): Array<{ txHash: string; nodeName: string; scenario: string; error: string }> {
    return this.txMetrics
      .filter((m) => m.status === "failed" && m.error)
      .map((m) => ({
        txHash: m.txHash,
        nodeName: m.nodeName,
        scenario: m.scenario,
        error: m.error!,
      }));
  }

  getAllTxMetrics(): TxMetric[] {
    return [...this.txMetrics];
  }

  getAllBatchMetrics(): BatchMetric[] {
    return [...this.batchMetrics];
  }
}
