import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BORROW_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, formatWeiAmount, safeParseFloat, formatUnits } from "@/utils/numberUtils";
import { NewLoanData, CollateralData, HealthImpactData } from "@/interface";
import { calculateBorrowHealthImpact } from "@/utils/lendingUtils";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";
import { useLendingContext } from "@/context/LendingContext";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";
import { UserRewardsData } from "@/services/rewardsService";
import { CompactRewardsDisplay } from "../rewards/CompactRewardsDisplay";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface BorrowFormProps {
  loans: NewLoanData | null;
  borrowLoading: boolean;
  onBorrow: (amount: string, requiredCollateral?: Array<{ asset: CollateralData; amount: string }>) => Promise<boolean> | boolean;
  usdstBalance: string;
  voucherBalance: string;
  collateralInfo: CollateralData[] | null;
  startPolling?: () => void;
  stopPolling?: () => void;
  userRewards?: UserRewardsData | null;
  rewardsLoading?: boolean;
}

// Component to display USD amounts with 2 decimals and tooltip showing precise amount
const FormattedUSDAmount = ({ weiAmount, symbol = "USDST", preciseAmount }: { weiAmount: string | bigint; symbol?: string; preciseAmount?: string }) => {
  const amountStr = typeof weiAmount === 'bigint' ? weiAmount.toString() : weiAmount;
  const precise = preciseAmount || formatWeiAmount(amountStr, 18);
  const display = parseFloat(precise).toFixed(2);
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">{symbol} {display}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{symbol} {precise}</p>
      </TooltipContent>
    </Tooltip>
  );
};

