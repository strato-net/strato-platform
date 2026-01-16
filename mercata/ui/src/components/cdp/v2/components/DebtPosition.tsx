import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cdpService } from '@/services/cdpService';
import type { Vault } from '@/components/cdp/v2/cdpTypes';
import { formatWeiToDecimalHP } from '@/utils/numberUtils';
import { formatNumber } from '@/utils/numberUtils';
import { calculatePositionMetrics } from '@/components/cdp/v2/cdpUtils';

interface DebtPositionProps {
  refreshTrigger?: number;
}

const DebtPosition: React.FC<DebtPositionProps> = ({ refreshTrigger }) => {
  const [positions, setPositions] = useState<Vault[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPositions = async () => {
      setLoading(true);
      try {
        const fetchedPositions = await cdpService.getVaults();
        setPositions(fetchedPositions);
      } catch (error) {
        console.error('Failed to fetch positions:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPositions();
  }, [refreshTrigger]);

  const { totalMinted, weightedAverageFee, totalCollateralUSD, overallHealthFactor } = useMemo(() => 
    calculatePositionMetrics(
      positions.map(pos => ({
        debtAmount: pos.debtAmount,
        collateralValueUSD: pos.collateralValueUSD,
        stabilityFeeRate: pos.stabilityFeeRate,
        liquidationRatio: pos.liquidationRatio,
        collateralizationRatio: pos.collateralizationRatio,
      })),
      formatWeiToDecimalHP
    ),
  [positions]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Position</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Position</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Debt</span>
            <span className="text-sm font-semibold">{formatNumber(totalMinted, 2)} USDST</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Average Stability Fee</span>
            <span className="text-sm font-semibold">
              {weightedAverageFee > 0 ? `${formatNumber(weightedAverageFee, 2)}%` : '1.50%'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Average Health Factor</span>
            <span className="text-sm font-semibold">
              {overallHealthFactor === Infinity ? 'No Position' : formatNumber(overallHealthFactor, 2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Vault Collateral Supplied</span>
            <span className="text-sm font-semibold">${formatNumber(totalCollateralUSD, 2)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DebtPosition;

