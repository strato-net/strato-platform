import { BaseScenario } from "./base";
import { NodeClients } from "../api/client";
import { runRateLimited } from "../concurrency";
import { ScenarioResult, TxMetric } from "../types";
import {
  SepoliaBroadcaster,
  normalizeAddress0x,
} from "../tx/sepoliaBroadcast";

/**
 * Scenario 4 — Ethereum Sepolia → STRATO bridge-in.
 *
 * For each iteration:
 *   1. Sign and broadcast a DepositRouter.depositETH(...) transaction on
 *      Sepolia (sequential nonces from a single signer).
 *   2. Optionally await Sepolia confirmation.
 *   3. The bridge service (mercata/services/bridge) detects DepositRouted
 *      events via eth_getLogs and calls MercataBridge.depositBatch on STRATO
 *      asynchronously — that side is monitored out of band.
 *
 * The on-chain broadcast logic is shared with Scenario 1's `bridge` sub-config
 * via `src/tx/sepoliaBroadcast.ts`.
 */
export class BridgeInScenario extends BaseScenario {
  name(): string {
    return "bridgeIn";
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.bridgeIn;

    if (!cfg.sepoliaRpcUrl) throw new Error("bridgeIn: sepoliaRpcUrl is required");
    if (!cfg.sepoliaPrivateKey) throw new Error("bridgeIn: sepoliaPrivateKey is required");
    if (!cfg.depositRouterAddress) throw new Error("bridgeIn: depositRouterAddress is required");
    if (!cfg.stratoRecipientAddress) throw new Error("bridgeIn: stratoRecipientAddress is required");
    if (!cfg.targetStratoToken) throw new Error("bridgeIn: targetStratoToken is required");

    const mode = cfg.depositMode ?? "ETH";
    if (mode !== "ETH") {
      throw new Error(
        `bridgeIn: depositMode=${mode} is not yet supported (ERC20 requires Permit2 signing). Use depositMode: ETH.`,
      );
    }

    const broadcaster = new SepoliaBroadcaster({
      rpcUrl: cfg.sepoliaRpcUrl,
      privateKey: cfg.sepoliaPrivateKey,
      depositRouterAddress: cfg.depositRouterAddress,
      chainId: cfg.sepoliaChainId,
      gasLimit: cfg.gasLimit,
      maxFeePerGasGwei: cfg.maxFeePerGasGwei,
      maxPriorityFeePerGasGwei: cfg.maxPriorityFeePerGasGwei,
      startNonce: cfg.startNonce,
    });
    await broadcaster.init();

    const stratoRecipient = normalizeAddress0x(cfg.stratoRecipientAddress);
    const targetStratoToken = normalizeAddress0x(cfg.targetStratoToken);
    const amount = cfg.amountPerTx;

    console.log(
      `[bridgeIn] wallet=${broadcaster.walletAddress} mode=${mode} amount=${amount} wei ` +
        `-> strato=${stratoRecipient} token=${targetStratoToken}`,
    );
    console.log(
      `[bridgeIn] nonce base=${broadcaster.startNonce}, ` +
        `maxFeePerGas=${broadcaster.maxFeePerGas.toString()}, ` +
        `priority=${broadcaster.maxPriorityFeePerGas.toString()}`,
    );

    const nodeName = clients.nodeName;
    const scenario = this.name();
    const txMetrics: TxMetric[] = [];

    const runStart = Date.now();
    await runRateLimited(
      cfg.totalBridgeIns,
      cfg.timeWindowMs,
      Math.min(cfg.totalBridgeIns, 20),
      async (i) => {
        const submitTime = Date.now();
        const result = await broadcaster.broadcastDepositETH({
          nonceOffset: i,
          stratoRecipient,
          targetStratoToken,
          amountWei: amount,
          awaitConfirmation: cfg.awaitSepoliaConfirmation === true,
        });

        const metric: TxMetric = {
          txHash: result.txHash,
          nodeName,
          scenario,
          batchIndex: Math.floor(i / 10),
          submitTime,
          submitDuration: result.submitDurationMs,
          confirmTime: submitTime + result.submitDurationMs + result.confirmDurationMs,
          confirmDuration: result.confirmDurationMs,
          totalDuration: result.submitDurationMs + result.confirmDurationMs,
          status: result.status,
          error: result.error,
        };
        this.collector.recordTx(metric);
        txMetrics.push(metric);

        if (this.verbose || i % 5 === 0) {
          console.log(
            `[bridgeIn] #${i} nonce=${broadcaster.startNonce + i} ${result.status} ` +
              `${result.txHash.substring(0, 18)}... ` +
              `submit=${result.submitDurationMs}ms confirm=${result.confirmDurationMs}ms ` +
              `${result.error ?? ""}`,
          );
        }
      },
    );
    const runEnd = Date.now();

    const confirmed = txMetrics.filter((m) => m.status === "confirmed").length;
    const submitted = txMetrics.filter((m) => m.status === "submitted").length;
    const failed = txMetrics.filter((m) => m.status === "failed").length;
    const elapsedSec = (runEnd - runStart) / 1000;

    console.log(
      `[bridgeIn] Done. confirmed=${confirmed} submitted=${submitted} failed=${failed} ` +
        `in ${elapsedSec.toFixed(2)}s — ${(txMetrics.length / Math.max(elapsedSec, 0.001)).toFixed(2)} bridges/s submitted`,
    );

    if (cfg.stratoBackendUrl && cfg.stratoConfirmTimeoutSec) {
      console.log(
        `[bridgeIn] Bridge service polls Sepolia every ~60s; STRATO-side mint ` +
          `may take several minutes. Monitor manually at ${cfg.stratoBackendUrl}.`,
      );
    }

    return {
      scenario,
      nodeName,
      transactions: txMetrics,
      batches: [],
    };
  }
}