const BorrowForm = ({ loans, borrowLoading, onBorrow, usdstBalance, voucherBalance, collateralInfo, startPolling, stopPolling, userRewards, rewardsLoading }: BorrowFormProps) => {
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [borrowAmountError, setBorrowAmountError] = useState<string>("");
  const [feeError, setFeeError] = useState<string>("");
  const [riskLevel, setRiskLevel] = useState(0);
  const [healthImpact, setHealthImpact] = useState<HealthImpactData>({
    currentHealthFactor: 0,
    newHealthFactor: 0,
    healthImpact: 0,
    isHealthy: true,
  });
  const { borrowMax } = useLendingContext();

  const HF_MAX = 10;
  
  // Calculate minimum health factor dynamically based on collateral assets
  // Formula: At max borrow (using LTV), HF = (collateral × liquidation_threshold) / (collateral × LTV) = liquidation_threshold / LTV
  // We use the minimum ratio across all assets to ensure the slider allows all possible borrow scenarios
  const HF_MIN = useMemo(() => {
    if (!collateralInfo || collateralInfo.length === 0) {
      // If no collateral info, use a conservative default that's definitely achievable
      // This is only used as a fallback - the form should ideally wait for collateral info
      return 1.5;
    }
    
    let minHF = Infinity;
    
    for (const asset of collateralInfo) {
      try {
        const liquidationThresholdBP = BigInt(asset.liquidationThreshold || "0"); // basis points
        const ltvBP = BigInt(asset.ltv || "0"); // basis points
        
        // Skip if either value is missing or zero
        if (liquidationThresholdBP === 0n || ltvBP === 0n) continue;
        
        // Calculate HF at max borrow: liquidation_threshold / LTV
        // Both are in basis points, so: (liquidationThresholdBP / 10000) / (ltvBP / 10000) = liquidationThresholdBP / ltvBP
        const hfAtMaxBorrow = Number(liquidationThresholdBP) / Number(ltvBP);
        
        if (hfAtMaxBorrow > 0 && hfAtMaxBorrow < minHF) {
          minHF = hfAtMaxBorrow;
        }
      } catch (error) {
        // Skip this asset if calculation fails
        continue;
      }
    }
    
    // If we found valid assets, return the minimum
    // If no valid assets found, use conservative default that's definitely achievable
    return isFinite(minHF) && minHF > 0 ? minHF : 1.5;
  }, [collateralInfo]);
  
  // Initialize target health factor - will be updated when borrow amount is entered
  const [targetHealthFactor, setTargetHealthFactor] = useState<number>(HF_MAX);

  // State for collateral deposit section
  const [selectedCollateralDeposits, setSelectedCollateralDeposits] = useState<Record<string, string>>({});

  // Calculate borrow amount in wei - needs to be defined early since it's used in other useMemos
  const borrowAmountWei = useMemo(() => {
    try {
      return safeParseUnits(borrowAmount || "0", 18);
    } catch {
      return 0n;
    }
  }, [borrowAmount]);

  // Create preview loan that includes selected collateral deposits
  // This is used for health factor calculations to show what the HF would be after deposits + borrow
  const loanForPreview = useMemo<NewLoanData | null>(() => {
    if (!loans) return null;
    
    // Start with current collateral value
    let totalCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0"); // USD 1e18 (threshold-adjusted)
    
    // Add selected collateral deposits
    if (collateralInfo && Array.isArray(collateralInfo) && Object.keys(selectedCollateralDeposits).length > 0) {
      for (const asset of collateralInfo) {
        const selectedAmount = selectedCollateralDeposits[asset.address];
        if (selectedAmount && parseFloat(selectedAmount) > 0) {
          try {
            const depositWei = safeParseUnits(selectedAmount, asset.customDecimals ?? 18);
            const assetPrice = BigInt(asset.assetPrice || "0"); // USD 1e18
            const liqThreshold = BigInt(asset.liquidationThreshold || "0"); // bps
            const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
            
            if (depositWei > 0n && liqThreshold > 0n && assetPrice > 0n) {
              // Calculate USD value of deposit
              const depositValueUSD = (depositWei * assetPrice) / tokenDecimals;
              // Apply liquidation threshold (same as deposited collateral)
              const depositValueWithThreshold = (depositValueUSD * liqThreshold) / 10000n;
              totalCollateralValueUSD += depositValueWithThreshold;
            }
          } catch (error) {
            // Skip this asset if calculation fails
            continue;
          }
        }
      }
    }
    
    // Return updated loan data with selected deposits included
    return {
      ...loans,
      totalCollateralValueUSD: totalCollateralValueUSD.toString(),
      // Recalculate health factor raw with new collateral value
      healthFactorRaw: (() => {
        const currentDebtUSD = BigInt(loans.totalAmountOwed || "0");
        if (currentDebtUSD === 0n) return "0"; // Infinite HF when no debt
        // HF = (collateral * 1e18) / debt
        return ((totalCollateralValueUSD * (10n ** 18n)) / currentDebtUSD).toString();
      })(),
      healthFactor: (() => {
        const currentDebtUSD = BigInt(loans.totalAmountOwed || "0");
        if (currentDebtUSD === 0n) return Infinity;
        return Number(totalCollateralValueUSD) / Number(currentDebtUSD);
      })(),
    };
  }, [loans, collateralInfo, selectedCollateralDeposits]);

  // Calculate maximum achievable HF with current borrow amount + all available collateral
  const maxAchievableHF = useMemo(() => {
    if (!loans || !borrowAmount || borrowAmountWei <= 0n) {
      // If no borrow amount, use HF at zero borrow
      if (!loanForPreview) return HF_MAX;
      try {
        const hf0 = Number(calculateBorrowHealthImpact(0n, loanForPreview).newHealthFactor);
        if (!isFinite(hf0) || hf0 <= 0) return HF_MAX;
        return hf0;
      } catch {
        return HF_MAX;
      }
    }
    
    // Calculate max HF with borrow amount + all available collateral
    let maxCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0"); // Current deposited
    
    // Add all available undeposited collateral
    if (collateralInfo && Array.isArray(collateralInfo)) {
      for (const asset of collateralInfo) {
        try {
          const userBalanceWei = BigInt(asset.userBalance || "0");
          const collateralizedWei = BigInt(asset.collateralizedAmount || "0");
          const undepositedWei = userBalanceWei > collateralizedWei ? userBalanceWei - collateralizedWei : 0n;
          
          if (undepositedWei > 0n) {
            const assetPrice = BigInt(asset.assetPrice || "0"); // USD 1e18
            const liqThreshold = BigInt(asset.liquidationThreshold || "0"); // bps
            const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
            
            if (liqThreshold > 0n && assetPrice > 0n) {
              const depositValueUSD = (undepositedWei * assetPrice) / tokenDecimals;
              const depositValueWithThreshold = (depositValueUSD * liqThreshold) / 10000n;
              maxCollateralValueUSD += depositValueWithThreshold;
            }
          }
        } catch {
          continue;
        }
      }
    }
    
    // Calculate HF with max collateral and borrow amount
    const currentDebtUSD = BigInt(loans.totalAmountOwed || "0");
    const newDebtUSD = currentDebtUSD + borrowAmountWei;
    
    if (newDebtUSD === 0n) return HF_MAX;
    const maxHF = Number(maxCollateralValueUSD) / Number(newDebtUSD);
    
    return isFinite(maxHF) && maxHF > 0 ? maxHF : HF_MAX;
  }, [loans, borrowAmount, borrowAmountWei, collateralInfo, loanForPreview]);

  // Calculate minimum achievable HF for current borrow amount (with current collateral only, no additional deposits)
  const minAchievableHF = useMemo(() => {
    if (!loans || !borrowAmount || borrowAmountWei <= 0n) {
      // If no borrow amount, use HF_MIN (theoretical minimum)
      return HF_MIN;
    }
    
    // Minimum HF = what you'd have with current collateral + borrow amount (no additional deposits)
    const currentCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0"); // USD 1e18 (threshold-adjusted)
    const currentDebtUSD = BigInt(loans.totalAmountOwed || "0"); // USD 1e18
    const newDebtUSD = currentDebtUSD + borrowAmountWei; // USD 1e18
    
    if (newDebtUSD === 0n) return HF_MAX; // No debt = infinite HF
    
    const minHF = Number(currentCollateralValueUSD) / Number(newDebtUSD);
    return isFinite(minHF) && minHF > 0 ? minHF : HF_MIN;
  }, [loans, borrowAmount, borrowAmountWei, HF_MIN]);

  const hfSliderMax = useMemo(() => {
    // Ensure the slider range is always valid
    // Allow slider max to exceed HF_MAX when achievable HF is higher (e.g., small borrow amounts)
    // But ensure it's at least HF_MIN
    return Math.max(HF_MIN, maxAchievableHF);
  }, [HF_MIN, maxAchievableHF]);

  const hfSliderMin = useMemo(() => {
    // Minimum is the higher of: theoretical minimum (HF_MIN) or minimum achievable with current borrow amount
    return Math.max(HF_MIN, minAchievableHF);
  }, [HF_MIN, minAchievableHF]);
  
  // Ensure target health factor doesn't exceed slider max when slider max changes
  // This prevents flip-flopping when current HF > 10
  useEffect(() => {
    // Only clamp if we're above the max
    if (targetHealthFactor > hfSliderMax) {
      setTargetHealthFactor(hfSliderMax);
    }
  }, [hfSliderMax]); // Only depend on hfSliderMax to avoid loops

  // Calculate "Available to Borrow" including all user balances (not just deposited collateral)
  // This shows what you COULD borrow if you deposited all your available collateral
  // Formula: (LTV × deposited collateral value) + (LTV × undeposited collateral value) - current debt
  const maxAvailableToBorrowForPreviewWei = useMemo(() => {
    if (!loans) return 0n;
    
    // Start with borrowing power from already deposited collateral (LTV × deposited)
    // This is loans.totalBorrowingPowerUSD which is the sum of (deposited collateral × LTV)
    const depositedBorrowingPower = (() => {
      try {
        return BigInt(loans.totalBorrowingPowerUSD || "0");
      } catch {
        return 0n;
      }
    })();

    // Calculate total borrowing power from ALL collateral (deposited + undeposited)
    // Formula: (LTV × deposited) + (LTV × undeposited) = (LTV × total wallet balance)
    // We need to calculate: (deposited amount × LTV) + (undeposited amount × LTV)
    // Since userBalance might not include deposited amounts, we use:
    // totalAmount = userBalance (wallet) + collateralizedAmount (deposited)
    let totalWalletBorrowingPower = 0n;
    const assetBreakdown: Array<{symbol: string; userBalance: string; collateralized: string; totalAmount: string; totalUsdValue: string; totalBorrowPower: string}> = [];
    
    if (collateralInfo && Array.isArray(collateralInfo)) {
      for (const asset of collateralInfo) {
        try {
          const userBalanceWei = BigInt(asset.userBalance || "0"); // Wallet balance (undeposited)
          const collateralizedWei = BigInt(asset.collateralizedAmount || "0"); // Already deposited
          
          // Total amount = wallet balance + deposited amount
          // This gives us the complete picture of all collateral (deposited + undeposited)
          const totalAmountWei = userBalanceWei + collateralizedWei;
          
          if (totalAmountWei > 0n) {
            const assetPrice = BigInt(asset.assetPrice || "0"); // USD 1e18
            const ltvBP = BigInt(asset.ltv || "0"); // bps
            const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
            
            if (ltvBP > 0n && assetPrice > 0n) {
              // Calculate USD value of total amount (deposited + undeposited)
              const totalValueUSD = (totalAmountWei * assetPrice) / tokenDecimals;
              // Calculate borrowing power: USD value * LTV (in basis points)
              const borrowPowerUSD = (totalValueUSD * ltvBP) / 10000n;
              totalWalletBorrowingPower += borrowPowerUSD;
              
              // Track breakdown for debugging
              assetBreakdown.push({
                symbol: asset._symbol || 'Unknown',
                userBalance: formatUnits(userBalanceWei, asset.customDecimals ?? 18),
                collateralized: formatUnits(collateralizedWei, asset.customDecimals ?? 18),
                totalAmount: formatUnits(totalAmountWei, asset.customDecimals ?? 18),
                totalUsdValue: formatUnits(totalValueUSD, 18),
                totalBorrowPower: formatUnits(borrowPowerUSD, 18),
              });
            }
          }
        } catch (error) {
          // Skip this asset if calculation fails
          console.error(`Error calculating borrowing power for ${asset._symbol}:`, error);
          continue;
        }
      }
    }

    // Total borrowing power = sum of (LTV × total amount) for all assets
    // This equals: (LTV × deposited) + (LTV × undeposited)
    const totalBorrowingPower = totalWalletBorrowingPower;
    
    // Current debt
    const currentDebt = (() => {
      try {
        return BigInt(loans.totalAmountOwed || "0");
      } catch {
        return 0n;
      }
    })();
    
    // Available to borrow = Total borrowing power - current debt
    const total = totalBorrowingPower > currentDebt ? totalBorrowingPower - currentDebt : 0n;
    
    // Debug logging (remove in production)
    if (process.env.NODE_ENV === 'development') {
      console.log('Available to Borrow Calculation:', {
        depositedBorrowingPower_fromBackend: formatUnits(depositedBorrowingPower, 18),
        totalWalletBorrowingPower: formatUnits(totalWalletBorrowingPower, 18),
        totalBorrowingPower: formatUnits(totalBorrowingPower, 18),
        currentDebt: formatUnits(currentDebt, 18),
        availableToBorrow: formatUnits(total, 18),
        assetBreakdown,
        // For comparison with backend value
        backend_maxAvailableToBorrowUSD: formatUnits(BigInt(loans.maxAvailableToBorrowUSD || "0"), 18),
      });
    }

    return total;
  }, [loans, collateralInfo]);

  const hasPreviewBorrowPower = useMemo(() => {
    try {
      return BigInt(maxAvailableToBorrowForPreviewWei || 0n) > 0n;
    } catch {
      return false;
    }
  }, [maxAvailableToBorrowForPreviewWei]);

  const maxAmount = useMemo(() => {
    return computeMaxTransferable(
      maxAvailableToBorrowForPreviewWei.toString(),
      false,
      voucherBalance,
      usdstBalance,
      safeParseUnits(BORROW_FEE).toString(),
      setFeeError
    );
  }, [voucherBalance, usdstBalance, maxAvailableToBorrowForPreviewWei]);

  // Calculate risk level for borrow form
  useEffect(() => {
    try {
      const existingBorrowedBigInt = BigInt(loanForPreview?.totalAmountOwed || 0);
      const newBorrowAmountBigInt = safeParseUnits(borrowAmount || "0", 18);
      const totalBorrowedBigInt = existingBorrowedBigInt + newBorrowAmountBigInt;
      const collateralValueBigInt = BigInt(loanForPreview?.totalCollateralValueUSD || 0);

      if (collateralValueBigInt === 0n) {
        setRiskLevel(0);
        return;
      }

      const risk = Number((totalBorrowedBigInt * 10000n) / collateralValueBigInt) / 100;
      setRiskLevel(Math.min(risk, 100));
    } catch {
      setRiskLevel(0);
    }
  }, [borrowAmount, loanForPreview?.totalCollateralValueUSD, loanForPreview?.totalAmountOwed]);

  // Consolidated polling handler
  const handlePollingUpdate = (amount: string) => {
    if (amount && parseFloat(amount) > 0) {
      startPolling?.();
    } else {
      stopPolling?.();
    }
  };

  // Calculate required collateral to achieve target health factor
  const calculateRequiredCollateral = useMemo(() => {
    if (!loans || !borrowAmount || borrowAmountWei <= 0n) return [];
    
    const targetHFScaled = BigInt(Math.round(targetHealthFactor * 1e18));
    const currentDebtUSD = BigInt(loans.totalAmountOwed || "0"); // USD 1e18
    const newDebtUSD = currentDebtUSD + borrowAmountWei; // USD 1e18
    
    // Calculate required collateral value: debt * targetHF
    const requiredCollateralValueUSD = (newDebtUSD * targetHFScaled) / (10n ** 18n);
    const currentCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0"); // USD 1e18 (threshold-adjusted)
    const shortfallUSD = requiredCollateralValueUSD > currentCollateralValueUSD 
      ? requiredCollateralValueUSD - currentCollateralValueUSD 
      : 0n;
    
    if (shortfallUSD <= 0n) return []; // No collateral needed
    
    // Calculate how much of each asset is needed
    const required: Array<{ asset: CollateralData; amount: string }> = [];
    
    if (collateralInfo && Array.isArray(collateralInfo)) {
      let remainingShortfall = shortfallUSD;
      
      for (const asset of collateralInfo) {
        if (remainingShortfall <= 0n) break;
        
        try {
          const userBalanceWei = BigInt(asset.userBalance || "0");
          const collateralizedWei = BigInt(asset.collateralizedAmount || "0");
          const undepositedWei = userBalanceWei > collateralizedWei ? userBalanceWei - collateralizedWei : 0n;
          
          if (undepositedWei > 0n) {
            const assetPrice = BigInt(asset.assetPrice || "0"); // USD 1e18
            const liqThreshold = BigInt(asset.liquidationThreshold || "0"); // bps
            const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
            
            if (liqThreshold > 0n && assetPrice > 0n) {
              // Calculate collateral value this asset can provide (with threshold)
              const maxValueUSD = (undepositedWei * assetPrice) / tokenDecimals;
              const maxValueWithThreshold = (maxValueUSD * liqThreshold) / 10000n;
              
              if (maxValueWithThreshold > 0n) {
                const neededValue = remainingShortfall > maxValueWithThreshold ? maxValueWithThreshold : remainingShortfall;
                // Convert back to token amount: (neededValue * decimals * 10000) / (price * threshold)
                const neededWei = (neededValue * tokenDecimals * 10000n) / (assetPrice * liqThreshold);
                const depositWei = neededWei > undepositedWei ? undepositedWei : neededWei;
                
                if (depositWei > 0n) {
                  required.push({
                    asset,
                    amount: formatUnits(depositWei, asset.customDecimals ?? 18),
                  });
                  remainingShortfall -= (depositWei * assetPrice * liqThreshold) / (tokenDecimals * 10000n);
                }
              }
            }
          }
        } catch {
          continue;
        }
      }
    }
    
    return required;
  }, [loans, borrowAmount, borrowAmountWei, targetHealthFactor, collateralInfo]);

  const handleBorrow = async () => {
    if (!borrowAmount || borrowAmountWei <= 0n) return;
    
    // Build required collateral array from selected deposits
    const required: Array<{ asset: CollateralData; amount: string }> = [];
    if (calculateRequiredCollateral.length > 0) {
      for (const item of calculateRequiredCollateral) {
        const selectedAmount = selectedCollateralDeposits[item.asset.address];
        if (selectedAmount && parseFloat(selectedAmount) > 0) {
          required.push({
            asset: item.asset,
            amount: selectedAmount,
          });
        }
      }
    }
    
    const maxWei = BigInt(loans?.maxAvailableToBorrowUSD || 0);
    const wei = safeParseUnits(borrowAmount || "0", 18);

    // If at or within 1 wei of the max available, route via parent as 'ALL' to use on-chain borrowMax and parent UX
    if (maxWei > 0n && (wei >= maxWei || (maxWei > 0n && wei >= (maxWei - 1n)))) {
      const ok = await onBorrow('ALL', required.length > 0 ? required : undefined);
      if (ok !== false) {
        setBorrowAmount("");
        setBorrowAmountError("");
        setFeeError("");
        setSelectedCollateralDeposits({});
        handlePollingUpdate("");
      }
      return;
    }

    const ok = await onBorrow(borrowAmount, required.length > 0 ? required : undefined);
    if (ok !== false) {
      setBorrowAmount("");
      setBorrowAmountError("");
      setFeeError("");
      setSelectedCollateralDeposits({});
      handlePollingUpdate("");
    }
  };

  useEffect(() => {
    // Health Impact should be:
    // - "before": current on-chain position (no planned deposit, no new borrow)
    // - "after": position after planned deposit + entered borrow amount
    if (!loans || !loanForPreview) return;

    const borrowAmountWei = safeParseUnits(borrowAmount || "0", 18);

    // Before: exclude planned deposit by using the real loan snapshot.
    const before = calculateBorrowHealthImpact(0n, loans);
    // After: include planned deposit by using preview loan + entered borrow.
    // loanForPreview already includes selectedCollateralDeposits
    const after = calculateBorrowHealthImpact(borrowAmountWei, loanForPreview);

    setHealthImpact({
      ...after,
      currentHealthFactor: before.currentHealthFactor,
      newHealthFactor: after.newHealthFactor,
      healthImpact: after.newHealthFactor - before.currentHealthFactor,
    });
  }, [borrowAmount, loans, loanForPreview]);

  // Track previous borrow amount to detect when it changes
  const prevBorrowAmountRef = useRef<string>("");
  
  useEffect(() => {
    // When borrow amount changes (entered or modified), set slider to minimum achievable
    // This ensures user starts at the HF they can achieve without additional collateral
    if (borrowAmount && borrowAmountWei > 0n && borrowAmount !== prevBorrowAmountRef.current) {
      setTargetHealthFactor(hfSliderMin);
      prevBorrowAmountRef.current = borrowAmount;
      return;
    }
    
    // When borrow amount is cleared, reset to max (but don't exceed slider max)
    // Don't update if we're already at a valid value to prevent flip-flopping
    if (!borrowAmount || borrowAmountWei <= 0n) {
      if (targetHealthFactor > hfSliderMax) {
        setTargetHealthFactor(hfSliderMax);
      }
      // Only reset prevBorrowAmountRef if it was set (to avoid unnecessary updates)
      if (prevBorrowAmountRef.current !== "") {
        prevBorrowAmountRef.current = "";
      }
      return;
    }
    
    // Otherwise, clamp if out of bounds (user manually adjusted slider)
    // Only clamp if actually out of bounds to prevent unnecessary updates
    const currentTarget = targetHealthFactor;
    if (currentTarget > hfSliderMax) {
      setTargetHealthFactor(hfSliderMax);
    } else if (currentTarget < hfSliderMin) {
      setTargetHealthFactor(hfSliderMin);
    }
  }, [borrowAmount, borrowAmountWei, hfSliderMin, hfSliderMax]);

  // Health factor slider just sets the target - doesn't auto-calculate borrow amount
  const handleHealthFactorSliderChange = (values: number[]) => {
    const targetHf = values?.[0];
    if (!isFinite(targetHf)) return;
    
    // Prevent dragging below achievable minimum, but allow slider to show theoretical minimum
    // Clamp the actual target to achievable range
    const clampedTarget = Math.min(hfSliderMax, Math.max(hfSliderMin, targetHf));
    setTargetHealthFactor(clampedTarget);
    
    // If user tried to drag below achievable, reset slider position visually
    if (targetHf < hfSliderMin) {
      // The slider component will handle the visual reset via the value prop
    }
  };
  
  // Auto-populate collateral deposits when target health factor changes
  useEffect(() => {
    if (!borrowAmount || borrowAmountWei <= 0n) {
      // No borrow amount - clear deposits
      setSelectedCollateralDeposits({});
      return;
    }
    
    // If at or near max achievable, use all available collateral
    if (targetHealthFactor >= hfSliderMax * 0.99) {
      if (collateralInfo && Array.isArray(collateralInfo)) {
        const newSelected: Record<string, string> = {};
        for (const asset of collateralInfo) {
          const userBalanceWei = BigInt(asset.userBalance || "0");
          const collateralizedWei = BigInt(asset.collateralizedAmount || "0");
          const undepositedWei = userBalanceWei > collateralizedWei ? userBalanceWei - collateralizedWei : 0n;
          
          if (undepositedWei > 0n) {
            const maxDisplay = formatUnits(undepositedWei, asset.customDecimals ?? 18);
            newSelected[asset.address] = maxDisplay;
          }
        }
        setSelectedCollateralDeposits(newSelected);
      } else {
        setSelectedCollateralDeposits({});
      }
    } else {
      // For achievable targets, use calculateRequiredCollateral
      if (calculateRequiredCollateral.length > 0) {
        const newSelected: Record<string, string> = {};
        for (const item of calculateRequiredCollateral) {
          newSelected[item.asset.address] = item.amount;
        }
        setSelectedCollateralDeposits(newSelected);
      } else {
        // No collateral needed - clear selections
        setSelectedCollateralDeposits({});
      }
    }
  }, [targetHealthFactor, borrowAmount, borrowAmountWei, hfSliderMax, calculateRequiredCollateral, collateralInfo]);

  const interestRateDisplay = (() => {
    type LoanWithInterestRate = NewLoanData & { interestRate?: unknown };
    const raw = (loans as LoanWithInterestRate | null)?.interestRate; // bps
    const num = Number(raw);
    if (!isFinite(num)) return "-";
    return `${(num / 100).toFixed(2)}%`;
  })();

  // Calculate if borrow amount exceeds available borrowing power and suggest collateral options
  const needsMoreCollateral = useMemo(() => {
    if (borrowAmountWei <= 0n) return false;
    return borrowAmountWei > maxAvailableToBorrowForPreviewWei;
  }, [borrowAmountWei, maxAvailableToBorrowForPreviewWei]);

  const collateralShortfallUSD = useMemo(() => {
    if (!needsMoreCollateral) return 0n;
    return borrowAmountWei - maxAvailableToBorrowForPreviewWei;
  }, [needsMoreCollateral, borrowAmountWei, maxAvailableToBorrowForPreviewWei]);

  // Calculate suggested collateral deposits to cover the shortfall
  const suggestedCollateralDeposits = useMemo(() => {
    if (!needsMoreCollateral || !collateralInfo || collateralInfo.length === 0) return [];
    
    const suggestions: Array<{ asset: CollateralData; amountWei: bigint; amountDisplay: string; borrowPowerUSD: bigint }> = [];
    
    for (const asset of collateralInfo) {
      try {
        const userBalanceWei = BigInt(asset.userBalance || "0");
        const collateralizedWei = BigInt(asset.collateralizedAmount || "0");
        const undepositedWei = userBalanceWei > collateralizedWei ? userBalanceWei - collateralizedWei : 0n;
        
        if (undepositedWei > 0n) {
          const assetPrice = BigInt(asset.assetPrice || "0"); // USD 1e18
          const ltvBP = BigInt(asset.ltv || "0"); // bps
          const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
          
          if (ltvBP > 0n && assetPrice > 0n) {
            // Calculate how much of this asset would be needed to cover the shortfall
            // shortfallUSD = (amountWei * price * ltv) / (decimals * 10000)
            // amountWei = (shortfallUSD * decimals * 10000) / (price * ltv)
            const neededWei = (collateralShortfallUSD * tokenDecimals * 10000n) / (assetPrice * ltvBP);
            const depositWei = neededWei > undepositedWei ? undepositedWei : neededWei;
            
            if (depositWei > 0n) {
              const borrowPowerUSD = (depositWei * assetPrice * ltvBP) / (tokenDecimals * 10000n);
              suggestions.push({
                asset,
                amountWei: depositWei,
                amountDisplay: formatUnits(depositWei, asset.customDecimals ?? 18),
                borrowPowerUSD,
              });
            }
          }
        }
      } catch {
        // Skip this asset if calculation fails
        continue;
      }
    }
    
    // Sort by borrow power (descending) to show best options first
    return suggestions.sort((a, b) => {
      if (a.borrowPowerUSD > b.borrowPowerUSD) return -1;
      if (a.borrowPowerUSD < b.borrowPowerUSD) return 1;
      return 0;
    });
  }, [needsMoreCollateral, collateralInfo, collateralShortfallUSD]);

  return (
    <div className="space-y-4 pt-4">
      {/* Borrow USDST */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
        <div className="font-medium">Borrow USDST</div>

        {/* Loan Details */}
        <div className="space-y-3">
          <div className="flex justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm text-muted-foreground cursor-help">Available to borrow</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Maximum you could borrow if you deposited all available collateral from your wallet</p>
              </TooltipContent>
            </Tooltip>
            <span className="font-medium">
              {hasPreviewBorrowPower ? <FormattedUSDAmount weiAmount={maxAvailableToBorrowForPreviewWei} /> : '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Interest Rate</span>
            <span className="font-medium">
              {interestRateDisplay}
            </span>
          </div>
        </div>

        {/* Borrow Amount Input */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Borrow Amount (USDST)</label>
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>Min: 0.01 USDST</span>
            <div>
              <button
                type="button"
                onClick={() => {
                  try {
                    setBorrowAmount(formatUnits(BigInt(maxAmount)));
                    setBorrowAmountError("");
                  } catch {}
                }}
                disabled={!hasPreviewBorrowPower}
                className="px-2 py-1 mr-1 bg-muted hover:bg-muted/80 rounded-full text-muted-foreground hover:text-foreground text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-muted"
                title={!hasPreviewBorrowPower ? "No amount available to borrow" : "Set to safe maximum available amount"}
              >
                Max :
              </button>
              <span>{hasPreviewBorrowPower ? formatWeiAmount(maxAvailableToBorrowForPreviewWei.toString(), 18) : '-'} USDST</span>
            </div>
          </div>
          <div className="relative">
            <Input
              placeholder="0.00"
              className={`pr-16 ${(() => { try { return safeParseUnits(borrowAmount || "0", 18) > BigInt(maxAmount || "0"); } catch { return false; } })() ? 'text-red-600' : ''}`}
              value={addCommasToInput(borrowAmount)}
              onChange={(e)=>{
                const value = e.target.value;
                handleAmountInputChange(value, setBorrowAmount, setBorrowAmountError, maxAmount);
              }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">USDST</span>
          </div>
          {borrowAmountError && (
            <p className="text-red-600 text-sm">{borrowAmountError}</p>
          )}
          <CompactRewardsDisplay
            userRewards={userRewards}
            activityName="Lending Pool Borrow"
            inputAmount={borrowAmount}
            actionLabel="Borrow"
          />
        </div>
      </div>

      {/* Health Factor */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Health Factor</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{targetHealthFactor.toFixed(2)}</span>
              <span
                className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  riskLevel < 30
                    ? "bg-green-50 text-green-700"
                    : riskLevel < 70
                      ? "bg-yellow-50 text-yellow-700"
                      : "bg-red-50 text-red-700"
                }`}
              >
                {riskLevel < 30 ? "Low Risk" : riskLevel < 70 ? "Moderate Risk" : "High Risk"}
              </span>
            </div>
          </div>
          <Slider
            value={[targetHealthFactor]}
            min={HF_MIN}
            max={hfSliderMax}
            step={0.05}
            onValueChange={handleHealthFactorSliderChange}
            disabled={!loanForPreview || !hasPreviewBorrowPower || !borrowAmount || borrowAmountWei <= 0n}
            trackClassName="h-3"
            thumbClassName="h-6 w-6"
            className="py-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Riskier</span>
            <span>Safer</span>
          </div>
        </div>

        <div className="px-4 py-3 bg-muted/50 rounded-md">
          <HealthImpactDisplay healthImpact={healthImpact} showWarning={false} className="mb-4" />
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Transaction Fee</span>
            <span className="font-medium">{BORROW_FEE} USDST ({parseFloat(BORROW_FEE) * 100} voucher)</span>
          </div>
          {feeError && (
            <p className="text-yellow-600 text-sm mt-1">{feeError}</p>
          )}
        </div>

        {/* Conditional Warning Messages */}
        {(() => {
          const isZeroAvailable = !hasPreviewBorrowPower;
          const eligibleCollateralTokens = collateralInfo || [];

          const borrowInfoMessage = (
            <p className="text-muted-foreground mt-2">
              Borrowing against your assets allows you to access liquidity
              without selling your holdings. Be mindful of the risk level, as
              high borrowing increases liquidation risk during market
              volatility.
            </p>
          );

          if (isZeroAvailable) {
            return (
              <div className="mt-2">
                <p className="text-muted-foreground">
                  You currently have no available borrowing power. Supply collateral to enable borrowing.
                </p>
                {borrowInfoMessage}
              </div>
            );
          }

          if (eligibleCollateralTokens.length === 0) {
            return (
              <div className="mt-2">
                <p className="text-muted-foreground">
                  You have no eligible collateral. Supply assets to enable borrowing.
                </p>
                {borrowInfoMessage}
              </div>
            );
          }

          return null;
        })()}
      </div>

      {/* Additional Collateral Needed Section - Only show when required */}
      {calculateRequiredCollateral.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <div className="font-medium">Additional Collateral Needed</div>
          <p className="text-sm text-muted-foreground">
            To borrow {borrowAmount || "0"} USDST with a health factor of {targetHealthFactor.toFixed(2)}, you need to deposit additional collateral.
          </p>
          
          <div className="space-y-3">
            {calculateRequiredCollateral.map((item) => {
              const asset = item.asset;
              const recommendedAmount = item.amount;
              const selectedAmount = selectedCollateralDeposits[asset.address] || "";
              const userBalanceWei = BigInt(asset.userBalance || "0");
              const userBalanceDisplay = formatWeiAmount(userBalanceWei.toString(), asset.customDecimals ?? 18);
              const maxWei = userBalanceWei;
              
              return (
                <div key={asset.address} className="p-3 border rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {asset?.images?.[0]?.value ? (
                        <img
                          src={asset.images[0].value}
                          alt={asset._name}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted-foreground" />
                      )}
                      <div>
                        <div className="font-medium">{asset._symbol}</div>
                        <div className="text-sm text-muted-foreground">
                          Available: {userBalanceDisplay} {asset._symbol}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Recommended: {recommendedAmount} {asset._symbol}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Deposit Amount</label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="0.00"
                        value={addCommasToInput(selectedAmount)}
                        onChange={(e) => {
                          const value = e.target.value;
                          handleAmountInputChange(
                            value,
                            (val: string) => {
                              setSelectedCollateralDeposits(prev => {
                                const updated = { ...prev };
                                updated[asset.address] = val;
                                return updated;
                              });
                            },
                            () => {}, // No error handling for now
                            maxWei.toString(),
                            asset.customDecimals ?? 18
                          );
                        }}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const maxDisplay = formatUnits(maxWei, asset.customDecimals ?? 18);
                          setSelectedCollateralDeposits(prev => ({ ...prev, [asset.address]: maxDisplay }));
                        }}
                        disabled={maxWei <= 0n}
                      >
                        Max
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedCollateralDeposits(prev => ({ ...prev, [asset.address]: recommendedAmount }));
                        }}
                      >
                        Use Recommended
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Borrow Button - Outside Health Factor box, below Additional Collateral if present */}
      <Button
        onClick={handleBorrow}
        disabled={
          !borrowAmount ||
          !!borrowAmountError ||
          !!feeError ||
          safeParseUnits(borrowAmount || "0") <= 0n ||
          borrowLoading ||
          safeParseUnits(borrowAmount || "0") > BigInt(maxAmount)
        }
        className="w-full"
      >
        {borrowLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : null}
        Borrow
      </Button>
    </div>
  );
};

export default BorrowForm;