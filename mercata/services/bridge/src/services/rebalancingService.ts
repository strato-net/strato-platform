import { config } from "../config";
import { logInfo, logError } from "../utils/logger";
import { RebalanceTransfer } from "../types";
import { AssetFamilyRegistry } from "./assetFamilyRegistry";
import { LiquidityManager } from "./liquidityManager";
import { initiateIntent } from "./acrossService";

const LOG_CTX = "RebalancingService";

/**
 * Orchestrates cross-chain rebalancing when a destination vault is short on
 * liquidity for external-canonical assets. Uses Across for all transfers
 * (CCTP for USDC can be added later as an optimization).
 *
 * Rebalancing is only triggered when total queued PendingLiquidity demand
 * for a given asset on a destination chain exceeds a configurable minimum.
 */
export class RebalancingService {
  /** In-flight transfers: key = "sourceChainId:destChainId:token" */
  private inFlight = new Map<string, RebalanceTransfer>();

  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  /** Queued demand: key = "destChainId:token" -> total amount */
  private queuedDemand = new Map<string, bigint>();

  constructor(
    private registry: AssetFamilyRegistry,
    private liquidityManager: LiquidityManager,
  ) {}

  // ===========================================================================
  // Demand Tracking
  // ===========================================================================

  /**
   * Record demand from a PendingLiquidity withdrawal.
   */
  addDemand(destinationChainId: number, token: string, amount: bigint): void {
    const key = `${destinationChainId}:${token}`;
    const current = this.queuedDemand.get(key) ?? 0n;
    this.queuedDemand.set(key, current + amount);
  }

  /**
   * Remove demand when a queued withdrawal is fulfilled or cancelled.
   */
  removeDemand(
    destinationChainId: number,
    token: string,
    amount: bigint,
  ): void {
    const key = `${destinationChainId}:${token}`;
    const current = this.queuedDemand.get(key) ?? 0n;
    const updated = current > amount ? current - amount : 0n;
    if (updated === 0n) {
      this.queuedDemand.delete(key);
    } else {
      this.queuedDemand.set(key, updated);
    }
  }

  // ===========================================================================
  // Rebalancing Logic
  // ===========================================================================

  /**
   * Check whether rebalancing should be triggered for a specific
   * destination chain and token, and execute if thresholds are met.
   */
  async checkAndRebalance(
    stratoToken: string,
    destinationChainId: number,
    externalToken: string,
  ): Promise<RebalanceTransfer | null> {
    const demandKey = `${destinationChainId}:${externalToken}`;
    const demand = this.queuedDemand.get(demandKey) ?? 0n;

    // Check minimum threshold
    if (demand < config.rebalancing.minThreshold) {
      return null;
    }

    // Check if there's already an in-flight transfer for this pair
    const entries = this.registry.getExternalTokensForFamily(stratoToken);
    for (const { chainId: srcChainId } of entries) {
      if (srcChainId === destinationChainId) continue;
      const flightKey = `${srcChainId}:${destinationChainId}:${externalToken}`;
      if (this.inFlight.has(flightKey)) {
        logInfo(LOG_CTX, "Rebalancing already in-flight", { flightKey });
        return null;
      }
    }

    // Find surplus chain
    const surplus = this.liquidityManager.findSurplusChain(
      stratoToken,
      destinationChainId,
    );

    if (!surplus || surplus.available === 0n) {
      logInfo(LOG_CTX, "No surplus chain available for rebalancing", {
        stratoToken,
        destinationChainId,
      });
      return null;
    }

    // Compute transfer amount: min of demand, surplus, and per-transfer cap
    let transferAmount = demand < surplus.available ? demand : surplus.available;
    if (
      config.rebalancing.maxPerTransfer > 0n &&
      transferAmount > config.rebalancing.maxPerTransfer
    ) {
      transferAmount = config.rebalancing.maxPerTransfer;
    }

    logInfo(LOG_CTX, "Initiating rebalancing transfer", {
      from: surplus.chainId,
      to: destinationChainId,
      token: externalToken,
      amount: transferAmount.toString(),
    });

    try {
      // Use Across to transfer from surplus vault to destination vault
      const result = await initiateIntent({
        originChainId: surplus.chainId,
        destinationChainId,
        inputToken: surplus.externalToken,
        outputToken: externalToken,
        inputAmount: transferAmount.toString(),
        // Recipient is the destination vault
        recipient: process.env[`CHAIN_${destinationChainId}_VAULT_ADDRESS`] || "",
      });

      const flightKey = `${surplus.chainId}:${destinationChainId}:${externalToken}`;
      const transfer: RebalanceTransfer = {
        id: flightKey,
        token: externalToken,
        sourceChainId: surplus.chainId,
        destinationChainId,
        amount: transferAmount,
        txHash: result.txHash,
        status: "pending",
        initiatedAt: Date.now(),
      };

      this.inFlight.set(flightKey, transfer);

      logInfo(LOG_CTX, "Rebalancing transfer initiated", {
        txHash: result.txHash,
        flightKey,
      });

      return transfer;
    } catch (error: any) {
      logError(LOG_CTX, error, {
        operation: "checkAndRebalance",
        from: surplus.chainId,
        to: destinationChainId,
      });
      return null;
    }
  }

