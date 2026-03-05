import { BaseScenario } from "./base";
import { NodeClients } from "../api/client";
import { buildContractDeployBatch, buildFunctionCallBatch } from "../tx/builders";
import { submitBatch } from "../tx/submitter";
import { pollForResults } from "../tx/poller";
import { ScenarioResult } from "../types";

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
      const address = response.txResult?.contractsCreated?.[0] || response.hash;
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

    const address = result.txResult?.contractsCreated?.[0] || result.hash;
    console.log(`[mixedWorkload] Setup contract deployed: ${address}`);
    return address;
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.mixedWorkload;
    const deployCfg = this.config.scenarios.contractDeploy;
    const callCfg = this.config.scenarios.functionCall;

    // Deploy a contract for function calls
    const contractAddress = await this.deploySetupContract(clients);

    const totalBatches = Math.ceil(cfg.totalTxCount / cfg.batchSize);
    console.log(
      `[mixedWorkload] Starting: ${totalBatches} batches, ${Math.round(cfg.deployRatio * 100)}% deploys on ${clients.nodeName} (${cfg.submitMode} mode)`,
    );

    // Build all batches upfront
    const allBuiltTxs: import("../types").BuiltTx[] = [];
    let txSent = 0;

    while (txSent < cfg.totalTxCount) {
      const remaining = cfg.totalTxCount - txSent;
      const batchSize = Math.min(cfg.batchSize, remaining);
      const deployCount = Math.round(batchSize * cfg.deployRatio);
      const callCount = batchSize - deployCount;

      if (deployCount > 0) {
        allBuiltTxs.push(
          buildContractDeployBatch(
            deployCfg.contractSource,
            deployCfg.contractName,
            deployCfg.contractArgs,
            deployCount,
            this.config.gas,
          ),
        );
      }
      if (callCount > 0) {
        allBuiltTxs.push(
          buildFunctionCallBatch(
            callCfg.contractName,
            contractAddress,
            callCfg.method,
            callCfg.args,
            callCount,
            this.config.gas,
          ),
        );
      }

      txSent += batchSize;
    }

    let allTxMetrics: import("../types").TxMetric[];
    let allBatchMetrics: import("../types").BatchMetric[];

    if (cfg.submitMode === "pipeline") {
      const result = await this.submitAllThenTrack(clients, allBuiltTxs);
      allTxMetrics = result.txMetrics;
      allBatchMetrics = result.batchMetrics;
    } else {
      allTxMetrics = [];
      allBatchMetrics = [];
      for (let i = 0; i < allBuiltTxs.length; i++) {
        const { txMetrics, batchMetric } = await this.submitAndTrack(clients, allBuiltTxs[i], i);
        allTxMetrics.push(...txMetrics);
        allBatchMetrics.push(batchMetric);
      }
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
