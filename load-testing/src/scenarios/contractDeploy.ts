import { BaseScenario } from "./base";
import { NodeClients } from "../api/client";
import { buildContractDeployBatch } from "../tx/builders";
import { ScenarioResult, TxMetric, BatchMetric } from "../types";

export class ContractDeployScenario extends BaseScenario {
  name(): string {
    return "contractDeploy";
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.contractDeploy;

    console.log(
      `[contractDeploy] Starting: ${cfg.batchCount} batches x ${cfg.batchSize} deploys on ${clients.nodeName} (${cfg.submitMode} mode)`,
    );

    // Build all batches upfront
    const builtTxs = Array.from({ length: cfg.batchCount }, () =>
      buildContractDeployBatch(
        cfg.contractSource,
        cfg.contractName,
        cfg.contractArgs,
        cfg.batchSize,
        this.config.gas,
      ),
    );

    let allTxMetrics: TxMetric[];
    let allBatchMetrics: BatchMetric[];

    if (cfg.submitMode === "pipeline") {
      const result = await this.submitAllThenTrack(clients, builtTxs, cfg.batchDelay);
      allTxMetrics = result.txMetrics;
      allBatchMetrics = result.batchMetrics;
    } else {
      allTxMetrics = [];
      allBatchMetrics = [];
      for (let i = 0; i < builtTxs.length; i++) {
        const { txMetrics, batchMetric } = await this.submitAndTrack(clients, builtTxs[i], i);
        allTxMetrics.push(...txMetrics);
        allBatchMetrics.push(batchMetric);
        if (cfg.batchDelay > 0 && i < builtTxs.length - 1) {
          await new Promise((r) => setTimeout(r, cfg.batchDelay));
        }
      }
    }

    console.log(
      `[contractDeploy] Completed on ${clients.nodeName}: ${allTxMetrics.filter((m) => m.status === "confirmed").length}/${allTxMetrics.length} succeeded`,
    );

    return {
      scenario: this.name(),
      nodeName: clients.nodeName,
      transactions: allTxMetrics,
      batches: allBatchMetrics,
    };
  }
}
