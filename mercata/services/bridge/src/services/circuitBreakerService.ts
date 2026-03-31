import { config } from "../config";
import { logInfo, logError } from "../utils/logger";
import { AssetFamily } from "../types";

const LOG_CTX = "CircuitBreaker";

interface WindowState {
  totalVolume: bigint;
  windowStart: number;
  tripped: boolean;
  trippedAt?: number;
}

/**
 * Per-route circuit breaker that monitors withdrawal volume per asset-family
 * per destination-chain on a rolling time window.
 *
 * If volume exceeds the configured anomaly threshold, the circuit opens and
 * blocks new withdrawals on that route until manual reset or cooldown expiry.
 */
export class CircuitBreakerService {
  /** Key: "assetFamily:chainId" -> WindowState */
  private windows = new Map<string, WindowState>();

  // ===========================================================================
  // Core
  // ===========================================================================

  /**
   * Record a successful withdrawal. If the volume exceeds the anomaly
   * threshold, the circuit opens for that route.
   */
  recordWithdrawal(
    assetFamily: AssetFamily,
    chainId: number,
    amount: bigint,
  ): void {
    if (!config.circuitBreaker.enabled) return;
    if (config.circuitBreaker.anomalyThreshold === 0n) return;

    const key = `${assetFamily}:${chainId}`;
    let state = this.windows.get(key);

    if (!state) {
      state = {
        totalVolume: 0n,
        windowStart: Date.now(),
        tripped: false,
      };
      this.windows.set(key, state);
    }

    // Reset window if expired
    if (Date.now() - state.windowStart > config.circuitBreaker.windowDurationMs) {
      state.totalVolume = 0n;
      state.windowStart = Date.now();
      // Don't auto-reset a tripped breaker here; cooldown handles that
    }

    state.totalVolume += amount;

    if (
      !state.tripped &&
      state.totalVolume > config.circuitBreaker.anomalyThreshold
    ) {
      state.tripped = true;
      state.trippedAt = Date.now();
      logError(LOG_CTX, "Circuit breaker TRIPPED", {
        assetFamily,
        chainId,
        totalVolume: state.totalVolume.toString(),
        threshold: config.circuitBreaker.anomalyThreshold.toString(),
      });
    }
  }

  /**
   * Check if the circuit breaker is open (tripped) for a route.
   * Automatically resets after cooldown period.
   */
  isOpen(assetFamily: AssetFamily, chainId: number): boolean {
    if (!config.circuitBreaker.enabled) return false;

    const key = `${assetFamily}:${chainId}`;
    const state = this.windows.get(key);
    if (!state || !state.tripped) return false;

    // Auto-reset after cooldown
    if (
      state.trippedAt &&
      Date.now() - state.trippedAt > config.circuitBreaker.cooldownMs
    ) {
      state.tripped = false;
      state.totalVolume = 0n;
      state.windowStart = Date.now();
      logInfo(LOG_CTX, "Circuit breaker auto-reset after cooldown", {
        assetFamily,
        chainId,
      });
      return false;
    }

    return true;
  }

  /**
   * Manually reset a tripped circuit breaker.
   */
  reset(assetFamily: AssetFamily, chainId: number): void {
    const key = `${assetFamily}:${chainId}`;
    const state = this.windows.get(key);
    if (state) {
      state.tripped = false;
      state.totalVolume = 0n;
      state.windowStart = Date.now();
      logInfo(LOG_CTX, "Circuit breaker manually reset", {
        assetFamily,
        chainId,
      });
    }
  }

  /**
   * Get the current state of all circuit breakers (for operator visibility).
   */
  getStatus(): Array<{
    key: string;
    totalVolume: string;
    tripped: boolean;
    trippedAt?: number;
  }> {
    return [...this.windows.entries()].map(([key, state]) => ({
      key,
      totalVolume: state.totalVolume.toString(),
      tripped: state.tripped,
      trippedAt: state.trippedAt,
    }));
  }
}
