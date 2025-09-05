import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cdpService, AssetConfig, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { formatBalance as formatBalanceUtil } from "@/utils/numberUtils";
import { api } from "@/lib/axios";

/**
 * CDP Mint flow widget - now connected to backend
 * Mirrors basic UX from Spark.fi Easy Borrow screen.
 * Uses real asset configurations from backend API.
 */
const MintWidget: React.FC = () => {
  const [supportedAssets, setSupportedAssets] = useState<AssetConfig[]>([]);
  const [depositAsset, setDepositAsset] = useState<AssetConfig | null>(null);
  const [depositAmount, setDepositAmount] = useState("0");
  const [borrowAmount, setBorrowAmount] = useState("0");
  const [loading, setLoading] = useState(false);
  const [isMintMaxEnabled, setIsMintMaxEnabled] = useState(false);
  const [isDepositMaxEnabled, setIsDepositMaxEnabled] = useState(false);
  const [isRatioLocked, setIsRatioLocked] = useState(false);
  const [lockedCR, setLockedCR] = useState<number | null>(null);
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});
  const { toast } = useToast();
  const { activeTokens } = useUserTokens();

  const borrowRate = depositAsset?.stabilityFeeRate || 5.54;
  
  // Get real asset price from dynamic data only
  const getAssetPrice = (): number => {
    if (!depositAsset) return 0;
    return assetPrices[depositAsset.asset] || 0;
  };
  
  // Calculate current collateralization ratio and related values
  const calculateCurrentCR = (): number => {
    if (!depositAsset || !depositAmount || !borrowAmount || 
        parseFloat(depositAmount) <= 0 || parseFloat(borrowAmount) <= 0) {
      return 0;
    }
    
    const collateralAmount = parseFloat(depositAmount);
    const debtAmount = parseFloat(borrowAmount);
    const assetPriceUSD = getAssetPrice();
    const collateralValueUSD = collateralAmount * assetPriceUSD;
    
    // CR = (collateral value / debt value) * 100
    return (collateralValueUSD / debtAmount) * 100;
  };

  // Calculate max borrowable amount based on liquidation threshold from backend
  const calculateMaxBorrowable = (): number => {
    if (!depositAsset || !depositAmount || parseFloat(depositAmount) <= 0) {
      return 0;
    }
    
    const collateralAmount = parseFloat(depositAmount);
    const assetPriceUSD = getAssetPrice();
    const collateralValueUSD = collateralAmount * assetPriceUSD;
    
    // liquidationRatio from backend is the liquidation threshold (e.g., 150 means 150%)
    // At liquidation: CR = LT, so maxDebt = collateralValue / (LT / 100)
    // Apply small safety buffer (1%) to avoid exact liquidation threshold
    const liquidationThreshold = depositAsset.liquidationRatio; // Already in percentage
    const safetyBuffer = 1.01; // 1% buffer above LT
    const effectiveLT = liquidationThreshold * safetyBuffer;
    const maxBorrowableUSD = (collateralValueUSD * 100) / effectiveLT;
    
    return Math.max(0, maxBorrowableUSD);
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
  const currentCR = calculateCurrentCR();
  const liquidationRatio = depositAsset?.liquidationRatio || 150;
  const userDepositBalance = getUserDepositBalance();

  // Dynamic slider configuration based on LT
  const getSliderConfig = () => {
    if (!depositAsset) {
      return { min: 100, max: 500, safeDefault: 200 };
    }
    
    const lt = depositAsset.liquidationRatio;
    const minCR = Math.ceil(lt * 1.01); // LT + 1% minimum
    const safeDefault = Math.ceil(lt * 1.5); // 1.5x LT as safe starting point
    
    // Dynamic max based on LT for better scale
    let maxCR;
    if (lt <= 110) {
      maxCR = 300; // For low LT assets, show up to 300%
    } else if (lt <= 150) {
      maxCR = Math.max(400, lt * 2.5); // For medium LT, show 2.5x or 400%
    } else {
      maxCR = Math.max(500, lt * 2); // For high LT, show 2x or 500%
    }
    
    return { min: minCR, max: maxCR, safeDefault };
  };

  const sliderConfig = getSliderConfig();

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
          const priceResponse = await api.get('/tokens/balance');
          const tokensData = priceResponse.data;
          
          const prices: Record<string, number> = {};
          assets.forEach(asset => {
            // Find the token data that matches this asset
            const tokenData = tokensData.find((token: { address?: string; price?: string }) => 
              token.address?.toLowerCase() === asset.asset.toLowerCase()
            );
            
            if (tokenData?.price) {
              // Convert price from wei format (18 decimals) to regular number
              prices[asset.asset] = parseFloat(formatWeiToDecimal(tokenData.price, 18));
            }
            // No fallback prices - only use real data
          });
          
          setAssetPrices(prices);
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

  // Update max borrowable amount display when collateral amount changes
  useEffect(() => {

    // Check if current mint amount equals max borrowable (within tolerance)
    const currentMintAmount = parseFloat(borrowAmount);
    const isCurrentlyMaxAmount = Math.abs(currentMintAmount - maxBorrowable) < 0.01 && maxBorrowable > 0;
    
    if (isCurrentlyMaxAmount && !isMintMaxEnabled) {
      // Current amount equals max, activate MAX styling
      setIsMintMaxEnabled(true);
    } else if (!isCurrentlyMaxAmount && isMintMaxEnabled) {
      // Current amount doesn't equal max, but MAX is still enabled from manual typing
      // Don't disable here to avoid flicker - let handleBorrowAmountChange handle it
    }

    // Only auto-update when MAX is enabled - no other automatic mint amount setting
    if (isMintMaxEnabled && maxBorrowable > 0) {
      setBorrowAmount(maxBorrowable.toFixed(2));
    }
  }, [maxBorrowable, isMintMaxEnabled, depositAsset, depositAmount, isRatioLocked, lockedCR, borrowAmount]);

  // Reset mint MAX state and ratio lock when deposit asset changes
  useEffect(() => {
    setIsMintMaxEnabled(false);
    setIsDepositMaxEnabled(false);
    setBorrowAmount("0");
    setDepositAmount("0");
    setIsRatioLocked(false);
    setLockedCR(null);
  }, [depositAsset]);

  // Handle MAX button click for mint amount
  const handleMintMaxClick = () => {
    if (isMintMaxEnabled) {
      // Disable MAX and clear amount
      setIsMintMaxEnabled(false);
      setBorrowAmount("0");
    } else {
      // Enable MAX and set to max borrowable
      setIsMintMaxEnabled(true);
      setBorrowAmount(maxBorrowable.toFixed(2));
      // Lock the ratio when MAX is used
      if (parseFloat(depositAmount) > 0 && maxBorrowable > 0 && depositAsset) {
        const collateralAmount = parseFloat(depositAmount);
        const assetPriceUSD = getAssetPrice();
        const collateralValueUSD = collateralAmount * assetPriceUSD;
        const newCR = (collateralValueUSD / maxBorrowable) * 100;
        setIsRatioLocked(true);
        setLockedCR(newCR);
      }
    }
  };

  // Handle manual input change for borrow amount
  const handleBorrowAmountChange = (value: string) => {
    // Check if user manually typed the max amount
    const isTypingMaxAmount = Math.abs(parseFloat(value) - maxBorrowable) < 0.01 && maxBorrowable > 0;
    
    if (isTypingMaxAmount && !isMintMaxEnabled) {
      // User typed the max amount, activate MAX styling
      setIsMintMaxEnabled(true);
    } else if (!isTypingMaxAmount && isMintMaxEnabled) {
      // User changed away from max amount, disable MAX styling
      setIsMintMaxEnabled(false);
    }
    
    // Validate mint amount doesn't violate minimum CR requirement
    if (parseFloat(depositAmount) > 0 && parseFloat(value) > 0 && depositAsset) {
      const collateralAmount = parseFloat(depositAmount);
      const debtAmount = parseFloat(value);
      const assetPriceUSD = getAssetPrice();
      const collateralValueUSD = collateralAmount * assetPriceUSD;
      const newCR = (collateralValueUSD / debtAmount) * 100;
      // Prevent mint amount that would result in CR below minimum using dynamic config
      if (newCR < sliderConfig.min) {
        const maxAllowedDebt = (collateralValueUSD * 100) / sliderConfig.min;
        setBorrowAmount(maxAllowedDebt.toFixed(2));
        setIsRatioLocked(true);
        setLockedCR(sliderConfig.min);
        return;
      }
    }
    
    setBorrowAmount(value);
    
    // When mint amount changes, update the slider to reflect new CR
    // Calculate new CR based on current deposit and new mint amount
    if (parseFloat(depositAmount) > 0 && parseFloat(value) > 0) {
      const collateralAmount = parseFloat(depositAmount);
      const debtAmount = parseFloat(value);
      const assetPriceUSD = getAssetPrice();
      const collateralValueUSD = collateralAmount * assetPriceUSD;
      const newCR = (collateralValueUSD / debtAmount) * 100;
      
      // Update the locked CR to reflect this new ratio
      setIsRatioLocked(true);
      setLockedCR(newCR);
    } else {
      // Clear ratio lock if invalid amounts
      setIsRatioLocked(false);
      setLockedCR(null);
    }
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
    
    // Deposit changes don't affect slider or mint amount
    // Users must manually adjust mint or use slider for ratio control
  };

  // Handle CR slider changes
  const handleCRSliderChange = (values: number[]) => {
    const targetCR = values[0];
    
    if (!depositAsset || !depositAmount || parseFloat(depositAmount) <= 0 || targetCR <= 0) {
      return;
    }
    
    const assetPriceUSD = getAssetPrice();
    if (assetPriceUSD <= 0) {
      return;
    }
    
    // Enforce minimum CR constraint using dynamic slider config
    const effectiveTargetCR = Math.max(targetCR, sliderConfig.min);
    
    const collateralAmount = parseFloat(depositAmount);
    const collateralValueUSD = collateralAmount * assetPriceUSD;
    
    // Calculate mint amount based on effective target CR and current deposit
    // CR = (collateral value / debt value) * 100
    // So debt value = (collateral value * 100) / CR
    const newDebtAmount = (collateralValueUSD * 100) / effectiveTargetCR;
    
    setBorrowAmount(newDebtAmount.toFixed(2));
    
    // Set the locked CR to the effective slider value
    setIsRatioLocked(true);
    setLockedCR(effectiveTargetCR);
    
    // Disable MAX if it was enabled
    if (isMintMaxEnabled) {
      setIsMintMaxEnabled(false);
    }
  };

  // Check if current CR is below liquidation threshold (dangerous)
  const effectiveCR = isRatioLocked && lockedCR ? lockedCR : currentCR;
  const isPositionDangerous = effectiveCR > 0 && effectiveCR < liquidationRatio;

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

    if (depAmount <= 0) {
      toast({
        title: "Invalid Deposit Amount",
        description: "Please enter a valid deposit amount",
        variant: "destructive",
      });
      return;
    }

    // Minting is now optional - only validate if user entered an amount
    if (borAmount < 0) {
      toast({
        title: "Invalid Borrow Amount", 
        description: "Borrow amount cannot be negative",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // First deposit collateral
      const depositResult = await cdpService.deposit(depositAsset.asset, depositAmount);
      
      if (depositResult.status.toLowerCase() !== "success") {
        throw new Error(`Deposit failed with status: ${depositResult.status}`);
      }

      let finalResult = depositResult;
      let successMessage = `Deposited ${formatNumber(parseFloat(depositAmount))} ${depositAsset.symbol}`;

      // Only mint if user specified an amount > 0
      if (borAmount > 0) {
        const mintResult = await cdpService.mint(depositAsset.asset, borrowAmount);
        
        if (mintResult.status.toLowerCase() !== "success") {
          throw new Error(`Mint failed with status: ${mintResult.status}`);
        }
        
        finalResult = mintResult;
        successMessage += ` and minted ${formatNumber(parseFloat(borrowAmount))} USDST`;
      }

      toast({
        title: "Vault Created Successfully",
        description: `${successMessage}. Tx: ${finalResult.hash}`,
      });

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
      <h2 className="text-xl font-semibold text-gray-900">Create Vault</h2>
      {/* Deposit / Borrow Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deposit */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Deposit</h3>
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
              placeholder="0.0"
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
              ? `$${formatNumber(parseFloat(depositAmount || "0") * getAssetPrice())}`
              : "Price unavailable"
            }
          </p>
        </div>

        {/* Mint */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Mint <span className="text-sm text-gray-500 font-normal">(Optional)</span></h3>
            {maxBorrowable > 0 && depositAsset && (
              <span className="text-xs text-gray-500">
                Max: ${formatNumber(maxBorrowable)} (~{formatNumber(depositAsset.liquidationRatio * 1.01, 0)}% CR)
              </span>
            )}
          </div>

          <div className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-center">
            <span className="text-sm font-medium text-gray-700">USDST</span>
          </div>

          <div className="flex items-center gap-3">
            <Input
              className={`flex-1 text-right ${isMintMaxEnabled ? 'text-blue-600 bg-blue-50 border-blue-300' : ''}`}
              value={borrowAmount}
              onChange={(e) => handleBorrowAmountChange(e.target.value)}
              placeholder="0.0 (optional)"
              type="number"
              step="any"
              readOnly={isMintMaxEnabled}
            />
            <Button 
              variant={isMintMaxEnabled ? "default" : "outline"}
              size="sm" 
              className={`min-w-[50px] ${isMintMaxEnabled ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
              onClick={handleMintMaxClick}
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
        <div className="lg:col-span-2 border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center text-sm font-medium">
            <span>Collateralization Ratio (CR)</span>
            <span className={isPositionDangerous ? 'text-red-500 font-bold' : ''}>
              {isRatioLocked && lockedCR ? formatPercentage(lockedCR, 1) : (currentCR > 0 ? formatPercentage(currentCR, 1) : '0.0%')}
            </span>
          </div>
          <div className="relative">
            <div className={isPositionDangerous ? 'cr-slider-dangerous' : ''}>
              <Slider 
                value={isRatioLocked && lockedCR ? [lockedCR] : (currentCR > 0 ? [currentCR] : [sliderConfig.safeDefault])} 
                max={sliderConfig.max} 
                min={sliderConfig.min}
                step={1} 
                onValueChange={handleCRSliderChange}
                disabled={!depositAsset || parseFloat(depositAmount) <= 0 || getAssetPrice() <= 0}
                className="w-full"
              />
            </div>
            {/* Liquidation threshold marker */}
            {depositAsset && (
              <div 
                className="absolute top-0 w-px h-4 bg-red-500 z-10"
                style={{ 
                  left: `${((liquidationRatio - sliderConfig.min) / (sliderConfig.max - sliderConfig.min)) * 100}%` 
                }}
              >
                <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full"></div>
              </div>
            )}
          </div>
          <style>{`
            .cr-slider-dangerous [data-radix-collection-item] {
              background-color: #ef4444 !important;
              border-color: #ef4444 !important;
            }
            .cr-slider-dangerous [data-orientation="horizontal"] {
              background-color: #fecaca !important;
            }
          `}</style>
          <div className="flex justify-between text-xs text-gray-500">
            <span className="text-orange-500">Min: {formatPercentage(sliderConfig.min, 0)}</span>
            <span className="text-red-500">LT: {formatPercentage(liquidationRatio, 0)}</span>
            <span className="text-green-600">Safe: {formatPercentage(sliderConfig.safeDefault, 0)}+</span>
            <span>{formatPercentage(sliderConfig.max, 0)}</span>
          </div>
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
        disabled={loading || !depositAsset || getAssetPrice() <= 0}
      >
        {loading 
          ? "Creating Vault..." 
          : getAssetPrice() <= 0 
            ? "Price data required" 
            : "Create Vault"
        }
      </Button>
    </div>
  );
};

export default MintWidget;
