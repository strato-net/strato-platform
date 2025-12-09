import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";
import { cdpService, AssetConfig } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { formatBalance as formatBalanceUtil, formatWeiToDecimalHP, formatNumber, formatDecimalToWeiHP } from "@/utils/numberUtils";
import { usdstAddress } from "@/lib/constants";


interface OpenJuniorNoteWidgetProps {
  onSuccess?: () => void;
  assetBadDebt?: Record<string, string>; // asset address -> bad debt amount in wei
  onBadDebtCovered?: () => void; // Callback to refresh bad debt data after covering
}

const OpenJuniorNoteWidget: React.FC<OpenJuniorNoteWidgetProps> = ({ onSuccess, assetBadDebt = {}, onBadDebtCovered }) => {
  const [supportedAssets, setSupportedAssets] = useState<AssetConfig[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetConfig | null>(null);
  const [burnAmount, setBurnAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isMaxEnabled, setIsMaxEnabled] = useState(false);
  const { toast } = useToast();
  const { activeTokens } = useUserTokens();

  // Get user's USDST balance
  const getUsdstBalance = useCallback((): string => {
    const usdstToken = activeTokens.find(token => 
      token.address.toLowerCase() === usdstAddress.toLowerCase()
    );
    return usdstToken?.balance || "0";
  }, [activeTokens]);


  // Calculate maximum burneable amount as decimal string (min of bad debt and user balance)
  const calculateMaxBurnAmount = useCallback((): string => {
    if (!selectedAsset) return "0";
    
    const userBalance = getUsdstBalance();
    const badDebt = assetBadDebt[selectedAsset.asset] || "0";
    
    if (!userBalance || !badDebt) return "0";
    
    const userBalanceWei = BigInt(userBalance);
    const badDebtWei = BigInt(badDebt);
    
    // Get minimum in wei, then convert to decimal string
    const minWei = userBalanceWei < badDebtWei ? userBalanceWei : badDebtWei;
    return formatWeiToDecimalHP(minWei.toString(), 18);
  }, [selectedAsset, assetBadDebt, getUsdstBalance]);

  // Calculate expected cap (burn amount + premium)
  const calculateExpectedCap = (): number => {
    const burnAmountDecimal = parseFloat(burnAmount || "0");
    if (burnAmountDecimal <= 0) return 0;
    
    // Assuming 10% premium (1000 bps)
    const premium = 0.10;
    return burnAmountDecimal * (1 + premium);
  };

  // Fetch supported assets on component mount
  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const assets = await cdpService.getSupportedAssets();
        setSupportedAssets(assets);
        // Don't auto-select the first asset anymore - let user choose from the list
        setSelectedAsset(null);
      } catch (error) {
        console.error("Failed to fetch supported assets:", error);
        toast({
          title: "Error",
          description: "Failed to load supported assets",
          variant: "destructive",
        });
      }
    };

    fetchAssets();
  }, [toast]);

  // Auto-update input when max is enabled and max value changes
  useEffect(() => {
    if (isMaxEnabled && selectedAsset) {
      const currentMaxAmount = calculateMaxBurnAmount();
      if (currentMaxAmount !== "0") {
        setBurnAmount(currentMaxAmount);
      }
    }
  }, [isMaxEnabled, selectedAsset, assetBadDebt, calculateMaxBurnAmount]);

  // Handle MAX button click
  const handleMaxClick = () => {
    if (isMaxEnabled) {
      setIsMaxEnabled(false);
      setBurnAmount("");
    } else {
      const maxAmount = calculateMaxBurnAmount();
      if (maxAmount !== "0") {
        setBurnAmount(maxAmount);
        setIsMaxEnabled(true);
      }
    }
  };

  // Handle input amount change
  const handleAmountChange = (value: string) => {
    setBurnAmount(value);
    
    // Check if user manually typed the max amount
    const maxAmount = calculateMaxBurnAmount();
    if (maxAmount !== "0") {
      const isTypingMax = value === maxAmount;
      setIsMaxEnabled(isTypingMax);
    } else {
      setIsMaxEnabled(false);
    }
  };

  // Check if amount exceeds maximum (min of bad debt and balance)
  const isAmountAboveMax = (): boolean => {
    const currentAmount = parseFloat(burnAmount || "0");
    const maxAmount = parseFloat(calculateMaxBurnAmount());
    return currentAmount > maxAmount;
  };

  // Handle opening junior note
  const handleOpenJuniorNote = async () => {
    if (!selectedAsset) {
      toast({
        title: "No Asset Selected",
        description: "Please select an asset",
        variant: "destructive",
      });
      return;
    }

    const burnAmountDecimal = parseFloat(burnAmount);
    if (burnAmountDecimal <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid burn amount",
        variant: "destructive",
      });
      return;
    }

    if (isAmountAboveMax()) {
      const maxAmount = parseFloat(calculateMaxBurnAmount());
      const userBalance = parseFloat(formatWeiToDecimalHP(getUsdstBalance(), 18));
      const badDebt = parseFloat(formatWeiToDecimalHP(assetBadDebt[selectedAsset.asset] || "0", 18));
      
      let limitingFactor = "";
      if (userBalance <= badDebt) {
        limitingFactor = "USDST balance";
      } else {
        limitingFactor = "available bad debt";
      }
      
      toast({
        title: "Amount Exceeds Limit",
        description: `Maximum allowed: ${formatNumber(maxAmount)} USDST (limited by ${limitingFactor})`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Convert amount to wei (18 decimals) with exact precision
      const amountWei = isMaxEnabled 
        ? formatDecimalToWeiHP(burnAmount, 18) // burnAmount is already a string from formatWeiToDecimalHP
        : formatDecimalToWeiHP(burnAmountDecimal.toString(), 18); // Convert number to string for exact precision
      
      // Call the backend API
      const result = await cdpService.openJuniorNote(selectedAsset.asset, amountWei);
      
      // Extract return values from the transaction result using exact precision conversion
      const burnedUSDST = result.burnedUSDST ? 
        parseFloat(formatWeiToDecimalHP(result.burnedUSDST, 18)) : burnAmountDecimal;
      const capUSDST = result.capUSDST ? 
        parseFloat(formatWeiToDecimalHP(result.capUSDST, 18)) : calculateExpectedCap();
      
      toast({
        title: "Bad Debt Coverage Successful",
        description: `Burned ${formatNumber(burnedUSDST)} USDST for ${formatNumber(capUSDST)} USDST cap to cover ${selectedAsset.symbol} bad debt`,
      });

      // Reset form
      setBurnAmount("");
      setIsMaxEnabled(false);
      setSelectedAsset(null); // Clear selection so user sees updated list

      if (onSuccess) {
        onSuccess();
      }
      
      // Refresh bad debt data to show updated amounts
      if (onBadDebtCovered) {
        onBadDebtCovered();
      }
    } catch (error) {
      console.error("Failed to open junior note:", error);
      
      // Extract error message for better user feedback
      let errorMessage = "Failed to open junior note. Please try again.";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null && 'response' in error) {
        const axiosError = error as { response?: { data?: { message?: string } } };
        if (axiosError.response?.data?.message) {
          errorMessage = axiosError.response.data.message;
        }
      }
      
      toast({
        title: "Transaction Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const usdstBalance = getUsdstBalance();
  const expectedCap = calculateExpectedCap();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cover Bad Debt</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <style>{`
          input[type="number"]::-webkit-outer-spin-button,
          input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          input[type="number"] {
            -moz-appearance: textfield;
          }
        `}</style>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Select Asset to Cover Bad Debt</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRefreshing(true);
                if (onBadDebtCovered) {
                  onBadDebtCovered();
                }
                // Reset refreshing state after a delay to show the refresh happened
                setTimeout(() => setRefreshing(false), 1000);
              }}
              disabled={refreshing}
              className="h-8 w-8 p-0"
              title="Refresh bad debt amounts"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {supportedAssets
              .sort((a, b) => {
                // Sort by bad debt amount (greatest to least)
                const badDebtA = parseFloat(formatWeiToDecimalHP(assetBadDebt[a.asset] || "0", 18));
                const badDebtB = parseFloat(formatWeiToDecimalHP(assetBadDebt[b.asset] || "0", 18));
                return badDebtB - badDebtA; // Descending order
              })
              .map((asset) => {
              const badDebtAmount = assetBadDebt[asset.asset] || "0";
              const badDebtDecimal = parseFloat(formatWeiToDecimalHP(badDebtAmount, 18));
              const isSelected = selectedAsset?.asset === asset.asset;
              const hasRealBadDebt = badDebtDecimal > 0;
              
              return (
                <div
                  key={asset.asset}
                  className={`p-3 border rounded-lg cursor-pointer transition-all hover:shadow-sm ${
                    isSelected 
                      ? 'border-blue-500 bg-blue-500/10 shadow-sm' 
                      : hasRealBadDebt
                        ? 'border-border hover:border-border/80 bg-card'
                        : 'border-border/50 bg-muted/50 opacity-60'
                  } ${!hasRealBadDebt ? 'cursor-not-allowed' : ''}`}
                  onClick={() => {
                    if (hasRealBadDebt) {
                      // Toggle selection: if already selected, deselect; otherwise select
                      if (isSelected) {
                        setSelectedAsset(null);
                      } else {
                        setSelectedAsset(asset);
                      }
                    }
                  }}
                  title={!hasRealBadDebt ? "No bad debt available for this asset" : isSelected ? `Click to deselect ${asset.symbol}` : `Click to select ${asset.symbol}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                        hasRealBadDebt 
                          ? isSelected 
                            ? 'bg-blue-500/20 text-blue-500' 
                            : 'bg-red-500/20 text-red-500'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {asset.symbol.slice(0, 3).toUpperCase()}
                      </div>
                      <div>
                        <div className={`font-medium ${hasRealBadDebt ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {asset.symbol}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {asset.asset.slice(0, 8)}...{asset.asset.slice(-6)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${
                        hasRealBadDebt 
                          ? isSelected 
                            ? 'text-blue-500' 
                            : 'text-red-500'
                          : 'text-muted-foreground'
                      }`}>
                        {formatNumber(badDebtDecimal)} USDST
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {hasRealBadDebt ? 'Bad Debt' : 'No bad debt'}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="mt-2 pt-2 border-t border-blue-200">
                      <div className="text-xs text-blue-700 flex items-center gap-1">
                        <span>✓</span>
                        <span>Selected for bad debt coverage</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {supportedAssets.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <div className="text-sm">No supported assets found</div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>USDST to Burn</Label>
          <div className="flex items-center gap-3">
            <Input
              className={`flex-1 text-right ${
                isMaxEnabled 
                  ? 'text-blue-600 bg-blue-50 border-blue-300' 
                  : isAmountAboveMax() 
                    ? 'text-red-600 bg-red-50 border-red-300' 
                    : ''
              }`}
              value={burnAmount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0.0"
              type="number"
              step="any"
            />
            <Button 
              variant={isMaxEnabled ? "default" : "outline"}
              size="sm" 
              className={`min-w-[50px] ${isMaxEnabled ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
              onClick={handleMaxClick}
                    disabled={calculateMaxBurnAmount() === "0"}
            >
              MAX
            </Button>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Balance: {usdstBalance && parseFloat(usdstBalance) > 0 
                ? formatBalanceUtil(usdstBalance, undefined, 18, 1, 4) 
                : "0"
              } USDST
            </p>
            {selectedAsset && calculateMaxBurnAmount() !== "0" && (
              <p className="text-xs text-green-600 font-medium">
                Max Burneable: {formatNumber(parseFloat(calculateMaxBurnAmount()))} USDST
              </p>
            )}
          </div>
        </div>

        {/* Expected Cap Preview */}
        {expectedCap > 0 && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
            <div className="text-sm font-medium text-blue-500 mb-1">Expected Note Cap</div>
            <div className="text-lg font-bold text-blue-500">
              ~{formatNumber(expectedCap)} USDST
            </div>
            <div className="text-xs text-blue-500/80">
              Includes 10% premium for bad debt recovery
            </div>
          </div>
        )}

        {/* Transaction Fee */}
        {parseFloat(burnAmount || "0") > 0 && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              Transaction Fee: 0.01 USDST
            </p>
          </div>
        )}

        <Button 
          className="w-full" 
          onClick={handleOpenJuniorNote}
          disabled={
            loading || 
            !selectedAsset || 
            parseFloat(burnAmount || "0") <= 0 || 
            isAmountAboveMax()
          }
        >
          {(() => {
            if (loading) return "Processing...";
            if (isAmountAboveMax()) return "Amount exceeds limit";
            if (!selectedAsset) return "Select asset with bad debt";
                    if (calculateMaxBurnAmount() === "0") return "Selected asset has no bad debt";
            if (parseFloat(burnAmount || "0") <= 0) return "Enter amount to burn";
            return "Cover Bad Debt";
          })()}
        </Button>
      </CardContent>
    </Card>
  );
};

export default OpenJuniorNoteWidget;
