import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PositionData {
  asset: string;
  symbol: string;
  collateralAmount: string;
  collateralValueUSD: string;
  debtAmount: string;
  debtValueUSD: string;
  collateralizationRatio: number;
  liquidationRatio: number;
  stabilityFeeRate: number;
  health: "healthy" | "warning" | "danger";
}

// Calculate Health Factor: CR / LT (Liquidation Threshold)
const calculateHealthFactor = (cr: number, lt: number): number => {
  return cr / lt;
};

// Get health factor color based on value
const getHealthFactorColor = (healthFactor: number): string => {
  if (healthFactor >= 1.5) return "text-black"; // Healthy - black
  if (healthFactor >= 1.1) return "text-yellow-600"; // Warning - yellow
  return "text-red-600"; // Danger - red
};

/**
 * PositionsList component displays user's CDP positions
 * Each position represents a collateral vault with corresponding debt
 * Currently uses dummy data - will connect to backend API later
 */
const PositionsList: React.FC = () => {
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [loading, setLoading] = useState(true);

  // Dummy data - will replace with API call
  useEffect(() => {
    const fetchPositions = async () => {
      setLoading(true);
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Dummy position data - each represents collateral + debt pair
      const dummyPositions: PositionData[] = [
        {
          asset: "0x1234567890123456789012345678901234567890",
          symbol: "wstETH",
          collateralAmount: "2.5",
          collateralValueUSD: "10000.00",
          debtAmount: "5000.00",
          debtValueUSD: "5000.00",
          collateralizationRatio: 200,
          liquidationRatio: 150,
          stabilityFeeRate: 5.54,
          health: "healthy"
        },
        {
          asset: "0x2345678901234567890123456789012345678901",
          symbol: "WBTC",
          collateralAmount: "0.15",
          collateralValueUSD: "15000.00",
          debtAmount: "8000.00",
          debtValueUSD: "8000.00",
          collateralizationRatio: 187.5,
          liquidationRatio: 150,
          stabilityFeeRate: 4.25,
          health: "healthy"
        },
        {
          asset: "0x3456789012345678901234567890123456789012",
          symbol: "ETH",
          collateralAmount: "5.0",
          collateralValueUSD: "20000.00",
          debtAmount: "12000.00",
          debtValueUSD: "12000.00",
          collateralizationRatio: 166.67,
          liquidationRatio: 150,
          stabilityFeeRate: 6.12,
          health: "warning"
        }
      ];
      
      setPositions(dummyPositions);
      setLoading(false);
    };

    fetchPositions();
  }, []);



  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Your Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Loading positions...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (positions.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Your Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="text-gray-500 mb-4">No positions found</div>
            <div className="text-sm text-gray-400">Create your first position by depositing collateral and minting USDST above</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Your Positions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {positions.map((position, index) => {
            const healthFactor = calculateHealthFactor(position.collateralizationRatio, position.liquidationRatio);
            
            return (
            <div
              key={`${position.asset}-${index}`}
              className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-semibold">
                    {position.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <h4 className="font-semibold">{position.symbol}</h4>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Collateral</p>
                  <p className="font-semibold">{position.collateralAmount} {position.symbol}</p>
                  <p className="text-xs text-gray-400">${position.collateralValueUSD}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Debt</p>
                  <p className="font-semibold">{position.debtAmount} USDST</p>
                  <p className="text-xs text-gray-400">${position.debtValueUSD}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Health Factor</p>
                  <p className={`font-semibold ${getHealthFactorColor(healthFactor)}`}>{healthFactor.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Stability Fee</p>
                  <p className="font-semibold">{position.stabilityFeeRate.toFixed(2)}%</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1">
                  Deposit
                </Button>
                <Button variant="outline" size="sm" className="flex-1">
                  Withdraw
                </Button>
                <Button variant="outline" size="sm" className="flex-1">
                  Mint
                </Button>
                <Button variant="outline" size="sm" className="flex-1">
                  Repay
                </Button>
              </div>
            </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default PositionsList;
