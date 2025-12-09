import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cdpService, VaultData, AssetConfig, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { formatWeiToDecimalHP, formatNumber } from "@/utils/numberUtils";

interface LiquidationsViewProps {
  // Props can be added here if needed in the future
  children?: never; // Placeholder to make interface non-empty
}

// Format percentage with reasonable precision
const formatPercentage = (num: number, decimals: number = 2): string => {
  if (isNaN(num)) return '0.00%';
  return num.toFixed(decimals) + '%';
};

const LiquidationsView: React.FC<LiquidationsViewProps> = () => {
  const [liquidatableVaults, setLiquidatableVaults] = useState<VaultData[]>([]);
  const [assetConfigs, setAssetConfigs] = useState<Record<string, AssetConfig>>({});
  const [loading, setLoading] = useState(true);
  const [expandedVaults, setExpandedVaults] = useState<Record<string, boolean>>({});
  const [liquidationAmounts, setLiquidationAmounts] = useState<Record<string, string>>({});
  const [liquidatingVaults, setLiquidatingVaults] = useState<Record<string, boolean>>({});
  const [maxStates, setMaxStates] = useState<Record<string, boolean>>({});
  const [maxValues, setMaxValues] = useState<Record<string, number>>({});
  const [availableUsdstBalance, setAvailableUsdstBalance] = useState<number>(0);
  const [isGlobalPaused, setIsGlobalPaused] = useState<boolean>(false);
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { fetchTokens } = useUserTokens();
  const { fetchUsdstBalance, usdstBalance } = useTokenContext();

  // Fetch liquidatable positions, asset configs, and USDST balance
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch global pause status
        let globalPaused = false;
        try {
          const globalPauseStatus = await cdpService.getGlobalPaused();
          globalPaused = globalPauseStatus.isPaused;
          setIsGlobalPaused(globalPaused);
        } catch (error) {
          console.error("Failed to fetch global pause status:", error);
          setIsGlobalPaused(false); // Default to not paused if we can't fetch
        }

        // Fetch liquidatable vaults
        const liquidatable = await cdpService.getLiquidatable();

        // Fetch asset configs for each unique asset
        const uniqueAssets = [
          ...new Set(liquidatable.map((vault) => vault.asset)),
        ];
        const configPromises = uniqueAssets.map(async (asset) => {
          try {
            const config = await cdpService.getAssetConfig(asset);
            return { asset, config };
          } catch (error) {
            console.error(`Error fetching config for asset ${asset}:`, error);
            return { asset, config: null };
          }
        });

        const configResults = await Promise.all(configPromises);
        const configsMap: Record<string, AssetConfig> = {};
        configResults.forEach(({ asset, config }) => {
          if (config) {
            configsMap[asset] = config;
          }
        });
        setAssetConfigs(configsMap);

        // Filter out paused positions (global pause OR individual asset pause) and positions with 0 collateral
        const filteredLiquidatable = liquidatable.filter((vault) => {
          const assetConfig = configsMap[vault.asset];
          // Exclude if globally paused OR if this specific asset is paused
          const isPaused = globalPaused || (assetConfig?.isPaused ?? false);
          // Exclude if collateral amount is 0
          const hasCollateral =
            vault.collateralAmount &&
            vault.collateralAmount !== "0" &&
            BigInt(vault.collateralAmount) > 0n;
          return !isPaused && hasCollateral;
        });
        setLiquidatableVaults(filteredLiquidatable);

        // Fetch USDST balance once for the entire component
        await fetchUsdstBalance();
        const availableUsdstWei = BigInt(usdstBalance || "0");
        const availableUsdstDecimal = parseFloat(
          formatWeiToDecimalHP(availableUsdstWei.toString(), 18)
        );
        setAvailableUsdstBalance(availableUsdstDecimal);
      } catch (error) {
        console.error("Error fetching data:", error);
        toast({
          title: "Error",
          description: "Failed to fetch liquidatable positions",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [toast, userAddress, fetchUsdstBalance, usdstBalance]);

  const toggleExpanded = async (vaultKey: string) => {
    const isCurrentlyExpanded = expandedVaults[vaultKey];
    
    setExpandedVaults(prev => ({
      ...prev,
      [vaultKey]: !prev[vaultKey]
    }));
    
    // If expanding the vault and we don't have max value yet, fetch it
    if (!isCurrentlyExpanded && !maxValues[vaultKey]) {
      const vaultIndex = parseInt(vaultKey.split('-').pop() || '0');
      const vault = liquidatableVaults[vaultIndex];
      
      if (vault && vault.borrower) {
        try {
          // Fetch max liquidatable amount from backend
          const result = await cdpService.getMaxLiquidatable(vault.asset, vault.borrower);
          const backendMaxWei = result.maxAmount;
          
          // Convert backend max from wei to decimal (18 decimals for USDST)
          const backendMaxDecimal = parseFloat(formatWeiToDecimalHP(backendMaxWei, 18));
          
          // Calculate actual max as minimum of backend max and available USDST balance
          const actualMaxDecimal = Math.min(backendMaxDecimal, availableUsdstBalance - 0.02);
          
          // Store the max value
          setMaxValues(prev => ({ ...prev, [vaultKey]: actualMaxDecimal }));
          
        } catch (error) {
          console.error("Error fetching max liquidatable amount:", error);
        }
      }
    }
  };

  const handleLiquidationAmountChange = (vaultKey: string, value: string) => {
    setLiquidationAmounts(prev => ({
      ...prev,
      [vaultKey]: value
    }));
    
    // Check if the entered amount equals the max amount
    const enteredAmount = parseFloat(value);
    const maxAmount = maxValues[vaultKey];
    
    if (!isNaN(enteredAmount) && maxAmount && Math.abs(enteredAmount - maxAmount) < 0.000001) {
      // Re-enter max state if amount equals max
      setMaxStates(prev => ({ ...prev, [vaultKey]: true }));
    } else if (maxStates[vaultKey]) {
      // Clear max state when user manually changes the amount to something different
      setMaxStates(prev => ({ ...prev, [vaultKey]: false }));
    }
  };

  // Check if current amount exceeds maximum
  const isAmountExceedsMax = (vaultKey: string): boolean => {
    const currentAmount = parseFloat(liquidationAmounts[vaultKey] || "0");
    const maxAmount = maxValues[vaultKey];
    return maxAmount && currentAmount > maxAmount;
  };

  // Check if USDST balance is insufficient (less than 0.02)
  const isUsdstBalanceInsufficient = (): boolean => {
    return availableUsdstBalance < 0.02;
  };

  // Handle MAX button click
  const handleMaxClick = async (vault: VaultData, vaultKey: string) => {
    const isCurrentlyMax = maxStates[vaultKey];
    if (isCurrentlyMax) {
      // Clear max state and amount
      setMaxStates(prev => ({ ...prev, [vaultKey]: false }));
      setLiquidationAmounts(prev => ({ ...prev, [vaultKey]: "" }));
    } else {
      // Check if balance is insufficient
      if (availableUsdstBalance < 0.02) {
        return;
      }
      
      // Use already-fetched max value if available, otherwise fetch it
      let actualMaxDecimal = maxValues[vaultKey];
      
      if (!actualMaxDecimal) {
        try {
          // Fetch max liquidatable amount from backend if not already available
          const result = await cdpService.getMaxLiquidatable(vault.asset, vault.borrower!);
          const backendMaxWei = result.maxAmount;
          
          // Convert backend max from wei to decimal (18 decimals for USDST)
          const backendMaxDecimal = parseFloat(formatWeiToDecimalHP(backendMaxWei, 18));
          
          // Calculate actual max as minimum of backend max and available USDST balance
          actualMaxDecimal = Math.min(backendMaxDecimal, availableUsdstBalance - 0.02);
          
          // Store the max value
          setMaxValues(prev => ({ ...prev, [vaultKey]: actualMaxDecimal }));
          
        } catch (error) {
          console.error("Error fetching max liquidatable amount:", error);
          toast({
            title: "Error",
            description: "Failed to calculate maximum liquidation amount",
            variant: "destructive",
          });
          return;
        }
      } else {
        // Recalculate based on current USDST balance in case it changed
        const vaultIndex = parseInt(vaultKey.split('-').pop() || '0');
        const currentVault = liquidatableVaults[vaultIndex];
        if (currentVault && currentVault.borrower) {
          try {
            const result = await cdpService.getMaxLiquidatable(currentVault.asset, currentVault.borrower);
            const backendMaxWei = result.maxAmount;
            const backendMaxDecimal = parseFloat(formatWeiToDecimalHP(backendMaxWei, 18));
            actualMaxDecimal = Math.min(backendMaxDecimal, availableUsdstBalance - 0.02);
            setMaxValues(prev => ({ ...prev, [vaultKey]: actualMaxDecimal }));
          } catch (error) {
            console.error("Error updating max liquidatable amount:", error);
            // Use the cached value if update fails
          }
        }
      }
      
      // Set max state and update input amount
      setMaxStates(prev => ({ ...prev, [vaultKey]: true }));
      setLiquidationAmounts(prev => ({ 
        ...prev, 
        [vaultKey]: actualMaxDecimal.toString() 
      }));
    }
  };

  const calculateExpectedProfit = (vault: VaultData, liquidationAmount: string): string => {
    const vaultKey = `${vault.borrower || 'unknown'}-${vault.asset}-${liquidatableVaults.findIndex(v => v.borrower === vault.borrower && v.asset === vault.asset)}`;
    const amount = parseFloat(liquidationAmount);
    
    // If no valid amount provided, use the maximum liquidatable amount instead of 0
    let calculationAmount = amount;
    if (isNaN(amount) || amount <= 0) {
      const maxAmount = maxValues[vaultKey];
      if (maxAmount && maxAmount > 0) {
        calculationAmount = maxAmount;
      } else {
        return "$0.00";
      }
    } else {
      calculationAmount = amount;
    }
    
    // Get the actual liquidation penalty from asset config
    const assetConfig = assetConfigs[vault.asset];
    if (!assetConfig) {
      console.warn(`No asset config found for ${vault.asset}, using fallback 5% penalty`);
      const fallbackBonus = 0.05;
      const profit = calculationAmount * fallbackBonus;
      return `$${formatNumber(profit)}`;
    }
    
    // Convert basis points to decimal (e.g., 500 bps = 5% = 0.05)
    const liquidationBonus = assetConfig.liquidationPenaltyBps / 10000;
    const profit = calculationAmount * liquidationBonus;
    return `$${formatNumber(profit)}`;
  };

  const handleLiquidate = async (vault: VaultData, vaultKey: string) => {
    const liquidationAmount = liquidationAmounts[vaultKey];
    
    if (!liquidationAmount || parseFloat(liquidationAmount) <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid liquidation amount",
        variant: "destructive",
      });
      return;
    }

    // Check if USDST balance is insufficient
    if (isUsdstBalanceInsufficient()) {
      return;
    }

    setLiquidatingVaults(prev => ({ ...prev, [vaultKey]: true }));
    
    try {
      // Use the borrower address from vault data
      if (!vault.borrower) {
        toast({
          title: "Error",
          description: "Borrower address not available for this vault",
          variant: "destructive",
        });
        return;
      }
      const borrowerAddress = vault.borrower;
      
      const result = await cdpService.liquidate(vault.asset, borrowerAddress, liquidationAmount);
      
      if (result.status.toLowerCase() === "success") {
        toast({
          title: "Liquidation Successful",
          description: `Liquidated ${liquidationAmount} USDST. Tx: ${result.hash}`,
        });
        
        // Refresh liquidatable vaults and filter out paused ones and positions with 0 collateral
        const updatedLiquidatable = await cdpService.getLiquidatable();
        const filteredUpdatedLiquidatable = updatedLiquidatable.filter(v => {
          const assetConfig = assetConfigs[v.asset];
          // Exclude if globally paused OR if this specific asset is paused
          const isPaused = isGlobalPaused || (assetConfig?.isPaused ?? false);
          // Exclude if collateral amount is 0
          const hasCollateral = v.collateralAmount && v.collateralAmount !== "0" && BigInt(v.collateralAmount) > 0n;
          return !isPaused && hasCollateral;
        });
        setLiquidatableVaults(filteredUpdatedLiquidatable);
        
        // Clear the input
        setLiquidationAmounts(prev => ({ ...prev, [vaultKey]: "" }));
        
        // Refresh user token balances (they spent USDST and received collateral)
          await fetchTokens(); // Refresh all token balances (including received collateral)
        await fetchUsdstBalance(); // Refresh USDST balance (spent during liquidation)
          
          // Update the global USDST balance after fetching
          const updatedUsdstWei = BigInt(usdstBalance || "0");
          const updatedUsdstDecimal = parseFloat(formatWeiToDecimalHP(updatedUsdstWei.toString(), 18));
          setAvailableUsdstBalance(updatedUsdstDecimal);
      }
    } catch (error) {
      console.error("Liquidation failed:", error);
      toast({
        title: "Liquidation Failed",
        description: "Failed to execute liquidation",
        variant: "destructive",
      });
    } finally {
      setLiquidatingVaults(prev => ({ ...prev, [vaultKey]: false }));
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-center">Loading liquidatable positions...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
      {/* Main Card */}
      <Card>
        <CardHeader>
          <CardTitle>Liquidatable Positions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {liquidatableVaults.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No liquidatable positions found
            </div>
          ) : (
            liquidatableVaults.map((vault, index) => {
              const vaultKey = `${vault.borrower || 'unknown'}-${vault.asset}-${index}`;
              const isExpanded = expandedVaults[vaultKey];
              const liquidationAmount = liquidationAmounts[vaultKey] || "";
              const isLiquidating = liquidatingVaults[vaultKey];
              
              return (
                <div key={vaultKey} className="border rounded-lg">
                  {/* Collapsed View */}
                  <div 
                    className="p-4 cursor-pointer hover:bg-muted/50 flex items-center justify-between"
                    onClick={() => toggleExpanded(vaultKey)}
                  >
                    <div className="flex items-center space-x-2">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                    <div className="flex items-center space-x-8">
                      <div>
                        <span className="text-muted-foreground">Borrower</span>
                        <div className="font-medium font-mono text-sm">
                          {vault.borrower ? `${vault.borrower.slice(0, 6)}...${vault.borrower.slice(-4)}` : "Unknown"}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Borrowed</span>
                        <div className="font-medium">{formatNumber(parseFloat(formatWeiToDecimalHP(vault.debtAmount, 18)))} USDST</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Health Factor</span>
                        <div className="font-medium text-red-600 dark:text-red-400">{formatNumber(vault.healthFactor)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded View */}
                  {isExpanded && (
                    <div className="border-t bg-muted/30">
                      {/* Table Header */}
                      <div className="grid grid-cols-4 gap-4 p-4 text-sm text-muted-foreground font-medium border-b border-border">
                        <div>Collateral Asset</div>
                        <div>Amount</div>
                        <div>Value (USD)</div>
                        <div>Expected Profit</div>
                      </div>
                      
                      {/* Table Row - Position Values */}
                      <div className="grid grid-cols-4 gap-4 p-4 items-center border-b">
                        <div className="flex items-center space-x-1.5 min-w-0">
                          <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {vault.symbol.charAt(0)}
                          </div>
                          <span className="font-medium truncate min-w-[80px]">{vault.symbol}</span>
                        </div>
                        <div>{formatNumber(parseFloat(formatWeiToDecimalHP(vault.collateralAmount, vault.collateralAmountDecimals)))}</div>
                        <div>${formatNumber(parseFloat(formatWeiToDecimalHP(vault.collateralValueUSD, 18)))}</div>
                        <div className="text-green-600 font-medium">
                          {calculateExpectedProfit(vault, liquidationAmount)}
                        </div>
                      </div>
                      
                      {/* Action Row - Input and Button */}
                      <div className="p-4">
                        {/* Transaction Fee Display */}
                        <div className="text-center mb-3">
                          <p className="text-xs text-muted-foreground">
                            Transaction Fee: 0.02 USDST
                          </p>
                        </div>
                        
                        <div className="flex flex-col items-center space-y-2">
                          <div className="flex items-center space-x-3">
                            <Input
                              type="number"
                              placeholder="Amount to liquidate"
                              value={liquidationAmount}
                              onChange={(e) => handleLiquidationAmountChange(vaultKey, e.target.value)}
                              className={`w-40 ${isAmountExceedsMax(vaultKey) ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                              min="0"
                              step="0.01"
                            />
                            <Button 
                              variant={maxStates[vaultKey] ? "default" : "outline"}
                              size="sm" 
                              className={`min-w-[50px] ${maxStates[vaultKey] ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
                              onClick={() => handleMaxClick(vault, vaultKey)}
                              disabled={isUsdstBalanceInsufficient()}
                            >
                              MAX
                            </Button>
                            <Button 
                              className="bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => handleLiquidate(vault, vaultKey)}
                              disabled={isLiquidating || !liquidationAmount || isAmountExceedsMax(vaultKey) || isUsdstBalanceInsufficient()}
                            >
                              {isLiquidating ? "Liquidating..." : "Liquidate"}
                            </Button>
                          </div>
                          
                          {/* Error message when amount exceeds max */}
                          {isAmountExceedsMax(vaultKey) && (
                            <div className="text-center">
                              <p className="text-xs text-red-500">
                                Maximum liquidation amount reached
                              </p>
                            </div>
                          )}
                          
                          {/* Error message when USDST balance is insufficient */}
                          {isUsdstBalanceInsufficient() && (
                            <div className="text-center">
                              <p className="text-xs text-red-500">
                                Insufficient USDST Balance
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LiquidationsView;
