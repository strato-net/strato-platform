import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { ChevronDown, Info } from "lucide-react";
import { useOracleContext } from "@/context/OracleContext";
import { cdpService } from "@/services/cdpService";
import { getOptimalAllocations, computeTotalHeadroom, getMaxAllocations, type VaultCandidate } from "@/services/mintPlanService";
import type { PlanItem } from "@/services/cdpTypes";
import {
  SECONDS_PER_DAY,
  SECONDS_PER_WEEK,
  SECONDS_PER_MONTH,
  SECONDS_PER_YEAR,
  getCompoundInterest,
  convertStabilityFeeRateToAnnualPercentage,
} from "@/services/cdpUtils";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { CompactRewardsDisplay } from "@/components/rewards/CompactRewardsDisplay";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { roundByMagnitude, formatRoundedWithCommas } from "@/services/rewardsService";
import MintWidget from "./MintWidget";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OptimalAllocation = PlanItem;

// Helper to convert Allocation to PlanItem for UI display
function allocationToPlanItem(
  allocation: { assetAddress: string; depositAmount: bigint; mintAmount: bigint },
  candidate: VaultCandidate
): PlanItem {
  // Calculate decimals from assetScale (e.g., 1e18 = 18 decimals)
  const assetScaleStr = candidate.assetScale.toString();
  const decimals = assetScaleStr.length - 1; // "1000000000000000000" -> 18
  
  // Calculate deposit amount in USD
  const depositAmountUSDWei = (allocation.depositAmount * candidate.oraclePrice) / candidate.assetScale;
  
  // Use symbol from candidate
  const symbol = candidate.symbol;
  
  // Calculate existing collateral USD
  const existingCollateralUSDWei = (candidate.currentCollateral * candidate.oraclePrice) / candidate.assetScale;
  
  // User balance is potentialCollateral
  const userBalanceWei = candidate.potentialCollateral;
  const userBalanceUSDWei = (userBalanceWei * candidate.oraclePrice) / candidate.assetScale;
  
  // Convert stabilityFeeRate from RAY (per-second rate) to annual percentage for display
  // Uses proper compound interest calculation via rpow (matches contract behavior)
  const stabilityFeeRate = convertStabilityFeeRateToAnnualPercentage(candidate.stabilityFeeRate);
  
  return {
    assetAddress: allocation.assetAddress,
    symbol,
    depositAmount: formatUnits(allocation.depositAmount, decimals),
    depositAmountUSD: formatUnits(depositAmountUSDWei, 18),
    mintAmount: formatUnits(allocation.mintAmount, 18),
    stabilityFeeRate,
    existingCollateralUSD: formatUnits(existingCollateralUSDWei, 18),
    userBalance: formatUnits(userBalanceWei, decimals),
    userBalanceUSD: formatUnits(userBalanceUSDWei, 18),
  };
}

const formatUSD = (value: number, decimals = 2) =>
  isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "0.00";
const formatPercentage = (num: number, decimals: number = 2): string => {
  if (isNaN(num)) return '0.00%';
  return num.toFixed(decimals) + '%';
};

