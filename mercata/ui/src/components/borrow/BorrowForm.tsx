import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BORROW_FEE } from "@/lib/constants";
import { safeParseUnits, addCommasToInput, formatWeiAmount, safeParseFloat, formatUnits } from "@/utils/numberUtils";
import { NewLoanData, CollateralData, HealthImpactData } from "@/interface";
import { calculateBorrowHealthImpact, getHealthFactorColor } from "@/utils/lendingUtils";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";
import { useLendingContext } from "@/context/LendingContext";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";
import { UserRewardsData } from "@/services/rewardsService";
import { CompactRewardsDisplay } from "../rewards/CompactRewardsDisplay";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import PercentageButtons from "@/components/ui/PercentageButtons";

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
  const [collateralDepositErrors, setCollateralDepositErrors] = useState<Record<string, string>>({});
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);

  // Calculate borrow amount in wei - needs to be defined early since it's used in other useMemos
  const borrowAmountWei = useMemo(() => {
    try {
      return safeParseUnits(borrowAmount || "0", 18);
    } catch {
      return 0n;
    }
  }, [borrowAmount]);

  // Helper: Calculate collateral value from selected deposits
  const calculateSelectedCollateralValue = useMemo(() => {
    if (!collateralInfo || Object.keys(selectedCollateralDeposits).length === 0) return 0n;
    let total = 0n;
    for (const asset of collateralInfo) {
      const selectedAmount = selectedCollateralDeposits[asset.address];
      if (selectedAmount && parseFloat(selectedAmount) > 0) {
        try {
          const depositWei = safeParseUnits(selectedAmount, asset.customDecimals ?? 18);
          const assetPrice = BigInt(asset.assetPrice || "0");
          const liqThreshold = BigInt(asset.liquidationThreshold || "0");
          const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
          
          if (depositWei > 0n && liqThreshold > 0n && assetPrice > 0n) {
            const depositValueUSD = (depositWei * assetPrice) / tokenDecimals;
            const depositValueWithThreshold = (depositValueUSD * liqThreshold) / 10000n;
            total += depositValueWithThreshold;
          }
        } catch {
          continue;
        }
      }
    }
    return total;
  }, [collateralInfo, selectedCollateralDeposits]);

  // Create preview loan that includes selected collateral deposits
  const loanForPreview = useMemo<NewLoanData | null>(() => {
    if (!loans) return null;
    
    const currentCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0");
    const totalCollateralValueUSD = currentCollateralValueUSD + calculateSelectedCollateralValue;
    const currentDebtUSD = BigInt(loans.totalAmountOwed || "0");
    
    return {
      ...loans,
      totalCollateralValueUSD: totalCollateralValueUSD.toString(),
      healthFactorRaw: currentDebtUSD === 0n 
        ? "0" 
        : ((totalCollateralValueUSD * (10n ** 18n)) / currentDebtUSD).toString(),
      healthFactor: currentDebtUSD === 0n 
        ? Infinity 
        : Number(totalCollateralValueUSD) / Number(currentDebtUSD),
    };
  }, [loans, calculateSelectedCollateralValue]);

  // Calculate maximum achievable HF with current borrow amount + all available collateral
  const maxAchievableHF = useMemo(() => {
    if (!loans) return HF_MAX;
    
    if (!borrowAmount || borrowAmountWei <= 0n) {
      try {
        const currentCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0");
        const currentDebtUSD = BigInt(loans.totalAmountOwed || "0");
        if (currentDebtUSD === 0n) return HF_MAX;
        const hf0 = Number(currentCollateralValueUSD) / Number(currentDebtUSD);
        if (!isFinite(hf0) || hf0 <= 0) return HF_MAX;
        return hf0;
      } catch {
        return HF_MAX;
      }
    }
    
    let maxCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0");
    
    if (collateralInfo && Array.isArray(collateralInfo)) {
      for (const asset of collateralInfo) {
        try {
          const userBalanceWei = BigInt(asset.userBalance || "0");
          if (userBalanceWei > 0n) {
            const assetPrice = BigInt(asset.assetPrice || "0");
            const liqThreshold = BigInt(asset.liquidationThreshold || "0");
            const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
            
            if (liqThreshold > 0n && assetPrice > 0n) {
              const depositValueUSD = (userBalanceWei * assetPrice) / tokenDecimals;
              const depositValueWithThreshold = (depositValueUSD * liqThreshold) / 10000n;
              maxCollateralValueUSD += depositValueWithThreshold;
            }
          }
        } catch {
          continue;
        }
      }
    }
    
    const currentDebtUSD = BigInt(loans.totalAmountOwed || "0");
    const newDebtUSD = currentDebtUSD + borrowAmountWei;
    
    if (newDebtUSD === 0n) return HF_MAX;
    const maxHF = Number(maxCollateralValueUSD) / Number(newDebtUSD);
    
    return isFinite(maxHF) && maxHF > 0 ? maxHF : HF_MAX;
  }, [loans, borrowAmount, borrowAmountWei, collateralInfo]);

  // Calculate minimum achievable HF for current borrow amount (with current collateral only)
  const minAchievableHF = useMemo(() => {
    if (!loans || !borrowAmount || borrowAmountWei <= 0n) return HF_MIN;
    
    const currentCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0");
    const currentDebtUSD = BigInt(loans.totalAmountOwed || "0");
    const newDebtUSD = currentDebtUSD + borrowAmountWei;
    
    if (newDebtUSD === 0n) return HF_MAX;
    
    const minHF = Number(currentCollateralValueUSD) / Number(newDebtUSD);
    return isFinite(minHF) && minHF > 0 ? minHF : HF_MIN;
  }, [loans, borrowAmount, borrowAmountWei, HF_MIN]);

  const hfSliderMax = useMemo(() => {
    return Math.max(HF_MIN, maxAchievableHF);
  }, [HF_MIN, maxAchievableHF]);

  const hfSliderMin = useMemo(() => {
    return Math.max(HF_MIN, minAchievableHF);
  }, [HF_MIN, minAchievableHF]);
  
  useEffect(() => {
    if (targetHealthFactor > hfSliderMax) {
      setTargetHealthFactor(hfSliderMax);
    }
  }, [hfSliderMax, targetHealthFactor]);

  const maxAvailableToBorrowForPreviewWei = useMemo(() => {
    if (!loans) return 0n;
    
    let totalWalletBorrowingPower = 0n;
    
    if (collateralInfo && Array.isArray(collateralInfo)) {
      for (const asset of collateralInfo) {
        try {
          const userBalanceWei = BigInt(asset.userBalance || "0");
          const collateralizedWei = BigInt(asset.collateralizedAmount || "0");
          const totalAmountWei = userBalanceWei + collateralizedWei;
          
          if (totalAmountWei > 0n) {
            const assetPrice = BigInt(asset.assetPrice || "0");
            const ltvBP = BigInt(asset.ltv || "0");
            const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
            
            if (ltvBP > 0n && assetPrice > 0n) {
              const totalValueUSD = (totalAmountWei * assetPrice) / tokenDecimals;
              const borrowPowerUSD = (totalValueUSD * ltvBP) / 10000n;
              totalWalletBorrowingPower += borrowPowerUSD;
            }
          }
        } catch {
          continue;
        }
      }
    }
    
    const currentDebt = BigInt(loans.totalAmountOwed || "0");
    return totalWalletBorrowingPower > currentDebt ? totalWalletBorrowingPower - currentDebt : 0n;
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
  // Uses greedy algorithm: prioritize assets by total borrowing power (LTV * amount)
  const calculateRequiredCollateral = useMemo(() => {
    if (!loans || !borrowAmount || borrowAmountWei <= 0n) return [];
    
    const targetHFScaled = BigInt(Math.round(targetHealthFactor * 1e18));
    const currentDebtUSD = BigInt(loans.totalAmountOwed || "0");
    const newDebtUSD = currentDebtUSD + borrowAmountWei;
    
    const requiredCollateralValueUSD = (newDebtUSD * targetHFScaled) / (10n ** 18n);
    const currentCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0");
    const shortfallUSD = requiredCollateralValueUSD > currentCollateralValueUSD 
      ? requiredCollateralValueUSD - currentCollateralValueUSD 
      : 0n;
    
    // Use a small tolerance to account for rounding errors
    // However, if targetHealthFactor is at or very close to max achievable, we should still recommend collateral
    // even if shortfall is tiny (due to rounding differences between maxAchievableHF and this calculation)
    const MIN_SHORTFALL_USD = BigInt("1000000000000000"); // 0.001 USD in 1e18 format
    const isNearMaxHF = targetHealthFactor >= hfSliderMax * 0.99;
    
    // Only filter out tiny shortfalls if we're not near the max HF
    // When near max, we want to recommend all available collateral even if rounding makes shortfall tiny
    if (shortfallUSD < MIN_SHORTFALL_USD && !isNearMaxHF) return [];
    
    const availableAssets: Array<{
      asset: CollateralData;
      undepositedWei: bigint;
      maxCollateralValueUSD: bigint;
      totalBorrowingPower: bigint;
    }> = [];
    
    if (collateralInfo && Array.isArray(collateralInfo)) {
      for (const asset of collateralInfo) {
        try {
          // userBalance represents the wallet balance (undeposited amount)
          const userBalanceWei = BigInt(asset.userBalance || "0");
          
          if (userBalanceWei > 0n) {
            const assetPrice = BigInt(asset.assetPrice || "0");
            const liqThreshold = BigInt(asset.liquidationThreshold || "0");
            const ltvBP = BigInt(asset.ltv || "0");
            const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
            
            if (liqThreshold > 0n && assetPrice > 0n && ltvBP > 0n) {
              const maxValueUSD = (userBalanceWei * assetPrice) / tokenDecimals;
              const maxValueWithThreshold = (maxValueUSD * liqThreshold) / 10000n;
              const totalBorrowingPower = (userBalanceWei * assetPrice * ltvBP) / (tokenDecimals * 10000n);
              
              if (maxValueWithThreshold > 0n) {
                availableAssets.push({
                  asset,
                  undepositedWei: userBalanceWei,
                  maxCollateralValueUSD: maxValueWithThreshold,
                  totalBorrowingPower,
                });
              }
            }
          }
        } catch {
          continue;
        }
      }
    }
    
    availableAssets.sort((a, b) => {
      if (a.totalBorrowingPower > b.totalBorrowingPower) return -1;
      if (a.totalBorrowingPower < b.totalBorrowingPower) return 1;
      return 0;
    });
    
    const DUST_THRESHOLD_USD = BigInt("1000000000000000");
    const required: Array<{ asset: CollateralData; amount: string; collateralValueUSD: bigint }> = [];
    let remainingShortfall = shortfallUSD;
    
    for (const item of availableAssets) {
      if (remainingShortfall <= 0n) break;
      
      const { asset, undepositedWei, maxCollateralValueUSD } = item;
      const assetPrice = BigInt(asset.assetPrice || "0");
      const liqThreshold = BigInt(asset.liquidationThreshold || "0");
      const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
      
      // Skip assets that can't meaningfully contribute, unless they're needed to fill remaining shortfall
      if (maxCollateralValueUSD < DUST_THRESHOLD_USD && remainingShortfall > DUST_THRESHOLD_USD) continue;
      
      // Greedy fill: use all available of this asset if needed, ensuring we exhaust it before moving to next
      // Calculate how much collateral value we need from this asset
      const neededValue = remainingShortfall > maxCollateralValueUSD ? maxCollateralValueUSD : remainingShortfall;
      const neededWei = (neededValue * tokenDecimals * 10000n) / (assetPrice * liqThreshold);
      
      // Use all available of this asset (up to what's needed)
      const depositWei = neededWei > undepositedWei ? undepositedWei : neededWei;
      
      if (depositWei > 0n) {
        const actualCollateralValue = (depositWei * assetPrice * liqThreshold) / (tokenDecimals * 10000n);
        const isUsingAllAvailable = depositWei === undepositedWei;
        
        // Only add this asset if it contributes meaningfully OR we're exhausting it
        if (actualCollateralValue >= DUST_THRESHOLD_USD || isUsingAllAvailable) {
          required.push({
            asset,
            amount: formatUnits(depositWei, asset.customDecimals ?? 18),
            collateralValueUSD: actualCollateralValue,
          });
          remainingShortfall -= actualCollateralValue;
          
          // Only break if shortfall is filled (with small tolerance for rounding)
          // If we've exhausted this asset and still have shortfall, continue to next asset
          const MIN_SHORTFALL_TOLERANCE = BigInt("1000000000000000"); // 0.001 USD
          if (remainingShortfall <= MIN_SHORTFALL_TOLERANCE) {
            break;
          }
        }
      }
    }
    
    return required;
  }, [loans, borrowAmount, borrowAmountWei, targetHealthFactor, collateralInfo, hfSliderMax]);

  // Calculate projected health factor after borrow with selected collateral
  const projectedHF = useMemo(() => {
    if (!loans || !borrowAmount || borrowAmountWei <= 0n) return null;
    
    const currentCollateralValueUSD = BigInt(loans.totalCollateralValueUSD || "0");
    const totalCollateralValueUSD = currentCollateralValueUSD + calculateSelectedCollateralValue;
    const currentDebtUSD = BigInt(loans.totalAmountOwed || "0");
    const newDebtUSD = currentDebtUSD + borrowAmountWei;
    
    if (newDebtUSD === 0n) return Infinity;
    
    return Number(totalCollateralValueUSD) / Number(newDebtUSD);
  }, [loans, borrowAmount, borrowAmountWei, calculateSelectedCollateralValue]);

  const handleBorrow = async () => {
    if (!borrowAmount || borrowAmountWei <= 0n) return;
    
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
    const isMaxBorrow = maxWei > 0n && (wei >= maxWei || (maxWei > 0n && wei >= (maxWei - 1n)));
    const amount = isMaxBorrow ? 'ALL' : borrowAmount;
    
    const ok = await onBorrow(amount, required.length > 0 ? required : undefined);
    if (ok !== false) {
      setBorrowAmount("");
      setBorrowAmountError("");
      setFeeError("");
      setSelectedCollateralDeposits({});
      handlePollingUpdate("");
    }
  };

  useEffect(() => {
    if (!loans || !loanForPreview) return;

    const borrowAmountWei = safeParseUnits(borrowAmount || "0", 18);
    const before = calculateBorrowHealthImpact(0n, loans);
    
    let afterHF: number;
    if (borrowAmountWei === 0n || !borrowAmount || parseFloat(borrowAmount) === 0) {
      afterHF = before.currentHealthFactor;
    } else if (calculateRequiredCollateral.length > 0) {
      // Use projectedHF instead of targetHealthFactor to reflect actual selected collateral
      afterHF = projectedHF !== null ? projectedHF : targetHealthFactor;
    } else {
      const after = calculateBorrowHealthImpact(borrowAmountWei, loanForPreview);
      afterHF = after.newHealthFactor;
    }

    setHealthImpact({
      currentHealthFactor: before.currentHealthFactor,
      newHealthFactor: afterHF,
      healthImpact: afterHF - before.currentHealthFactor,
      isHealthy: afterHF >= 1.0,
    });
  }, [borrowAmount, loans, loanForPreview, calculateRequiredCollateral.length, targetHealthFactor, projectedHF]);

  const prevBorrowAmountRef = useRef<string>("");
  
  useEffect(() => {
    if (borrowAmount && borrowAmountWei > 0n && borrowAmount !== prevBorrowAmountRef.current) {
      setTargetHealthFactor(hfSliderMin);
      prevBorrowAmountRef.current = borrowAmount;
      return;
    }
    
    // When borrow amount is cleared, reset to max (but don't exceed slider max)
    if (!borrowAmount || borrowAmountWei <= 0n) {
      // Use functional update to avoid stale closure
      setTargetHealthFactor(prev => prev > hfSliderMax ? hfSliderMax : prev);
      // Only reset prevBorrowAmountRef if it was set (to avoid unnecessary updates)
      if (prevBorrowAmountRef.current !== "") {
        prevBorrowAmountRef.current = "";
      }
      return;
    }
    
    // Don't clamp here - let handleHealthFactorSliderChange handle clamping during user interaction
    // This prevents interference with slider dragging. The other useEffect handles clamping when hfSliderMax changes.
  }, [borrowAmount, borrowAmountWei, hfSliderMin, hfSliderMax]);

  // Health factor slider just sets the target - doesn't auto-calculate borrow amount
  // Slider is inverted: left = safer (higher HF), right = riskier (lower HF)
  const handleHealthFactorSliderChange = (values: number[]) => {
    const invertedSliderValue = values?.[0];
    if (!isFinite(invertedSliderValue)) return;
    
    // Convert inverted slider value back to actual health factor
    // Slider shows: left = max HF (safer), right = min HF (riskier)
    // So: actualHF = max + min - sliderValue
    const actualHF = hfSliderMax + HF_MIN - invertedSliderValue;
    
    // Clamp to achievable range
    const clampedTarget = Math.min(hfSliderMax, Math.max(hfSliderMin, actualHF));
    setTargetHealthFactor(clampedTarget);
  };
  
  // Auto-populate collateral deposits when target health factor changes (only in recommended mode)
  useEffect(() => {
    if (!borrowAmount || borrowAmountWei <= 0n) {
      // No borrow amount - clear deposits and reset custom mode
      setSelectedCollateralDeposits({});
      setIsCustomMode(false);
      return;
    }
    
    // If no collateral needed, reset custom mode
    if (calculateRequiredCollateral.length === 0) {
      setIsCustomMode(false);
    }
    
    // Don't auto-populate if user is in custom mode
    if (isCustomMode) return;
    
    // If at or near max achievable, use all available collateral
    // Use a more lenient threshold to account for floating point precision
    const isNearMaxHF = Math.abs(targetHealthFactor - hfSliderMax) < 0.01 || targetHealthFactor >= hfSliderMax * 0.99;
    
    if (isNearMaxHF) {
      if (collateralInfo && Array.isArray(collateralInfo)) {
        const newSelected: Record<string, string> = {};
        for (const asset of collateralInfo) {
          // userBalance is already the undeposited (wallet) balance
          const userBalanceWei = BigInt(asset.userBalance || "0");
          
          if (userBalanceWei > 0n) {
            const maxDisplay = formatUnits(userBalanceWei, asset.customDecimals ?? 18);
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
        // No collateral needed - ensure selections are cleared
        // This happens when target <= minimum achievable HF (current collateral is sufficient)
        setSelectedCollateralDeposits({});
      }
    }
  }, [targetHealthFactor, borrowAmount, borrowAmountWei, hfSliderMax, calculateRequiredCollateral, collateralInfo, isCustomMode]);

  const interestRateDisplay = (() => {
    type LoanWithInterestRate = NewLoanData & { interestRate?: unknown };
    const raw = (loans as LoanWithInterestRate | null)?.interestRate; // bps
    const num = Number(raw);
    if (!isFinite(num)) return "-";
    return `${(num / 100).toFixed(2)}%`;
  })();

  // Calculate slider color based on health factor (safer = green on left, riskier = red on right)
  // Match the same color scheme as getHealthFactorColor: >=1.5 green, >=1.2 yellow, >=1.0 orange, <1.0 red
  const sliderColorStyle = useMemo(() => {
    // Use the same thresholds as getHealthFactorColor
    // Tailwind colors: green-600, yellow-600, orange-600, red-600
    // RGB values: green-600: rgb(22, 163, 74), yellow-600: rgb(202, 138, 4), orange-600: rgb(234, 88, 12), red-600: rgb(220, 38, 38)
    
    let r, g, b;
    
    if (targetHealthFactor >= 1.5) {
      // Green
      r = 22;
      g = 163;
      b = 74;
    } else if (targetHealthFactor >= 1.2) {
      // Yellow
      r = 202;
      g = 138;
      b = 4;
    } else if (targetHealthFactor >= 1.0) {
      // Orange
      r = 234;
      g = 88;
      b = 12;
    } else {
      // Red
      r = 220;
      g = 38;
      b = 38;
    }
    
    return { backgroundColor: `rgb(${r}, ${g}, ${b})` };
  }, [targetHealthFactor]);
  
  // Calculate inverted slider value for display (left = safer/higher HF, right = riskier/lower HF)
  const invertedSliderValue = useMemo(() => {
    return hfSliderMax + HF_MIN - targetHealthFactor;
  }, [targetHealthFactor, HF_MIN, hfSliderMax]);

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
          <PercentageButtons
            value={borrowAmount}
            maxValue={hasPreviewBorrowPower ? maxAvailableToBorrowForPreviewWei.toString() : "0"}
            onChange={(value) => {
              setBorrowAmount(value);
              setBorrowAmountError("");
            }}
            decimals={18}
            disabled={borrowLoading || !hasPreviewBorrowPower}
          />
        </div>
      </div>

      {/* Health Factor */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Health Factor</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {(() => {
                  // When borrow amount is zero, show current health factor
                  // Otherwise show projected health factor (or target if no collateral selected)
                  if (!borrowAmount || borrowAmountWei <= 0n) {
                    const currentHF = loans?.healthFactor;
                    if (currentHF === undefined || currentHF === null) return "-";
                    if (!isFinite(currentHF)) return "No Loan";
                    return currentHF.toFixed(2);
                  }
                  // Use projectedHF if available (reflects selected collateral), otherwise fall back to target
                  if (projectedHF !== null) {
                    if (!isFinite(projectedHF)) return "No Loan";
                    return projectedHF.toFixed(2);
                  }
                  return targetHealthFactor.toFixed(2);
                })()}
              </span>
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
            value={[invertedSliderValue]}
            min={HF_MIN}
            max={hfSliderMax}
            step={0.05}
            onValueChange={handleHealthFactorSliderChange}
            disabled={!loanForPreview || !hasPreviewBorrowPower || !borrowAmount || borrowAmountWei <= 0n}
            trackClassName="h-3"
            thumbClassName="h-6 w-6"
            className="py-2"
            rangeStyle={sliderColorStyle}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Safer</span>
            <span>Riskier</span>
          </div>
        </div>

        <div className="px-4 py-2 bg-muted/50 rounded-md">
          <HealthImpactDisplay healthImpact={healthImpact} showWarning={false} />
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
          <div className="flex items-center justify-between">
            <div className="font-medium">Additional Collateral Needed</div>
            <div className="flex items-center gap-3">
              {isCustomMode && projectedHF !== null && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Projected Health Factor: </span>
                  <span className={`font-medium ${getHealthFactorColor(projectedHF)}`}>
                    {projectedHF === Infinity ? "No Loan" : projectedHF.toFixed(2)}
                  </span>
                  {projectedHF !== null && Math.abs(projectedHF - targetHealthFactor) > 0.01 && projectedHF < targetHealthFactor && (
                    <span className="text-xs text-yellow-600 dark:text-yellow-500 ml-2">
                      (Target: {targetHealthFactor.toFixed(2)})
                    </span>
                  )}
                </div>
              )}
              <Button
                type="button"
                variant={isCustomMode ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setIsCustomMode(!isCustomMode);
                  if (!isCustomMode) {
                    // Switching to custom mode - keep current selections
                  } else {
                    // Switching back to recommended mode - reset to recommended amounts
                    const newSelected: Record<string, string> = {};
                    for (const item of calculateRequiredCollateral) {
                      newSelected[item.asset.address] = item.amount;
                    }
                    setSelectedCollateralDeposits(newSelected);
                  }
                }}
              >
                {isCustomMode ? "Use Recommended" : "Customize"}
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            To borrow {borrowAmount ? parseFloat(borrowAmount).toFixed(2) : "0.00"} USDST with a health factor of {targetHealthFactor.toFixed(2)}, you need to deposit additional collateral.
          </p>
          
          {!isCustomMode ? (
            /* Compact Recommended Summary */
            <div className="p-3 border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Recommended Collateral</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {calculateRequiredCollateral.map((item) => {
                  const asset = item.asset;
                  const recommendedAmount = item.amount;
                  const recommendedWei = safeParseUnits(recommendedAmount, asset.customDecimals ?? 18);
                  
                  // Calculate collateral value for recommended amount
                  let recommendedCollateralValue = 0n;
                  try {
                    const assetPrice = BigInt(asset.assetPrice || "0");
                    const liqThresholdBP = BigInt(asset.liquidationThreshold || "0");
                    const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
                    
                    if (recommendedWei > 0n && liqThresholdBP > 0n && assetPrice > 0n) {
                      const depositValueUSD = (recommendedWei * assetPrice) / tokenDecimals;
                      const depositValueWithThreshold = (depositValueUSD * liqThresholdBP) / 10000n;
                      recommendedCollateralValue = depositValueWithThreshold;
                    }
                  } catch {
                    // Ignore errors
                  }
                  
                  return (
                    <div key={asset.address} className="flex items-center gap-2 px-2 py-1 bg-background rounded">
                      {asset?.images?.[0]?.value ? (
                        <img
                          src={asset.images[0].value}
                          alt={asset._name}
                          className="w-5 h-5 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-muted-foreground" />
                      )}
                      <span className="text-sm font-medium">{asset._symbol}</span>
                      <span className="text-xs text-muted-foreground">{recommendedAmount}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Custom Mode - Show All Available Collateral */
            <div className="space-y-3">
              {collateralInfo && Array.isArray(collateralInfo) && collateralInfo
                .filter((asset) => {
                  const userBalanceWei = BigInt(asset.userBalance || "0");
                  return userBalanceWei > 0n;
                })
                .map((asset) => {
                  const selectedAmount = selectedCollateralDeposits[asset.address] || "";
                  const userBalanceWei = BigInt(asset.userBalance || "0");
                  const userBalanceDisplay = formatWeiAmount(userBalanceWei.toString(), asset.customDecimals ?? 18);
                  const maxWei = userBalanceWei;
                  const ltv = asset.ltv ? (Number(asset.ltv) / 100).toFixed(0) : "N/A";
                  const liqThreshold = asset.liquidationThreshold ? (Number(asset.liquidationThreshold) / 100).toFixed(0) : "N/A";
                  
                  // Calculate collateral value for selected amount
                  let selectedCollateralValue = 0n;
                  if (selectedAmount && parseFloat(selectedAmount) > 0) {
                    try {
                      const depositWei = safeParseUnits(selectedAmount, asset.customDecimals ?? 18);
                      const assetPrice = BigInt(asset.assetPrice || "0");
                      const liqThresholdBP = BigInt(asset.liquidationThreshold || "0");
                      const tokenDecimals = 10n ** BigInt(asset.customDecimals ?? 18);
                      
                      if (depositWei > 0n && liqThresholdBP > 0n && assetPrice > 0n) {
                        const depositValueUSD = (depositWei * assetPrice) / tokenDecimals;
                        const depositValueWithThreshold = (depositValueUSD * liqThresholdBP) / 10000n;
                        selectedCollateralValue = depositValueWithThreshold;
                      }
                    } catch {
                      // Ignore errors
                    }
                  }
                  
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
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{asset._symbol}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              LTV: {ltv}% • Liquidation: {liqThreshold}%
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Available: {userBalanceDisplay} {asset._symbol}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Deposit Amount</label>
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                          <Input
                            placeholder="0.00"
                            value={addCommasToInput(selectedAmount)}
                            onChange={(e) => {
                              const value = e.target.value;
                              const input = value.replace(/,/g, "").trim();
                              
                              // Always set the value first so user can see what they typed
                              setSelectedCollateralDeposits(prev => {
                                const updated = { ...prev };
                                updated[asset.address] = input;
                                return updated;
                              });
                              
                              // Allow empty or zero for collateral deposits
                              if (!input || input === "0" || input === "0." || input === "0.0") {
                                setCollateralDepositErrors(prev => {
                                  const updated = { ...prev };
                                  delete updated[asset.address];
                                  return updated;
                                });
                                return;
                              }
                              
                              // Validate format
                              const basicPattern = /^\d*\.?\d*$/;
                              if (!basicPattern.test(input)) {
                                setCollateralDepositErrors(prev => ({
                                  ...prev,
                                  [asset.address]: "Invalid input format"
                                }));
                                return;
                              }
                              
                              // Check decimal places
                              if (input.includes('.')) {
                                const decimalPart = input.split('.')[1];
                                if (decimalPart && decimalPart.length > (asset.customDecimals ?? 18)) {
                                  setCollateralDepositErrors(prev => ({
                                    ...prev,
                                    [asset.address]: `Maximum ${asset.customDecimals ?? 18} decimal places allowed`
                                  }));
                                  return;
                                }
                              }
                              
                              // Check if exceeds max
                              const inputWei = safeParseUnits(input, asset.customDecimals ?? 18);
                              if (inputWei > maxWei) {
                                setCollateralDepositErrors(prev => ({
                                  ...prev,
                                  [asset.address]: "Maximum amount exceeded"
                                }));
                                return;
                              }
                              
                              // Valid input - clear any errors
                              setCollateralDepositErrors(prev => {
                                const updated = { ...prev };
                                delete updated[asset.address];
                                return updated;
                              });
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
                              setCollateralDepositErrors(prev => {
                                const updated = { ...prev };
                                delete updated[asset.address];
                                return updated;
                              });
                            }}
                            disabled={maxWei <= 0n}
                          >
                            Max
                          </Button>
                          </div>
                          {collateralDepositErrors[asset.address] && (
                            <p className="text-red-600 text-xs">{collateralDepositErrors[asset.address]}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
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
          safeParseUnits(borrowAmount || "0") > BigInt(maxAmount) ||
          // Only check projected HF vs target in custom mode (in recommended mode, they should match)
          (isCustomMode && projectedHF !== null && projectedHF < targetHealthFactor - 0.01) ||
          // Disable if there are any collateral deposit errors
          Object.keys(collateralDepositErrors).length > 0
        }
        className="w-full"
      >
        {borrowLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : null}
        Borrow
      </Button>

      {/* Transaction Fee */}
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Transaction Fee</span>
        <span className="font-medium">{BORROW_FEE} USDST ({parseFloat(BORROW_FEE) * 100} voucher)</span>
      </div>
      {feeError && (
        <p className="text-yellow-600 text-sm">{feeError}</p>
      )}

      {/* Rewards Display */}
      <CompactRewardsDisplay
        userRewards={userRewards}
        activityName="Lending Pool Borrow"
        inputAmount={borrowAmount}
        actionLabel="Borrow"
      />
    </div>
  );
};

export default BorrowForm;