import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";
import { cdpService, VaultData, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";

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

// Format large numbers for display
const formatNumber = (num: number | string, decimals: number = 2): string => {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(value)) return '0';
  
  // For very large numbers, use scientific notation
  if (value >= 1e21) {
    return value.toExponential(2);
  }
  
  // For large numbers, use K/M/B notation
  if (value >= 1e9) {
    return (value / 1e9).toFixed(1) + 'B';
  }
  if (value >= 1e6) {
    return (value / 1e6).toFixed(1) + 'M';
  }
  if (value >= 1e3) {
    return (value / 1e3).toFixed(1) + 'K';
  }
  
  // For normal numbers, limit decimal places
  return value.toFixed(decimals);
};

// Format percentage with reasonable precision
const formatPercentage = (num: number, decimals: number = 2): string => {
  if (isNaN(num)) return '0.00%';
  return num.toFixed(decimals) + '%';
};

// Convert wei string to decimal for display (handles raw integer strings from backend)
const formatWeiToDecimal = (weiString: string, decimals: number): string => {
  if (!weiString || weiString === '0') return '0';
  
  const wei = BigInt(weiString);
  const divisor = BigInt(10) ** BigInt(decimals);
  const quotient = wei / divisor;
  const remainder = wei % divisor;
  
  if (remainder === 0n) {
    return quotient.toString();
  }
  
  // For non-zero remainder, show decimal places
  const decimalPart = remainder.toString().padStart(decimals, '0');
  const trimmedDecimal = decimalPart.replace(/0+$/, ''); // Remove trailing zeros
  
  if (trimmedDecimal === '') {
    return quotient.toString();
  }
  
  return `${quotient}.${trimmedDecimal}`;
};

/**
 * VaultsList component displays user's CDP vaults
 * Each vault represents a collateral position with corresponding debt
 * Connected to backend API for real-time data
 */
