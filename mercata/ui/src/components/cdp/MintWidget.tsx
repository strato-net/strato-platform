import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CRSlider from "./CRSlider";
import { cdpService, AssetConfig, TransactionResponse } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { formatBalance as formatBalanceUtil, formatWeiToDecimalHP, formatNumber, formatDecimalToWeiHP } from "@/utils/numberUtils";
import { api } from "@/lib/axios";
import { CompactRewardsDisplay } from "@/components/rewards/CompactRewardsDisplay";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";

interface MintWidgetProps {
  onSuccess?: () => void; // Callback fired when mint operation succeeds
  title?: string; // Title to display, defaults to "Mint Against Collateral"
}

const MintWidget: React.FC<MintWidgetProps> = ({ onSuccess, title = "Mint Against Collateral" }) => {
  const [supportedAssets, setSupportedAssets] = useState<AssetConfig[]>([]);
  const [depositAsset, setDepositAsset] = useState<AssetConfig | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [isMintMaxEnabled, setIsMintMaxEnabled] = useState(false);
  const [isDepositMaxEnabled, setIsDepositMaxEnabled] = useState(false);
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});
  const [existingVaultCollateral, setExistingVaultCollateral] = useState<string>("0"); // Wei format
  const [existingVaultDebt, setExistingVaultDebt] = useState<string>("0"); // Wei format
  const [isGlobalPaused, setIsGlobalPaused] = useState<boolean>(false);
  const [isAssetPaused, setIsAssetPaused] = useState<boolean>(false);
  const [maxMintableUSD, setMaxMintableUSD] = useState<number>(0);
  const [maxMintLoading, setMaxMintLoading] = useState<boolean>(false);
  const { toast } = useToast();
  const { activeTokens } = useUserTokens();
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  const mintRate = depositAsset?.stabilityFeeRate || 5.54;
  
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
    
    // Get existing debt and new mint amount
    const existingDebtDecimal = parseFloat(formatWeiToDecimalHP(existingVaultDebt, 18));
    const newMintAmt = parseFloat(mintAmount || "0");
    const totalDebt = existingDebtDecimal + newMintAmt;
    
    // Handle case of no debt
    if (totalDebt <= 0) return 999999; // Infinite CR when no debt
    
    // CR = (total collateral value / total debt value) * 100
    const projectedCR = (totalCollateralValueUSD / totalDebt) * 100;
    
    return isFinite(projectedCR) ? projectedCR : 0;
  }, [depositAsset, getTotalCollateralValue, existingVaultDebt, mintAmount]);

  // Get max mintable amount from backend (respects minCR, not liquidationRatio)
  // Note: This only considers existing vault collateral, not new deposits
  const getMaxMintable = useCallback(async (): Promise<number> => {
    if (!depositAsset) return 0;
    
    try {
      setMaxMintLoading(true);
      // Use the backend endpoint that calculates max mintable amount with safety buffer
      // This calls CDPEngine.mintMax which respects minCR
      const result = await cdpService.getMaxMint(depositAsset.asset);
      // Convert from wei to decimal format (USDST is 18 decimals)
      const maxAmount = parseFloat(formatWeiToDecimalHP(result.maxAmount, 18));
      setMaxMintableUSD(maxAmount);
      return maxAmount;
    } catch (error) {
      console.error("Failed to get max mint amount from backend:", error);
      setMaxMintableUSD(0);
      return 0;
    } finally {
      setMaxMintLoading(false);
    }
  }, [depositAsset]);

  // Calculate max mintable including new deposit input
  // This combines backend max (from existing collateral) + additional power from new deposits
  const calculateMaxMintableWithDeposit = useCallback((): number => {
    if (!depositAsset) return 0;
    
    const assetPriceUSD = getAssetPrice();
    if (assetPriceUSD <= 0) return 0;
    
    // Start with backend max from existing collateral (respects minCR with safety buffer)
    let totalMaxMintable = maxMintableUSD;
    
    // Add additional minting power from new deposit input
    const newDepositAmount = parseFloat(depositAmount || "0");
    if (newDepositAmount > 0) {
      // Calculate additional collateral value from new deposit
      const additionalCollateralValueUSD = newDepositAmount * assetPriceUSD;
      
      // Calculate additional minting power based on minCR (NOT liquidationRatio)
      const minCRDecimal = (depositAsset.minCR || depositAsset.liquidationRatio) / 100;
      const additionalMintingPower = additionalCollateralValueUSD / minCRDecimal;
      
      totalMaxMintable += additionalMintingPower;
    }
    
    return Math.max(0, totalMaxMintable);
    
  }, [depositAsset, getAssetPrice, maxMintableUSD, depositAmount]);

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
  const maxMintableAmount = calculateMaxMintableWithDeposit();
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

  const isMintAmountAboveMax = (): boolean => {
    // If MAX mint is enabled, never consider the amount as above max
    if (isMintMaxEnabled) {
      return false;
    }
    
    const currentMintAmount = parseFloat(mintAmount || "0");
    const currentMaxMintable = calculateMaxMintableWithDeposit();
    return currentMintAmount > currentMaxMintable;
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

  // Update MAX mint state and amount when needed
  useEffect(() => {
    // Check if current mint amount equals max mintable (within tolerance)
    const currentMintAmt = parseFloat(mintAmount);
    const currentMaxMint = calculateMaxMintableWithDeposit();
    const isCurrentlyMaxAmount = Math.abs(currentMintAmt - currentMaxMint) < 0.01 && currentMaxMint > 0;
    
    if (isCurrentlyMaxAmount && !isMintMaxEnabled) {
      // Current amount equals max, activate MAX styling
      setIsMintMaxEnabled(true);
    } else if (!isCurrentlyMaxAmount && isMintMaxEnabled) {
      // Current amount doesn't equal max, but MAX is still enabled from manual typing
      // Don't disable here to avoid flicker - let handleMintAmountChange handle it
    }

    // Only auto-update when MAX is enabled - uses calculated value including new deposits
    if (isMintMaxEnabled && currentMaxMint > 0) {
      const maxAmountToSet = currentMaxMint.toFixed(2);
      setMintAmount(maxAmountToSet);
    }
  }, [depositAmount, maxMintableUSD, assetPrices, depositAsset, isMintMaxEnabled, mintAmount, calculateMaxMintableWithDeposit]);

  // Fetch existing vault collateral and max mintable when asset changes
  useEffect(() => {
    const fetchVaultData = async () => {
      if (!depositAsset) {
        setExistingVaultCollateral("0");
        setExistingVaultDebt("0");
        setIsAssetPaused(false);
        setMaxMintableUSD(0);
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

        // Fetch max mintable amount from backend
        await getMaxMintable();
      } catch (error) {
        console.log("No existing vault found for asset:", depositAsset.symbol);
        setExistingVaultCollateral("?");
        setExistingVaultDebt("?");
        setIsAssetPaused(false);
        setMaxMintableUSD(0);
      }
    };

    fetchVaultData();
  }, [depositAsset, getMaxMintable]);


  // Reset mint MAX state when deposit asset changes
  useEffect(() => {
    setIsMintMaxEnabled(false);
    setIsDepositMaxEnabled(false);
    setMintAmount("");
    setDepositAmount("");
  }, [depositAsset]);

  // Handle MAX button click for mint amount
  const handleMintMaxClick = () => {
    if (isMintMaxEnabled) {
      // Disable MAX and clear amount
      setIsMintMaxEnabled(false);
      setMintAmount("");
    } else {
      // Enable MAX and set to calculated max (includes existing + new deposit collateral)
      const currentMaxMintable = calculateMaxMintableWithDeposit();
      const maxAmountToSet = currentMaxMintable.toFixed(2);
      
      setIsMintMaxEnabled(true);
      setMintAmount(maxAmountToSet);
    }
  };

  // Handle manual input change for mint amount
  const handleMintAmountChange = (value: string) => {
    const currentAmount = parseFloat(value || "0");
    
    // Check if user manually typed the max amount (using calculated value with deposits)
    const currentMaxMintable = calculateMaxMintableWithDeposit();
    const isTypingMaxAmount = Math.abs(currentAmount - currentMaxMintable) < 0.01 && currentMaxMintable > 0;
    
    if (isTypingMaxAmount && !isMintMaxEnabled) {
      // User typed the max amount, activate MAX styling
      setIsMintMaxEnabled(true);
    } else if (isMintMaxEnabled) {
      // If MAX is currently enabled, check if user changed the value
      if (currentAmount < currentMaxMintable) {
        // User reduced the amount below max, disable MAX mode
        setIsMintMaxEnabled(false);
      } else if (currentAmount > currentMaxMintable) {
        // User increased above max, disable MAX mode so red styling shows
        setIsMintMaxEnabled(false);
      }
    }
    
    // Always update the mint amount
    setMintAmount(value);
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
    
    // Calculate new mint amount needed
    const newMintAmount = Math.max(0, requiredTotalDebt - existingDebtDecimal);
    
    setMintAmount(newMintAmount.toFixed(2));
    
    // Disable MAX if it was enabled
    if (isMintMaxEnabled) {
      setIsMintMaxEnabled(false);
    }
  };

  // Check if mint operations are paused
  // Note: Deposit is NOT affected by pause (no whenNotPaused modifier on deposit())
  // Only mint/mintMax have whenNotPaused modifier
  const isMintPaused = isGlobalPaused || isAssetPaused;
  
  // Check if there's no more minting room due to being at min collateral ratio threshold
  // This should trigger when user has collateral (existing or being deposited) but no minting power
  const isAtMinCRThreshold = useCallback((): boolean => {
    const hasExistingCollateral = parseFloat(formatWeiToDecimalHP(existingVaultCollateral, 18)) > 0;
    const hasDepositInput = parseFloat(depositAmount || "0") > 0;
    const hasAnyCollateral = hasExistingCollateral || hasDepositInput;
    const currentMaxMintable = calculateMaxMintableWithDeposit();
    return currentMaxMintable <= 0 && hasAnyCollateral;
  }, [existingVaultCollateral, depositAmount, calculateMaxMintableWithDeposit])();


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

      // Refresh max mintable amount from backend
      await getMaxMintable();

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
  const validateDebtConstraints = async (mintAmountDecimal: number): Promise<boolean> => {
    if (!depositAsset || mintAmountDecimal <= 0) return true;


    try {
      // Get current asset debt info
      const debtInfo = await cdpService.getAssetDebtInfo(depositAsset.asset);
      
      // Keep everything in wei for accurate comparison (like blockchain)
      const currentAssetTotalDebtWei = BigInt(debtInfo.currentTotalDebt);
      const debtFloorWei = BigInt(debtInfo.debtFloor);
      const debtCeilingWei = BigInt(debtInfo.debtCeiling);
      
      // Convert mint amount to wei (18 decimals) with exact precision
      const mintAmountWei = BigInt(formatDecimalToWeiHP(mintAmountDecimal.toString(), 18));
      

      // Check debt ceiling constraint (total debt for this asset across all users)
      if (debtCeilingWei > 0n) {
        const newAssetTotalDebtWei = currentAssetTotalDebtWei + mintAmountWei;
        if (newAssetTotalDebtWei > debtCeilingWei) {
          const availableRoomWei = debtCeilingWei > currentAssetTotalDebtWei ? debtCeilingWei - currentAssetTotalDebtWei : 0n;
          const availableRoom = parseFloat(formatWeiToDecimalHP(availableRoomWei.toString(), 18));
          const debtCeilingDecimal = parseFloat(formatWeiToDecimalHP(debtCeilingWei.toString(), 18));
          
          toast({
            title: "Debt Ceiling Exceeded",
            description: `Cannot mint ${mintAmountDecimal.toFixed(2)} USDST. Maximum available: ${availableRoom.toFixed(2)} USDST (asset debt ceiling: ${debtCeilingDecimal.toFixed(2)} USDST)`,
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
        // 1. Convert mint amount to scaled debt: scaledAdd = (amountUSDST * RAY) / rateAccumulator
        // 2. Add to existing scaled debt: newScaledDebt = scaledDebt + scaledAdd  
        // 3. Convert back to debt: totalDebtAfter = (newScaledDebt * rateAccumulator) / RAY
        
        const RAY = BigInt("1000000000000000000000000000"); // 1e27
        const existingScaledDebtWei = BigInt(vaultData.scaledDebt || "0");
        const rateAccumulatorWei = BigInt(vaultData.rateAccumulator || "1000000000000000000000000000");

        // Step 1: Convert mint amount to scaled debt (same as contract)
        const scaledAddWei = (mintAmountWei * RAY + rateAccumulatorWei - 1n) / rateAccumulatorWei;

        // Step 2: Add to existing scaled debt (same as contract)
        const newScaledDebtWei = existingScaledDebtWei + scaledAddWei;

        // Step 3: Convert back to debt for floor check (same as contract)
        const totalDebtAfterWei = (newScaledDebtWei * rateAccumulatorWei) / RAY;
        

        if (totalDebtAfterWei > 0n && totalDebtAfterWei < debtFloorWei) {
          toast({
            title: "Below Debt Floor",
            description: `Mint more USDST to reach the minimum debt floor`,
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
    const mintAmt = parseFloat(mintAmount);

    // At least one amount must be provided
    if (depAmount <= 0 && mintAmt <= 0) {
      toast({
        title: "Invalid Amount", 
        description: "Please enter a deposit amount, mint amount, or both",
        variant: "destructive",
      });
      return;
    }

    // If minting, check if we have sufficient total collateral
    if (mintAmt > 0) {
      const totalCollateralValueUSD = getTotalCollateralValue();
      if (totalCollateralValueUSD <= 0) {
      toast({
        title: "Insufficient Collateral",
        description: "You need collateral to mint. Either deposit now or select an asset with existing vault balance.",
        variant: "destructive",
      });
      return;
      }

      // Validate debt floor and ceiling constraints
      const isValid = await validateDebtConstraints(mintAmt);
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

      // Mint if user entered a mint amount
      if (mintAmt > 0) {
        // Use mintMax if MAX is enabled, otherwise use regular mint
        const mintResult = isMintMaxEnabled 
          ? await cdpService.mintMax(depositAsset.asset)
          : await cdpService.mint(depositAsset.asset, mintAmount);
      
      if (mintResult.status.toLowerCase() !== "success") {
        throw new Error(`Mint failed with status: ${mintResult.status}`);
      }

      finalResult = mintResult;
        
        // For display, use the actual max amount when MAX is enabled
        const displayAmount = isMintMaxEnabled ? maxMintableAmount : parseFloat(mintAmount);
        
      if (depAmount > 0) {
          successMessage += ` and minted ${formatNumber(displayAmount)} USDST`;
      } else {
          successMessage = `Minted ${formatNumber(displayAmount)} USDST`;
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

      // Refresh widget data after successful transaction
      await refreshWidgetData();

      // Reset form
      setDepositAmount("");
      setMintAmount("");
      setIsMintMaxEnabled(false);
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

        {/* Mint */}
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Mint</h3>
            {depositAsset && (
              <span className="text-sm text-muted-foreground">
                {maxMintLoading ? (
                  "Loading..."
                ) : (
                  maxMintableAmount > 0 ? `Max: $${formatNumber(maxMintableAmount)}` : "No minting power"
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
                  isMintMaxEnabled 
                    ? 'text-blue-600 bg-blue-50 border-blue-300' 
                    : isAtMinCRThreshold 
                      ? 'bg-muted text-muted-foreground border-border' 
                      : isMintAmountAboveMax()
                        ? 'text-red-600 bg-red-50 border-red-300'
                        : ''
                }`}
              value={mintAmount}
              onChange={(e) => handleMintAmountChange(e.target.value)}
              placeholder="0.0"
              type="number"
              step="any"
                readOnly={isAtMinCRThreshold}
                disabled={isAtMinCRThreshold}
            />
            <Button 
              variant={isMintMaxEnabled ? "default" : "outline"}
              size="sm" 
              className={`min-w-[50px] ${isMintMaxEnabled ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
              onClick={handleMintMaxClick}
              disabled={maxMintLoading || maxMintableAmount <= 0}
            >
              {maxMintLoading ? "..." : "MAX"}
            </Button>
            </div>
            
            {/* Overlay when at min collateral ratio threshold */}
            {isAtMinCRThreshold && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/90 rounded pointer-events-none">
                <span className="text-muted-foreground font-medium text-sm text-center px-2">
                  Min Collateral Ratio reached — Add more collateral to mint.
                </span>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            ${formatNumber(parseFloat(mintAmount || "0"))}
          </p>
        </div>
      </div>

      {/* CR Slider & Mint Rate */}
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
            totalDebtUSD={parseFloat(formatWeiToDecimalHP(existingVaultDebt, 18)) + parseFloat(mintAmount || "0")}
          />
        </div>

        <div className="p-4 text-left">
          <h3 className="text-base font-bold mb-2">Stability Fee</h3>
          <p className="text-4xl font-bold">{formatPercentage(mintRate)}</p>
        </div>
      </div>

      {/* Transaction Fee Display */}
      {depositAsset && (parseFloat(depositAmount || "0") > 0 || parseFloat(mintAmount || "0") > 0) && (
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            Transaction Fee: {(() => {
              const hasDeposit = parseFloat(depositAmount || "0") > 0;
              const hasMint = parseFloat(mintAmount || "0") > 0;
              
              if (hasDeposit && hasMint) return "0.03";
              if (hasDeposit && !hasMint) return "0.02";
              if (!hasDeposit && hasMint) return "0.01";
              
              return "0.01";
            })()} USDST
          </p>
        </div>
      )}

      <Button 
        className="w-full" 
        onClick={handleCreateVault}
        disabled={
          loading || 
          maxMintLoading ||
          !depositAsset || 
          (parseFloat(depositAmount || "0") <= 0 && parseFloat(mintAmount || "0") <= 0) || 
          getAssetPrice() <= 0 ||
          isDepositAmountAboveMax() ||
          isMintAmountAboveMax() ||
          (parseFloat(mintAmount || "0") > 0 && isMintPaused) // Only block if minting AND paused
        }
      >
        {(() => {
          if (loading) return "Processing...";
          if (maxMintLoading) return "Loading max mint...";
          
          const hasDeposit = parseFloat(depositAmount || "0") > 0;
          const hasMint = parseFloat(mintAmount || "0") > 0;
          
          // Pause message only shown when trying to mint while paused
          if (hasMint && isMintPaused) {
            if (isGlobalPaused) return "Mint paused by admin at this time";
            if (isAssetPaused) return `Mint for ${depositAsset?.symbol} paused by admin at this time`;
          }
          
          if (isDepositAmountAboveMax() || isMintAmountAboveMax()) return "Amount exceeds maximum";
          if (getAssetPrice() <= 0) return "Price data required";
          if (!depositAsset) return "Select asset";
          
          if (!hasDeposit && !hasMint) return "Enter amount";
          if (hasDeposit && hasMint) return "Deposit + Mint";
          if (hasDeposit && !hasMint) return "Deposit";
          if (!hasDeposit && hasMint) return "Mint";
          
          return "Submit";
        })()}
      </Button>

      {userRewards && (() => {
        const cdpActivity = userRewards.activities.find(a => {
          const nameLower = a.activity.name.toLowerCase();
          return nameLower.includes("cdp") || 
                 nameLower.includes("mint") ||
                 (nameLower.includes("borrow") && !nameLower.includes("lending"));
        });
        
        if (!cdpActivity) return null;
        
        const displayAmount = parseFloat(mintAmount || "0") > 0 ? mintAmount : undefined;
        
        return (
          <CompactRewardsDisplay
            key={mintAmount || depositAmount}
            userRewards={userRewards}
            activityName={cdpActivity.activity.name}
            inputAmount={displayAmount}
            actionLabel="Mint"
          />
        );
      })()}
    </div>
  );
};

export default MintWidget;
