import { ZERO_ADDRESS } from "../config";
import { logInfo, logError } from "../utils/logger";
import {
  WithdrawalInfo,
  AllocationResult,
  ExecutionResult,
} from "../types";
import { AssetFamilyRegistry } from "./assetFamilyRegistry";
import { LiquidityManager } from "./liquidityManager";
import { CircuitBreakerService } from "./circuitBreakerService";
import * as vaultService from "./vaultService";

const LOG_CTX = "WithdrawalAllocator";

/**
 * Unified withdrawal allocator that replaces the old hot-wallet / standard split.
 *
 * For external-canonical assets: checks global solvency then destination liquidity.
 * For STRATO-canonical assets: always ready (mint on external chain).
 *
 * Uses pessimistic locking per asset-family per destination-chain to prevent
 * concurrent withdrawals from overcommitting a vault.
 */
export class WithdrawalAllocator {
  /** In-progress locks: "stratoToken:chainId" -> Promise */
  private locks = new Map<string, Promise<void>>();

  constructor(
    private registry: AssetFamilyRegistry,
    private liquidityManager: LiquidityManager,
    private circuitBreaker: CircuitBreakerService,
  ) {}

  // ===========================================================================
  // Allocation
  // ===========================================================================

  /**
   * Determine whether a withdrawal can execute immediately, must be queued,
   * or should be rejected.
   */
  async allocate(withdrawal: WithdrawalInfo): Promise<AllocationResult> {
    const chainId = Number(withdrawal.externalChainId);
    const stratoToken = withdrawal.stratoToken;
    const family = this.registry.getFamily(stratoToken);

    // Circuit breaker check
    if (this.circuitBreaker.isOpen(family, chainId)) {
      return {
        status: "rejected",
        reason: `Circuit breaker tripped for ${family} on chain ${chainId}`,
      };
    }

    // STRATO-canonical: always ready (we mint representation tokens, no liquidity constraint)
    if (family === "strato-canonical") {
      return { status: "ready" };
    }

    // External-canonical: need liquidity checks
    const amount = BigInt(withdrawal.externalTokenAmount);
    const externalToken = withdrawal.externalToken;

    // 1. Global solvency check
    const globalBalance =
      this.liquidityManager.getGlobalEffectiveBalance(stratoToken);
    if (amount > globalBalance) {
      return {
        status: "rejected",
        reason: `Insufficient global balance: need ${amount}, have ${globalBalance}`,
      };
    }

    // 2. Destination liquidity check
    const chainLiquidity = this.liquidityManager.getChainLiquidity(
      chainId,
      externalToken,
    );
    if (amount > chainLiquidity) {
      // Globally solvent but destination is short
      return { status: "pending_liquidity" };
    }

    // 3. Reserve liquidity
    const lockKey = `${stratoToken}:${chainId}`;
    await this.acquireLock(lockKey);
    try {
      const reserved = this.liquidityManager.reserveLiquidity(
        chainId,
        externalToken,
        amount,
        withdrawal.withdrawalId,
      );

      if (!reserved) {
        // Lost race — another withdrawal reserved the remaining liquidity
        return { status: "pending_liquidity" };
      }
    } finally {
      this.releaseLock(lockKey);
    }

    return { status: "ready" };
  }

  // ===========================================================================
  // Execution
  // ===========================================================================

  /**
   * Execute a withdrawal that has been allocated as "ready".
   * For external-canonical: release from ExternalBridgeVault.
   * For STRATO-canonical: mint on StratoRepresentationBridge.
   */
  async executeWithdrawal(withdrawal: WithdrawalInfo): Promise<ExecutionResult> {
    const chainId = Number(withdrawal.externalChainId);
    const family = this.registry.getFamily(withdrawal.stratoToken);

    logInfo(LOG_CTX, "Executing withdrawal", {
      withdrawalId: withdrawal.withdrawalId,
      family,
      chainId,
      amount: withdrawal.externalTokenAmount,
    });

    try {
      let result: ExecutionResult;

      if (family === "strato-canonical") {
        // Mint representation tokens on the destination chain
        result = await vaultService.mintRepresentation(
          chainId,
          withdrawal.stratoToken,
          withdrawal.externalRecipient,
          withdrawal.externalTokenAmount,
        );
      } else {
        // Release canonical tokens from the destination vault
        const isETH =
          withdrawal.externalToken.toLowerCase() ===
          ZERO_ADDRESS.toLowerCase();

        result = isETH
          ? await vaultService.releaseETHFromVault(
              chainId,
              withdrawal.externalRecipient,
              withdrawal.externalTokenAmount,
            )
          : await vaultService.releaseFromVault(
              chainId,
              withdrawal.externalToken,
              withdrawal.externalRecipient,
              withdrawal.externalTokenAmount,
            );

        // Consume the liquidity reservation on success
        if (result.success) {
          this.liquidityManager.consumeReservation(withdrawal.withdrawalId);
        }
      }

      // Record in circuit breaker
      if (result.success) {
        this.circuitBreaker.recordWithdrawal(
          family,
          chainId,
          BigInt(withdrawal.externalTokenAmount),
        );
      } else {
        // Release reservation on failure for external-canonical
        if (family === "external-canonical") {
          this.liquidityManager.releaseLiquidityReservation(
            withdrawal.withdrawalId,
          );
        }
      }

      return result;
    } catch (error: any) {
      logError(LOG_CTX, error, {
        operation: "executeWithdrawal",
        withdrawalId: withdrawal.withdrawalId,
      });

      // Release reservation on error
      if (family === "external-canonical") {
        this.liquidityManager.releaseLiquidityReservation(
          withdrawal.withdrawalId,
        );
      }

      return { success: false, error: error.message };
    }
  }

  // ===========================================================================
  // Pessimistic Locking
  // ===========================================================================

  private async acquireLock(key: string): Promise<void> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    let resolve: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.locks.set(key, promise);
    // Store resolve so releaseLock can call it
    (promise as any).__resolve = resolve!;
  }

  private releaseLock(key: string): void {
    const promise = this.locks.get(key);
    this.locks.delete(key);
    if (promise && (promise as any).__resolve) {
      (promise as any).__resolve();
    }
  }
}