const VaultsList: React.FC = () => {
  const [positions, setPositions] = useState<VaultData[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  
  // State for active action and input amounts for each position
  const [activeActions, setActiveActions] = useState<Record<string, 'deposit' | 'withdraw' | 'mint' | 'repay' | null>>({});
  const [inputAmounts, setInputAmounts] = useState<Record<string, string>>({});
  const [maxStates, setMaxStates] = useState<Record<string, boolean>>({});

  // Fetch positions from backend
  useEffect(() => {
    const fetchPositions = async () => {
      setLoading(true);
      try {
        const fetchedPositions = await cdpService.getVaults();
        setPositions(fetchedPositions);
        
        // Initialize state for each position
        const initialActiveActions: Record<string, null> = {};
        const initialAmounts: Record<string, string> = {};
        const initialMaxStates: Record<string, boolean> = {};
        fetchedPositions.forEach(position => {
          initialActiveActions[position.asset] = null;
          initialAmounts[position.asset] = "";
          initialMaxStates[position.asset] = false;
        });
        setActiveActions(initialActiveActions);
        setInputAmounts(initialAmounts);
        setMaxStates(initialMaxStates);
      } catch (error) {
        console.error("Failed to fetch positions:", error);
        toast({
          title: "Error",
          description: "Failed to load your vaults. Please try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchPositions();
  }, [toast]);

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
  const calculateMaxValue = (position: VaultData, action: 'deposit' | 'withdraw' | 'mint' | 'repay'): string => {
    // Convert wei strings to decimal numbers for calculations
    const currentCollateral = parseFloat(formatWeiToDecimal(position.collateralAmount, position.collateralAmountDecimals));
    const currentDebt = parseFloat(formatWeiToDecimal(position.debtAmount, 18));
    const currentCollateralUSD = parseFloat(formatWeiToDecimal(position.collateralValueUSD, 18));
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
        return formatNumber(maxWithdraw, 6);
      }
      
      case 'mint': {
        // Maximum mint while maintaining health factor above 1.5
        const safeHealthFactor = 1.5;
        const safeCollateralRatio = position.liquidationRatio * safeHealthFactor;
        const maxDebtUSD = (currentCollateralUSD * 100) / safeCollateralRatio;
        const maxMint = Math.max(0, maxDebtUSD - currentDebt);
        return formatNumber(maxMint);
      }
      
      case 'repay': {
        // Maximum repay is current debt
        return formatNumber(currentDebt);
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
  const calculatePreviewValues = (position: VaultData, action: 'deposit' | 'withdraw' | 'mint' | 'repay', inputAmount: string) => {
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) return null;

    // Convert wei strings to decimal numbers for calculations
    const currentCollateral = parseFloat(formatWeiToDecimal(position.collateralAmount, position.collateralAmountDecimals));
    const currentDebt = parseFloat(formatWeiToDecimal(position.debtAmount, 18));
    const currentCollateralUSD = parseFloat(formatWeiToDecimal(position.collateralValueUSD, 18));
    const currentDebtUSD = parseFloat(formatWeiToDecimal(position.debtValueUSD, 18));
    
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
    const newHealthFactor = newDebt > 0 
      ? calculateHealthFactor(newCR, position.liquidationRatio)
      : Infinity;

    return {
      collateralAmount: formatNumber(newCollateral),
      collateralValueUSD: formatNumber(newCollateralUSD),
      debtAmount: formatNumber(newDebt),
      debtValueUSD: formatNumber(newDebtUSD),
      healthFactor: newHealthFactor
    };
  };

  // Handle action button clicks
  const handleAction = async (asset: string, action: 'deposit' | 'withdraw' | 'mint' | 'repay', amount: string) => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount greater than 0",
        variant: "destructive",
      });
      return;
    }

    try {
      let result;
      
      switch (action) {
        case 'deposit':
          result = await cdpService.deposit(asset, amount);
          break;
        case 'withdraw':
          result = await cdpService.withdraw(asset, amount);
          break;
        case 'mint':
          result = await cdpService.mint(asset, amount);
          break;
        case 'repay':
          result = await cdpService.repay(asset, amount);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      if (result.status.toLowerCase() === "success") {
        toast({
          title: "Success",
          description: `${action.charAt(0).toUpperCase() + action.slice(1)} completed successfully. Tx: ${result.hash}`,
        });
        
        // Clear the input and reset states after successful action
        setInputAmounts(prev => ({ ...prev, [asset]: "" }));
        setMaxStates(prev => ({ ...prev, [asset]: false }));
        setActiveActions(prev => ({ ...prev, [asset]: null }));
        
        // Refresh positions data
        const updatedPositions = await cdpService.getVaults();
        setPositions(updatedPositions);
      } else {
        throw new Error(`${action} failed`);
      }
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
      toast({
        title: "Transaction Failed",
        description: `Failed to ${action}. Please try again.`,
        variant: "destructive",
      });
    }
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
            const currentDebt = parseFloat(formatWeiToDecimal(position.debtAmount, 18));
            const hasDebt = currentDebt > 0;
            const healthFactor = hasDebt 
              ? calculateHealthFactor(position.collateralizationRatio, position.liquidationRatio)
              : Infinity;
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
                  <p className="font-semibold">{formatNumber(parseFloat(formatWeiToDecimal(position.collateralAmount, position.collateralAmountDecimals)))} {position.symbol}</p>
                  <p className="text-xs text-gray-400">${formatNumber(parseFloat(formatWeiToDecimal(position.collateralValueUSD, 18)))}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Debt</p>
                  <p className="font-semibold">{formatNumber(parseFloat(formatWeiToDecimal(position.debtAmount, 18)))} USDST</p>
                  <p className="text-xs text-gray-400">${formatNumber(parseFloat(formatWeiToDecimal(position.debtValueUSD, 18)))}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Health Factor</p>
                  <p className={`font-semibold ${hasDebt ? getHealthFactorColor(healthFactor) : 'text-green-600'}`}>
                    {hasDebt ? formatNumber(healthFactor) : '∞'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Stability Fee</p>
                  <p className="font-semibold">{formatPercentage(position.stabilityFeeRate)}</p>
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
                      <p className={`font-semibold ${previewValues.healthFactor === Infinity ? 'text-green-600' : getHealthFactorColor(previewValues.healthFactor)}`}>
                        {previewValues.healthFactor === Infinity ? '∞' : formatNumber(previewValues.healthFactor)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-600 mb-1">Stability Fee</p>
                      <p className="font-semibold text-blue-900">{formatPercentage(position.stabilityFeeRate)}</p>
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

export default VaultsList;
