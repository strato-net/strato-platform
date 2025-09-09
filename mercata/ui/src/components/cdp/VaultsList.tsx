import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";
import { cdpService, VaultData, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { useOracleContext } from "@/context/OracleContext";
import { usdstAddress } from "@/lib/constants";

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

interface VaultsListProps {
  refreshTrigger?: number; // Increment this to trigger a refresh
  onVaultActionSuccess?: () => void; // Callback when vault actions succeed
}

/**
 * VaultsList component displays user's CDP vaults
 * Each vault represents a collateral position with corresponding debt
 * Connected to backend API for real-time data
 */
const VaultsList: React.FC<VaultsListProps> = ({ refreshTrigger, onVaultActionSuccess }) => {
  const [positions, setPositions] = useState<VaultData[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { activeTokens } = useUserTokens();
  const { getPrice } = useOracleContext();
  
  // State for active action and input amounts for each position
  const [activeActions, setActiveActions] = useState<Record<string, 'deposit' | 'withdraw' | 'borrow' | 'repay' | null>>({});
  const [inputAmounts, setInputAmounts] = useState<Record<string, string>>({});
  const [maxStates, setMaxStates] = useState<Record<string, boolean>>({});
  const [maxValues, setMaxValues] = useState<Record<string, number>>({});  // Store max values for comparison

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
  }, [toast, refreshTrigger]);

  // Handle dropdown action selection
  const handleActionSelect = (asset: string, action: 'deposit' | 'withdraw' | 'borrow' | 'repay') => {
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

  // Check if amount is above maximum for the given action (synchronous)
  const isAmountAboveMax = (asset: string, inputAmount: string): boolean => {
    const currentAmount = parseFloat(inputAmount || "0");
    if (currentAmount <= 0) return false;
    
    const maxAmount = maxValues[asset] || 0;
    return currentAmount > maxAmount;
  };

  // Handle input amount changes
  const handleInputChange = async (asset: string, value: string) => {
    const currentAmount = parseFloat(value || "0");
    const position = positions.find(p => p.asset === asset);
    const currentAction = activeActions[asset];
    
    if (!position || !currentAction) {
      setInputAmounts(prev => ({ ...prev, [asset]: value }));
      return;
    }

    try {
      const maxValue = await calculateMaxValue(position, currentAction);
      const maxAmount = parseFloat(maxValue);
      
      // Store the max value for comparison
      setMaxValues(prev => ({ ...prev, [asset]: maxAmount }));
      
      const isTypingMaxAmount = Math.abs(currentAmount - maxAmount) < 0.000001 && maxAmount > 0;
      
      if (isTypingMaxAmount && !maxStates[asset]) {
        // User typed the max amount, activate MAX styling
        setMaxStates(prev => ({ ...prev, [asset]: true }));
      } else if (maxStates[asset]) {
        // If MAX is currently enabled, check if user changed the value
        if (currentAmount < maxAmount) {
          // User reduced the amount below max, disable MAX mode
          setMaxStates(prev => ({ ...prev, [asset]: false }));
        } else if (currentAmount > maxAmount) {
          // User increased above max, keep MAX enabled but input will show red
          // The red styling is handled by isAmountAboveMax()
        }
      }
    } catch (error) {
      console.error("Failed to calculate max value during input change:", error);
    }
    
    // Always update the input amount
    setInputAmounts(prev => ({ ...prev, [asset]: value }));
  };

  // Calculate maximum allowed value for each action
  const calculateMaxValue = async (position: VaultData, action: 'deposit' | 'withdraw' | 'borrow' | 'repay'): Promise<string> => {
    switch (action) {
      case 'deposit': {
        // Find the user's balance for this token
        const userToken = activeTokens.find(token => 
          token.address.toLowerCase() === position.asset.toLowerCase()
        );
        
        if (userToken?.balance) {
          // Convert balance from wei to decimal format
          return formatWeiToDecimal(userToken.balance, position.collateralAmountDecimals);
        }
        
        // Fallback to 0 if no balance found
        return "0";
      }
      
      case 'withdraw': {
        try {
          // Use the backend endpoint that simulates the contract's withdrawMax logic
          const result = await cdpService.getMaxWithdraw(position.asset);
          // Convert from wei to decimal format
          return formatWeiToDecimal(result.maxAmount, position.collateralAmountDecimals);
        } catch (error) {
          console.error("Failed to get max withdraw amount:", error);
          return "0";
        }
      }
      
      case 'borrow': {
        try {
          // Use the backend endpoint that calculates max borrowable amount (now without safety buffer)
          const result = await cdpService.getMaxMint(position.asset);
          // Convert from wei to decimal format (USDST is 18 decimals)
          return formatWeiToDecimal(result.maxAmount, 18);
        } catch (error) {
          console.error("Failed to get max borrow amount:", error);
          return "0";
        }
      }
      
      case 'repay': {
        // Maximum repay is min(current debt, available USDST balance)
        const currentDebt = parseFloat(formatWeiToDecimal(position.debtAmount, 18));
        const availableUSDST = parseFloat(formatWeiToDecimal(activeTokens.find(token => 
          token.address.toLowerCase() === usdstAddress.toLowerCase()
        )?.balance || "0", 18));
        
        const maxRepayAmount = Math.min(currentDebt, availableUSDST);
        return maxRepayAmount.toString();
      }
      
      default:
        return "0";
    }
  };

  // Handle MAX button click
  const handleMaxClick = async (asset: string, action: 'deposit' | 'withdraw' | 'borrow' | 'repay') => {
    const position = positions.find(p => p.asset === asset);
    if (!position) return;

    const isCurrentlyMax = maxStates[asset];
    
    if (isCurrentlyMax) {
      // If currently in max state, disable it and clear input
      setMaxStates(prev => ({ ...prev, [asset]: false }));
      setInputAmounts(prev => ({ ...prev, [asset]: "" }));
    } else {
      try {
        // Enable max state and set max value
        const maxValue = await calculateMaxValue(position, action);
        const maxAmount = parseFloat(maxValue);
        
        // Store the max value for comparison
        setMaxValues(prev => ({ ...prev, [asset]: maxAmount }));
        setMaxStates(prev => ({ ...prev, [asset]: true }));
        setInputAmounts(prev => ({ ...prev, [asset]: maxValue }));
      } catch (error) {
        console.error("Failed to calculate max value:", error);
        toast({
          title: "Error",
          description: "Failed to calculate maximum amount. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  // Calculate preview values based on input
  const calculatePreviewValues = (position: VaultData, action: 'deposit' | 'withdraw' | 'borrow' | 'repay', inputAmount: string) => {
    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) return null;

    // Convert wei strings to decimal numbers for calculations
    const currentCollateral = parseFloat(formatWeiToDecimal(position.collateralAmount, position.collateralAmountDecimals));
    const currentDebt = parseFloat(formatWeiToDecimal(position.debtAmount, 18));
    const currentCollateralUSD = parseFloat(formatWeiToDecimal(position.collateralValueUSD, 18));
    const currentDebtUSD = parseFloat(formatWeiToDecimal(position.debtValueUSD, 18));
    
    // Get the actual token price from oracle
    const priceWei = getPrice(position.asset);
    let pricePerUnit = 0;
    
    if (priceWei) {
      // Convert price from wei (18 decimals) to decimal
      pricePerUnit = parseFloat(formatWeiToDecimal(priceWei, 18));
    } else {
      // Fallback: calculate from current values if oracle price is not available
      if (currentCollateral > 0 && currentCollateralUSD > 0) {
        pricePerUnit = currentCollateralUSD / currentCollateral;
      }
    }
    
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
      case 'borrow':
        newDebt = currentDebt + amount;
        newDebtUSD = newDebt; // Assuming 1:1 USD peg for USDST
        break;
      case 'repay':
        newDebt = Math.max(0, currentDebt - amount);
        newDebtUSD = newDebt;
        break;
    }

    // Calculate new health factor with safety checks
    let newCR = 999999;
    let newHealthFactor = Infinity;
    
    if (newDebt > 0 && newDebtUSD > 0) {
      newCR = (newCollateralUSD / newDebtUSD) * 100;
      newHealthFactor = calculateHealthFactor(newCR, position.liquidationRatio);
    }

    return {
      collateralAmount: formatNumber(newCollateral),
      collateralValueUSD: formatNumber(newCollateralUSD),
      debtAmount: formatNumber(newDebt),
      debtValueUSD: formatNumber(newDebtUSD),
      healthFactor: newHealthFactor
    };
  };

  // Validate debt floor and ceiling constraints for borrow actions
  const validateDebtConstraints = async (asset: string, borrowAmountDecimal: number): Promise<boolean> => {
    if (borrowAmountDecimal <= 0) return true;

    try {
      // Get current asset debt info
      const debtInfo = await cdpService.getAssetDebtInfo(asset);
      
      // Keep everything in wei for accurate comparison (like blockchain)
      const currentAssetTotalDebtWei = BigInt(debtInfo.currentTotalDebt);
      const debtFloorWei = BigInt(debtInfo.debtFloor);
      const debtCeilingWei = BigInt(debtInfo.debtCeiling);
      
      // Convert borrow amount to wei (18 decimals)
      const borrowAmountWei = BigInt(Math.floor(borrowAmountDecimal * 1e18));

      // Check debt ceiling constraint (total debt for this asset across all users)
      if (debtCeilingWei > 0n) {
        const newAssetTotalDebtWei = currentAssetTotalDebtWei + borrowAmountWei;
        if (newAssetTotalDebtWei > debtCeilingWei) {
          const availableRoomWei = debtCeilingWei > currentAssetTotalDebtWei ? debtCeilingWei - currentAssetTotalDebtWei : 0n;
          const availableRoom = parseFloat(formatWeiToDecimal(availableRoomWei.toString(), 18));
          const debtCeilingDecimal = parseFloat(formatWeiToDecimal(debtCeilingWei.toString(), 18));
          
          toast({
            title: "Debt Ceiling Exceeded",
            description: `Cannot borrow ${borrowAmountDecimal.toFixed(2)} USDST. Maximum available: ${availableRoom.toFixed(2)} USDST (asset debt ceiling: ${debtCeilingDecimal.toFixed(2)} USDST)`,
            variant: "destructive",
          });
          return false;
        }
      }

      // Check debt floor constraint (per-user minimum debt)
      // We need to simulate the exact contract calculation to avoid precision gaps
      if (debtFloorWei > 0n) {
        const position = positions.find(p => p.asset === asset);
        if (position) {
          // Simulate the exact contract calculation:
          // 1. Convert borrow amount to scaled debt: scaledAdd = (amountUSD * RAY) / rateAccumulator
          // 2. Add to existing scaled debt: newScaledDebt = scaledDebt + scaledAdd  
          // 3. Convert back to debt: totalDebtAfter = (newScaledDebt * rateAccumulator) / RAY
          
          const RAY = BigInt("1000000000000000000000000000"); // 1e27
          const existingScaledDebtWei = BigInt(position.scaledDebt || "0");
          const rateAccumulatorWei = BigInt(position.rateAccumulator || "1000000000000000000000000000");
          
          // Step 1: Convert borrow amount to scaled debt (same as contract)
          const scaledAddWei = (borrowAmountWei * RAY) / rateAccumulatorWei;
          
          // Step 2: Add to existing scaled debt (same as contract)
          const newScaledDebtWei = existingScaledDebtWei + scaledAddWei;
          
          // Step 3: Convert back to debt for floor check (same as contract)
          const totalDebtAfterWei = (newScaledDebtWei * rateAccumulatorWei) / RAY;
          

          if (totalDebtAfterWei > 0n && totalDebtAfterWei < debtFloorWei) {
            // Calculate how much more is needed to reach debt floor
            const currentDebtWei = (existingScaledDebtWei * rateAccumulatorWei) / RAY;
            const minRequiredWei = debtFloorWei > currentDebtWei ? debtFloorWei - currentDebtWei : 0n;
            const minRequired = parseFloat(formatWeiToDecimal(minRequiredWei.toString(), 18));
            const debtFloorDecimal = parseFloat(formatWeiToDecimal(debtFloorWei.toString(), 18));
            const currentDebt = parseFloat(formatWeiToDecimal(currentDebtWei.toString(), 18));
            
            toast({
              title: "Below Debt Floor",
              description: `Borrow more USDST to reach the minimum debt floor`,
              variant: "destructive",
            });
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      console.error("Failed to validate debt constraints:", error);
      // Don't block the transaction if validation fails
      return true;
    }
  };

  // Handle action button clicks
  const handleAction = async (asset: string, action: 'deposit' | 'withdraw' | 'borrow' | 'repay', amount: string) => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount greater than 0",
        variant: "destructive",
      });
      return;
    }

    // Validate debt constraints for borrow actions
    if (action === 'borrow') {
      const borrowAmountDecimal = parseFloat(amount);
      const isValid = await validateDebtConstraints(asset, borrowAmountDecimal);
      if (!isValid) {
        return; // Validation failed, error already shown
      }
    }

    try {
      let result;
      
      switch (action) {
        case 'deposit':
          result = await cdpService.deposit(asset, amount);
          break;
        case 'withdraw':
          // If user is in max state, use withdrawMax endpoint
          if (maxStates[asset]) {
            result = await cdpService.withdrawMax(asset);
          } else {
            result = await cdpService.withdraw(asset, amount);
          }
          break;
        case 'borrow':
          // If user is in max state, use mintMax endpoint
          if (maxStates[asset]) {
            result = await cdpService.mintMax(asset);
          } else {
            result = await cdpService.mint(asset, amount);
          }
          break;
        case 'repay':
          // If user is in max state, check if they can repay all debt or just partial
          if (maxStates[asset]) {
            const position = positions.find(p => p.asset === asset);
            if (position) {
              const currentDebt = parseFloat(formatWeiToDecimal(position.debtAmount, 18));
              const availableUSDST = parseFloat(formatWeiToDecimal(activeTokens.find(token => 
                token.address.toLowerCase() === usdstAddress.toLowerCase()
              )?.balance || "0", 18));
              
              // Use repayAll only if user has enough USDST to cover full debt
              if (availableUSDST >= currentDebt) {
                result = await cdpService.repayAll(asset);
              } else {
                // Use regular repay with the limited amount they can afford
                result = await cdpService.repay(asset, amount);
              }
            } else {
              result = await cdpService.repay(asset, amount);
            }
          } else {
            result = await cdpService.repay(asset, amount);
          }
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
        
        // Call the callback to refresh other components (like deposits)
        if (onVaultActionSuccess) {
          onVaultActionSuccess();
        }
      } else {
        throw new Error(`${action} failed`);
      }
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
      
      // Extract detailed error information
      let errorMessage = `Failed to ${action}. Please try again.`;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        // Handle API errors
        const apiError = error as { 
          response?: { 
            data?: { 
              error?: { message?: string }; 
              message?: string 
            } 
          }; 
          message?: string 
        };
        if (apiError.response?.data?.error?.message) {
          // Backend sends errors in { error: { message, status, type } } format
          errorMessage = apiError.response.data.error.message;
        } else if (apiError.response?.data?.message) {
          // Fallback for direct message format
          errorMessage = apiError.response.data.message;
        } else if (apiError.message) {
          errorMessage = apiError.message;
        }
      }
      
      toast({
        title: "Transaction Failed",
        description: errorMessage,
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
            <div className="text-sm text-gray-400">Create your first position by depositing collateral and borrowing USDST above</div>
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
        <style>{`
          /* Hide number input arrows */
          input[type="number"]::-webkit-outer-spin-button,
          input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          input[type="number"] {
            -moz-appearance: textfield;
          }
        `}</style>
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
                    <DropdownMenuItem onClick={() => handleActionSelect(position.asset, 'borrow')}>
                      Borrow
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
                      <p className="text-xs text-blue-600 mb-1">Debt</p>
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
                    className={`flex-1 ${
                      maxStates[position.asset] 
                        ? 'text-blue-600 bg-blue-50 border-blue-300' 
                        : isAmountAboveMax(position.asset, inputAmounts[position.asset] || "")
                          ? 'text-red-600 bg-red-50 border-red-300'
                          : ''
                    }`}
                    type="number"
                    step="any"
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
                    disabled={isAmountAboveMax(position.asset, inputAmounts[position.asset] || "")}
                  >
                    {isAmountAboveMax(position.asset, inputAmounts[position.asset] || "") 
                      ? "Amount exceeds maximum"
                      : activeActions[position.asset]!.charAt(0).toUpperCase() + activeActions[position.asset]!.slice(1)
                    }
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
