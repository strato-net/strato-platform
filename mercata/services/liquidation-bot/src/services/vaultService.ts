import { logger } from '../utils/logger';
import { VaultInvestor, VaultMetrics } from '../types';
import { config } from '../config';

/**
 * VaultService manages the investment vault functionality
 * Users can invest in the bot, and profits from liquidations are distributed proportionally
 */
export class VaultService {
  private investors: Map<string, VaultInvestor> = new Map();
  private totalShares: bigint = 0n;
  private totalValue: bigint = 0n;
  private totalLiquidations: number = 0;
  private totalProfits: bigint = 0n;

  constructor() {
    logger.info('Vault service initialized', {
      enabled: config.vaultEnabled,
      minInvestment: config.minInvestmentUsd,
      feeBps: config.vaultFeeBps,
    });
  }

  /**
   * Allow a user to invest in the vault
   * Returns the number of shares allocated
   */
  async invest(userAddress: string, amount: string): Promise<string> {
    if (!config.vaultEnabled) {
      throw new Error('Vault functionality is disabled');
    }

    const investAmount = BigInt(amount);
    const minInvestment = BigInt(config.minInvestmentUsd) * BigInt(1e18);

    if (investAmount < minInvestment) {
      throw new Error(`Minimum investment is ${config.minInvestmentUsd} USD`);
    }

    // Calculate shares based on current vault value
    // shares = (investment / pricePerShare) where pricePerShare = totalValue / totalShares
    let shares: bigint;
    if (this.totalShares === 0n) {
      // Initial investment: 1:1 ratio
      shares = investAmount;
    } else {
      // shares = (investment * totalShares) / totalValue
      shares = (investAmount * this.totalShares) / this.totalValue;
    }

    // Update investor record
    const existingInvestor = this.investors.get(userAddress);
    if (existingInvestor) {
      existingInvestor.shares = (BigInt(existingInvestor.shares) + shares).toString();
      existingInvestor.investedAmount = (
        BigInt(existingInvestor.investedAmount) + investAmount
      ).toString();
    } else {
      this.investors.set(userAddress, {
        address: userAddress,
        shares: shares.toString(),
        investedAmount: investAmount.toString(),
        currentValue: investAmount.toString(),
        joinedAt: Date.now(),
      });
    }

    // Update totals
    this.totalShares += shares;
    this.totalValue += investAmount;

    logger.info('Investment recorded', {
      user: userAddress,
      amount: amount,
      shares: shares.toString(),
      totalShares: this.totalShares.toString(),
      totalValue: this.totalValue.toString(),
    });

    return shares.toString();
  }

  /**
   * Record profits from a liquidation
   * Profits are added to the vault value, increasing the value of all shares
   */
  async recordProfit(profitAmount: string): Promise<void> {
    const profit = BigInt(profitAmount);

    // Deduct performance fee
    const fee = (profit * BigInt(config.vaultFeeBps)) / 10000n;
    const netProfit = profit - fee;

    this.totalValue += netProfit;
    this.totalProfits += netProfit;
    this.totalLiquidations += 1;

    logger.info('Profit recorded', {
      grossProfit: profitAmount,
      fee: fee.toString(),
      netProfit: netProfit.toString(),
      totalValue: this.totalValue.toString(),
    });

    // Update current value for all investors
    this.updateInvestorValues();
  }

  /**
   * Allow a user to withdraw their investment
   * Returns the amount they can withdraw based on their share of the vault
   */
  async withdraw(userAddress: string, shareAmount?: string): Promise<string> {
    if (!config.vaultEnabled) {
      throw new Error('Vault functionality is disabled');
    }

    const investor = this.investors.get(userAddress);
    if (!investor) {
      throw new Error('No investment found for this address');
    }

    const userShares = BigInt(investor.shares);
    const sharesToWithdraw = shareAmount ? BigInt(shareAmount) : userShares;

    if (sharesToWithdraw > userShares) {
      throw new Error('Insufficient shares');
    }

    // Calculate withdrawal amount based on share percentage
    // withdrawAmount = (sharesToWithdraw / totalShares) * totalValue
    const withdrawAmount = (sharesToWithdraw * this.totalValue) / this.totalShares;

    // Update investor record
    const remainingShares = userShares - sharesToWithdraw;
    if (remainingShares === 0n) {
      this.investors.delete(userAddress);
    } else {
      investor.shares = remainingShares.toString();
      investor.currentValue = ((remainingShares * this.totalValue) / this.totalShares).toString();
    }

    // Update totals
    this.totalShares -= sharesToWithdraw;
    this.totalValue -= withdrawAmount;

    logger.info('Withdrawal processed', {
      user: userAddress,
      shares: sharesToWithdraw.toString(),
      amount: withdrawAmount.toString(),
      remainingShares: remainingShares.toString(),
    });

    return withdrawAmount.toString();
  }

  /**
   * Get metrics for the vault
   */
  getMetrics(): VaultMetrics {
    const roi = this.totalShares > 0n
      ? Number((this.totalProfits * 10000n) / this.totalValue) / 100
      : 0;

    return {
      totalShares: this.totalShares.toString(),
      totalValue: this.totalValue.toString(),
      totalInvestors: this.investors.size,
      totalLiquidations: this.totalLiquidations,
      totalProfits: this.totalProfits.toString(),
      performanceFee: `${config.vaultFeeBps / 100}%`,
      roi,
    };
  }

  /**
   * Get investor information
   */
  getInvestor(userAddress: string): VaultInvestor | undefined {
    return this.investors.get(userAddress);
  }

  /**
   * Get all investors
   */
  getAllInvestors(): VaultInvestor[] {
    return Array.from(this.investors.values());
  }

  /**
   * Update current value for all investors based on their share percentage
   */
  private updateInvestorValues(): void {
    for (const investor of this.investors.values()) {
      const shares = BigInt(investor.shares);
      investor.currentValue = ((shares * this.totalValue) / this.totalShares).toString();
    }
  }
}
