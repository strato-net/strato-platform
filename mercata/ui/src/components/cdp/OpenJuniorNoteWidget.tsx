import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cdpService, AssetConfig } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { formatBalance as formatBalanceUtil } from "@/utils/numberUtils";
import { usdstAddress } from "@/lib/constants";

// Convert wei string to decimal for display
const formatWeiToDecimal = (weiString: string, decimals: number): string => {
  if (!weiString || weiString === '0') return '0';
  
  const wei = BigInt(weiString);
  const divisor = BigInt(10) ** BigInt(decimals);
  const quotient = wei / divisor;
  const remainder = wei % divisor;
  
  if (remainder === 0n) {
    return quotient.toString();
  }
  
  const decimalPart = remainder.toString().padStart(decimals, '0');
  const trimmedDecimal = decimalPart.replace(/0+$/, '');
  
  if (trimmedDecimal === '') {
    return quotient.toString();
  }
  
  return `${quotient}.${trimmedDecimal}`;
};

// Format large numbers for display
const formatNumber = (num: number | string, decimals: number = 2): string => {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(value)) return '0';
  
  if (value >= 1e9) {
    return (value / 1e9).toFixed(1) + 'B';
  }
  if (value >= 1e6) {
    return (value / 1e6).toFixed(1) + 'M';
  }
  if (value >= 1e3) {
    return (value / 1e3).toFixed(1) + 'K';
  }
  
  return value.toFixed(decimals);
};

interface OpenJuniorNoteWidgetProps {
  onSuccess?: () => void;
  assetBadDebt?: Record<string, string>; // asset address -> bad debt amount in wei
}

const OpenJuniorNoteWidget: React.FC<OpenJuniorNoteWidgetProps> = ({ onSuccess, assetBadDebt = {} }) => {
  const [supportedAssets, setSupportedAssets] = useState<AssetConfig[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetConfig | null>(null);
  const [burnAmount, setBurnAmount] = useState("");
  const [loading, setLoading] = useState(false);
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


  // Calculate maximum burneable amount (min of bad debt and user balance)
  const calculateMaxBurnAmount = useCallback((): number => {
    if (!selectedAsset) return 0;
    
    const userBalance = getUsdstBalance();
    const badDebt = assetBadDebt[selectedAsset.asset] || "0";
    
    // Debug logging to check asset mapping
    console.log("🔍 DEBUG - selectedAsset.asset:", selectedAsset.asset);
    console.log("🔍 DEBUG - assetBadDebt keys:", Object.keys(assetBadDebt));
    console.log("🔍 DEBUG - badDebt for asset:", badDebt);
    
    if (!userBalance || !badDebt) return 0;
    
    const userBalanceDecimal = parseFloat(formatWeiToDecimal(userBalance, 18));
    const badDebtDecimal = parseFloat(formatWeiToDecimal(badDebt, 18));
    
    return Math.min(userBalanceDecimal, badDebtDecimal);
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
        if (assets.length > 0) {
          setSelectedAsset(assets[0]);
        }
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
      if (currentMaxAmount > 0) {
        setBurnAmount(currentMaxAmount.toString());
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
      if (maxAmount > 0) {
        setBurnAmount(maxAmount.toString());
        setIsMaxEnabled(true);
      }
    }
  };

  // Handle input amount change
  const handleAmountChange = (value: string) => {
    setBurnAmount(value);
    
    // Check if user manually typed the max amount
    const currentAmount = parseFloat(value || "0");
    const maxAmount = calculateMaxBurnAmount();
    if (maxAmount > 0) {
      const isTypingMax = Math.abs(currentAmount - maxAmount) < 0.000001;
      setIsMaxEnabled(isTypingMax);
    } else {
      setIsMaxEnabled(false);
    }
  };

  // Check if amount exceeds maximum (min of bad debt and balance)
  const isAmountAboveMax = (): boolean => {
    const currentAmount = parseFloat(burnAmount || "0");
    const maxAmount = calculateMaxBurnAmount();
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
      const maxAmount = calculateMaxBurnAmount();
      const userBalance = parseFloat(formatWeiToDecimal(getUsdstBalance(), 18));
      const badDebt = parseFloat(formatWeiToDecimal(assetBadDebt[selectedAsset.asset] || "0", 18));
      
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
      // Convert amount to wei (18 decimals)
      const amountWei = (BigInt(Math.floor(burnAmountDecimal * 1e18))).toString();
      
      // Call the backend API
      const result = await cdpService.openJuniorNote(selectedAsset.asset, amountWei);
      
      // Extract return values from the transaction result
      const burnedUSDST = result.burnedUSDST ? 
        parseFloat((BigInt(result.burnedUSDST) / BigInt(1e18)).toString()) : burnAmountDecimal;
      const capUSDST = result.capUSDST ? 
        parseFloat((BigInt(result.capUSDST) / BigInt(1e18)).toString()) : calculateExpectedCap();
      
      toast({
        title: "Junior Note Opened Successfully",
        description: `Burned ${formatNumber(burnedUSDST)} USDST for ${formatNumber(capUSDST)} USDST cap`,
      });

      // Reset form
      setBurnAmount("");
      setIsMaxEnabled(false);

      if (onSuccess) {
        onSuccess();
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
        <CardTitle>Open Junior Note</CardTitle>
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
          <Label>Asset</Label>
          <Select 
            value={selectedAsset?.symbol || ""} 
            onValueChange={(symbol) => {
              const asset = supportedAssets.find(a => a.symbol === symbol);
              setSelectedAsset(asset || null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select asset" />
            </SelectTrigger>
            <SelectContent>
              {supportedAssets.map((asset) => (
                <SelectItem key={asset.symbol} value={asset.symbol}>
                  {asset.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bad Debt Display */}
        {selectedAsset && (
          <div className="text-xs text-gray-500 -mt-1">
            Bad Debt: {assetBadDebt[selectedAsset.asset] 
              ? formatNumber(parseFloat(formatWeiToDecimal(assetBadDebt[selectedAsset.asset], 18)))
              : "0"
            } USDST
          </div>
        )}

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
              disabled={calculateMaxBurnAmount() <= 0}
            >
              MAX
            </Button>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-gray-500">
              Balance: {usdstBalance && parseFloat(usdstBalance) > 0 
                ? formatBalanceUtil(usdstBalance, undefined, 18, 1, 4) 
                : "0"
              } USDST
            </p>
            {selectedAsset && calculateMaxBurnAmount() > 0 && (
              <p className="text-xs text-green-600 font-medium">
                Max Burneable: {formatNumber(calculateMaxBurnAmount())} USDST
              </p>
            )}
          </div>
        </div>

        {/* Expected Cap Preview */}
        {expectedCap > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-sm font-medium text-blue-900 mb-1">Expected Note Cap</div>
            <div className="text-lg font-bold text-blue-800">
              ~{formatNumber(expectedCap)} USDST
            </div>
            <div className="text-xs text-blue-600">
              Includes 10% premium for bad debt recovery
            </div>
          </div>
        )}

        {/* Transaction Fee */}
        {parseFloat(burnAmount || "0") > 0 && (
          <div className="text-center">
            <p className="text-xs text-gray-500">
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
            if (!selectedAsset) return "Select asset";
            if (calculateMaxBurnAmount() <= 0) return "No bad debt available";
            if (parseFloat(burnAmount || "0") <= 0) return "Enter amount";
            return "Open Junior Note";
          })()}
        </Button>
      </CardContent>
    </Card>
  );
};

export default OpenJuniorNoteWidget;
