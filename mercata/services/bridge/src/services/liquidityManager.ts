import { config, ZERO_ADDRESS } from "../config";
import { logInfo, logError } from "../utils/logger";
import { VaultBalance, LiquidityReservation } from "../types";
import { getVaultBalance, getVaultETHBalance } from "./vaultService";
import { AssetFamilyRegistry } from "./assetFamilyRegistry";

const LOG_CTX = "LiquidityManager";

/**
 * Tracks global effective balance across all ExternalBridgeVaults
 * for external-canonical assets. Provides liquidity reservation,
 * and periodic reconciliation against on-chain balances.
 */
export class LiquidityManager {
  /** Key: "chainId:token" -> VaultBalance */
  private balances = new Map<string, VaultBalance>();

  /** Key: withdrawalId -> LiquidityReservation */
  private reservations = new Map<string, LiquidityReservation>();

  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private registry: AssetFamilyRegistry) {}

  // ===========================================================================
  // Balance Refresh
  // ===========================================================================

  /**
   * Refresh on-chain balances for all external-canonical vaults.
   */
  async refreshBalances(): Promise<void> {
    const externalTokens = this.registry.getExternalCanonicalTokens();

    for (const stratoToken of externalTokens) {
      const entries = this.registry.getExternalTokensForFamily(stratoToken);
      for (const { chainId, externalToken } of entries) {
        try {
          const isETH =
            externalToken.toLowerCase() === ZERO_ADDRESS.toLowerCase();
          const balance = isETH
            ? await getVaultETHBalance(chainId)
            : await getVaultBalance(chainId, externalToken);

          const key = `${chainId}:${externalToken}`;
          const existing = this.balances.get(key);
          this.balances.set(key, {
            chainId,
            token: externalToken,
            balance,
            reserved: existing?.reserved ?? 0n,
            lastUpdated: Date.now(),
          });
        } catch (error) {
          logError(LOG_CTX, error as Error, {
            operation: "refreshBalances",
            chainId,
            externalToken,
          });
        }
      }
    }

    logInfo(LOG_CTX, "Balances refreshed", {
      entries: this.balances.size,
    });
  }

  // ===========================================================================
  // Global Effective Balance
  // ===========================================================================

  /**
   * Sum of all vault balances for a STRATO token across all chains,
   * minus reserved amounts and in-flight outflows.
   */
  getGlobalEffectiveBalance(stratoToken: string): bigint {
    const entries = this.registry.getExternalTokensForFamily(stratoToken);
    let total = 0n;

    for (const { chainId, externalToken } of entries) {
      const key = `${chainId}:${externalToken}`;
      const vb = this.balances.get(key);
      if (vb) {
        const available = vb.balance > vb.reserved ? vb.balance - vb.reserved : 0n;
        total += available;
      }
    }

    return total;
  }

  /**
   * Available (unreserved) balance on a specific destination chain.
   */
  getChainLiquidity(chainId: number, externalToken: string): bigint {
    const key = `${chainId}:${externalToken}`;
    const vb = this.balances.get(key);
    if (!vb) return 0n;
    return vb.balance > vb.reserved ? vb.balance - vb.reserved : 0n;
  }

  /**
   * Raw cached balance (before reservations) on a chain.
   */
  getChainBalance(chainId: number, externalToken: string): bigint {
    const key = `${chainId}:${externalToken}`;
    return this.balances.get(key)?.balance ?? 0n;
  }

  // ===========================================================================
  // Reservations
  // ===========================================================================

  /**
   * Reserve liquidity on a destination chain for a withdrawal.
   * Returns true if the reservation was successful.
   */
  reserveLiquidity(
    chainId: number,
    token: string,
    amount: bigint,
    withdrawalId: string,
  ): boolean {
    const available = this.getChainLiquidity(chainId, token);
    if (amount > available) return false;

    const key = `${chainId}:${token}`;
    const vb = this.balances.get(key);
    if (!vb) return false;

    vb.reserved += amount;

    this.reservations.set(withdrawalId, {
      withdrawalId,
      chainId,
      token,
      amount,
      reservedAt: Date.now(),
    });

    logInfo(LOG_CTX, "Liquidity reserved", {
      withdrawalId,
      chainId,
      token,
      amount: amount.toString(),
    });

    return true;
  }

  /**
   * Release a previously made reservation (e.g., on cancellation or expiry).
   */
  releaseLiquidityReservation(withdrawalId: string): void {
    const reservation = this.reservations.get(withdrawalId);
    if (!reservation) return;

    const key = `${reservation.chainId}:${reservation.token}`;
    const vb = this.balances.get(key);
    if (vb) {
      vb.reserved =
        vb.reserved > reservation.amount
          ? vb.reserved - reservation.amount
          : 0n;
    }

    this.reservations.delete(withdrawalId);

    logInfo(LOG_CTX, "Reservation released", { withdrawalId });
  }

  /**
   * Consume a reservation after successful execution.
   * Reduces the balance (funds have left the vault) and removes the reservation.
   */
  consumeReservation(withdrawalId: string): void {
    const reservation = this.reservations.get(withdrawalId);
    if (!reservation) return;

    const key = `${reservation.chainId}:${reservation.token}`;
    const vb = this.balances.get(key);
    if (vb) {
      vb.balance =
        vb.balance > reservation.amount
          ? vb.balance - reservation.amount
          : 0n;
      vb.reserved =
        vb.reserved > reservation.amount
          ? vb.reserved - reservation.amount
          : 0n;
    }

    this.reservations.delete(withdrawalId);
  }

  // ===========================================================================
  // Surplus Detection (for rebalancing)
  // ===========================================================================

  /**
   * Find the chain with the most available surplus for a given STRATO token,
   * excluding the specified chain. Returns null if no surplus chain exists.
   */
  findSurplusChain(
    stratoToken: string,
    excludeChainId: number,
  ): { chainId: number; externalToken: string; available: bigint } | null {
    const entries = this.registry.getExternalTokensForFamily(stratoToken);
    let best: {
      chainId: number;
      externalToken: string;
      available: bigint;
    } | null = null;

    for (const { chainId, externalToken } of entries) {
      if (chainId === excludeChainId) continue;
      const available = this.getChainLiquidity(chainId, externalToken);
      if (!best || available > best.available) {
        best = { chainId, externalToken, available };
      }
    }

    // Enforce reserve threshold: don't drain below reserve
    if (best) {
      const totalBalance = this.getChainBalance(
        best.chainId,
        best.externalToken,
      );
      const reservePct = config.rebalancing.reservePct;
      const reserveFloor = (totalBalance * BigInt(reservePct)) / 100n;
      const transferable = best.available > reserveFloor
        ? best.available - reserveFloor
        : 0n;

      if (transferable === 0n) return null;
      return { ...best, available: transferable };
    }

    return null;
  }

  // ===========================================================================
  // Reconciliation
  // ===========================================================================

  /**
   * Compare service-layer balance state to actual on-chain balances.
   * Returns a list of discrepancies above threshold.
   */
  async reconcile(): Promise<
    Array<{
      stratoToken: string;
      onChainTotal: bigint;
      serviceTotal: bigint;
      discrepancy: bigint;
    }>
  > {
    const discrepancies: Array<{
      stratoToken: string;
      onChainTotal: bigint;
      serviceTotal: bigint;
      discrepancy: bigint;
    }> = [];

    const externalTokens = this.registry.getExternalCanonicalTokens();

    for (const stratoToken of externalTokens) {
      const entries = this.registry.getExternalTokensForFamily(stratoToken);
      let onChainTotal = 0n;
      let serviceTotal = 0n;

      for (const { chainId, externalToken } of entries) {
        try {
          const isETH =
            externalToken.toLowerCase() === ZERO_ADDRESS.toLowerCase();
          const onChain = isETH
            ? await getVaultETHBalance(chainId)
            : await getVaultBalance(chainId, externalToken);
          onChainTotal += onChain;
        } catch {
          // Skip chains we can't reach
        }

        const key = `${chainId}:${externalToken}`;
        const vb = this.balances.get(key);
        if (vb) serviceTotal += vb.balance;
      }

      const diff =
        onChainTotal > serviceTotal
          ? onChainTotal - serviceTotal
          : serviceTotal - onChainTotal;

      const thresholdPct = BigInt(config.reconciliation.discrepancyThresholdPct);
      const pctThreshold =
        onChainTotal > 0n ? (onChainTotal * thresholdPct) / 100n : 0n;
      const absFloor = config.reconciliation.discrepancyAbsoluteFloor;
      const threshold = pctThreshold > absFloor ? pctThreshold : absFloor;

      if (diff > threshold) {
        discrepancies.push({
          stratoToken,
          onChainTotal,
          serviceTotal,
          discrepancy: diff,
        });
        logError(LOG_CTX, "Balance discrepancy detected", {
          stratoToken,
          onChain: onChainTotal.toString(),
          service: serviceTotal.toString(),
          diff: diff.toString(),
        });
      }
    }

    return discrepancies;
  }

  /**
   * Start periodic reconciliation.
   */
  startPeriodicReconciliation(): void {
    if (this.reconciliationTimer) return;

    const interval = config.reconciliation.interval;
    logInfo(LOG_CTX, `Starting periodic reconciliation every ${interval}ms`);

    this.reconciliationTimer = setInterval(async () => {
      try {
        await this.refreshBalances();
        await this.reconcile();
      } catch (error) {
        logError(LOG_CTX, error as Error, {
          operation: "periodicReconciliation",
        });
      }
    }, interval);
  }

  stopPeriodicReconciliation(): void {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
  }
}
