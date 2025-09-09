import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cdpService, VaultData, AssetConfig, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";

interface LiquidationsViewProps {
  onBack: () => void;
}

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

const LiquidationsView: React.FC<LiquidationsViewProps> = ({ onBack }) => {
  const [liquidatableVaults, setLiquidatableVaults] = useState<VaultData[]>([]);
  const [assetConfigs, setAssetConfigs] = useState<Record<string, AssetConfig>>({});
  const [loading, setLoading] = useState(true);
  const [expandedVaults, setExpandedVaults] = useState<Record<string, boolean>>({});
  const [liquidationAmounts, setLiquidationAmounts] = useState<Record<string, string>>({});
  const [liquidatingVaults, setLiquidatingVaults] = useState<Record<string, boolean>>({});
  const [maxStates, setMaxStates] = useState<Record<string, boolean>>({});
  const [maxValues, setMaxValues] = useState<Record<string, number>>({});
  const { toast } = useToast();

  // Fetch liquidatable positions and asset configs
  useEffect(() => {
    const fetchLiquidatable = async () => {
      setLoading(true);
      try {
        const liquidatable = await cdpService.getLiquidatable();
        setLiquidatableVaults(liquidatable);
        
        // Fetch asset configs for each unique asset
        const uniqueAssets = [...new Set(liquidatable.map(vault => vault.asset))];
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
        
      } catch (error) {
        console.error("Error fetching liquidatable vaults:", error);
        toast({
          title: "Error",
          description: "Failed to fetch liquidatable positions",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchLiquidatable();
  }, [toast]);

  const toggleExpanded = (vaultKey: string) => {
    setExpandedVaults(prev => ({
      ...prev,
      [vaultKey]: !prev[vaultKey]
    }));
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

  // Handle MAX button click
  const handleMaxClick = async (vault: VaultData, vaultKey: string) => {
    const isCurrentlyMax = maxStates[vaultKey];
    
    if (isCurrentlyMax) {
      // Clear max state and amount
      setMaxStates(prev => ({ ...prev, [vaultKey]: false }));
      setLiquidationAmounts(prev => ({ ...prev, [vaultKey]: "" }));
    } else {
      try {
        // Fetch max liquidatable amount
        const result = await cdpService.getMaxLiquidatable(vault.asset, vault.borrower!);
        const maxAmountWei = result.maxAmount;
        
        // Convert from wei to decimal (18 decimals for USDST)
        const maxAmountDecimal = parseFloat(formatWeiToDecimal(maxAmountWei, 18));
        
        // Store the max value and set max state
        setMaxValues(prev => ({ ...prev, [vaultKey]: maxAmountDecimal }));
        setMaxStates(prev => ({ ...prev, [vaultKey]: true }));
        setLiquidationAmounts(prev => ({ 
          ...prev, 
          [vaultKey]: maxAmountDecimal.toString() 
        }));
        
      } catch (error) {
        console.error("Error fetching max liquidatable amount:", error);
        toast({
          title: "Error",
          description: "Failed to calculate maximum liquidation amount",
          variant: "destructive",
        });
      }
    }
  };

  const calculateExpectedProfit = (vault: VaultData, liquidationAmount: string): string => {
    const amount = parseFloat(liquidationAmount);
    if (isNaN(amount) || amount <= 0) return "$0.00";
    
    // Get the actual liquidation penalty from asset config
    const assetConfig = assetConfigs[vault.asset];
    if (!assetConfig) {
      console.warn(`No asset config found for ${vault.asset}, using fallback 5% penalty`);
      const fallbackBonus = 0.05;
      const profit = amount * fallbackBonus;
      return `$${formatNumber(profit)}`;
    }
    
    // Convert basis points to decimal (e.g., 500 bps = 5% = 0.05)
    const liquidationBonus = assetConfig.liquidationPenaltyBps / 10000;
    const profit = amount * liquidationBonus;
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
        
        // Refresh liquidatable vaults
        const updatedLiquidatable = await cdpService.getLiquidatable();
        setLiquidatableVaults(updatedLiquidatable);
        
        // Clear the input
        setLiquidationAmounts(prev => ({ ...prev, [vaultKey]: "" }));
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
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={onBack}>
            ← Back to Borrow
          </Button>
        </div>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          ← Back to Borrow
        </Button>
        <div /> {/* Spacer for center alignment */}
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader>
          <CardTitle>Liquidatable Positions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {liquidatableVaults.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
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
                    className="p-4 cursor-pointer hover:bg-gray-50 flex items-center justify-between"
                    onClick={() => toggleExpanded(vaultKey)}
                  >
                    <div className="flex items-center space-x-2">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                    <div className="flex items-center space-x-8">
                      <div>
                        <span className="text-gray-500">Borrower</span>
                        <div className="font-medium font-mono text-sm">
                          {vault.borrower ? `${vault.borrower.slice(0, 6)}...${vault.borrower.slice(-4)}` : "Unknown"}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">Borrowed</span>
                        <div className="font-medium">{formatNumber(parseFloat(formatWeiToDecimal(vault.debtAmount, 18)))} USDST</div>
                      </div>
                      <div>
                        <span className="text-gray-500">Health Factor</span>
                        <div className="font-medium text-red-600">{formatNumber(vault.healthFactor)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded View */}
                  {isExpanded && (
                    <div className="border-t bg-gray-50">
                      {/* Table Header */}
                      <div className="grid grid-cols-4 gap-4 p-4 text-sm text-gray-500 font-medium border-b">
                        <div>Collateral Asset</div>
                        <div>Amount</div>
                        <div>Value (USD)</div>
                        <div>Expected Profit</div>
                      </div>
                      
                      {/* Table Row - Position Values */}
                      <div className="grid grid-cols-4 gap-4 p-4 items-center border-b">
                        <div className="flex items-center space-x-2">
                          <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                            {vault.symbol.charAt(0)}
                          </div>
                          <span className="font-medium">{vault.symbol}</span>
                        </div>
                        <div>{formatNumber(parseFloat(formatWeiToDecimal(vault.collateralAmount, vault.collateralAmountDecimals)))}</div>
                        <div>${formatNumber(parseFloat(formatWeiToDecimal(vault.collateralValueUSD, 18)))}</div>
                        <div className="text-green-600 font-medium">
                          {calculateExpectedProfit(vault, liquidationAmount)}
                        </div>
                      </div>
                      
                      {/* Action Row - Input and Button */}
                      <div className="p-4">
                        {/* Transaction Fee Display */}
                        <div className="text-center mb-3">
                          <p className="text-xs text-gray-500">
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
                            >
                              MAX
                            </Button>
                            <Button 
                              className="bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => handleLiquidate(vault, vaultKey)}
                              disabled={isLiquidating || !liquidationAmount || isAmountExceedsMax(vaultKey)}
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
