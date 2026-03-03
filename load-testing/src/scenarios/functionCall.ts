import { BaseScenario } from "./base";
import { NodeClients } from "../api/client";
import { buildContractDeployBatch, buildFunctionCallBatch } from "../tx/builders";
import { submitBatch } from "../tx/submitter";
import { pollForResults } from "../tx/poller";
import { ScenarioResult, TxMetric, BatchMetric } from "../types";

export class FunctionCallScenario extends BaseScenario {
  name(): string {
    return "functionCall";
  }

  private async deploySetupContract(clients: NodeClients): Promise<string> {
    const cfg = this.config.scenarios.functionCall;

    console.log(`[functionCall] Deploying setup contract ${cfg.contractName} on ${clients.nodeName}...`);

    const builtTx = buildContractDeployBatch(
      cfg.setupContract,
      cfg.contractName,
      {},
      1,
      this.config.gas,
    );

    // Deploy with resolve=true so we get the address immediately
    const responses = await submitBatch(clients.strato, builtTx, true);
    const response = responses[0];

    if (response.status === "Success") {
      const address = response.txResult?.contractsCreated?.[0] || response.hash;
      console.log(`[functionCall] Setup contract deployed: ${address}`);
      return address;
    }

    // If not immediately resolved, poll
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
    console.log(`[functionCall] Setup contract deployed: ${address}`);
    return address;
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.functionCall;
    const allTxMetrics: TxMetric[] = [];
    const allBatchMetrics: BatchMetric[] = [];

    // Deploy setup contract first
    const contractAddress = await this.deploySetupContract(clients);

    console.log(
      `[functionCall] Starting: ${cfg.batchCount} batches x ${cfg.batchSize} calls on ${clients.nodeName}`,
    );

    for (let i = 0; i < cfg.batchCount; i++) {
      const builtTx = buildFunctionCallBatch(
        cfg.contractName,
        contractAddress,
        cfg.method,
        cfg.args,
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
      `[functionCall] Completed on ${clients.nodeName}: ${allTxMetrics.filter((m) => m.status === "confirmed").length}/${allTxMetrics.length} succeeded`,
    );

    return {
      scenario: this.name(),
      nodeName: clients.nodeName,
      transactions: allTxMetrics,
      batches: allBatchMetrics,
    };
  }
}
