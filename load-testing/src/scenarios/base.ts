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
  TxSubmitResponse,
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

  /**
   * Pipeline mode: submit all batches back-to-back without waiting for
   * confirmation, then poll for all results. This fills the mempool and
   * reveals how confirmation latency grows with mempool depth.
   */
  protected async submitAllThenTrack(
    clients: NodeClients,
    builtTxs: BuiltTx[],
    batchDelay: number = 0,
  ): Promise<{ txMetrics: TxMetric[]; batchMetrics: BatchMetric[] }> {
    const scenario = this.name();
    const nodeName = clients.nodeName;

    // Phase 1: Submit all batches, collecting hashes and timing
    interface SubmittedBatch {
      batchIndex: number;
      txCount: number;
      submitStart: number;
      submitEnd: number;
      submitDuration: number;
      responses: TxSubmitResponse[];
    }

    const submitted: SubmittedBatch[] = [];

    console.log(`[${scenario}] Pipeline mode: submitting ${builtTxs.length} batches...`);

    for (let i = 0; i < builtTxs.length; i++) {
      const builtTx = builtTxs[i];
      const txCount = builtTx.txs.length;

      const submitStart = Date.now();
      const responses = await submitBatch(clients.strato, builtTx, false);
      const submitEnd = Date.now();
      const submitDuration = submitEnd - submitStart;

      submitted.push({ batchIndex: i, txCount, submitStart, submitEnd, submitDuration, responses });

      this.log(`Batch ${i}: submitted ${txCount} txs in ${submitDuration}ms`);

      if (batchDelay > 0 && i < builtTxs.length - 1) {
        await new Promise((r) => setTimeout(r, batchDelay));
      }
    }

    const totalSubmitted = submitted.reduce((sum, b) => sum + b.txCount, 0);
    console.log(`[${scenario}] All ${totalSubmitted} txs submitted. Polling for results...`);

    // Phase 2: Poll for all hashes at once
    const allHashes = submitted.flatMap((b) => b.responses.map((r) => r.hash));
    const pollStart = Date.now();
    const allResults = await pollForResults(clients.bloc, allHashes, this.config.polling);
    const pollEnd = Date.now();

    console.log(`[${scenario}] All results received in ${pollEnd - pollStart}ms`);

    // Phase 3: Map results back to batches and build metrics
    const txMetrics: TxMetric[] = [];
    const batchMetrics: BatchMetric[] = [];
    let resultOffset = 0;

    for (const batch of submitted) {
      const batchResults = allResults.slice(resultOffset, resultOffset + batch.txCount);
      resultOffset += batch.txCount;

      let successCount = 0;
      let failureCount = 0;
      let timeoutCount = 0;

      for (const [i, result] of batchResults.entries()) {
        const hash = batch.responses[i].hash;
        const confirmDuration = pollEnd - batch.submitStart;

        const metric: TxMetric = {
          txHash: hash,
          nodeName,
          scenario,
          batchIndex: batch.batchIndex,
          submitTime: batch.submitStart,
          submitDuration: batch.submitDuration,
          confirmTime: pollEnd,
          confirmDuration: pollEnd - batch.submitEnd,
          totalDuration: confirmDuration,
          status: "submitted",
        };

        if (result.status === "Success") {
          metric.status = "confirmed";
          successCount++;
        } else if (result.status === "Failure") {
          metric.status = "failed";
          metric.error = result.txResult?.message || result.error || result.message || "Transaction failed";
          failureCount++;
        } else {
          metric.status = "timeout";
          metric.error = "Polling timeout";
          timeoutCount++;
        }

        this.collector.recordTx(metric);
        txMetrics.push(metric);
      }

      const batchMetric: BatchMetric = {
        batchIndex: batch.batchIndex,
        nodeName,
        scenario,
        txCount: batch.txCount,
        submitStart: batch.submitStart,
        submitEnd: batch.submitEnd,
        submitDuration: batch.submitDuration,
        confirmEnd: pollEnd,
        confirmDuration: pollEnd - batch.submitEnd,
        totalDuration: pollEnd - batch.submitStart,
        successCount,
        failureCount,
        timeoutCount,
      };
      this.collector.recordBatch(batchMetric);
      batchMetrics.push(batchMetric);

      this.log(
        `Batch ${batch.batchIndex}: ${successCount} confirmed, ${failureCount} failed, ${timeoutCount} timeout (total ${pollEnd - batch.submitStart}ms)`,
      );
    }

    return { txMetrics, batchMetrics };
  }
}
