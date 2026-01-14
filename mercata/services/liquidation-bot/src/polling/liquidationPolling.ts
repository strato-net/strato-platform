import { config } from '../config';
import { logger } from '../utils/logger';
import { CDPLiquidationService } from '../services/cdpLiquidationService';
import { VaultService } from '../services/vaultService';
import { LiquidatablePosition } from '../types';

export class LiquidationPolling {
  private cdpService: CDPLiquidationService;
  private vaultService: VaultService;
  private isPolling: boolean = false;
  private pollTimer?: NodeJS.Timeout;

  constructor(cdpService: CDPLiquidationService, vaultService: VaultService) {
    this.cdpService = cdpService;
    this.vaultService = vaultService;
  }

  /**
   * Start the polling loop
   */
  start(): void {
    if (this.isPolling) {
      logger.warn('Polling is already running');
      return;
    }

    this.isPolling = true;
    logger.info('Starting liquidation polling', {
      interval: config.pollIntervalMs,
      maxBatch: config.maxLiquidationsPerBatch,
    });

    this.poll();
  }

  /**
   * Stop the polling loop
   */
  stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.isPolling = false;
    logger.info('Stopped liquidation polling');
  }

  /**
   * Main polling function
   */
  private async poll(): Promise<void> {
    if (!this.isPolling) return;

    try {
      await this.executePollCycle();
    } catch (error) {
      logger.error('Error in poll cycle', { error });
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.poll(), config.pollIntervalMs);
  }

  /**
   * Execute one poll cycle
   */
  private async executePollCycle(): Promise<void> {
    logger.debug('Starting poll cycle');

    const allPositions: LiquidatablePosition[] = [];

    // Fetch CDP liquidatable positions
    if (config.enableCdpLiquidations) {
      const cdpPositions = await this.cdpService.fetchLiquidatablePositions();
      allPositions.push(...cdpPositions);
    }

    if (allPositions.length === 0) {
      logger.debug('No liquidatable positions found');
      return;
    }

    // Sort by estimated profit (descending)
    allPositions.sort((a, b) => {
      const profitA = BigInt(a.estimatedProfit || '0');
      const profitB = BigInt(b.estimatedProfit || '0');
      return profitB > profitA ? 1 : profitB < profitA ? -1 : 0;
    });

    // Filter positions by minimum profit threshold
    const profitablePositions = allPositions.filter((position) => {
      const profit = BigInt(position.estimatedProfit || '0');
      const threshold = BigInt(config.minProfitThresholdUsd) * BigInt(1e18);
      return profit >= threshold;
    });

    if (profitablePositions.length === 0) {
      logger.info('No positions meet minimum profit threshold', {
        total: allPositions.length,
        threshold: config.minProfitThresholdUsd,
      });
      return;
    }

    // Limit batch size
    const positionsToLiquidate = profitablePositions.slice(0, config.maxLiquidationsPerBatch);

    logger.info('Processing liquidations', {
      total: allPositions.length,
      profitable: profitablePositions.length,
      executing: positionsToLiquidate.length,
    });

    // Execute liquidations
    for (const position of positionsToLiquidate) {
      await this.executeLiquidation(position);
    }
  }

  /**
   * Execute a single liquidation
   */
  private async executeLiquidation(position: LiquidatablePosition): Promise<void> {
    try {
      logger.info('Attempting liquidation', {
        user: position.user,
        asset: position.asset,
        type: position.positionType,
        estimatedProfit: position.estimatedProfit,
      });

      let result;

      if (position.positionType === 'CDP') {
        result = await this.cdpService.executeLiquidation(position);
      } else {
        // Lending liquidations would go here
        logger.warn('Lending liquidations not yet implemented');
        return;
      }

      if (result.success) {
        logger.info('Liquidation successful', {
          positionId: result.positionId,
          profit: result.profit,
          txHash: result.txHash,
        });

        // Record profit in vault if enabled
        if (config.vaultEnabled && result.profit !== '0') {
          await this.vaultService.recordProfit(result.profit);
        }
      } else {
        logger.warn('Liquidation failed', {
          positionId: result.positionId,
          error: result.error,
        });
      }
    } catch (error) {
      logger.error('Unexpected error during liquidation', {
        user: position.user,
        asset: position.asset,
        error,
      });
    }
  }
}
