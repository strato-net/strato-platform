import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { safeParseUnits, addCommasToInput, formatUnits, formatBalance } from "@/utils/numberUtils";
import { NewLoanData, CollateralData } from "@/interface";
import { 
  calculateAvailableToBorrowUSD, 
  calculateHFSliderExtrema, 
  calculateAfterBorrowHealthFactor,
  recommendCollateralToSupply,
  calculateAdditionalValueNeeded,
  calculateBorrowTxFee,
  determineErrorMessage,
  calculateAdditionalCollateralAmountFromValue,
  sortCollateralAssets,
  calculateMaxCollateralValueUSDCentFloored,
  centCeil
} from "@/utils/lendingUtils";
import { getRiskLabel } from "@/utils/loanUtils";
import { useLendingContext } from "@/context/LendingContext";
import { handleAmountInputChange } from "@/utils/transferValidation";
import { UserRewardsData } from "@/services/rewardsService";
import { CompactRewardsDisplay } from "../rewards/CompactRewardsDisplay";
import BorrowProgressModal, { BorrowStep } from "./BorrowProgressModal";

interface BorrowFormProps {
  loans: NewLoanData | null;
  borrowLoading: boolean;
  onBorrow: (amount: string) => void;
  usdstBalance: string;
  voucherBalance: string;
  collateralInfo: CollateralData[] | null;
  startPolling?: () => void;
  stopPolling?: () => void;
  userRewards?: UserRewardsData | null;
  rewardsLoading?: boolean;
}

