import { NodeClients } from "../api/client";
import { submitBatch } from "../tx/submitter";
import { pollForResults } from "../tx/poller";
import { MetricsCollector } from "../metrics/collector";
import {
  BuiltTx,
  LoadTestConfig,
  TxMetric,
  BatchMetric,
  ScenarioResult,
} from "../types";

export abstract class BaseScenario {
  protected config: LoadTestConfig;
  protected collector: MetricsCollector;
  protected verbose: boolean;

  constructor(config: LoadTestConfig, collector: MetricsCollector, verbose: boolean = false) {
    this.config = config;
    this.collector = collector;
    this.verbose = verbose;
  }

  abstract name(): string;
  abstract run(clients: NodeClients): Promise<ScenarioResult>;

  protected log(msg: string): void {
    if (this.verbose) {
      console.log(`  [${this.name()}] ${msg}`);
    }
  }

  protected async submitAndTrack(
    clients: NodeClients,
    builtTx: BuiltTx,
    batchIndex: number,
  ): Promise<{ txMetrics: TxMetric[]; batchMetric: BatchMetric }> {
    const scenario = this.name();
    const nodeName = clients.nodeName;
    const txCount = builtTx.txs.length;

    // Submit batch
    const submitStart = Date.now();
    const submitResponses = await submitBatch(clients.strato, builtTx, false);
    const submitEnd = Date.now();
    const submitDuration = submitEnd - submitStart;

    this.log(
      `Batch ${batchIndex}: submitted ${txCount} txs in ${submitDuration}ms`,
    );

    const hashes = submitResponses.map((r) => r.hash);

    // Record initial tx metrics (submitted state)
    const txMetrics: TxMetric[] = submitResponses.map((r) => ({
      txHash: r.hash,
      nodeName,
      scenario,
      batchIndex,
      submitTime: submitStart,
      submitDuration,
      status: "submitted" as const,
    }));

    // Poll for results
    const pollStart = Date.now();
    const results = await pollForResults(clients.bloc, hashes, this.config.polling);
    const pollEnd = Date.now();
    const confirmDuration = pollEnd - pollStart;

    this.log(
      `Batch ${batchIndex}: confirmed in ${confirmDuration}ms`,
    );

    // Update tx metrics with confirmation data
    let successCount = 0;
    let failureCount = 0;
    let timeoutCount = 0;

    for (const [i, result] of results.entries()) {
      const metric = txMetrics[i];
      metric.confirmTime = pollEnd;
      metric.confirmDuration = confirmDuration;
      metric.totalDuration = pollEnd - submitStart;

      if (result.status === "Success") {
        metric.status = "confirmed";
        successCount++;
      } else if (result.status === "Failure") {
        metric.status = "failed";
        metric.error =
          result.txResult?.message || result.error || result.message || "Transaction failed";
        failureCount++;
      } else {
        // Still pending = timeout
        metric.status = "timeout";
        metric.error = "Polling timeout";
        timeoutCount++;
      }

      this.collector.recordTx(metric);
    }

    const batchMetric: BatchMetric = {
      batchIndex,
      nodeName,
      scenario,
      txCount,
      submitStart,
      submitEnd,
      submitDuration,
      confirmEnd: pollEnd,
      confirmDuration,
      totalDuration: pollEnd - submitStart,
      successCount,
      failureCount,
      timeoutCount,
    };
    this.collector.recordBatch(batchMetric);

    return { txMetrics, batchMetric };
  }
}