// Helper to format number with commas for display
const formatNumberWithCommas = (value: string | number): string => {
  if (value === "" || value === null || value === undefined) return "";
  const str = typeof value === "number" ? value.toString() : value;
  // Remove any existing commas
  const cleaned = str.replace(/,/g, "");
  
  // Handle empty string or just decimal point
  if (cleaned === "" || cleaned === ".") return cleaned;
  
  // Split into integer and decimal parts
  const parts = cleaned.split(".");
  const integerPart = parts[0] || "";
  const decimalPart = parts[1];
  
  // Format integer part with commas (only if there's content)
  let formattedInteger = integerPart;
  if (integerPart) {
    // Remove leading zeros except for single zero
    const normalizedInteger = integerPart.replace(/^0+/, "") || "0";
    formattedInteger = normalizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  
  // Combine with decimal part if present
  return decimalPart !== undefined ? `${formattedInteger}.${decimalPart}` : formattedInteger;
};

// Helper to parse comma-separated number string to numeric string
const parseCommaNumber = (value: string): string => {
  return value.replace(/,/g, "");
};


const VaultBreakdown: React.FC<{
  allocations: OptimalAllocation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ allocations, open, onOpenChange }) => {
  // Calculate total mint amount
  const totalMintAmount = allocations.reduce((sum, allocation) => {
    return sum + parseFloat(allocation.mintAmount || "0");
  }, 0);

  // Calculate transaction fees (0.01 USDST per transaction)
  const TX_FEE_USDST = 0.01;
  const transactionCount = allocations.reduce((count, allocation) => {
    const depositAmount = parseFloat(allocation.depositAmount || "0");
    const mintAmount = parseFloat(allocation.mintAmount || "0");
    // Each deposit is 1 transaction, each mint is 1 transaction
    if (depositAmount > 0) count += 1; // Deposit transaction
    if (mintAmount > 0) count += 1; // Mint transaction
    return count;
  }, 0);
  const totalTransactionFees = transactionCount * TX_FEE_USDST;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full flex items-center justify-between p-3 rounded-md bg-muted border border-border hover:bg-muted/80"
        >
          <span className="text-sm font-semibold text-foreground">Vault Breakdown</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 pt-2">
          {allocations.map((allocation) => {
            const depositAmount = parseFloat(allocation.depositAmount);
            const existingCollateralUSD = parseFloat(allocation.existingCollateralUSD);
            const userBalance = parseFloat(allocation.userBalance);
            const userBalanceUSD = parseFloat(allocation.userBalanceUSD);

            return (
              <div
                key={allocation.assetAddress}
                className="p-3 rounded-md border border-border bg-card"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-foreground">{allocation.symbol}</p>
                  <Badge variant="outline">{formatPercentage(allocation.stabilityFeeRate)}</Badge>
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    • Balance: {formatUSD(userBalance, 4)} {allocation.symbol} (${formatUSD(userBalanceUSD, 2)})
                  </p>
                  {depositAmount > 0 ? (
                    <p>
                      • Add collateral: {formatUSD(depositAmount, 4)} {allocation.symbol} (${formatUSD(parseFloat(allocation.depositAmountUSD))})
                    </p>
                  ) : existingCollateralUSD > 0 ? (
                    <p>• Use existing collateral: ${formatUSD(existingCollateralUSD)}</p>
                  ) : null}
                  <p className="font-semibold text-foreground">
                    • Mint: {formatUSD(parseFloat(allocation.mintAmount), 2)} USDST
                  </p>
                </div>
              </div>
            );
          })}
          {allocations.length > 0 && (
            <div className="pt-2 mt-2 border-t border-border space-y-2">
              <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                <p className="text-sm font-semibold text-foreground">Total Mint Amount</p>
                <p className="text-sm font-bold text-foreground">{formatUSD(totalMintAmount, 2)} USDST</p>
              </div>
              {transactionCount > 0 && (
                <div className="flex items-center justify-between px-3 pb-2">
                  <p className="text-xs text-muted-foreground">
                    Transaction Fees ({transactionCount} {transactionCount === 1 ? 'tx' : 'txs'})
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">{formatUSD(totalTransactionFees, 2)} USDST</p>
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const MintPlanner: React.FC<{ title?: string; onSuccess?: () => void; refreshTrigger?: number }> = ({
  title = "Mint against collateral (CDP)",
  onSuccess,
  refreshTrigger,
}) => {
  const [mintAmountInput, setMintAmountInput] = useState<string>("");
  const [riskBuffer, setRiskBuffer] = useState<number>(1.5);
  const [isMaxMode, setIsMaxMode] = useState<boolean>(false);

  const getRiskColor = useCallback((factor: number): string => {
    if (factor <= 1.5) {
      const ratio = (factor - 1.0) / 0.5;
      const r = Math.round(239 + (16 - 239) * ratio);
      const g = Math.round(68 + (185 - 68) * ratio);
      const b = Math.round(68 + (129 - 68) * ratio);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const ratio = (factor - 1.5) / 1.0;
      const r = Math.round(16 + (180 - 16) * ratio);
      const g = Math.round(185 + (220 - 185) * ratio);
      const b = Math.round(129 + (180 - 129) * ratio);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"quick" | "advanced">("quick");
  const [showProjectedCosts, setShowProjectedCosts] = useState(false);
  const [showVaultBreakdown, setShowVaultBreakdown] = useState(false);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [vaultCandidates, setVaultCandidates] = useState<VaultCandidate[]>([]);
  const { fetchAllPrices } = useOracleContext();
  const { toast } = useToast();
  const { userRewards } = useRewardsUserInfo();

  const fetchVaultCandidates = useCallback(async () => {
    try {
      const { existingVaults, potentialVaults } = await cdpService.getVaultCandidates();
      setVaultCandidates([...existingVaults, ...potentialVaults]);
    } catch {
      setVaultCandidates([]);
    }
  }, []);

  useEffect(() => {
    fetchVaultCandidates();
  }, [fetchVaultCandidates, refreshTrigger]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        await fetchAllPrices();
      } catch {
        setError("Could not load CDP data");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchAllPrices, refreshTrigger]);

  const mintAmount = useMemo(() => {
    const parsed = parseFloat((mintAmountInput || "").replace(/,/g, ""));
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [mintAmountInput]);

  const mintAmountWei = useMemo(() => {
    const str = (mintAmountInput || "").replace(/,/g, "").trim();
    if (!str || str === "0") return 0n;
    try {
      const [intPart = "", decPart = ""] = str.split(".");
      return BigInt(intPart + decPart.padEnd(18, "0").substring(0, 18));
    } catch {
      return 0n;
    }
  }, [mintAmountInput]);

  const maxAllocations = useMemo<OptimalAllocation[]>(() => {
    if (vaultCandidates.length === 0) return [];
    try {
      const result = getMaxAllocations(vaultCandidates, riskBuffer);
      
      // Convert Allocation[] to PlanItem[] for UI
      const planItems: PlanItem[] = [];
      for (const allocation of result) {
        const candidate = vaultCandidates.find(c => c.assetAddress === allocation.assetAddress);
        if (candidate) {
          planItems.push(allocationToPlanItem(allocation, candidate));
        }
      }
      
      // Sort by lowest stabilityFeeRate first
      return planItems.sort((a, b) => a.stabilityFeeRate - b.stabilityFeeRate);
    } catch {
      return [];
    }
  }, [riskBuffer, vaultCandidates]);

  const { optimalAllocations, debtFloorHit } = useMemo<{ optimalAllocations: OptimalAllocation[]; debtFloorHit: boolean }>(() => {
    // In MAX mode, use max allocations instead
    if (isMaxMode) return { optimalAllocations: maxAllocations, debtFloorHit: false };
    
    if (mintAmountWei <= 0n || vaultCandidates.length === 0) return { optimalAllocations: [], debtFloorHit: false };
    try {
      // Use allocation function directly with VaultCandidate[]
      const result = getOptimalAllocations(mintAmountWei, riskBuffer, vaultCandidates);
      
      // Convert Allocation[] to PlanItem[] for UI
      const planItems: PlanItem[] = [];
      for (const allocation of result.allocations) {
        const candidate = vaultCandidates.find(c => c.assetAddress === allocation.assetAddress);
        if (candidate) {
          planItems.push(allocationToPlanItem(allocation, candidate));
        }
      }
      
      // Sort by lowest stabilityFeeRate first
      return {
        optimalAllocations: planItems.sort((a, b) => a.stabilityFeeRate - b.stabilityFeeRate),
        debtFloorHit: result.debtFloorHit
      };
    } catch {
      return { optimalAllocations: [], debtFloorHit: false };
    }
  }, [mintAmountWei, riskBuffer, vaultCandidates, isMaxMode, maxAllocations]);

  const totalHeadroomWei = useMemo(() => {
    if (vaultCandidates.length === 0) return 0n;
    return computeTotalHeadroom(riskBuffer, vaultCandidates);
  }, [riskBuffer, vaultCandidates]);

  // Calculate total max mint from max allocations
  const totalMaxMintWei = useMemo(() => {
    return maxAllocations.reduce((sum, allocation) => {
      return sum + parseUnits(allocation.mintAmount, 18);
    }, 0n);
  }, [maxAllocations]);

  // Update mint amount input when MAX mode is enabled
  useEffect(() => {
    if (isMaxMode && totalMaxMintWei > 0n) {
      const maxMint = formatUnits(totalMaxMintWei, 18);
      // Remove trailing zeros but preserve precision
      const cleaned = maxMint.replace(/\.?0+$/, '');
      // Format with commas
      const formatted = formatNumberWithCommas(cleaned);
      setMintAmountInput(formatted);
    }
  }, [isMaxMode, totalMaxMintWei]);

  // Disable MAX mode if risk buffer changes and no allocations are possible
  useEffect(() => {
    if (isMaxMode && (maxAllocations.length === 0 || totalMaxMintWei === 0n)) {
      setIsMaxMode(false);
      setMintAmountInput("");
    }
  }, [riskBuffer, maxAllocations.length, totalMaxMintWei, isMaxMode]);

  // Check if input should be locked (no max allocations possible)
  const shouldLockInput = !isMaxMode && (maxAllocations.length === 0 || totalMaxMintWei === 0n);
  
  const exceedsMaxCollateral = isMaxMode 
    ? false 
    : mintAmountWei > 0n && mintAmountWei > totalHeadroomWei;

  const handleMaxClick = useCallback(() => {
    setIsMaxMode(!isMaxMode);
    if (!isMaxMode && totalMaxMintWei > 0n) {
      const maxMint = formatUnits(totalMaxMintWei, 18);
      const cleaned = maxMint.replace(/\.?0+$/, '');
      // Format with commas
      const formatted = formatNumberWithCommas(cleaned);
      setMintAmountInput(formatted);
    } else if (isMaxMode) {
      setMintAmountInput("");
    }
  }, [isMaxMode, totalMaxMintWei]);

  const supportedAssetsWithBalances = useMemo(() => {
    return vaultCandidates.map((c) => {
      // Calculate decimals from assetScale (assetScale is 10^decimals)
      const decimals = c.assetScale.toString().length - 1;
      const priceUSD = parseFloat(formatUnits(c.oraclePrice, 18));
      
      // Calculate deposited collateral (already in vault)
      const depositedAmount = parseFloat(formatUnits(c.currentCollateral, decimals));
      const depositedUSD = depositedAmount * priceUSD;
      
      // Calculate wallet balance (available to deposit)
      const walletAmount = parseFloat(formatUnits(c.potentialCollateral, decimals));
      const walletUSD = walletAmount * priceUSD;
      
      // Total collateral = deposited + wallet
      const totalAmount = depositedAmount + walletAmount;
      const totalUSD = depositedUSD + walletUSD;
      
      return {
        assetAddress: c.assetAddress,
        symbol: c.symbol,
        depositedAmount,
        depositedUSD,
        walletAmount,
        walletUSD,
        totalAmount,
        totalUSD,
      };
    }).sort((a, b) => b.totalUSD - a.totalUSD);
  }, [vaultCandidates]);

  const weightedAverageAPR = useMemo(() => {
    if (optimalAllocations.length === 0) return 0;
    
    let totalMintAmount = 0;
    let weightedSum = 0;
    
    for (const allocation of optimalAllocations) {
      const mintAmount = parseFloat(allocation.mintAmount);
      const feeRate = allocation.stabilityFeeRate;
      
      // Validate values before using them
      if (!isFinite(mintAmount) || !isFinite(feeRate)) continue;
      if (mintAmount <= 0 || feeRate < 0) continue;
      
      totalMintAmount += mintAmount;
      weightedSum += mintAmount * feeRate;
    }
    
    const result = totalMintAmount > 0 ? weightedSum / totalMintAmount : 0;
    return isFinite(result) ? result : 0;
  }, [optimalAllocations]);

  const projectedInterestCosts = useMemo(() => {
    // Validate inputs
    if (!isFinite(mintAmount) || mintAmount <= 0) {
      return { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
    }
    if (!isFinite(weightedAverageAPR) || weightedAverageAPR <= 0) {
      return { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
    }
    
    return {
      daily: getCompoundInterest(mintAmount, weightedAverageAPR, SECONDS_PER_DAY),
      weekly: getCompoundInterest(mintAmount, weightedAverageAPR, SECONDS_PER_WEEK),
      monthly: getCompoundInterest(mintAmount, weightedAverageAPR, SECONDS_PER_MONTH),
      yearly: getCompoundInterest(mintAmount, weightedAverageAPR, SECONDS_PER_YEAR),
    };
  }, [mintAmount, weightedAverageAPR]);

  const handleQuickMint = useCallback(async () => {
    if (mintAmount <= 0 || optimalAllocations.length === 0) return;

    setTransactionLoading(true);
    try {
      await fetchAllPrices();
      const { existingVaults, potentialVaults } = await cdpService.getVaultCandidates();
      const freshCandidates = [...existingVaults, ...potentialVaults];
      const freshTargetMintUSD = parseUnits(mintAmount.toFixed(18), 18);
      
      // Use allocation function directly with VaultCandidate[]
      const result = getOptimalAllocations(freshTargetMintUSD, riskBuffer, freshCandidates);
      
      // Convert Allocation[] to PlanItem[] for UI
      const freshAllocations: PlanItem[] = [];
      for (const allocation of result.allocations) {
        const candidate = freshCandidates.find(c => c.assetAddress === allocation.assetAddress);
        if (candidate) {
          freshAllocations.push(allocationToPlanItem(allocation, candidate));
        }
      }

      const transactions: Array<{ type: "deposit" | "mint"; asset: string; amount: string; symbol: string }> = [];

      for (const allocation of freshAllocations) {
        const assetAddress = allocation.assetAddress.toLowerCase();
        
        // Add deposit transaction if allocation includes a deposit
        const depositAmount = parseFloat(allocation.depositAmount || "0");
        if (depositAmount > 0) {
          transactions.push({
            type: "deposit",
            asset: allocation.assetAddress,
            amount: allocation.depositAmount,
            symbol: allocation.symbol,
          });
        }
        const mintAmount = parseFloat(allocation.mintAmount || "0");
        if (mintAmount > 0) {
          transactions.push({
            type: "mint",
            asset: allocation.assetAddress,
            amount: allocation.mintAmount,
            symbol: allocation.symbol,
          });
        }
      }

      const SAFETY_BUFFER_PERCENT = 0.001;
      let allSuccessful = true;

      for (const tx of transactions) {
        let result;

        if (tx.type === "deposit") {
          result = await cdpService.deposit(tx.asset, tx.amount);
          if (result.status.toLowerCase() !== "success") {
            allSuccessful = false;
            toast({
              title: `Deposit Failed: ${tx.symbol}`,
              description: `Failed to deposit ${formatUSD(parseFloat(tx.amount), 4)} ${tx.symbol}. Status: ${result.status}`,
              variant: "destructive",
            });
            throw new Error(`Deposit failed for ${tx.symbol}: ${result.status}`);
          }
          toast({
            title: `Deposit Successful: ${tx.symbol}`,
            description: `Deposited ${formatUSD(parseFloat(tx.amount), 4)} ${tx.symbol}. Tx: ${result.hash}`,
          });
          
          await fetchAllPrices();
        } else {
          try {
            const maxMintResult = await cdpService.getMaxMint(tx.asset);
            const maxMintableUSD = parseFloat(formatUnits(maxMintResult.maxAmount, 18));
            const plannedMintUSD = parseFloat(tx.amount);
            const safeMaxMintableUSD = maxMintableUSD * (1 - SAFETY_BUFFER_PERCENT);

            if (plannedMintUSD > safeMaxMintableUSD) {
              const clampedMintUSD = Math.max(0, safeMaxMintableUSD);

              if (clampedMintUSD < plannedMintUSD * 0.99) {
                toast({
                  title: "Mint Amount Adjusted",
                  description: `Planned ${formatUSD(plannedMintUSD, 2)} USDST for ${tx.symbol}, but only ${formatUSD(clampedMintUSD, 2)} USDST is available. This may be due to price changes or debt accrual.`,
                  variant: "default",
                });
              }
              if (clampedMintUSD <= 0) {
                toast({
                  title: `Mint Skipped: ${tx.symbol}`,
                  description: `Insufficient collateral after deposits. Planned: ${formatUSD(plannedMintUSD, 2)} USDST`,
                  variant: "default",
                });
                continue;
              }

              tx.amount = clampedMintUSD.toString();
            }
          } catch {
            // Continue with planned amount - backend validation will catch it
          }

          result = await cdpService.mint(tx.asset, tx.amount);
          if (result.status.toLowerCase() !== "success") {
            allSuccessful = false;
            toast({
              title: `Mint Failed: ${tx.symbol}`,
              description: `Failed to mint ${formatUSD(parseFloat(tx.amount), 2)} USDST from ${tx.symbol}. Status: ${result.status}`,
              variant: "destructive",
            });
            throw new Error(`Mint failed for ${tx.symbol}: ${result.status}`);
          }

          toast({
            title: `Mint Successful: ${tx.symbol}`,
            description: `Minted ${formatUSD(parseFloat(tx.amount), 2)} USDST from ${tx.symbol}. Tx: ${result.hash}`,
          });
        }
      }

      if (allSuccessful) {
        await new Promise(resolve => setTimeout(resolve, 500));
        toast({
          title: "Quick Mint Complete",
          description: "All transactions completed successfully",
        });
      }
      
      // Refetch all state after successful transactions
      await Promise.all([fetchVaultCandidates(), fetchAllPrices()]);
      
      // Reset all input state
      setMintAmountInput("");
      setIsMaxMode(false);
      
      if (onSuccess) onSuccess();
    } catch (error) {
      // Even on error, refetch state to reflect any partial success
      try {
        await Promise.all([fetchVaultCandidates(), fetchAllPrices()]);
      } catch (refetchError) {
        console.error("Failed to refetch state after error:", refetchError);
      }
      
      toast({
        title: "Transaction Failed",
        description: error instanceof Error ? error.message : "Transaction failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setTransactionLoading(false);
    }
  }, [mintAmount, optimalAllocations, toast, fetchVaultCandidates, fetchAllPrices, onSuccess, riskBuffer]);

  return (
    <>
      <style>{`
        .risk-slider-track {
          background-color: hsl(var(--secondary)) !important;
        }
        .risk-slider-range {
          background-color: var(--risk-slider-color, #10b981) !important;
          transition: background-color 0.2s ease;
        }
      `}</style>
      <div className="space-y-6">
      <div className="flex items-center justify-between px-6 pb-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        <Select value={viewMode} onValueChange={(value) => setViewMode(value as "quick" | "advanced")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="quick">Quick Mint</SelectItem>
            <SelectItem value="advanced">Advanced</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {viewMode === "quick" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Quick Mint
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="How Quick Mint allocations are determined"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="w-48 text-sm">
                    Quick Mint finds an optimal collateral allocation by ranking vaults by stability
                    fee and proposing deposit/mint amounts that satisfy your target risk buffer,
                    constrained by your asset balances.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Mint Amount (USDST)</label>
              <div className="relative">
                <Input
                  value={mintAmountInput}
                  onChange={(e) => {
                    const rawValue = e.target.value;
                    // Allow empty string
                    if (rawValue === "") {
                      setMintAmountInput("");
                      setIsMaxMode(false);
                      return;
                    }
                    
                    // Remove commas and validate format
                    const parsed = parseCommaNumber(rawValue);
                    
                    // Allow: empty, numbers, single decimal point, or number with decimal
                    if (parsed === "" || parsed === "." || /^\d*\.?\d*$/.test(parsed)) {
                      // Format with commas for display
                      const formatted = formatNumberWithCommas(parsed);
                      setMintAmountInput(formatted);
                      setIsMaxMode(false); // Disable MAX mode when user types
                    }
                    // If invalid format, don't update (prevents invalid input)
                  }}
                  placeholder="0"
                  inputMode="decimal"
                  className="pr-20"
                  disabled={isMaxMode || shouldLockInput}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {totalMaxMintWei > 0n && (
                    <Button
                      type="button"
                      variant={isMaxMode ? "default" : "ghost"}
                      size="sm"
                      className={`h-6 px-2 text-xs font-medium ${
                        isMaxMode
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "text-primary hover:text-primary/80"
                      }`}
                      onClick={handleMaxClick}
                    >
                      MAX
                    </Button>
                  )}
                  <span className="text-muted-foreground text-sm">USDST</span>
                </div>
              </div>
              {/* {totalHeadroomWei > 0n && (
                <p className="text-xs text-muted-foreground">
                  Max Mint: {formatUSD(parseFloat(formatUnits(totalHeadroomWei, 18)), 2)} USDST
                </p>
              )} */}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Risk Buffer</label>
                <span 
                  className="text-sm font-semibold"
                  style={{
                    color: getRiskColor(riskBuffer)
                  }}
                >
                  {riskBuffer === 1.0 ? "No Buffer" : `${riskBuffer.toFixed(1)}x`}
                </span>
              </div>
              <div className="relative w-full">
                <div style={{ '--risk-slider-color': getRiskColor(riskBuffer) } as React.CSSProperties}>
                  <Slider
                    value={[3.5 - riskBuffer]}
                    onValueChange={(value) => setRiskBuffer(3.5 - value[0])}
                    min={1}
                    max={2.5}
                    step={0.1}
                    className="w-full risk-slider"
                    trackClassName="risk-slider-track"
                    rangeClassName="risk-slider-range"
                  />
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                <span>
                  This value will determine the size of the safety buffer between each vault's target CR and the protocol minimum.
                </span>
              </div>
            </div>

            <Button 
              disabled={(mintAmount <= 0 && !isMaxMode) || optimalAllocations.length === 0 || transactionLoading || exceedsMaxCollateral || shouldLockInput} 
              onClick={handleQuickMint}
              className="w-full"
            >
              {transactionLoading
                ? "Processing..."
                : shouldLockInput
                ? "Insufficient Collateral: Decrease Risk Buffer"
                : (mintAmount <= 0 && !isMaxMode)
                ? "Enter mint amount"
                : exceedsMaxCollateral
                ? "Insufficient Collateral: Decrease Mint Amount or Risk Buffer"
                : optimalAllocations.length === 0 && debtFloorHit
                ? "Debt Floor: Increase Mint Amount"
                : optimalAllocations.length === 0 && totalHeadroomWei <= 0n
                ? "Vaults at Capacity: Decrease Risk Buffer"
                : optimalAllocations.length === 0
                ? "No vaults available"
                : isMaxMode
                ? "Confirm Max Mint"
                : "Confirm Quick Mint"}
            </Button>

            <Separator />

            {shouldLockInput ? (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Insufficient Collateral</p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  Zero USDST can be minted with your current asset balances and selected Risk Buffer. Try decreasing the risk buffer to increase headroom.
                </p>
              </div>
            ) : (mintAmount <= 0 && !isMaxMode) ? (
              <div className="p-3 rounded-md bg-muted border border-border text-center">
                <p className="text-sm text-muted-foreground">Enter a mint amount and select risk buffer to see your optimal mint plan</p>
              </div>
            ) : exceedsMaxCollateral ? null : optimalAllocations.length > 0 ? (
              <VaultBreakdown
                allocations={optimalAllocations}
                open={showVaultBreakdown}
                onOpenChange={setShowVaultBreakdown}
              />
            ) : (
              <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                  {debtFloorHit
                    ? "Debt floor prevents allocation"
                    : totalHeadroomWei <= 0n
                    ? "Vaults at capacity for current risk buffer"
                    : "No suitable vaults found"}
                </p>
                <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
                  {debtFloorHit
                    ? "Each vault requires a minimum debt amount. Try increasing your mint amount or use a different vault."
                    : totalHeadroomWei <= 0n
                    ? "Your vaults have reached their borrowing limit at the current risk buffer. Try decreasing the risk buffer to allow more borrowing."
                    : "No vaults are available for minting at this time."}
                </p>
                {totalHeadroomWei > 0n && (
                  <div className="space-y-2 text-xs text-yellow-800 dark:text-yellow-200">
                    {supportedAssetsWithBalances.length > 0 ? (
                      supportedAssetsWithBalances.map((asset) => (
                        <div key={asset.assetAddress} className="space-y-0.5">
                          <div className="flex justify-between font-medium">
                            <span>{asset.symbol} Total:</span>
                            <span>
                              {formatUSD(asset.totalAmount, 4)} {isFinite(asset.totalUSD) ? `($${formatUSD(asset.totalUSD, 2)})` : ""}
                            </span>
                          </div>
                          <div className="flex justify-between text-yellow-700 dark:text-yellow-300 pl-2">
                            <span>Deposited:</span>
                            <span>
                              {formatUSD(asset.depositedAmount, 4)} {isFinite(asset.depositedUSD) ? `($${formatUSD(asset.depositedUSD, 2)})` : ""}
                            </span>
                          </div>
                          <div className="flex justify-between text-yellow-700 dark:text-yellow-300 pl-2">
                            <span>Wallet:</span>
                            <span>
                              {formatUSD(asset.walletAmount, 4)} {isFinite(asset.walletUSD) ? `($${formatUSD(asset.walletUSD, 2)})` : ""}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-yellow-700 dark:text-yellow-300">No supported assets available</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {mintAmount > 0 && weightedAverageAPR > 0 && (
              <Collapsible open={showProjectedCosts} onOpenChange={setShowProjectedCosts}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between p-3 rounded-md bg-muted border border-border hover:bg-muted/80"
                  >
                    <span className="text-sm font-semibold text-foreground">
                      Projected Interest Costs (APR: {formatPercentage(weightedAverageAPR)})
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ${
                        showProjectedCosts ? "rotate-180" : ""
                      }`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-3 pt-0 rounded-md bg-muted border border-border border-t-0 rounded-t-none">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2">
                      <div>
                        <p className="text-muted-foreground">Daily</p>
                        <p className="font-semibold text-foreground">${formatRoundedWithCommas(roundByMagnitude(projectedInterestCosts.daily.toString()))}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Weekly</p>
                        <p className="font-semibold text-foreground">${formatRoundedWithCommas(roundByMagnitude(projectedInterestCosts.weekly.toString()))}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Monthly</p>
                        <p className="font-semibold text-foreground">${formatRoundedWithCommas(roundByMagnitude(projectedInterestCosts.monthly.toString()))}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Yearly</p>
                        <p className="font-semibold text-foreground">${formatRoundedWithCommas(roundByMagnitude(projectedInterestCosts.yearly.toString()))}</p>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {userRewards && (() => {
              const cdpActivity = userRewards.activities.find((a) => {
                const nameLower = a.activity.name.toLowerCase();
                return nameLower.includes("cdp") || 
                       nameLower.includes("mint") ||
                       (nameLower.includes("borrow") && !nameLower.includes("lending"));
              });
              
              if (!cdpActivity) return null;
              
              return (
                <CompactRewardsDisplay
                  key={mintAmount}
                  userRewards={userRewards}
                  activityName={cdpActivity.activity.name}
                  inputAmount={mintAmount > 0 ? mintAmount.toString() : undefined}
                  actionLabel="Mint"
                />
              );
            })()}
          </CardContent>
        </Card>
      )}

      {viewMode === "advanced" && (
        <div className="border border-border bg-card rounded-xl p-4">
          <MintWidget onSuccess={onSuccess} title={title} />
        </div>
      )}
    </div>
    </>
  );
};

export default MintPlanner;