const BorrowForm = ({ loans, borrowLoading, onBorrow, usdstBalance, voucherBalance, collateralInfo, startPolling, stopPolling, userRewards, rewardsLoading }: BorrowFormProps) => {
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [borrowAmountError, setBorrowAmountError] = useState<string>("");
  const [customBorrowError, setCustomBorrowError] = useState<string>("");
  const [feeError, setFeeError] = useState<string>("");
  const [targetHealthFactor, setTargetHealthFactor] = useState<number>(2.10);
  const [autoSupplyCollateral, setAutoSupplyCollateral] = useState<boolean>(true);
  const [isCollateralExpanded, setIsCollateralExpanded] = useState<boolean>(false);
  const [customCollateralValues, setCustomCollateralValues] = useState<Map<string, string>>(new Map());
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [borrowSteps, setBorrowSteps] = useState<BorrowStep[]>([]);
  const { borrowMax, supplyCollateral } = useLendingContext();

  // Calculate slider extrema based on collateral configs
  const sliderExtrema = useMemo(() => {
    if (!loans || !collateralInfo || collateralInfo.length === 0) {
      return { min: 1.01, max: 3.00 };
    }
    return calculateHFSliderExtrema(loans, collateralInfo);
  }, [loans, collateralInfo]);

  // Build collateral map from all available user balances (reused for calculations)
  const potentialCollateral = useMemo(() => {
    const map = new Map<CollateralData, bigint>();
    if (collateralInfo) {
      for (const collateral of collateralInfo) {
        const balance = BigInt(collateral.userBalance ?? "0");
        if (balance > 0n) {
          map.set(collateral, balance);
        }
      }
    }
    return map;
  }, [collateralInfo]);

  // Calculate available to borrow based on current health factor setting
  // Includes all available collateral balances (max potential borrowing power)
  const availableToBorrow = useMemo(() => {
    if (!loans) return 0;
    return calculateAvailableToBorrowUSD(loans, targetHealthFactor, potentialCollateral);
  }, [loans, targetHealthFactor, potentialCollateral]);

  // Calculate maximum borrowable at minimum health factor (riskier)
  const maxAtMinHF = useMemo(() => {
    if (!loans) return 0;
    return calculateAvailableToBorrowUSD(loans, sliderExtrema.min, potentialCollateral);
  }, [loans, sliderExtrema.min, potentialCollateral]);

  // Max borrowable amount in wei
  const maxAmount = useMemo(() => {
    return BigInt(Math.round(Number(availableToBorrow) * 1e18)).toString();
  }, [availableToBorrow]);

  // Current health factor display
  const currentHF = useMemo(() => {
    if (!loans) return null;
    const owed = BigInt(loans.totalAmountOwed || 0);
    if (owed <= 1n) return null; // No loan
    return loans.healthFactor;
  }, [loans]);

  // Recommended collateral to supply based on borrow amount and target HF
  const recommendedCollateral = useMemo(() => {
    if (!loans || !collateralInfo || collateralInfo.length === 0 || !borrowAmount || parseFloat(borrowAmount) <= 0) {
      return new Map<CollateralData, bigint>();
    }
    // Make a copy of collateralInfo to avoid mutating original
    const collateralsCopy = [...collateralInfo];
    return recommendCollateralToSupply(loans, targetHealthFactor, parseFloat(borrowAmount), collateralsCopy);
  }, [loans, collateralInfo, borrowAmount, targetHealthFactor]);

  // Build collateral table data
  const collateralTableData = useMemo(() => {
    const data: Array<{ collateral: CollateralData; amount: bigint; valueUSD: number }> = [];
    
    if (autoSupplyCollateral) {
      // In auto mode, only show recommended collateral with amount > 0
      for (const [collateral, amount] of recommendedCollateral.entries()) {
        if (amount <= 0n) continue;
        
        const price = BigInt(collateral.assetPrice ?? "0");
        const decimals = BigInt(10) ** BigInt(collateral.customDecimals ?? 18);
        const valueUSD = Number((amount * price) / decimals) / 1e18;
        data.push({ collateral, amount, valueUSD });
      }
    } else {
      // In custom mode, show ALL collateral assets the user possesses
      // Extract collaterals into array, sort them, then build data array in sorted order
      const collateralsArray = Array.from(potentialCollateral.keys());
      sortCollateralAssets(collateralsArray);

      for (const collateral of collateralsArray) {
        const price = BigInt(collateral.assetPrice ?? "0");
        const decimals = BigInt(10) ** BigInt(collateral.customDecimals ?? 18);
        
        // Use custom value if set, otherwise check if in recommendation
        if (customCollateralValues.has(collateral.address)) {
          const customValue = parseFloat(customCollateralValues.get(collateral.address) || "0");
          const customValueWei = BigInt(Math.round(customValue * 1e18));
          const customAmount = calculateAdditionalCollateralAmountFromValue(customValueWei, price, decimals);
          data.push({ collateral, amount: customAmount, valueUSD: customValue });
        } else {
          // Fallback to recommended amount or 0
          const recommendedAmount = recommendedCollateral.get(collateral) ?? 0n;
          const valueUSD = Number((recommendedAmount * price) / decimals) / 1e18;
          data.push({ collateral, amount: recommendedAmount, valueUSD });
        }
      }
    }
    
    return data;
  }, [recommendedCollateral, autoSupplyCollateral, customCollateralValues, potentialCollateral]);

  // Total value of collateral in table
  const totalCollateralValue = useMemo(() => {
    return collateralTableData.reduce((sum, item) => sum + item.valueUSD, 0);
  }, [collateralTableData]);

  // Map of collateral addresses to whether their value exceeds maximum
  const collateralExceedsMaxMap = useMemo(() => {
    const map = new Map<string, boolean>();
    if (autoSupplyCollateral) return map; // Only check in custom mode
    
    for (const item of collateralTableData) {
      const maxValueUSD = calculateMaxCollateralValueUSDCentFloored(item.collateral);
      
      map.set(item.collateral.address, item.valueUSD > maxValueUSD);
    }
    
    return map;
  }, [autoSupplyCollateral, collateralTableData]);

  // Check if any custom collateral values exceed their maximum
  const hasExceededMaxCollateralValue = useMemo(() => {
    for (const exceedsMax of collateralExceedsMaxMap.values()) {
      if (exceedsMax) return true;
    }
    return false;
  }, [collateralExceedsMaxMap]);

  // Calculate after-borrow health factor (includes new collateral being supplied)
  const afterBorrowHF = useMemo(() => {
    if (!loans || !borrowAmount || parseFloat(borrowAmount) <= 0) {
      return null;
    }
    // Build collateral map from table data (includes auto or custom amounts)
    const newCollateral = new Map<CollateralData, bigint>();
    for (const item of collateralTableData) {
      newCollateral.set(item.collateral, item.amount);
    }
    return calculateAfterBorrowHealthFactor(loans, parseFloat(borrowAmount), newCollateral);
  }, [loans, borrowAmount, collateralTableData]);

  // Additional collateral needed value (for header)
  const additionalCollateralNeededValue = useMemo(() => {
    if (autoSupplyCollateral) {
      return totalCollateralValue;
    }
    // In custom mode, calculate what's needed to achieve target HF using strictest LT
    if (!loans || !collateralInfo || collateralInfo.length === 0) return 0;
    const needed = calculateAdditionalValueNeeded(collateralInfo, parseFloat(borrowAmount || "0"), loans, targetHealthFactor);
    return Number(needed);
  }, [autoSupplyCollateral, totalCollateralValue, loans, collateralInfo, borrowAmount, targetHealthFactor]);

  // Check if sufficient collateral is supplied in custom mode
  const hasInsufficientCollateral = useMemo(() => {
    if (autoSupplyCollateral) return false; // Only check in custom mode
    if (!borrowAmount || parseFloat(borrowAmount) <= 0) return false; // No validation needed if no borrow amount
    return totalCollateralValue < additionalCollateralNeededValue;
  }, [autoSupplyCollateral, totalCollateralValue, additionalCollateralNeededValue, borrowAmount]);

  // Calculate transaction fee based on number of collateral assets being supplied
  const txFee = useMemo(() => {
    const collateralCount = collateralTableData.length;
    return calculateBorrowTxFee(collateralCount);
  }, [collateralTableData]);

  // Check if user can afford the transaction fee (separate from borrow amount)
  const canAffordFee = useMemo(() => {
    const feeWei = safeParseUnits(txFee.fee.toString(), 18);
    const voucherBal = BigInt(voucherBalance || 0);
    const usdstBal = safeParseUnits(usdstBalance || "0", 18);
    
    const canCover = voucherBal >= BigInt(txFee.voucher) || usdstBal >= feeWei;
    if (!canCover) {
      setFeeError("Insufficient balance to cover transaction fee");
    } else {
      setFeeError("");
    }
    return canCover;
  }, [txFee, voucherBalance, usdstBalance]);

  // Update custom error message when borrow amount exceeds maximum at selected health factor
  useEffect(() => {
    if (!borrowAmount || !loans) {
      setCustomBorrowError("");
      return;
    }

    const cleanedInput = borrowAmount.replace(/,/g, "");
    const borrowAmountNum = parseFloat(cleanedInput);
    if (isNaN(borrowAmountNum) || borrowAmountNum <= 0) {
      setCustomBorrowError("");
      return;
    }

    const borrowAmountWei = safeParseUnits(cleanedInput, 18);
    const maxAmountWei = BigInt(maxAmount);
    
    // Only set custom error if amount exceeds maximum
    if (borrowAmountWei > maxAmountWei) {
      const errorMsg = determineErrorMessage(
        borrowAmountNum,
        availableToBorrow,
        maxAtMinHF
      );
      setCustomBorrowError(errorMsg);
    } else {
      setCustomBorrowError("");
    }
  }, [borrowAmount, loans, maxAmount, availableToBorrow, maxAtMinHF]);

  // Handle checkbox change - expand when unchecked
  const handleAutoSupplyChange = (checked: boolean) => {
    setAutoSupplyCollateral(checked);
    if (!checked) {
      setIsCollateralExpanded(true);
      // Initialize custom values from ALL user-possessed collateral assets
      // Assets in recommendation get their recommended value, others get 0
      const initialCustomValues = new Map<string, string>();
      for (const [collateral] of potentialCollateral.entries()) {
        const recommendedAmount = recommendedCollateral.get(collateral);
        if (recommendedAmount && recommendedAmount > 0n) {
          const price = BigInt(collateral.assetPrice ?? "0");
          const decimals = BigInt(10) ** BigInt(collateral.customDecimals ?? 18);
          const valueUSD = Number((recommendedAmount * price) / decimals) / 1e18;
          initialCustomValues.set(collateral.address, valueUSD.toFixed(2));
        } else {
          // Not in recommendation - initialize to zero
          initialCustomValues.set(collateral.address, "0.00");
        }
      }
      setCustomCollateralValues(initialCustomValues);
    }
  };

  // Handle custom value change
  const handleCustomValueChange = (address: string, value: string) => {
    const newValues = new Map(customCollateralValues);
    newValues.set(address, value);
    setCustomCollateralValues(newValues);
  };

  // Handle clicking available value to fill max
  const handleFillAddCollatMaxValue = (collateral: CollateralData) => {
    const maxValueUSD = calculateMaxCollateralValueUSDCentFloored(collateral);
    handleCustomValueChange(collateral.address, maxValueUSD.toFixed(2));
  };

  // Get risk indicator color and label
  const getRiskIndicator = (hf: number): { label: string; color: string } => {
    const label = getRiskLabel(hf);
    if (label === 'Low Risk') return { label, color: 'text-green-500' };
    if (label === 'Moderate Risk') return { label, color: 'text-yellow-500' };
    return { label, color: 'text-red-500' };
  };

  const riskIndicator = getRiskIndicator(targetHealthFactor);

  // Consolidated polling handler
  const handlePollingUpdate = (amount: string) => {
    if (amount && parseFloat(amount) > 0) {
      startPolling?.();
    } else {
      stopPolling?.();
    }
  };

  const handleBorrow = async () => {
    // Build steps array
    const steps: BorrowStep[] = [];
    
    // Filter to only collateral with non-zero amounts
    const collateralToSupply = collateralTableData.filter(item => item.amount > 0n);
    
    // Add collateral supply steps if we have collateral to supply
    if (collateralToSupply.length > 0) {
      for (const item of collateralToSupply) {
        const decimals = item.collateral.customDecimals ?? 18;
        const formattedAmount = formatUnits(item.amount, decimals);
        steps.push({
          id: `supply-${item.collateral.address}`,
          label: `Supply ${item.collateral._symbol}`,
          status: "pending",
          asset: item.collateral,
          amount: formattedAmount,
        });
      }
    }
    
    // Add borrow step
    steps.push({
      id: "borrow",
      label: `Borrow ${borrowAmount} USDST`,
      status: "pending",
    });
    
    // Initialize modal
    setBorrowSteps(steps);
    setProgressModalOpen(true);
    
    try {
      // Execute collateral supplies first
      for (const item of collateralToSupply) {
        const stepId = `supply-${item.collateral.address}`;
        
        // Update step to processing
        setBorrowSteps(prev => prev.map(s => 
          s.id === stepId ? { ...s, status: "processing" } : s
        ));
        
        try {
          await supplyCollateral({
            asset: item.collateral.address,
            amount: item.amount.toString(),
          });
          
          // Mark as completed
          setBorrowSteps(prev => prev.map(s => 
            s.id === stepId ? { ...s, status: "completed" } : s
          ));
        } catch (error: any) {
          // Mark as error
          setBorrowSteps(prev => prev.map(s => 
            s.id === stepId ? { 
              ...s, 
              status: "error",
              error: error.message || "Supply failed"
            } : s
          ));
          throw error; // Stop execution on error
        }
      }
      
      // Execute borrow step
      setBorrowSteps(prev => prev.map(s => 
        s.id === "borrow" ? { ...s, status: "processing" } : s
      ));
      
      await onBorrow(borrowAmount);
      
      // Mark borrow as completed
      setBorrowSteps(prev => prev.map(s => 
        s.id === "borrow" ? { ...s, status: "completed" } : s
      ));
      
      // Reset form after successful completion
      setBorrowAmount("");
      setBorrowAmountError("");
      setCustomBorrowError("");
      setFeeError("");
      handlePollingUpdate("");
      
    } catch (error: any) {
      // Error already handled in individual steps
      console.error("Borrow process failed:", error);
    }
  };

  // Handle slider change - convert position to HF value
  const handleSliderChange = (values: number[]) => {
    const sliderPos = values[0];
    // Slider goes from max HF (left/0) to min HF (right/range)
    const range = Number(sliderExtrema.max) - Number(sliderExtrema.min);
    const newHF = Number(sliderExtrema.max) - sliderPos;
    setTargetHealthFactor(Math.round(newHF * 100) / 100);
  };

  // Convert HF to slider position
  const sliderPosition = useMemo(() => {
    const range = Number(sliderExtrema.max) - Number(sliderExtrema.min);
    return Number(sliderExtrema.max) - targetHealthFactor;
  }, [targetHealthFactor, sliderExtrema]);

  const interestRateDisplay = (() => {
    const raw = (loans as any)?.interestRate; // bps
    const num = Number(raw);
    if (!isFinite(num)) return "-";
    return `${(num / 100).toFixed(2)}%`;
  })();

  const sliderRange = Number(sliderExtrema.max) - Number(sliderExtrema.min);

  return (
    <div className="space-y-4 pt-4">
      {/* Header: Borrow USDST */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Borrow USDST</h3>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Available to Borrow</span>
          <span className="font-medium">USDST {Number(availableToBorrow).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Interest Rate</span>
          <span className="font-medium">{interestRateDisplay}</span>
        </div>
      </div>

      {/* Borrow Amount Input */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Borrow Amount</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              placeholder="0"
              className={`pr-20 ${safeParseUnits(borrowAmount || "0", 18) > BigInt(maxAmount) ? 'text-red-600' : ''}`}
              value={addCommasToInput(borrowAmount)}
              onChange={(e) => {
                const value = e.target.value;
                handleAmountInputChange(value, setBorrowAmount, setBorrowAmountError, maxAmount);
                handlePollingUpdate(value);
              }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">USDST</span>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              try {
                setBorrowAmount(formatUnits(BigInt(maxAmount)));
                setBorrowAmountError("");
                handlePollingUpdate(formatUnits(BigInt(maxAmount)));
              } catch {}
            }}
            disabled={Number(availableToBorrow) <= 0}
            className="px-4"
          >
            MAX
          </Button>
        </div>
      </div>

      {/* Health Factor Slider */}
      <TooltipProvider>
        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 cursor-help">
                  <span className="text-base font-semibold">Health Factor</span>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Target health factor after borrowing. Higher = safer position with less borrowing. Lower = riskier with more borrowing.</p>
              </TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tabular-nums">{targetHealthFactor.toFixed(2)}</span>
              <span className={`text-sm font-medium ${riskIndicator.color}`}>{riskIndicator.label}</span>
            </div>
          </div>

          <Slider
            value={[sliderPosition]}
            min={0}
            max={sliderRange}
            step={0.01}
            onValueChange={handleSliderChange}
            className="w-full"
          />

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Safer</span>
            <span>Riskier</span>
          </div>

          {/* Health Impact: Before => After */}
          <div className="flex justify-between items-center text-sm border-t pt-3">
            <span className="text-muted-foreground">Health Impact</span>
            <span className="font-medium tabular-nums">
              {currentHF === null ? 'No Loan' : currentHF.toFixed(2)}
              {' → '}
              {afterBorrowHF && !customBorrowError ? afterBorrowHF.toFixed(2) : '-'}
            </span>
          </div>
        </div>
      </TooltipProvider>

      {/* Warning Message Box - Above Borrow Button */}
      {targetHealthFactor < 1.6 && !customBorrowError && (
        <div className="p-4 border rounded-lg bg-red-500/10 dark:bg-red-500/20 border-red-500/30">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">High Risk Warning</p>
          </div>
          <p className="text-sm whitespace-pre-line text-red-800 dark:text-red-200">
            Borrowing at this risk level can result in liquidation if the collateral drops in value.
          </p>
        </div>
      )}

      {/* Error Message Box - Above Borrow Button */}
      {customBorrowError && (
        <div className="p-4 bg-red-500/10 dark:bg-red-500/20 border border-red-500/30 rounded-lg">
          <p className="text-red-800 dark:text-red-200 text-sm whitespace-pre-line">{customBorrowError}</p>
        </div>
      )}

      {/* Borrow Button */}
      <Button
        onClick={handleBorrow}
        disabled={
          !borrowAmount ||
          !!borrowAmountError ||
          !!customBorrowError ||
          !!feeError ||
          safeParseUnits(borrowAmount || "0") <= 0n ||
          borrowLoading ||
          progressModalOpen ||
          safeParseUnits(borrowAmount || "0") > BigInt(maxAmount) ||
          hasExceededMaxCollateralValue ||
          hasInsufficientCollateral
        }
        className="w-full"
      >
        {borrowLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white mr-2"></div>
        ) : null}
        Borrow
      </Button>

      {/* Auto Supply Collateral Checkbox and Dropdown - Only show when collateral is needed */}
      {collateralTableData.length > 0 && !customBorrowError && (
        <>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="auto-supply"
              checked={autoSupplyCollateral}
              onCheckedChange={handleAutoSupplyChange}
            />
            <label
              htmlFor="auto-supply"
              className="text-sm text-muted-foreground cursor-pointer select-none"
            >
              Automatically supply collateral
            </label>
          </div>

          {/* Additional Collateral Needed Dropdown */}
          <Collapsible
            open={isCollateralExpanded}
            onOpenChange={setIsCollateralExpanded}
            className="border rounded-lg"
          >
        <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors">
          <span>
            Additional Collateral Needed{' '}
            <span className="text-muted-foreground font-normal">
              (Value: ${additionalCollateralNeededValue.toFixed(2)})
            </span>
          </span>
          {isCollateralExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-4">
          <style>{`
            /* Hide number input spinner arrows */
            .collateral-value-input[type="number"]::-webkit-outer-spin-button,
            .collateral-value-input[type="number"]::-webkit-inner-spin-button {
              -webkit-appearance: none;
              margin: 0;
            }
            .collateral-value-input[type="number"] {
              -moz-appearance: textfield;
            }
          `}</style>
          {/* Total Value Header */}
          <div className="text-sm font-medium mb-3 pt-2 border-t">
            Total Value of Collateral: ${totalCollateralValue.toFixed(2)}
            {hasInsufficientCollateral && (
              <span className="text-yellow-600 dark:text-yellow-400 ml-2">
                (${centCeil(additionalCollateralNeededValue - totalCollateralValue).toFixed(2)} more needed)
              </span>
            )}
          </div>

          {/* Collateral Table */}
          {collateralTableData.length > 0 ? (
            <TooltipProvider>
              <div className="space-y-1">
                {/* Table Header */}
                <div className="grid grid-cols-4 gap-4 text-xs text-muted-foreground pb-2">
                  <span>Asset</span>
                  <span className="text-center">Amount</span>
                  <span className="text-right">Value</span>
                  <span className="text-right">Available</span>
                </div>

                {/* Table Rows */}
                {collateralTableData.map((item) => {
                  const decimals = item.collateral.customDecimals ?? 18;
                  const fullAmount = item.amount === 0n ? "0" : formatBalance(item.amount, undefined, decimals, 2);
                  const displayAmount = item.amount === 0n ? "0" : formatBalance(item.amount, undefined, decimals, 0, 4);
                  const tokenImage = item.collateral.images?.[0]?.value;
                  
                  const maxValueUSD = calculateMaxCollateralValueUSDCentFloored(item.collateral);

                  return (
                    <div
                      key={item.collateral.address}
                      className="grid grid-cols-4 gap-4 items-center py-2 text-sm"
                    >
                      {/* Asset */}
                      <div className="flex items-center gap-2">
                        {tokenImage ? (
                          <img
                            src={tokenImage}
                            alt={item.collateral._symbol}
                            className="w-5 h-5 rounded-full"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs">
                            {item.collateral._symbol?.charAt(0) || '?'}
                          </div>
                        )}
                        <span className="font-medium">{item.collateral._symbol}</span>
                      </div>

                      {/* Amount */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-center tabular-nums cursor-help">
                            {displayAmount}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{fullAmount}</p>
                        </TooltipContent>
                      </Tooltip>

                      {/* Value */}
                      {autoSupplyCollateral ? (
                        <span className="text-right tabular-nums">
                          ${item.valueUSD.toFixed(2)}
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-muted-foreground">$</span>
                          <Input
                            type="number"
                            value={customCollateralValues.get(item.collateral.address) || item.valueUSD.toFixed(2)}
                            onChange={(e) => handleCustomValueChange(item.collateral.address, e.target.value)}
                            className={`collateral-value-input w-20 h-7 text-right text-sm px-2 ${collateralExceedsMaxMap.get(item.collateral.address) ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                          />
                        </div>
                      )}

                      {/* Available */}
                      {autoSupplyCollateral ? (
                        <span className="text-right tabular-nums text-muted-foreground">
                          ${maxValueUSD.toFixed(2)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleFillAddCollatMaxValue(item.collateral)}
                          className="text-right tabular-nums text-muted-foreground underline cursor-pointer hover:text-foreground transition-colors"
                        >
                          ${maxValueUSD.toFixed(2)}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </TooltipProvider>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              {borrowAmount && parseFloat(borrowAmount) > 0
                ? "No additional collateral needed"
                : "Enter a borrow amount to see collateral requirements"}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
        </>
      )}

      {/* Transaction Fee */}
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground underline cursor-help" title="Fee paid to process this transaction">Transaction Fee</span>
        <span className="font-medium">{txFee.fee.toFixed(2)} USDST ({txFee.voucher} vouchers)</span>
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

      {/* Conditional Warning Messages */}
      {(() => {
        const isZeroAvailable = Number(availableToBorrow) <= 0;
        const eligibleCollateralTokens = collateralInfo || [];

        if (isZeroAvailable && eligibleCollateralTokens.length === 0) {
          return (
            <p className="text-muted-foreground text-sm mt-2">
              You have no eligible collateral. Supply assets to enable borrowing.
            </p>
          );
        }

        return null;
      })()}

      {/* Borrow Progress Modal */}
      <BorrowProgressModal
        open={progressModalOpen}
        steps={borrowSteps}
        onClose={() => {
          setProgressModalOpen(false);
          setBorrowSteps([]);
        }}
      />
    </div>
  );
};

export default BorrowForm;