import { BaseScenario } from "./base";
import { NodeClients } from "../api/client";
import { buildContractDeployBatch, buildFunctionCallBatch } from "../tx/builders";
import { submitBatch } from "../tx/submitter";
import { pollForResults } from "../tx/poller";
import { ScenarioResult, TxMetric, BatchMetric } from "../types";

export class MixedWorkloadScenario extends BaseScenario {
  name(): string {
    return "mixedWorkload";
  }

  private async deploySetupContract(clients: NodeClients): Promise<string> {
    const deployConfig = this.config.scenarios.functionCall;

    console.log(`[mixedWorkload] Deploying setup contract for function calls on ${clients.nodeName}...`);

    const builtTx = buildContractDeployBatch(
      deployConfig.setupContract,
      deployConfig.contractName,
      {},
      1,
      this.config.gas,
    );

    const responses = await submitBatch(clients.strato, builtTx, true);
    const response = responses[0];

    if (response.status === "Success") {
      const address = response.txResult?.contractsCreated || response.hash;
      console.log(`[mixedWorkload] Setup contract deployed: ${address}`);
      return address;
    }

    const results = await pollForResults(
      clients.bloc,
      [response.hash],
      this.config.polling,
    );
    const result = results[0];

    if (result.status !== "Success") {
      throw new Error(
        `Setup contract deployment failed: ${result.txResult?.message || result.error || "Unknown error"}`,
      );
    }

    const address = result.txResult?.contractsCreated || result.hash;
    console.log(`[mixedWorkload] Setup contract deployed: ${address}`);
    return address;
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.mixedWorkload;
    const deployCfg = this.config.scenarios.contractDeploy;
    const callCfg = this.config.scenarios.functionCall;
    const allTxMetrics: TxMetric[] = [];
    const allBatchMetrics: BatchMetric[] = [];

    // Deploy a contract for function calls
    const contractAddress = await this.deploySetupContract(clients);

    const totalBatches = Math.ceil(cfg.totalTxCount / cfg.batchSize);
    console.log(
      `[mixedWorkload] Starting: ${totalBatches} batches, ${Math.round(cfg.deployRatio * 100)}% deploys on ${clients.nodeName}`,
    );

    let txSent = 0;
    let batchIndex = 0;

    while (txSent < cfg.totalTxCount) {
      const remaining = cfg.totalTxCount - txSent;
      const batchSize = Math.min(cfg.batchSize, remaining);
      const deployCount = Math.round(batchSize * cfg.deployRatio);
      const callCount = batchSize - deployCount;

      // Submit deploy batch if any
      if (deployCount > 0) {
        const deployBatch = buildContractDeployBatch(
          deployCfg.contractSource,
          deployCfg.contractName,
          deployCfg.contractArgs,
          deployCount,
          this.config.gas,
        );

        const { txMetrics, batchMetric } = await this.submitAndTrack(
          clients,
          deployBatch,
          batchIndex,
        );
        allTxMetrics.push(...txMetrics);
        allBatchMetrics.push(batchMetric);
      }

      // Submit call batch if any
      if (callCount > 0) {
        const callBatch = buildFunctionCallBatch(
          callCfg.contractName,
          contractAddress,
          callCfg.method,
          callCfg.args,
          callCount,
          this.config.gas,
        );

        const { txMetrics, batchMetric } = await this.submitAndTrack(
          clients,
          callBatch,
          batchIndex,
        );
        allTxMetrics.push(...txMetrics);
        allBatchMetrics.push(batchMetric);
      }

      txSent += batchSize;
      batchIndex++;
    }

    console.log(
      `[mixedWorkload] Completed on ${clients.nodeName}: ${allTxMetrics.filter((m) => m.status === "confirmed").length}/${allTxMetrics.length} succeeded`,
    );

    return {
      scenario: this.name(),
      nodeName: clients.nodeName,
      transactions: allTxMetrics,
      batches: allBatchMetrics,
    };
  }
}
