import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";

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
  
  // State for active action and input amounts for each position
  const [activeActions, setActiveActions] = useState<Record<string, 'deposit' | 'withdraw' | 'mint' | 'repay' | null>>({});
  const [inputAmounts, setInputAmounts] = useState<Record<string, string>>({});
  const [maxStates, setMaxStates] = useState<Record<string, boolean>>({});

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
      
      // Initialize state for each position
      const initialActiveActions: Record<string, null> = {};
      const initialAmounts: Record<string, string> = {};
      const initialMaxStates: Record<string, boolean> = {};
      dummyPositions.forEach(position => {
        initialActiveActions[position.asset] = null;
        initialAmounts[position.asset] = "";
        initialMaxStates[position.asset] = false;
      });
      setActiveActions(initialActiveActions);
      setInputAmounts(initialAmounts);
      setMaxStates(initialMaxStates);
      
      setLoading(false);
    };

    fetchPositions();
  }, []);

  // Handle dropdown action selection
  const handleActionSelect = (asset: string, action: 'deposit' | 'withdraw' | 'mint' | 'repay') => {
    const currentAction = activeActions[asset];
    
    if (currentAction === action) {
      // If selecting the same action, hide the input/button
      setActiveActions(prev => ({ ...prev, [asset]: null }));
      setInputAmounts(prev => ({ ...prev, [asset]: "" }));
      setMaxStates(prev => ({ ...prev, [asset]: false }));
    } else {
      // Show the selected action input/button
      setActiveActions(prev => ({ ...prev, [asset]: action }));
      setInputAmounts(prev => ({ ...prev, [asset]: "" })); // Reset input amount
      setMaxStates(prev => ({ ...prev, [asset]: false })); // Reset max state
    }
  };

  // Handle input amount changes
  const handleInputChange = (asset: string, value: string) => {
    // If user manually types, disable max state
    if (maxStates[asset]) {
      setMaxStates(prev => ({ ...prev, [asset]: false }));
    }
    setInputAmounts(prev => ({ ...prev, [asset]: value }));
  };

  // Calculate maximum allowed value for each action
  const calculateMaxValue = (position: PositionData, action: 'deposit' | 'withdraw' | 'mint' | 'repay'): string => {
    const currentCollateral = parseFloat(position.collateralAmount);
    const currentDebt = parseFloat(position.debtAmount);
    const currentCollateralUSD = parseFloat(position.collateralValueUSD);
    const pricePerUnit = currentCollateralUSD / currentCollateral;

    switch (action) {
      case 'deposit': {
        // For deposit, we could set a reasonable limit or user's wallet balance
        // For now, using a placeholder max value
        return "1000"; // TODO: Replace with actual wallet balance
      }
      
      case 'withdraw': {
        // Maximum withdraw is current collateral, but we should consider maintaining health factor
        // For safety, allow withdrawal that keeps health factor above 1.5
        if (currentDebt === 0) {
          return currentCollateral.toString();
        }
        // Calculate max withdrawal while maintaining health factor > 1.5
        const minHealthFactor = 1.5;
        const requiredCollateralRatio = position.liquidationRatio * minHealthFactor;
        const requiredCollateralUSD = (currentDebt * requiredCollateralRatio) / 100;
        const requiredCollateral = requiredCollateralUSD / pricePerUnit;
        const maxWithdraw = Math.max(0, currentCollateral - requiredCollateral);
        return maxWithdraw.toFixed(6);
      }
      
      case 'mint': {
        // Maximum mint while maintaining health factor above 1.5
        const safeHealthFactor = 1.5;
        const safeCollateralRatio = position.liquidationRatio * safeHealthFactor;
        const maxDebtUSD = (currentCollateralUSD * 100) / safeCollateralRatio;
        const maxMint = Math.max(0, maxDebtUSD - currentDebt);
        return maxMint.toFixed(2);
      }
      
      case 'repay': {
        // Maximum repay is current debt
        return currentDebt.toString();
      }
      
      default:
        return "0";
    }
  };

  // Handle MAX button click
  const handleMaxClick = (asset: string, action: 'deposit' | 'withdraw' | 'mint' | 'repay') => {
    const position = positions.find(p => p.asset === asset);
    if (!position) return;

    const isCurrentlyMax = maxStates[asset];
    
    if (isCurrentlyMax) {
      // If currently in max state, disable it and clear input
      setMaxStates(prev => ({ ...prev, [asset]: false }));
      setInputAmounts(prev => ({ ...prev, [asset]: "" }));
    } else {
      // Enable max state and set max value
      const maxValue = calculateMaxValue(position, action);
      setMaxStates(prev => ({ ...prev, [asset]: true }));
      setInputAmounts(prev => ({ ...prev, [asset]: maxValue }));
    }
  };

  // Calculate preview values based on input
  const calculatePreviewValues = (position: PositionData, action: 'deposit' | 'withdraw' | 'mint' | 'repay', inputAmount: string) => {
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) return null;

    const currentCollateral = parseFloat(position.collateralAmount);
    const currentDebt = parseFloat(position.debtAmount);
    const currentCollateralUSD = parseFloat(position.collateralValueUSD);
    const currentDebtUSD = parseFloat(position.debtValueUSD);
    
    // Assume price per unit of collateral
    const pricePerUnit = currentCollateralUSD / currentCollateral;
    
    let newCollateral = currentCollateral;
    let newCollateralUSD = currentCollateralUSD;
    let newDebt = currentDebt;
    let newDebtUSD = currentDebtUSD;

    switch (action) {
      case 'deposit':
        newCollateral = currentCollateral + amount;
        newCollateralUSD = newCollateral * pricePerUnit;
        break;
      case 'withdraw':
        newCollateral = Math.max(0, currentCollateral - amount);
        newCollateralUSD = newCollateral * pricePerUnit;
        break;
      case 'mint':
        newDebt = currentDebt + amount;
        newDebtUSD = newDebt; // Assuming 1:1 USD peg for USDST
        break;
      case 'repay':
        newDebt = Math.max(0, currentDebt - amount);
        newDebtUSD = newDebt;
        break;
    }

    // Calculate new health factor
    const newCR = newDebt > 0 ? (newCollateralUSD / newDebtUSD) * 100 : 999999;
    const newHealthFactor = calculateHealthFactor(newCR, position.liquidationRatio);

    return {
      collateralAmount: newCollateral.toFixed(2),
      collateralValueUSD: newCollateralUSD.toFixed(2),
      debtAmount: newDebt.toFixed(2),
      debtValueUSD: newDebtUSD.toFixed(2),
      healthFactor: newHealthFactor
    };
  };

  // Handle action button clicks
  const handleAction = (asset: string, action: 'deposit' | 'withdraw' | 'mint' | 'repay', amount: string) => {
    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    // TODO: Implement actual action calls to backend
    console.log(`${action} ${amount} for asset ${asset}`);
    alert(`${action.charAt(0).toUpperCase() + action.slice(1)} ${amount} - This will be implemented later`);
    
    // Clear the input after action
    setInputAmounts(prev => ({ ...prev, [asset]: "" }));
  };

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
          <CardTitle>Your Vaults</CardTitle>
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
        <CardTitle>Your Vaults</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {positions.map((position, index) => {
            const healthFactor = calculateHealthFactor(position.collateralizationRatio, position.liquidationRatio);
            const activeAction = activeActions[position.asset];
            const inputAmount = inputAmounts[position.asset] || "";
            const previewValues = activeAction && inputAmount ? calculatePreviewValues(position, activeAction, inputAmount) : null;
            
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
                
                {/* 3-dot options menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleActionSelect(position.asset, 'deposit')}>
                      Deposit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleActionSelect(position.asset, 'withdraw')}>
                      Withdraw
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleActionSelect(position.asset, 'mint')}>
                      Mint
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleActionSelect(position.asset, 'repay')}>
                      Repay
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

              {/* Preview Values */}
              {previewValues && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <h5 className="text-sm font-medium text-blue-900 mb-2">New Values After {activeAction}:</h5>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-blue-600 mb-1">Collateral</p>
                      <p className="font-semibold text-blue-900">{previewValues.collateralAmount} {position.symbol}</p>
                      <p className="text-xs text-blue-500">${previewValues.collateralValueUSD}</p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-600 mb-1">Borrowed</p>
                      <p className="font-semibold text-blue-900">{previewValues.debtAmount} USDST</p>
                      <p className="text-xs text-blue-500">${previewValues.debtValueUSD}</p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-600 mb-1">Health Factor</p>
                      <p className={`font-semibold ${getHealthFactorColor(previewValues.healthFactor)}`}>
                        {previewValues.healthFactor.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-600 mb-1">Stability Fee</p>
                      <p className="font-semibold text-blue-900">{position.stabilityFeeRate.toFixed(2)}%</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Conditional Action Input/Button */}
              {activeActions[position.asset] && (
                <div className="mt-4 flex gap-2">
                  <Input
                    placeholder="Amount"
                    value={inputAmounts[position.asset] || ""}
                    onChange={(e) => handleInputChange(position.asset, e.target.value)}
                    className={`flex-1 ${maxStates[position.asset] ? 'text-blue-600 bg-blue-50 border-blue-300' : ''}`}
                    type="number"
                    step="any"
                    readOnly={maxStates[position.asset]}
                  />
                  <Button 
                    variant={maxStates[position.asset] ? "default" : "outline"}
                    size="sm" 
                    className={`min-w-[50px] ${maxStates[position.asset] ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
                    onClick={() => handleMaxClick(position.asset, activeActions[position.asset]!)}
                  >
                    MAX
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="min-w-[80px]"
                    onClick={() => handleAction(position.asset, activeActions[position.asset]!, inputAmounts[position.asset] || "")}
                  >
                    {activeActions[position.asset]!.charAt(0).toUpperCase() + activeActions[position.asset]!.slice(1)}
                  </Button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default PositionsList;
