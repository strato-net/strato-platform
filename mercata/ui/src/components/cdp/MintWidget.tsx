import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CRSlider from "./CRSlider";
import { cdpService, AssetConfig, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { formatBalance as formatBalanceUtil } from "@/utils/numberUtils";
import { api } from "@/lib/axios";

interface BorrowWidgetProps {
  onSuccess?: () => void; // Callback fired when borrow operation succeeds
}

  /**
   * CDP Borrow flow widget - now connected to backend
 * Mirrors basic UX from Spark.fi Easy Borrow screen.
 * Uses real asset configurations from backend API.
 */
const BorrowWidget: React.FC<BorrowWidgetProps> = ({ onSuccess }) => {
  const [supportedAssets, setSupportedAssets] = useState<AssetConfig[]>([]);
  const [depositAsset, setDepositAsset] = useState<AssetConfig | null>(null);
  const [depositAmount, setDepositAmount] = useState("0");
  const [borrowAmount, setBorrowAmount] = useState("0");
  const [loading, setLoading] = useState(false);
  const [isBorrowMaxEnabled, setIsBorrowMaxEnabled] = useState(false);
  const [isDepositMaxEnabled, setIsDepositMaxEnabled] = useState(false);
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});
  const [existingVaultCollateral, setExistingVaultCollateral] = useState<string>("0"); // Wei format
  const [existingVaultDebt, setExistingVaultDebt] = useState<string>("0"); // Wei format
  const { toast } = useToast();
  const { activeTokens } = useUserTokens();

  const borrowRate = depositAsset?.stabilityFeeRate || 5.54;
  
  // Get real asset price from dynamic data only
  const getAssetPrice = useCallback((): number => {
    if (!depositAsset) return 0;
    return assetPrices[depositAsset.asset] || 0;
  }, [depositAsset, assetPrices]);

  // Calculate total collateral value (existing + new deposit)
  const getTotalCollateralValue = useCallback((): number => {
    if (!depositAsset) return 0;
    
    const assetPriceUSD = getAssetPrice();
    if (assetPriceUSD <= 0) return 0;
    
    // Get existing vault data (converted from wei to decimal)
    const existingCollateralDecimal = parseFloat(formatWeiToDecimal(existingVaultCollateral, 18));
    const newDepositAmount = parseFloat(depositAmount || "0");
    
    // Calculate total collateral in tokens
    const totalCollateralTokens = existingCollateralDecimal + newDepositAmount;
    
    // Convert to USD
    return totalCollateralTokens * assetPriceUSD;
  }, [depositAsset, getAssetPrice, existingVaultCollateral, depositAmount]);

  // Calculate projected CR based on current inputs
  const calculateProjectedCR = useCallback((): number => {
    if (!depositAsset) return 0;
    
    const totalCollateralValueUSD = getTotalCollateralValue();
    if (totalCollateralValueUSD <= 0) return 0;
    
    // Get existing debt and new borrow amount
    const existingDebtDecimal = parseFloat(formatWeiToDecimal(existingVaultDebt, 18));
    const newBorrowAmount = parseFloat(borrowAmount || "0");
    const totalDebt = existingDebtDecimal + newBorrowAmount;
    
    // Handle case of no debt
    if (totalDebt <= 0) return 999999; // Infinite CR when no debt
    
    // CR = (total collateral value / total debt value) * 100
    const projectedCR = (totalCollateralValueUSD / totalDebt) * 100;
    
    return isFinite(projectedCR) ? projectedCR : 0;
  }, [depositAsset, getTotalCollateralValue, existingVaultDebt, borrowAmount]);

  // Calculate max borrowable amount using backend endpoint for consistency
  const [maxBorrowableAmount, setMaxBorrowableAmount] = useState<number>(0);
  
  const calculateMaxBorrowable = (): number => {
    return maxBorrowableAmount;
  };

  // Get user's balance for the selected deposit asset
  const getUserDepositBalance = (): string => {
    if (!depositAsset) return "0";
    
    const userToken = activeTokens.find(token => 
      token.token.address.toLowerCase() === depositAsset.asset.toLowerCase()
    );
    
    return userToken?.balance || "0";
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

  const maxBorrowable = calculateMaxBorrowable();
  const projectedCR = calculateProjectedCR();
  const liquidationRatio = depositAsset?.liquidationRatio || 150;
  const userDepositBalance = getUserDepositBalance();

  // Fetch supported assets and prices on component mount
  useEffect(() => {
    const fetchAssetsAndPrices = async () => {
      try {
        const assets = await cdpService.getSupportedAssets();
        setSupportedAssets(assets);
        if (assets.length > 0) {
          setDepositAsset(assets[0]); // Set first asset as default
        }

        // Fetch real asset prices for all supported assets
        try {
          const prices: Record<string, number> = {};
          
          // Fetch prices for each asset individually using the oracle endpoint
          for (const asset of assets) {
            try {
              const priceResponse = await api.get(`/oracle/price?asset=${asset.asset}`);
              if (priceResponse.data?.price) {
                // Convert price from wei format (18 decimals) to regular number
                prices[asset.asset] = parseFloat(formatWeiToDecimal(priceResponse.data.price, 18));
                console.log(`✅ Price fetched for ${asset.symbol} (${asset.asset}): $${prices[asset.asset]}`);
              } else {
                console.warn(`⚠️  No price data for ${asset.symbol} (${asset.asset}):`, priceResponse.data);
              }
            } catch (assetPriceError) {
              console.error(`❌ Failed to fetch price for ${asset.symbol} (${asset.asset}):`, assetPriceError);
              // If 404, it means the asset is not in the oracle
              if (assetPriceError.response?.status === 404) {
                console.warn(`⚠️  Asset ${asset.symbol} (${asset.asset}) not found in price oracle`);
              }
            }
          }
          
          setAssetPrices(prices);
          console.log("🔍 Final asset prices:", prices);
        } catch (priceError) {
          console.error("Could not fetch real asset prices:", priceError);
          setAssetPrices({}); // Empty object - no prices available
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

    fetchAssetsAndPrices();
  }, [toast]);

  // Update max borrowable amount when collateral amount changes
  useEffect(() => {
    const updateMaxBorrowable = async () => {
      if (!depositAsset) {
        setMaxBorrowableAmount(0);
        return;
      }

      // Refetch max borrowable amount when deposit amount changes
      try {
        const maxMintResult = await cdpService.getMaxMint(depositAsset.asset);
        const maxAmountDecimal = parseFloat(formatWeiToDecimal(maxMintResult.maxAmount, 18));
        setMaxBorrowableAmount(maxAmountDecimal);
      } catch (error) {
        console.log("No borrowing power available for asset:", depositAsset.symbol);
        setMaxBorrowableAmount(0);
      }
    };

    // Only update if deposit amount has actually changed
    if (depositAsset && depositAmount !== "0") {
      updateMaxBorrowable();
    }

    // Check if current borrow amount equals max borrowable (within tolerance)
    const currentBorrowAmount = parseFloat(borrowAmount);
    const isCurrentlyMaxAmount = Math.abs(currentBorrowAmount - maxBorrowable) < 0.01 && maxBorrowable > 0;
    
    if (isCurrentlyMaxAmount && !isBorrowMaxEnabled) {
      // Current amount equals max, activate MAX styling
      setIsBorrowMaxEnabled(true);
    } else if (!isCurrentlyMaxAmount && isBorrowMaxEnabled) {
      // Current amount doesn't equal max, but MAX is still enabled from manual typing
      // Don't disable here to avoid flicker - let handleBorrowAmountChange handle it
    }

    // Only auto-update when MAX is enabled - no other automatic borrow amount setting
    if (isBorrowMaxEnabled && maxBorrowable > 0) {
      setBorrowAmount(maxBorrowable.toFixed(2));
    }
  }, [maxBorrowable, isBorrowMaxEnabled, depositAsset, depositAmount, borrowAmount]);

  // Fetch existing vault collateral and max borrowable amount when asset changes
  useEffect(() => {
    const fetchVaultData = async () => {
      if (!depositAsset) {
        setExistingVaultCollateral("0");
        setMaxBorrowableAmount(0);
        return;
      }

      try {
        // Fetch existing vault data
        const vaultData = await cdpService.getVault(depositAsset.asset);
        if (vaultData) {
          setExistingVaultCollateral(vaultData.collateralAmount);
          setExistingVaultDebt(vaultData.debtAmount);
        } else {
          setExistingVaultCollateral("0");
          setExistingVaultDebt("0");
        }

        // Fetch max borrowable amount from backend
        try {
          const maxMintResult = await cdpService.getMaxMint(depositAsset.asset);
          const maxAmountDecimal = parseFloat(formatWeiToDecimal(maxMintResult.maxAmount, 18));
          setMaxBorrowableAmount(maxAmountDecimal);
        } catch (error) {
          console.log("No borrowing power available for asset:", depositAsset.symbol);
          setMaxBorrowableAmount(0);
        }
      } catch (error) {
        console.log("No existing vault found for asset:", depositAsset.symbol);
        setExistingVaultCollateral("0");
        setExistingVaultDebt("0");
        setMaxBorrowableAmount(0);
      }
    };

    fetchVaultData();
  }, [depositAsset]);


  // Reset borrow MAX state when deposit asset changes
  useEffect(() => {
    setIsBorrowMaxEnabled(false);
    setIsDepositMaxEnabled(false);
    setBorrowAmount("0");
    setDepositAmount("0");
  }, [depositAsset]);

  // Handle MAX button click for borrow amount
  const handleBorrowMaxClick = () => {
    if (isBorrowMaxEnabled) {
      // Disable MAX and clear amount
      setIsBorrowMaxEnabled(false);
      setBorrowAmount("0");
    } else {
      // Enable MAX and set to max borrowable
      setIsBorrowMaxEnabled(true);
      setBorrowAmount(maxBorrowable.toFixed(2));
    }
  };

  // Handle manual input change for borrow amount
  const handleBorrowAmountChange = (value: string) => {
    // Check if user manually typed the max amount
    const isTypingMaxAmount = Math.abs(parseFloat(value) - maxBorrowable) < 0.01 && maxBorrowable > 0;
    
    if (isTypingMaxAmount && !isBorrowMaxEnabled) {
      // User typed the max amount, activate MAX styling
      setIsBorrowMaxEnabled(true);
    } else if (!isTypingMaxAmount && isBorrowMaxEnabled) {
      // User changed away from max amount, disable MAX styling
      setIsBorrowMaxEnabled(false);
    }
    
    setBorrowAmount(value);
  };

  // Handle deposit MAX button click
  const handleDepositMaxClick = () => {
    if (isDepositMaxEnabled) {
      // Disable MAX and clear amount
      setIsDepositMaxEnabled(false);
      setDepositAmount("0");
    } else {
      // Enable MAX and set to user's full balance (formatted for input)
      setIsDepositMaxEnabled(true);
      if (depositAsset && userDepositBalance && parseFloat(userDepositBalance) > 0) {
        // Get token info to determine decimals for proper conversion
        const userToken = activeTokens.find(token => 
          token.token.address.toLowerCase() === depositAsset.asset.toLowerCase()
        );
        const decimals = 18;
        
        // Convert from wei to decimal format for display in input
        const formattedBalance = formatWeiToDecimal(userDepositBalance, decimals);
        setDepositAmount(formattedBalance);
      } else {
        setDepositAmount("0");
      }
    }
  };

  // Handle manual input change for deposit amount
  const handleDepositAmountChange = (value: string) => {
    // Check if user manually typed the max deposit amount
    let isTypingMaxAmount = false;
    if (depositAsset && userDepositBalance && parseFloat(userDepositBalance) > 0) {
      // Get token info to determine decimals for proper conversion
      const userToken = activeTokens.find(token => 
        token.token.address.toLowerCase() === depositAsset.asset.toLowerCase()
      );
      const decimals = 18;
      
      // Convert balance to decimal for comparison
      const formattedBalance = formatWeiToDecimal(userDepositBalance, decimals);
      isTypingMaxAmount = Math.abs(parseFloat(value || "0") - parseFloat(formattedBalance)) < 0.000001;
    }
    
    if (isTypingMaxAmount && !isDepositMaxEnabled) {
      // User typed the max amount, activate MAX styling
      setIsDepositMaxEnabled(true);
    } else if (!isTypingMaxAmount && isDepositMaxEnabled) {
      // User changed away from max amount, disable MAX styling
      setIsDepositMaxEnabled(false);
    }
    
    // Deposit is only affected by user input - never by slider or other inputs
    setDepositAmount(value);
    
    // Deposit changes don't affect slider or borrow amount
    // Users must manually adjust borrow or use slider for ratio control
  };

  // Handle CR slider changes
  const handleCRChange = (targetCR: number) => {
    if (!depositAsset || targetCR <= 0) {
      return;
    }
    
    const assetPriceUSD = getAssetPrice();
    if (assetPriceUSD <= 0) return;
    
    // Get existing vault data and new deposit
    const existingCollateralDecimal = parseFloat(formatWeiToDecimal(existingVaultCollateral, 18));
    const existingDebtDecimal = parseFloat(formatWeiToDecimal(existingVaultDebt, 18));
    const newDepositAmount = parseFloat(depositAmount || "0");
    
    // Calculate total collateral value
    const totalCollateralTokens = existingCollateralDecimal + newDepositAmount;
    const totalCollateralValueUSD = totalCollateralTokens * assetPriceUSD;
    
    if (totalCollateralValueUSD <= 0) return;
    
    // Calculate required total debt for target CR
    // CR = (collateral value / debt value) * 100
    // So debt value = (collateral value * 100) / CR
    const requiredTotalDebt = (totalCollateralValueUSD * 100) / targetCR;
    
    // Calculate new borrow amount needed
    const newBorrowAmount = Math.max(0, requiredTotalDebt - existingDebtDecimal);
    
    setBorrowAmount(newBorrowAmount.toFixed(2));
    
    // Disable MAX if it was enabled
    if (isBorrowMaxEnabled) {
      setIsBorrowMaxEnabled(false);
    }
  };

  // Check if projected CR is below liquidation threshold (dangerous)
  const isPositionDangerous = projectedCR > 0 && projectedCR < liquidationRatio;

  // Handle vault creation
  const handleCreateVault = async () => {
    if (!depositAsset) {
      toast({
        title: "No Asset Selected",
        description: "Please select a collateral asset",
        variant: "destructive",
      });
      return;
    }

    const depAmount = parseFloat(depositAmount);
    const borAmount = parseFloat(borrowAmount);

    // Borrowing is now required
    if (borAmount <= 0) {
      toast({
        title: "Invalid Borrow Amount", 
        description: "Please enter a borrow amount",
        variant: "destructive",
      });
      return;
    }

    // Check if we have sufficient total collateral for the borrow amount
    const totalCollateralValueUSD = getTotalCollateralValue();
    if (totalCollateralValueUSD <= 0) {
      toast({
        title: "Insufficient Collateral",
        description: "You need collateral to borrow. Either deposit now or select an asset with existing vault balance.",
        variant: "destructive",
      });
      return;
    }

    // Deposit is now optional - only validate if user entered an amount
    if (depAmount < 0) {
      toast({
        title: "Invalid Deposit Amount",
        description: "Deposit amount cannot be negative",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      let finalResult;
      let successMessage = "";

      // First deposit collateral if user entered an amount > 0
      if (depAmount > 0) {
        const depositResult = await cdpService.deposit(depositAsset.asset, depositAmount);
        
        if (depositResult.status.toLowerCase() !== "success") {
          throw new Error(`Deposit failed with status: ${depositResult.status}`);
        }

        finalResult = depositResult;
        successMessage = `Deposited ${formatNumber(parseFloat(depositAmount))} ${depositAsset.symbol}`;
      }

      // Borrowing is required (already validated above)
      // Use mintMax if MAX is enabled, otherwise use regular mint
      const borrowResult = isBorrowMaxEnabled 
        ? await cdpService.mintMax(depositAsset.asset)
        : await cdpService.mint(depositAsset.asset, borrowAmount);
      
      if (borrowResult.status.toLowerCase() !== "success") {
        throw new Error(`Borrow failed with status: ${borrowResult.status}`);
      }

      finalResult = borrowResult;
      
      // For display, use the actual max amount when MAX is enabled
      const displayAmount = isBorrowMaxEnabled ? maxBorrowableAmount : parseFloat(borrowAmount);
      
      if (depAmount > 0) {
        successMessage += ` and borrowed ${formatNumber(displayAmount)} USDST`;
      } else {
        successMessage = `Borrowed ${formatNumber(displayAmount)} USDST`;
      }

      toast({
        title: "Transaction Successful",
        description: `${successMessage}. Tx: ${finalResult.hash}`,
      });

      // Call success callback to refresh other components
      if (onSuccess) {
        onSuccess();
      }

      // Reset form
      setDepositAmount("0");
      setBorrowAmount("0");
    } catch (error) {
      console.error("Failed to create vault:", error);
      
      // Extract more detailed error information
      let errorMessage = "Please try again";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        // Handle API errors
        const apiError = error as { response?: { data?: { message?: string } }; message?: string };
        if (apiError.response?.data?.message) {
          errorMessage = apiError.response.data.message;
        } else if (apiError.message) {
          errorMessage = apiError.message;
        }
      }
      
      toast({
        title: "Vault Creation Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full">
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
      <h2 className="text-xl font-semibold text-gray-900">Borrow Against Collateral</h2>
      {/* Deposit / Borrow Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deposit */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Deposit <span className="text-sm text-gray-500 font-normal"></span></h3>
          </div>

          <Select 
            value={depositAsset?.symbol || ""} 
            onValueChange={(symbol) => {
              const asset = supportedAssets.find(a => a.symbol === symbol);
              setDepositAsset(asset || null);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select collateral asset" />
            </SelectTrigger>
            <SelectContent>
              {supportedAssets.map((asset) => (
                <SelectItem key={asset.symbol} value={asset.symbol}>{asset.symbol}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Balance display under asset selector */}
          {depositAsset && parseFloat(userDepositBalance) > 0 && (
            <div className="text-xs text-gray-500 text-center">
              {formatBalanceUtil(userDepositBalance, undefined, 18, 1, 4)} {depositAsset.symbol}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Input
              className={`flex-1 text-right ${isDepositMaxEnabled ? 'text-blue-600 bg-blue-50 border-blue-300' : ''}`}
              value={depositAmount}
              onChange={(e) => handleDepositAmountChange(e.target.value)}
              placeholder="0.0 (optional)"
              type="number"
              step="any"
              readOnly={isDepositMaxEnabled}
            />
            <Button 
              variant={isDepositMaxEnabled ? "default" : "ghost"}
              size="sm" 
              className={`min-w-[50px] ${isDepositMaxEnabled ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
              onClick={handleDepositMaxClick}
              disabled={!userDepositBalance || parseFloat(userDepositBalance) <= 0}
            >
              MAX
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            {getAssetPrice() > 0 
              ? `$${formatNumber(getTotalCollateralValue())} total ${parseFloat(existingVaultCollateral) > 0 ? `(+$${formatNumber(parseFloat(depositAmount || "0") * getAssetPrice())} new)` : ""}`
              : "Price unavailable"
            }
          </p>
        </div>

        {/* Borrow */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Borrow</h3>
            {maxBorrowable > 0 && depositAsset && (
              <span className="text-xs text-gray-500">
                Max: ${formatNumber(maxBorrowable)} (safe above {formatNumber(depositAsset.liquidationRatio, 0)}% LT)
              </span>
            )}
          </div>

          <div className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-center">
            <span className="text-sm font-medium text-gray-700">USDST</span>
          </div>

          <div className="flex items-center gap-3">
            <Input
              className={`flex-1 text-right ${isBorrowMaxEnabled ? 'text-blue-600 bg-blue-50 border-blue-300' : ''}`}
              value={borrowAmount}
              onChange={(e) => handleBorrowAmountChange(e.target.value)}
              placeholder="0.0"
              type="number"
              step="any"
              readOnly={isBorrowMaxEnabled}
            />
            <Button 
              variant={isBorrowMaxEnabled ? "default" : "outline"}
              size="sm" 
              className={`min-w-[50px] ${isBorrowMaxEnabled ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
              onClick={handleBorrowMaxClick}
              disabled={maxBorrowable <= 0}
            >
              MAX
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            ${formatNumber(parseFloat(borrowAmount || "0"))}
          </p>
        </div>
      </div>

      {/* CR Slider & Borrow Rate */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
        <div className="lg:col-span-2 border border-gray-200 rounded-xl p-4">
          <CRSlider
            projectedCR={projectedCR}
            liquidationThreshold={liquidationRatio}
            onCRChange={handleCRChange}
            disabled={!depositAsset}
          />
        </div>

        <div className="border border-gray-200 rounded-xl p-6 bg-gray-50 text-center">
          <p className="text-sm text-gray-600 mb-2">Stability Fee</p>
          <p className="text-3xl font-semibold">{formatPercentage(borrowRate)}</p>
        </div>
      </div>

      {/* Warning for dangerous positions */}
      {isPositionDangerous && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">!</span>
            </div>
            <span className="text-sm text-red-700 font-medium">
              Warning: Position below liquidation threshold ({formatPercentage(liquidationRatio, 0)}). This position can be liquidated.
            </span>
          </div>
        </div>
      )}

      <Button 
        className="w-full" 
        onClick={handleCreateVault}
        disabled={loading || !depositAsset || parseFloat(borrowAmount) <= 0 || getAssetPrice() <= 0 || getTotalCollateralValue() <= 0}
      >
        {loading 
          ? "Processing..." 
          : getAssetPrice() <= 0 
            ? "Price data required"
            : getTotalCollateralValue() <= 0
              ? "Need collateral to borrow"
              : parseFloat(borrowAmount) <= 0
                ? "Enter borrow amount"
                : "Borrow"
        }
      </Button>
    </div>
  );
};

export default BorrowWidget;
