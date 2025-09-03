import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cdpService, AssetConfig, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";

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
  const { toast } = useToast();
  const { activeTokens } = useUserTokens();

  const borrowRate = depositAsset?.stabilityFeeRate || 5.54;
  
  // Calculate current collateralization ratio and related values
  const calculateCurrentCR = (): number => {
    if (!depositAsset || !depositAmount || !borrowAmount || 
        parseFloat(depositAmount) <= 0 || parseFloat(borrowAmount) <= 0) {
      return 0;
    }
    
    const collateralAmount = parseFloat(depositAmount);
    const debtAmount = parseFloat(borrowAmount);
    const assetPriceUSD = 4000; // Assuming ETH/wstETH price ~$4000
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
    // Assume price for demo (in real app, would fetch from price oracle)
    const assetPriceUSD = 4000; // Assuming ETH/wstETH price ~$4000
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

  const maxBorrowable = calculateMaxBorrowable();
  const currentCR = calculateCurrentCR();
  const liquidationRatio = depositAsset?.liquidationRatio || 150;
  const userDepositBalance = getUserDepositBalance();

  // Fetch supported assets on component mount
  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const assets = await cdpService.getSupportedAssets();
        setSupportedAssets(assets);
        if (assets.length > 0) {
          setDepositAsset(assets[0]); // Set first asset as default
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

  // Update max borrowable amount display when collateral amount changes
  useEffect(() => {
    // Debug log to verify calculation
    if (depositAsset && depositAmount && parseFloat(depositAmount) > 0) {
      console.log('Calculating max borrowable:', {
        depositAmount,
        depositAsset: depositAsset.symbol,
        liquidationRatio: depositAsset.liquidationRatio,
        maxBorrowable,
        isRatioLocked,
        lockedCR
      });
    }

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
        const assetPriceUSD = 4000;
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
      const assetPriceUSD = 4000;
      const collateralValueUSD = collateralAmount * assetPriceUSD;
      const newCR = (collateralValueUSD / debtAmount) * 100;
      const minAllowedCR = depositAsset.liquidationRatio * 1.01; // LT + 1%
      
      // Prevent mint amount that would result in CR below minimum
      if (newCR < minAllowedCR) {
        const maxAllowedDebt = (collateralValueUSD * 100) / minAllowedCR;
        setBorrowAmount(maxAllowedDebt.toFixed(2));
        setIsRatioLocked(true);
        setLockedCR(minAllowedCR);
        return;
      }
    }
    
    setBorrowAmount(value);
    
    // When mint amount changes, update the slider to reflect new CR
    // Calculate new CR based on current deposit and new mint amount
    if (parseFloat(depositAmount) > 0 && parseFloat(value) > 0) {
      const collateralAmount = parseFloat(depositAmount);
      const debtAmount = parseFloat(value);
      const assetPriceUSD = 4000;
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
      // Enable MAX and set to user's full balance
      setIsDepositMaxEnabled(true);
      setDepositAmount(userDepositBalance);
    }
  };

  // Handle manual input change for deposit amount
  const handleDepositAmountChange = (value: string) => {
    // Check if user manually typed the max deposit amount
    const isTypingMaxAmount = Math.abs(parseFloat(value || "0") - parseFloat(userDepositBalance)) < 0.000001 && parseFloat(userDepositBalance) > 0;
    
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
    
    // Enforce minimum CR constraint (LT + 1%)
    const minAllowedCR = depositAsset.liquidationRatio * 1.01;
    const effectiveTargetCR = Math.max(targetCR, minAllowedCR);
    
    const collateralAmount = parseFloat(depositAmount);
    const assetPriceUSD = 4000;
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

    if (borAmount <= 0) {
      toast({
        title: "Invalid Borrow Amount", 
        description: "Please enter a valid amount to mint",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // First deposit collateral
      const depositResult = await cdpService.deposit(depositAsset.asset, depositAmount);
      if (depositResult.status !== "success") {
        throw new Error("Deposit failed");
      }

      // Then mint USDST
      const mintResult = await cdpService.mint(depositAsset.asset, borrowAmount);
      if (mintResult.status !== "success") {
        throw new Error("Mint failed");
      }

      toast({
        title: "Vault Created Successfully",
        description: `Deposited ${depositAmount} ${depositAsset.symbol} and minted ${borrowAmount} USDST. Tx: ${mintResult.hash}`,
      });

      // Reset form
      setDepositAmount("0");
      setBorrowAmount("0");
    } catch (error) {
      console.error("Failed to create vault:", error);
      toast({
        title: "Vault Creation Failed",
        description: "Please try again",
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
            {depositAsset && parseFloat(userDepositBalance) > 0 && (
              <span className="text-xs text-gray-500">
                Balance: {parseFloat(userDepositBalance).toFixed(6)} {depositAsset.symbol}
              </span>
            )}
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
            ${(parseFloat(depositAmount || "0") * 4000).toFixed(2)}
          </p>
        </div>

        {/* Mint */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Mint</h3>
            {maxBorrowable > 0 && depositAsset && (
              <span className="text-xs text-gray-500">
                Max: ${maxBorrowable.toFixed(2)} (~{(depositAsset.liquidationRatio * 1.01).toFixed(0)}% CR)
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
              placeholder="0.0"
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
            ${parseFloat(borrowAmount || "0").toFixed(2)}
          </p>
        </div>
      </div>

      {/* CR Slider & Borrow Rate */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
        <div className="lg:col-span-2 border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center text-sm font-medium">
            <span>Collateralization Ratio (CR)</span>
            <span className={isPositionDangerous ? 'text-red-500 font-bold' : ''}>
              {isRatioLocked && lockedCR ? lockedCR.toFixed(2) : (currentCR > 0 ? currentCR.toFixed(2) : '0.00')}%
            </span>
          </div>
          <div className="relative">
            <div className={isPositionDangerous ? 'cr-slider-dangerous' : ''}>
              <Slider 
                value={isRatioLocked && lockedCR ? [lockedCR] : (currentCR > 0 ? [currentCR] : [liquidationRatio])} 
                max={500} 
                min={depositAsset ? Math.ceil(depositAsset.liquidationRatio * 1.01) : 100}
                step={1} 
                onValueChange={handleCRSliderChange}
                disabled={!depositAsset || parseFloat(depositAmount) <= 0}
                className="w-full"
              />
            </div>
            {/* Liquidation threshold marker */}
            <div 
              className="absolute top-0 w-px h-4 bg-red-500 z-10"
              style={{ 
                left: `${((liquidationRatio - (depositAsset ? Math.ceil(depositAsset.liquidationRatio * 1.01) : 100)) / 
                         (500 - (depositAsset ? Math.ceil(depositAsset.liquidationRatio * 1.01) : 100))) * 100}%` 
              }}
            >
              <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full"></div>
            </div>
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
            <span className="text-orange-500">Min: {depositAsset ? Math.ceil(depositAsset.liquidationRatio * 1.01) : 100}%</span>
            <span className="text-red-500">LT: {liquidationRatio}%</span>
            <span>Safe: {Math.round(liquidationRatio * 1.5)}%+</span>
            <span>500%</span>
          </div>
        </div>

        <div className="border border-gray-200 rounded-xl p-6 bg-gray-50 text-center">
          <p className="text-sm text-gray-600 mb-2">Stability Fee</p>
          <p className="text-3xl font-semibold">{borrowRate}%</p>
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
              Warning: Position below liquidation threshold ({liquidationRatio}%). This position can be liquidated.
            </span>
          </div>
        </div>
      )}

      <Button 
        className="w-full" 
        onClick={handleCreateVault}
        disabled={loading || !depositAsset}
      >
        {loading ? "Creating Vault..." : "Create Vault"}
      </Button>
    </div>
  );
};

export default MintWidget;
