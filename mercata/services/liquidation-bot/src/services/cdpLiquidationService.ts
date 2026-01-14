import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { LiquidatablePosition, LiquidationResult } from '../types';

export class CDPLiquidationService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.stratoUrl;
  }

  async fetchLiquidatablePositions(): Promise<LiquidatablePosition[]> {
    try {
      logger.info('Fetching liquidatable CDP positions');

      // Query CDP backend API for liquidatable vaults
      const response = await axios.get(`${this.baseUrl}/cdp/liquidatable`, {
        headers: {
          Authorization: `Bearer ${config.botOAuthToken}`,
        },
      });

      const positions = response.data.map((vault: any) => ({
        user: vault.owner,
        asset: vault.asset,
        collateralAmount: vault.collateralAmount,
        debtAmount: vault.debtAmount,
        collateralizationRatio: vault.collateralizationRatio,
        liquidationRatio: vault.liquidationRatio,
        estimatedProfit: vault.estimatedProfit || '0',
        positionType: 'CDP' as const,
      }));

      logger.info(`Found ${positions.length} liquidatable CDP positions`);
      return positions;
    } catch (error) {
      logger.error('Error fetching liquidatable CDP positions', { error });
      return [];
    }
  }

  async executeLiquidation(position: LiquidatablePosition): Promise<LiquidationResult> {
    try {
      logger.info('Executing CDP liquidation', {
        user: position.user,
        asset: position.asset,
      });

      // Call CDP liquidate function
      const response = await axios.post(
        `${this.baseUrl}/cdp/liquidate`,
        {
          collateralAsset: position.asset,
          borrower: position.user,
          debtToCover: position.debtAmount,
        },
        {
          headers: {
            Authorization: `Bearer ${config.botOAuthToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const result: LiquidationResult = {
        success: true,
        positionId: `${position.user}-${position.asset}`,
        user: position.user,
        asset: position.asset,
        debtRepaid: response.data.debtRepaid || position.debtAmount,
        collateralSeized: response.data.collateralSeized || '0',
        profit: response.data.profit || position.estimatedProfit,
        txHash: response.data.txHash,
      };

      logger.info('CDP liquidation executed successfully', result);
      return result;
    } catch (error: any) {
      logger.error('Error executing CDP liquidation', {
        user: position.user,
        asset: position.asset,
        error: error.message,
      });

      return {
        success: false,
        positionId: `${position.user}-${position.asset}`,
        user: position.user,
        asset: position.asset,
        debtRepaid: '0',
        collateralSeized: '0',
        profit: '0',
        error: error.message,
      };
    }
  }
}
