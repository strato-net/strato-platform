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
    const allTxMetrics: TxMetric[] = [];
    const allBatchMetrics: BatchMetric[] = [];

    console.log(
      `[contractDeploy] Starting: ${cfg.batchCount} batches x ${cfg.batchSize} deploys on ${clients.nodeName}`,
    );

    for (let i = 0; i < cfg.batchCount; i++) {
      const builtTx = buildContractDeployBatch(
        cfg.contractSource,
        cfg.contractName,
        cfg.contractArgs,
        cfg.batchSize,
        this.config.gas,
      );

      const { txMetrics, batchMetric } = await this.submitAndTrack(
        clients,
        builtTx,
        i,
      );

      allTxMetrics.push(...txMetrics);
      allBatchMetrics.push(batchMetric);

      if (cfg.batchDelay > 0 && i < cfg.batchCount - 1) {
        await new Promise((r) => setTimeout(r, cfg.batchDelay));
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
