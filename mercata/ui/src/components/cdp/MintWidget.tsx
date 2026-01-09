import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CRSlider from "./CRSlider";
import { cdpService, AssetConfig, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { useAuthAction } from "@/hooks/useAuthAction";
import { useTokenContext } from "@/context/TokenContext";
import { formatBalance as formatBalanceUtil, formatWeiToDecimalHP, formatNumber, formatDecimalToWeiHP } from "@/utils/numberUtils";
import { api } from "@/lib/axios";
import { CompactRewardsDisplay } from "@/components/rewards/CompactRewardsDisplay";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";

interface MintWidgetProps {
  onSuccess?: () => void; // Callback fired when borrow operation succeeds
  title?: string; // Title to display, defaults to "Mint Against Collateral"
}

const MintWidget: React.FC<MintWidgetProps> = ({ onSuccess, title = "Mint Against Collateral" }) => {
  const [supportedAssets, setSupportedAssets] = useState<AssetConfig[]>([]);
  const [depositAsset, setDepositAsset] = useState<AssetConfig | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [isBorrowMaxEnabled, setIsBorrowMaxEnabled] = useState(false);
  const [isDepositMaxEnabled, setIsDepositMaxEnabled] = useState(false);
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});
  const [existingVaultCollateral, setExistingVaultCollateral] = useState<string>("0"); // Wei format
  const [existingVaultDebt, setExistingVaultDebt] = useState<string>("0"); // Wei format
  const [isGlobalPaused, setIsGlobalPaused] = useState<boolean>(false);
  const [isAssetPaused, setIsAssetPaused] = useState<boolean>(false);
  const [maxBorrowableUSD, setMaxBorrowableUSD] = useState<number>(0);
  const [maxBorrowLoading, setMaxBorrowLoading] = useState<boolean>(false);
  const { toast } = useToast();
  const { activeTokens, fetchTokens } = useUserTokens();
  const { fetchUsdstBalance } = useTokenContext();
  const { canPerformAction, isLoggedIn } = useAuthAction();
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

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
    const existingCollateralDecimal = parseFloat(formatWeiToDecimalHP(existingVaultCollateral, 18));
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
    const existingDebtDecimal = parseFloat(formatWeiToDecimalHP(existingVaultDebt, 18));
    const newBorrowAmount = parseFloat(borrowAmount || "0");
    const totalDebt = existingDebtDecimal + newBorrowAmount;
    
    // Handle case of no debt
    if (totalDebt <= 0) return 999999; // Infinite CR when no debt
    
    // CR = (total collateral value / total debt value) * 100
    const projectedCR = (totalCollateralValueUSD / totalDebt) * 100;
    
    return isFinite(projectedCR) ? projectedCR : 0;
  }, [depositAsset, getTotalCollateralValue, existingVaultDebt, borrowAmount]);

  // Get max borrowable amount from backend (respects minCR, not liquidationRatio)
  // Note: This only considers existing vault collateral, not new deposits
  const getMaxBorrowable = useCallback(async (): Promise<number> => {
    if (!depositAsset) return 0;
    
    try {
      setMaxBorrowLoading(true);
      // Use the backend endpoint that calculates max borrowable amount with safety buffer
      // This calls CDPEngine.mintMax which respects minCR
      const result = await cdpService.getMaxMint(depositAsset.asset);
      // Convert from wei to decimal format (USDST is 18 decimals)
      const maxAmount = parseFloat(formatWeiToDecimalHP(result.maxAmount, 18));
      setMaxBorrowableUSD(maxAmount);
      return maxAmount;
    } catch (error) {
      console.error("Failed to get max borrow amount from backend:", error);
      setMaxBorrowableUSD(0);
      return 0;
    } finally {
      setMaxBorrowLoading(false);
    }
  }, [depositAsset]);

  // Calculate max borrowable including new deposit input
  // This combines backend max (from existing collateral) + additional power from new deposits
  const calculateMaxBorrowableWithDeposit = useCallback((): number => {
    if (!depositAsset) return 0;
    
    const assetPriceUSD = getAssetPrice();
    if (assetPriceUSD <= 0) return 0;
    
    // Start with backend max from existing collateral (respects minCR with safety buffer)
    let totalMaxBorrowable = maxBorrowableUSD;
    
    // Add additional borrowing power from new deposit input
    const newDepositAmount = parseFloat(depositAmount || "0");
    if (newDepositAmount > 0) {
      // Calculate additional collateral value from new deposit
      const additionalCollateralValueUSD = newDepositAmount * assetPriceUSD;
      
      // Calculate additional borrowing power based on minCR (NOT liquidationRatio)
      const minCRDecimal = (depositAsset.minCR || depositAsset.liquidationRatio) / 100;
      const additionalBorrowingPower = additionalCollateralValueUSD / minCRDecimal;
      
      totalMaxBorrowable += additionalBorrowingPower;
    }
    
    return Math.max(0, totalMaxBorrowable);
    
  }, [depositAsset, getAssetPrice, maxBorrowableUSD, depositAmount]);

  // Get user's balance for the selected deposit asset
  const getUserDepositBalance = (): string => {
    if (!depositAsset) return "0";
    
    const userToken = activeTokens.find(token => 
      token.token.address.toLowerCase() === depositAsset.asset.toLowerCase()
    );
    
    return userToken?.balance || "0";
  };

  // Format percentage with reasonable precision
  const formatPercentage = (num: number, decimals: number = 2): string => {
    if (isNaN(num)) return '0.00%';
    return num.toFixed(decimals) + '%';
  };

  // Use calculated max that includes new deposit input for real-time updates
  // This will be higher than backend max if user is adding new collateral
  const maxBorrowableAmount = calculateMaxBorrowableWithDeposit();
  const projectedCR = calculateProjectedCR();
  const minCR = depositAsset?.minCR || depositAsset?.liquidationRatio;
  const userDepositBalance = getUserDepositBalance();

  // Check if current amounts are above their respective max values
  const isDepositAmountAboveMax = (): boolean => {
    if (!depositAsset || !userDepositBalance) return false;
    const maxDepositAmount = parseFloat(formatWeiToDecimalHP(userDepositBalance, 18));
    const currentDepositAmount = parseFloat(depositAmount || "0");
    return currentDepositAmount > maxDepositAmount;
  };

  const isBorrowAmountAboveMax = (): boolean => {
    // If MAX borrow is enabled, never consider the amount as above max
    if (isBorrowMaxEnabled) {
      return false;
    }
    
    const currentBorrowAmount = parseFloat(borrowAmount || "0");
    const currentMaxBorrowable = calculateMaxBorrowableWithDeposit();
    return currentBorrowAmount > currentMaxBorrowable;
  };

  // Fetch supported assets and prices on component mount
  useEffect(() => {
    const fetchAssetsAndPrices = async () => {
      try {
        const assets = await cdpService.getSupportedAssets();
        setSupportedAssets(assets);
        if (assets.length > 0) {
          setDepositAsset(assets[0]); // Set first asset as default
        }

        // Check global pause status
        try {
          const globalPauseStatus = await cdpService.getGlobalPaused();
          setIsGlobalPaused(globalPauseStatus.isPaused);
        } catch (error) {
          console.error("Failed to fetch global pause status:", error);
          setIsGlobalPaused(true); // Default to not paused if we can't fetch
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
                prices[asset.asset] = parseFloat(formatWeiToDecimalHP(priceResponse.data.price, 18));
              }
            } catch (assetPriceError) {
              // If 404, it means the asset is not in the oracle
              if (assetPriceError.response?.status === 404) {
                console.warn(`Asset ${asset.symbol} not found in price oracle`);
              }
            }
          }
          
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

  // Update MAX borrow state and amount when needed
  useEffect(() => {
    // Check if current borrow amount equals max borrowable (within tolerance)
    const currentBorrowAmount = parseFloat(borrowAmount);
    const currentMaxBorrowable = calculateMaxBorrowableWithDeposit();
    const isCurrentlyMaxAmount = Math.abs(currentBorrowAmount - currentMaxBorrowable) < 0.01 && currentMaxBorrowable > 0;
    
    if (isCurrentlyMaxAmount && !isBorrowMaxEnabled) {
      // Current amount equals max, activate MAX styling
      setIsBorrowMaxEnabled(true);
    } else if (!isCurrentlyMaxAmount && isBorrowMaxEnabled) {
      // Current amount doesn't equal max, but MAX is still enabled from manual typing
      // Don't disable here to avoid flicker - let handleBorrowAmountChange handle it
    }

    // Only auto-update when MAX is enabled - uses calculated value including new deposits
    if (isBorrowMaxEnabled && currentMaxBorrowable > 0) {
      const maxAmountToSet = currentMaxBorrowable.toFixed(2);
      setBorrowAmount(maxAmountToSet);
    }
  }, [depositAmount, maxBorrowableUSD, assetPrices, depositAsset, isBorrowMaxEnabled, borrowAmount, calculateMaxBorrowableWithDeposit]);

  // Fetch existing vault collateral and max borrowable when asset changes
  useEffect(() => {
    const fetchVaultData = async () => {
      if (!depositAsset) {
        setExistingVaultCollateral("0");
        setExistingVaultDebt("0");
        setIsAssetPaused(false);
        setMaxBorrowableUSD(0);
        return;
      }

      // Skip user-specific API calls if not logged in
      if (!isLoggedIn) {
        setExistingVaultCollateral("0");
        setExistingVaultDebt("0");
        setMaxBorrowableUSD(0);
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

        // Check if this specific asset is paused
        try {
          const assetConfig = await cdpService.getAssetConfig(depositAsset.asset);
          setIsAssetPaused(assetConfig?.isPaused || false);
        } catch (error) {
          console.error("Failed to fetch asset pause status:", error);
          setIsAssetPaused(true); // Default to not paused if we can't fetch
        }

        // Fetch max borrowable amount from backend
        await getMaxBorrowable();
      } catch (error) {
        console.log("No existing vault found for asset:", depositAsset.symbol);
        setExistingVaultCollateral("0");
        setExistingVaultDebt("0");
        setIsAssetPaused(false);
        setMaxBorrowableUSD(0);
      }
    };

    fetchVaultData();
  }, [depositAsset, getMaxBorrowable, isLoggedIn]);


  // Reset borrow MAX state when deposit asset changes
  useEffect(() => {
    setIsBorrowMaxEnabled(false);
    setIsDepositMaxEnabled(false);
    setBorrowAmount("");
    setDepositAmount("");
  }, [depositAsset]);

  // Handle MAX button click for borrow amount
  const handleBorrowMaxClick = () => {
    if (isBorrowMaxEnabled) {
      // Disable MAX and clear amount
      setIsBorrowMaxEnabled(false);
      setBorrowAmount("");
    } else {
      // Enable MAX and set to calculated max (includes existing + new deposit collateral)
      const currentMaxBorrowable = calculateMaxBorrowableWithDeposit();
      const maxAmountToSet = currentMaxBorrowable.toFixed(2);
      
      setIsBorrowMaxEnabled(true);
      setBorrowAmount(maxAmountToSet);
    }
  };

  // Handle manual input change for borrow amount
  const handleBorrowAmountChange = (value: string) => {
    const currentAmount = parseFloat(value || "0");
    
    // Check if user manually typed the max amount (using calculated value with deposits)
    const currentMaxBorrowable = calculateMaxBorrowableWithDeposit();
    const isTypingMaxAmount = Math.abs(currentAmount - currentMaxBorrowable) < 0.01 && currentMaxBorrowable > 0;
    
    if (isTypingMaxAmount && !isBorrowMaxEnabled) {
      // User typed the max amount, activate MAX styling
      setIsBorrowMaxEnabled(true);
    } else if (isBorrowMaxEnabled) {
      // If MAX is currently enabled, check if user changed the value
      if (currentAmount < currentMaxBorrowable) {
        // User reduced the amount below max, disable MAX mode
        setIsBorrowMaxEnabled(false);
      } else if (currentAmount > currentMaxBorrowable) {
        // User increased above max, disable MAX mode so red styling shows
        setIsBorrowMaxEnabled(false);
      }
    }
    
    // Always update the borrow amount
    setBorrowAmount(value);
  };

  // Handle deposit MAX button click
  const handleDepositMaxClick = () => {
    if (isDepositMaxEnabled) {
      // Disable MAX and clear amount
      setIsDepositMaxEnabled(false);
      setDepositAmount("");
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
        const formattedBalance = formatWeiToDecimalHP(userDepositBalance, decimals);
        setDepositAmount(formattedBalance);
      } else {
        setDepositAmount("");
      }
    }
  };

  // Handle manual input change for deposit amount
  const handleDepositAmountChange = (value: string) => {
    const currentAmount = parseFloat(value || "0");
    
    // Check if user manually typed the max deposit amount
    let isTypingMaxAmount = false;
    let maxDepositAmount = 0;
    
    if (depositAsset && userDepositBalance && parseFloat(userDepositBalance) > 0) {
      // Convert balance to decimal for comparison
      const formattedBalance = formatWeiToDecimalHP(userDepositBalance, 18);
      maxDepositAmount = parseFloat(formattedBalance);
      isTypingMaxAmount = Math.abs(currentAmount - maxDepositAmount) < 0.000001;
    }
    
    if (isTypingMaxAmount && !isDepositMaxEnabled) {
      // User typed the max amount, activate MAX styling
      setIsDepositMaxEnabled(true);
    } else if (isDepositMaxEnabled) {
      // If MAX is currently enabled, check if user changed the value
      if (currentAmount < maxDepositAmount) {
        // User reduced the amount below max, disable MAX mode
      setIsDepositMaxEnabled(false);
      } else if (currentAmount > maxDepositAmount) {
        // User increased above max, disable MAX mode so red styling shows
        setIsDepositMaxEnabled(false);
      }
    }
    
    // Always update the deposit amount
    setDepositAmount(value);
  };

  // Handle CR slider changes
  const handleCRChange = (targetCR: number) => {
    if (!depositAsset || targetCR <= 0) {
      return;
    }
    
    const assetPriceUSD = getAssetPrice();
    if (assetPriceUSD <= 0) return;
    
    // Get existing vault data and new deposit
    const existingCollateralDecimal = parseFloat(formatWeiToDecimalHP(existingVaultCollateral, 18));
    const existingDebtDecimal = parseFloat(formatWeiToDecimalHP(existingVaultDebt, 18));
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

  // Check if borrow (mint) operations are paused
  // Note: Deposit is NOT affected by pause (no whenNotPaused modifier on deposit())
  // Only mint/mintMax have whenNotPaused modifier
  const isBorrowPaused = isGlobalPaused || isAssetPaused;
  
  // Check if there's no more borrowing room due to being at min collateral ratio threshold
  // This should trigger when user has collateral (existing or being deposited) but no borrowing power
  const isAtMinCRThreshold = useCallback((): boolean => {
    const hasExistingCollateral = parseFloat(formatWeiToDecimalHP(existingVaultCollateral, 18)) > 0;
    const hasDepositInput = parseFloat(depositAmount || "0") > 0;
    const hasAnyCollateral = hasExistingCollateral || hasDepositInput;
    const currentMaxBorrowable = calculateMaxBorrowableWithDeposit();
    return currentMaxBorrowable <= 0 && hasAnyCollateral;
  }, [existingVaultCollateral, depositAmount, calculateMaxBorrowableWithDeposit])();


  // Function to refresh all widget data after successful transaction
  const refreshWidgetData = async () => {
    if (!depositAsset) return;

    try {
      // Refresh existing vault data
      const vaultData = await cdpService.getVault(depositAsset.asset);
      if (vaultData) {
        setExistingVaultCollateral(vaultData.collateralAmount);
        setExistingVaultDebt(vaultData.debtAmount);
      } else {
        setExistingVaultCollateral("0");
        setExistingVaultDebt("0");
      }

      // Refresh max borrowable amount from backend
      await getMaxBorrowable();

      // Refresh asset prices (in case they changed)
      try {
        const priceResponse = await api.get(`/oracle/price?asset=${depositAsset.asset}`);
        if (priceResponse.data?.price) {
          const newPrice = parseFloat(formatWeiToDecimalHP(priceResponse.data.price, 18));
          setAssetPrices(prev => ({
            ...prev,
            [depositAsset.asset]: newPrice
          }));
        }
      } catch (error) {
        console.error("Failed to refresh asset price:", error);
      }
    } catch (error) {
      console.error("Failed to refresh widget data:", error);
    }
  };

  // Validate debt floor and ceiling constraints
  const validateDebtConstraints = async (borrowAmountDecimal: number): Promise<boolean> => {
    if (!depositAsset || borrowAmountDecimal <= 0) return true;


    try {
      // Get current asset debt info
      const debtInfo = await cdpService.getAssetDebtInfo(depositAsset.asset);
      
      // Keep everything in wei for accurate comparison (like blockchain)
      const currentAssetTotalDebtWei = BigInt(debtInfo.currentTotalDebt);
      const debtFloorWei = BigInt(debtInfo.debtFloor);
      const debtCeilingWei = BigInt(debtInfo.debtCeiling);
      
      // Convert borrow amount to wei (18 decimals) with exact precision
      const borrowAmountWei = BigInt(formatDecimalToWeiHP(borrowAmountDecimal.toString(), 18));
      

      // Check debt ceiling constraint (total debt for this asset across all users)
      if (debtCeilingWei > 0n) {
        const newAssetTotalDebtWei = currentAssetTotalDebtWei + borrowAmountWei;
        if (newAssetTotalDebtWei > debtCeilingWei) {
          const availableRoomWei = debtCeilingWei > currentAssetTotalDebtWei ? debtCeilingWei - currentAssetTotalDebtWei : 0n;
          const availableRoom = parseFloat(formatWeiToDecimalHP(availableRoomWei.toString(), 18));
          const debtCeilingDecimal = parseFloat(formatWeiToDecimalHP(debtCeilingWei.toString(), 18));
          
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
        // Get current vault data to access scaledDebt and rateAccumulator
        const vaultData = await cdpService.getVault(depositAsset.asset);
        if (!vaultData) {
          return true;
        }

        // Simulate the exact contract calculation:
        // 1. Convert borrow amount to scaled debt: scaledAdd = (amountUSDST * RAY) / rateAccumulator
        // 2. Add to existing scaled debt: newScaledDebt = scaledDebt + scaledAdd  
        // 3. Convert back to debt: totalDebtAfter = (newScaledDebt * rateAccumulator) / RAY
        
        const RAY = BigInt("1000000000000000000000000000"); // 1e27
        const existingScaledDebtWei = BigInt(vaultData.scaledDebt || "0");
        const rateAccumulatorWei = BigInt(vaultData.rateAccumulator || "1000000000000000000000000000");

        // Step 1: Convert borrow amount to scaled debt (same as contract)
        const scaledAddWei = (borrowAmountWei * RAY + rateAccumulatorWei - 1n) / rateAccumulatorWei;

        // Step 2: Add to existing scaled debt (same as contract)
        const newScaledDebtWei = existingScaledDebtWei + scaledAddWei;

        // Step 3: Convert back to debt for floor check (same as contract)
        const totalDebtAfterWei = (newScaledDebtWei * rateAccumulatorWei) / RAY;
        

        if (totalDebtAfterWei > 0n && totalDebtAfterWei < debtFloorWei) {
          toast({
            title: "Below Debt Floor",
            description: `Borrow more USDST to reach the minimum debt floor`,
            variant: "destructive",
          });
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("🔍 [MintWidget] Failed to validate debt constraints:", error);
      // Don't block the transaction if validation fails
      return true;
    }
  };

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

    // At least one amount must be provided
    if (depAmount <= 0 && borAmount <= 0) {
      toast({
        title: "Invalid Amount", 
        description: "Please enter a deposit amount, borrow amount, or both",
        variant: "destructive",
      });
      return;
    }

    // If borrowing, check if we have sufficient total collateral
    if (borAmount > 0) {
      const totalCollateralValueUSD = getTotalCollateralValue();
      if (totalCollateralValueUSD <= 0) {
      toast({
        title: "Insufficient Collateral",
        description: "You need collateral to borrow. Either deposit now or select an asset with existing vault balance.",
        variant: "destructive",
      });
      return;
      }

      // Validate debt floor and ceiling constraints
      const isValid = await validateDebtConstraints(borAmount);
      if (!isValid) {
        return; // Validation failed, error already shown
      }
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

      // Borrow if user entered a borrow amount
      if (borAmount > 0) {
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
      }

      toast({
        title: "Transaction Successful",
        description: `${successMessage}. Tx: ${finalResult.hash}`,
      });

      // Call success callback to refresh other components
      if (onSuccess) {
        onSuccess();
      }

      // Refresh widget data and balances after successful transaction
      await Promise.all([
        refreshWidgetData(),
        fetchUsdstBalance(),
        fetchTokens()
      ]);

      // Reset form
      setDepositAmount("");
      setBorrowAmount("");
      setIsBorrowMaxEnabled(false);
      setIsDepositMaxEnabled(false);
    } catch (error) {
      console.error("Failed to create vault:", error);
      
      // Extract more detailed error information
      let errorMessage = "Please try again";
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
      <h2 className="text-2xl font-bold text-foreground">{title}</h2>
      {/* Deposit / Borrow Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deposit */}
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Deposit <span className="text-sm text-muted-foreground font-normal"></span></h3>
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
          {depositAsset && (
            <div className="text-sm text-muted-foreground text-left">
              Available: {userDepositBalance && parseFloat(userDepositBalance) > 0 
                ? formatBalanceUtil(userDepositBalance, undefined, 18, 1, 4) 
                : "0"
              } {depositAsset.symbol}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Input
                className={`flex-1 text-right ${
                  isDepositMaxEnabled 
                    ? 'text-blue-600 bg-blue-50 border-blue-300' 
                    : isDepositAmountAboveMax() 
                      ? 'text-red-600 bg-red-50 border-red-300' 
                      : ''
                }`}
              value={depositAmount}
              onChange={(e) => handleDepositAmountChange(e.target.value)}
                placeholder="0.0"
              type="number"
              step="any"
            />
            <Button 
              variant={isDepositMaxEnabled ? "default" : "outline"}
              size="sm" 
              className={`min-w-[50px] ${isDepositMaxEnabled ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
              onClick={handleDepositMaxClick}
              disabled={!userDepositBalance || parseFloat(userDepositBalance) <= 0}
            >
              MAX
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {getAssetPrice() > 0 
              ? `Collateral: $${formatNumber(getTotalCollateralValue())} total ${parseFloat(existingVaultCollateral) > 0 ? `(+$${formatNumber(parseFloat(depositAmount || "0") * getAssetPrice())} new)` : ""}`
              : "Price unavailable"
            }
          </p>
        </div>

        {/* Borrow */}
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Borrow</h3>
            {depositAsset && (
              <span className="text-sm text-muted-foreground">
                {maxBorrowLoading ? (
                  "Loading..."
                ) : (
                  maxBorrowableAmount > 0 ? `Max: $${formatNumber(maxBorrowableAmount)}` : "No borrowing power"
                )}
              </span>
            )}
          </div>

          <div className="w-full p-3 bg-muted/50 border border-border rounded-lg text-center">
            <span className="text-sm font-medium text-foreground">USDST</span>
          </div>

          {/* Spacer to align with deposit side's balance display */}
          <div className="text-xs text-muted-foreground text-left" style={{ height: "5px" }}>
            {/* Empty spacer for vertical alignment */}
          </div>

          <div className="relative">
          <div className="flex items-center gap-3">
            <Input
                className={`flex-1 text-right ${
                  isBorrowMaxEnabled 
                    ? 'text-blue-600 bg-blue-50 border-blue-300' 
                    : isAtMinCRThreshold 
                      ? 'bg-muted text-muted-foreground border-border' 
                      : isBorrowAmountAboveMax()
                        ? 'text-red-600 bg-red-50 border-red-300'
                        : ''
                }`}
              value={borrowAmount}
              onChange={(e) => handleBorrowAmountChange(e.target.value)}
              placeholder="0.0"
              type="number"
              step="any"
                readOnly={isAtMinCRThreshold}
                disabled={isAtMinCRThreshold}
            />
            <Button 
              variant={isBorrowMaxEnabled ? "default" : "outline"}
              size="sm" 
              className={`min-w-[50px] ${isBorrowMaxEnabled ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
              onClick={handleBorrowMaxClick}
              disabled={maxBorrowLoading || maxBorrowableAmount <= 0}
            >
              {maxBorrowLoading ? "..." : "MAX"}
            </Button>
            </div>
            
            {/* Overlay when at min collateral ratio threshold */}
            {isAtMinCRThreshold && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/90 rounded pointer-events-none">
                <span className="text-muted-foreground font-medium text-sm text-center px-2">
                  Min Collateral Ratio reached — Add more collateral to borrow.
                </span>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            ${formatNumber(parseFloat(borrowAmount || "0"))}
          </p>
          {borrowAmount && parseFloat(borrowAmount) > 0 && (
            <CompactRewardsDisplay
              userRewards={userRewards}
              activityName="CDP USDST Mint"
              inputAmount={borrowAmount}
              actionLabel="Borrow"
            />
          )}
        </div>
      </div>

      {/* CR Slider & Borrow Rate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="p-4">
          <CRSlider
            projectedCR={projectedCR}
            minCR={minCR}
            onCRChange={handleCRChange}
            disabled={!depositAsset}
            hasCollateral={
              parseFloat(formatWeiToDecimalHP(existingVaultCollateral, 18)) > 0 || 
              parseFloat(depositAmount || "0") > 0
            }
            collateralValueUSD={getTotalCollateralValue()}
            totalDebtUSD={parseFloat(formatWeiToDecimalHP(existingVaultDebt, 18)) + parseFloat(borrowAmount || "0")}
          />
        </div>

        <div className="p-4 text-left">
          <h3 className="text-base font-bold mb-2">Stability Fee</h3>
          <p className="text-4xl font-bold">{formatPercentage(borrowRate)}</p>
        </div>
      </div>

      {/* Transaction Fee Display */}
      {depositAsset && (parseFloat(depositAmount || "0") > 0 || parseFloat(borrowAmount || "0") > 0) && (
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            Transaction Fee: {(() => {
              const hasDeposit = parseFloat(depositAmount || "0") > 0;
              const hasBorrow = parseFloat(borrowAmount || "0") > 0;
              
              if (hasDeposit && hasBorrow) return "0.03";
              if (hasDeposit && !hasBorrow) return "0.02";
              if (!hasDeposit && hasBorrow) return "0.01";
              
              return "0.01";
            })()} USDST
          </p>
        </div>
      )}

      <Button 
        className="w-full" 
        onClick={handleCreateVault}
        disabled={
          !canPerformAction ||
          loading || 
          maxBorrowLoading ||
          !depositAsset || 
          (parseFloat(depositAmount || "0") <= 0 && parseFloat(borrowAmount || "0") <= 0) || 
          getAssetPrice() <= 0 ||
          isDepositAmountAboveMax() ||
          isBorrowAmountAboveMax() ||
          (parseFloat(borrowAmount || "0") > 0 && isBorrowPaused) // Only block if borrowing AND paused
        }
      >
        {(() => {
          if (loading) return "Processing...";
          if (maxBorrowLoading) return "Loading max borrow...";
          
          const hasDeposit = parseFloat(depositAmount || "0") > 0;
          const hasBorrow = parseFloat(borrowAmount || "0") > 0;
          
          // Pause message only shown when trying to borrow while paused
          if (hasBorrow && isBorrowPaused) {
            if (isGlobalPaused) return "Borrow paused by admin at this time";
            if (isAssetPaused) return `Borrow for ${depositAsset?.symbol} paused by admin at this time`;
          }
          
          if (isDepositAmountAboveMax() || isBorrowAmountAboveMax()) return "Amount exceeds maximum";
          if (getAssetPrice() <= 0) return "Price data required";
          if (!depositAsset) return "Select asset";
          
          if (!hasDeposit && !hasBorrow) return "Enter amount";
          if (hasDeposit && hasBorrow) return "Deposit + Borrow";
          if (hasDeposit && !hasBorrow) return "Deposit";
          if (!hasDeposit && hasBorrow) return "Borrow";
          
          return "Submit";
        })()}
      </Button>
    </div>
  );
};

export default MintWidget;
