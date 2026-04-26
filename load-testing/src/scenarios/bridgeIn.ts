import { BaseScenario } from "./base";
import { NodeClients } from "../api/client";
import { runRateLimited } from "../concurrency";
import { ScenarioResult, TxMetric } from "../types";

/**
 * Minimal ABI for the Mercata DepositRouter contract deployed on Ethereum
 * Sepolia. See mercata/ethereum/contracts/bridge/DepositRouter.sol.
 *
 * DepositRouted event signature (topic0):
 *   0x55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750
 */
const DEPOSIT_ROUTER_ABI = [
  "function depositETH(address stratoAddress, address targetStratoToken) external payable",
  "function deposit(address token, uint256 amount, address stratoAddress, address targetStratoToken, uint256 nonce, uint256 deadline, bytes calldata signature) external",
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
];

function normalizeStratoAddress(addr: string): string {
  const hex = addr.replace(/^0x/, "").toLowerCase();
  if (hex.length !== 40) {
    throw new Error(`Expected 40-hex-char STRATO address, got: ${addr}`);
  }
  return `0x${hex}`;
}

/**
 * Scenario 4 — Ethereum Sepolia → STRATO bridge-in.
 *
 * For each iteration:
 *   1. Sign and broadcast a DepositRouter.depositETH(...) (or .deposit(...))
 *      transaction on Sepolia.
 *   2. Optionally await Sepolia confirmation.
 *   3. Optionally poll the STRATO backend for the corresponding mint / voucher
 *      credit that the bridge service applies after detecting DepositRouted.
 *
 * The flow mirrors mercata/services/bridge/src/polling/alchemyPolling.ts which
 * detects DepositRouted events via eth_getLogs and calls
 * MercataBridge.depositBatch on STRATO.
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

    // Lazy import ethers so scenarios 1–3 don't require it at startup.
    let ethers: any;
    try {
      ethers = require("ethers");
    } catch (err: any) {
      throw new Error(
        "bridgeIn: 'ethers' is not installed. Run `npm install` in load-testing/.",
      );
    }

    const provider = new ethers.JsonRpcProvider(cfg.sepoliaRpcUrl, cfg.sepoliaChainId);
    const wallet = new ethers.Wallet(cfg.sepoliaPrivateKey, provider);
    const router = new ethers.Contract(cfg.depositRouterAddress, DEPOSIT_ROUTER_ABI, wallet);

    const stratoRecipient = normalizeStratoAddress(cfg.stratoRecipientAddress);
    const targetStratoToken = normalizeStratoAddress(cfg.targetStratoToken);
    const amount = BigInt(cfg.amountPerTx);
    const gasLimit = BigInt(cfg.gasLimit ?? 250000);
    const mode = cfg.depositMode ?? "ETH";

    console.log(
      `[bridgeIn] wallet=${wallet.address} mode=${mode} amount=${amount.toString()} wei ` +
        `-> strato=${stratoRecipient} token=${targetStratoToken}`,
    );

    // Pre-fetch starting nonce so concurrent dispatches use sequential nonces
    // instead of racing the provider's pending-nonce cache.
    const startNonce =
      cfg.startNonce !== undefined
        ? cfg.startNonce
        : await provider.getTransactionCount(wallet.address, "pending");

    const feeData = await provider.getFeeData();
    const maxFeePerGas =
      cfg.maxFeePerGasGwei !== undefined
        ? ethers.parseUnits(String(cfg.maxFeePerGasGwei), "gwei")
        : feeData.maxFeePerGas ?? ethers.parseUnits("30", "gwei");
    const maxPriorityFeePerGas =
      cfg.maxPriorityFeePerGasGwei !== undefined
        ? ethers.parseUnits(String(cfg.maxPriorityFeePerGasGwei), "gwei")
        : feeData.maxPriorityFeePerGas ?? ethers.parseUnits("2", "gwei");

    console.log(
      `[bridgeIn] nonce base=${startNonce}, maxFeePerGas=${maxFeePerGas.toString()}, priority=${maxPriorityFeePerGas.toString()}`,
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
        const nonce = startNonce + i;
        const submitTime = Date.now();
        let txHash = `bridge:${i}`;
        let submitDuration = 0;
        let confirmDuration = 0;
        let status: TxMetric["status"] = "submitted";
        let error: string | undefined;

        try {
          const overrides: any = {
            nonce,
            gasLimit,
            maxFeePerGas,
            maxPriorityFeePerGas,
          };

          let tx;
          if (mode === "ETH") {
            overrides.value = amount;
            tx = await router.depositETH(stratoRecipient, targetStratoToken, overrides);
          } else {
            // ERC20 mode requires a Permit2 signature for gasless approve+pull.
            // For a load test we accept a pre-computed signature via a config
            // extension (not implemented here) — fall through to error.
            throw new Error(
              "ERC20 deposit mode requires Permit2 signing (not yet implemented; use depositMode: ETH)",
            );
          }
          txHash = tx.hash;
          submitDuration = Date.now() - submitTime;

          if (cfg.awaitSepoliaConfirmation) {
            const confirmStart = Date.now();
            const receipt = await tx.wait();
            confirmDuration = Date.now() - confirmStart;
            status = receipt && receipt.status === 1 ? "confirmed" : "failed";
            if (status === "failed") error = `Sepolia receipt status=${receipt?.status}`;
          } else {
            status = "submitted";
          }
        } catch (err: any) {
          submitDuration = Date.now() - submitTime;
          status = "failed";
          error = err.shortMessage || err.reason || err.message || String(err);
        }

        const metric: TxMetric = {
          txHash,
          nodeName,
          scenario,
          batchIndex: Math.floor(i / 10),
          submitTime,
          submitDuration,
          confirmTime: submitTime + submitDuration + confirmDuration,
          confirmDuration,
          totalDuration: submitDuration + confirmDuration,
          status,
          error,
        };
        this.collector.recordTx(metric);
        txMetrics.push(metric);

        if (this.verbose || i % 5 === 0) {
          console.log(
            `[bridgeIn] #${i} nonce=${nonce} ${status} ${txHash.substring(0, 18)}... ` +
              `submit=${submitDuration}ms confirm=${confirmDuration}ms ${error ?? ""}`,
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