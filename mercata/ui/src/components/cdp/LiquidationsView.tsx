import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cdpService, VaultData, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";

interface LiquidationsViewProps {
  onBack: () => void;
}

const LiquidationsView: React.FC<LiquidationsViewProps> = ({ onBack }) => {
  const [liquidatableVaults, setLiquidatableVaults] = useState<VaultData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVaults, setExpandedVaults] = useState<Record<string, boolean>>({});
  const [liquidationAmounts, setLiquidationAmounts] = useState<Record<string, string>>({});
  const [liquidatingVaults, setLiquidatingVaults] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  // Fetch liquidatable positions
  useEffect(() => {
    const fetchLiquidatable = async () => {
      setLoading(true);
      try {
        const liquidatable = await cdpService.getLiquidatable();
        setLiquidatableVaults(liquidatable);
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
  };

  const calculateExpectedProfit = (vault: VaultData, liquidationAmount: string): string => {
    const amount = parseFloat(liquidationAmount);
    if (isNaN(amount) || amount <= 0) return "$0.00";
    
    // Simplified calculation: assuming 5% liquidation bonus
    const liquidationBonus = 0.05;
    const profit = amount * liquidationBonus;
    return `$${profit.toFixed(2)}`;
  };

  const handleLiquidate = async (vault: VaultData) => {
    const vaultKey = `${vault.asset}-${vault.symbol}`;
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
      const borrowerAddress = vault.borrower || "0x1234567890123456789012345678901234567890";
      
      const result = await cdpService.liquidate(vault.asset, borrowerAddress, liquidationAmount);
      
      if (result.status === "success") {
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
            ← Back to Mint
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          ← Back to Mint
        </Button>
        <h2 className="text-xl font-semibold">Liquidatable Positions</h2>
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
            liquidatableVaults.map((vault) => {
              const vaultKey = `${vault.asset}-${vault.symbol}`;
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
                                          <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        <span className="font-medium">Borrower</span>
                        <span className="text-gray-600 font-mono">
                          {vault.borrower ? `${vault.borrower.slice(0, 6)}...${vault.borrower.slice(-4)}` : "88c86a...7cff"}
                        </span>
                        <Button variant="outline" size="sm" className="text-xs">
                          📋
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center space-x-8">
                      <div>
                        <span className="text-gray-500">Borrowed</span>
                        <div className="font-medium">{vault.debtAmount} USDST</div>
                      </div>
                      <div>
                        <span className="text-gray-500">Health Factor</span>
                        <div className="font-medium text-red-600">{vault.healthFactor.toFixed(2)}%</div>
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
                        <div>{vault.collateralAmount}</div>
                        <div>${vault.collateralValueUSD}</div>
                        <div className="text-red-600 font-medium">
                          {calculateExpectedProfit(vault, liquidationAmount)}
                        </div>
                      </div>
                      
                      {/* Action Row - Input and Button */}
                      <div className="p-4">
                        <div className="flex items-center space-x-3 justify-center">
                          <label className="text-sm font-medium text-gray-700">
                            Liquidation Amount:
                          </label>
                          <Input
                            type="number"
                            placeholder="Amount to liquidate"
                            value={liquidationAmount}
                            onChange={(e) => handleLiquidationAmountChange(vaultKey, e.target.value)}
                            className="w-40"
                            min="0"
                            step="0.01"
                          />
                          <Button 
                            className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => handleLiquidate(vault)}
                            disabled={isLiquidating || !liquidationAmount}
                          >
                            {isLiquidating ? "Liquidating..." : "Liquidate"}
                          </Button>
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