  /**
   * Called when a rebalancing transfer has been confirmed on the destination chain.
   */
  onRebalanceComplete(
    sourceChainId: number,
    destinationChainId: number,
    token: string,
    amount: bigint,
  ): void {
    const flightKey = `${sourceChainId}:${destinationChainId}:${token}`;
    const transfer = this.inFlight.get(flightKey);
    if (transfer) {
      transfer.status = "confirmed";
      this.inFlight.delete(flightKey);
    }

    // Reduce queued demand
    this.removeDemand(destinationChainId, token, amount);

    logInfo(LOG_CTX, "Rebalancing transfer completed", {
      flightKey,
      amount: amount.toString(),
    });
  }

  /**
   * Called when a rebalancing transfer fails.
   */
  onRebalanceFailed(
    sourceChainId: number,
    destinationChainId: number,
    token: string,
  ): void {
    const flightKey = `${sourceChainId}:${destinationChainId}:${token}`;
    const transfer = this.inFlight.get(flightKey);
    if (transfer) {
      transfer.status = "failed";
      this.inFlight.delete(flightKey);
    }

    logError(LOG_CTX, "Rebalancing transfer failed", { flightKey });
  }

  // ===========================================================================
  // Periodic Check
  // ===========================================================================

  /**
   * Start periodic rebalancing checks.
   */
  startPeriodicCheck(): void {
    if (this.pollingTimer) return;
    if (!config.rebalancing.enabled) {
      logInfo(LOG_CTX, "Rebalancing disabled via config");
      return;
    }

    const interval = config.rebalancing.checkInterval;
    logInfo(LOG_CTX, `Starting periodic rebalancing check every ${interval}ms`);

    this.pollingTimer = setInterval(async () => {
      try {
        await this.runRebalanceCheck();
      } catch (error) {
        logError(LOG_CTX, error as Error, {
          operation: "periodicRebalanceCheck",
        });
      }
    }, interval);
  }

  stopPeriodicCheck(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private async runRebalanceCheck(): Promise<void> {
    for (const [demandKey, demand] of this.queuedDemand) {
      if (demand < config.rebalancing.minThreshold) continue;

      const [chainIdStr, token] = demandKey.split(":");
      const destinationChainId = Number(chainIdStr);

      // Find which STRATO token this external token belongs to
      const allAssets = this.registry.getAllAssets();
      const match = allAssets.find(
        (a) =>
          a.externalToken.toLowerCase() === token.toLowerCase() &&
          a.externalChainId === destinationChainId &&
          a.assetFamily === "external-canonical",
      );

      if (!match) continue;

      await this.checkAndRebalance(
        match.stratoToken,
        destinationChainId,
        token,
      );
    }
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  getInFlightTransfers(): RebalanceTransfer[] {
    return [...this.inFlight.values()];
  }

  getQueuedDemand(): Map<string, bigint> {
    return new Map(this.queuedDemand);
  }
}
