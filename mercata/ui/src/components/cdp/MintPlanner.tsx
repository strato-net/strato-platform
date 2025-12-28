import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { ChevronDown, ChevronLeft, ChevronRight, Info } from "lucide-react";
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
import { formatNumberWithCommas, parseCommaNumber } from "@/utils/numberUtils";
import { useToast } from "@/hooks/use-toast";
import { CompactRewardsDisplay } from "@/components/rewards/CompactRewardsDisplay";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { roundByMagnitude, formatRoundedWithCommas } from "@/services/rewardsService";
import MintWidget from "./MintWidget";
import MintProgressModal, { type MintStep } from "./MintProgressModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Constants
const SAFETY_BUFFER_BPS = 5n;
const BPS_SCALE = 1000n;
const DEPOSIT_FEE_USDST = 0.02;
const MINT_FEE_USDST = 0.01;

// Helpers
const formatUSD = (value: number, decimals = 2) =>
  isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "0.00";

const formatPercentage = (num: number, decimals = 2): string =>
  isNaN(num) ? "0.00%" : num.toFixed(decimals) + "%";

const getRiskColor = (factor: number): string => {
  if (factor <= 1.5) {
    const ratio = (factor - 1.0) / 0.5;
    return `rgb(${Math.round(239 + (16 - 239) * ratio)}, ${Math.round(68 + (185 - 68) * ratio)}, ${Math.round(68 + (129 - 68) * ratio)})`;
  }
  const ratio = (factor - 1.5) / 1.0;
  return `rgb(${Math.round(16 + (180 - 16) * ratio)}, ${Math.round(185 + (220 - 185) * ratio)}, ${Math.round(129 + (180 - 129) * ratio)})`;
};

const parseInputToWei = (input: string): bigint => {
  const str = (input || "").replace(/,/g, "").trim();
  if (!str || str === "0") return 0n;
  try {
    const [intPart = "", decPart = ""] = str.split(".");
    return BigInt(intPart + decPart.padEnd(18, "0").substring(0, 18));
  } catch {
    return 0n;
  }
};

function allocationToPlanItem(
  allocation: { assetAddress: string; depositAmount: bigint; mintAmount: bigint },
  candidate: VaultCandidate
): PlanItem {
  const decimals = candidate.assetScale.toString().length - 1;
  const depositAmountUSDWei = (allocation.depositAmount * candidate.oraclePrice) / candidate.assetScale;
  const existingCollateralUSDWei = (candidate.currentCollateral * candidate.oraclePrice) / candidate.assetScale;
  const userBalanceUSDWei = (candidate.potentialCollateral * candidate.oraclePrice) / candidate.assetScale;
  
  return {
    assetAddress: allocation.assetAddress,
    symbol: candidate.symbol,
    depositAmount: formatUnits(allocation.depositAmount, decimals),
    depositAmountUSD: formatUnits(depositAmountUSDWei, 18),
    mintAmount: formatUnits(allocation.mintAmount, 18),
    stabilityFeeRate: convertStabilityFeeRateToAnnualPercentage(candidate.stabilityFeeRate),
    existingCollateralUSD: formatUnits(existingCollateralUSDWei, 18),
    userBalance: formatUnits(candidate.potentialCollateral, decimals),
    userBalanceUSD: formatUnits(userBalanceUSDWei, 18),
  };
}

function convertAllocationsToPlanItems(
  allocations: { assetAddress: string; depositAmount: bigint; mintAmount: bigint }[],
  candidates: VaultCandidate[]
): PlanItem[] {
  return allocations
    .map(allocation => {
      const candidate = candidates.find(c => c.assetAddress === allocation.assetAddress);
      return candidate ? allocationToPlanItem(allocation, candidate) : null;
    })
    .filter((item): item is PlanItem => item !== null)
    .sort((a, b) => a.stabilityFeeRate - b.stabilityFeeRate);
}

// VaultBreakdown Component
const VaultBreakdown: React.FC<{
  allocations: PlanItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ allocations, open, onOpenChange }) => {
  const totalMintAmount = allocations.reduce((sum, a) => sum + parseFloat(a.mintAmount || "0"), 0);
  
  const { transactionCount, totalFees } = allocations.reduce(
    (acc, a) => {
      const hasDeposit = parseFloat(a.depositAmount || "0") > 0;
      const hasMint = parseFloat(a.mintAmount || "0") > 0;
      return {
        transactionCount: acc.transactionCount + (hasDeposit ? 1 : 0) + (hasMint ? 1 : 0),
        totalFees: acc.totalFees + (hasDeposit ? DEPOSIT_FEE_USDST : 0) + (hasMint ? MINT_FEE_USDST : 0),
      };
    },
    { transactionCount: 0, totalFees: 0 }
  );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full flex items-center justify-between p-3 rounded-md bg-muted border border-border hover:bg-muted/80">
          <span className="text-sm font-semibold text-foreground">Vault Breakdown</span>
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 pt-2">
          {allocations.map((allocation) => {
            const depositAmount = parseFloat(allocation.depositAmount);
            const existingCollateralUSD = parseFloat(allocation.existingCollateralUSD);

            return (
              <div key={allocation.assetAddress} className="p-3 rounded-md border border-border bg-card">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-foreground">{allocation.symbol}</p>
                  <Badge variant="outline">{formatPercentage(allocation.stabilityFeeRate)}</Badge>
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>• Balance: {formatUSD(parseFloat(allocation.userBalance), 4)} {allocation.symbol} (${formatUSD(parseFloat(allocation.userBalanceUSD), 2)})</p>
                  {depositAmount > 0 ? (
                    <p>• Add collateral: {formatUSD(depositAmount, 4)} {allocation.symbol} (${formatUSD(parseFloat(allocation.depositAmountUSD))})</p>
                  ) : existingCollateralUSD > 0 ? (
                    <p>• Use existing collateral: ${formatUSD(existingCollateralUSD)}</p>
                  ) : null}
                  <p className="font-semibold text-foreground">• Mint: {formatUSD(parseFloat(allocation.mintAmount), 2)} USDST</p>
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
                  <p className="text-xs text-muted-foreground">Transaction Fees ({transactionCount} {transactionCount === 1 ? "tx" : "txs"})</p>
                  <p className="text-xs font-medium text-muted-foreground">{formatUSD(totalFees, 2)} USDST</p>
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

// Main Component
const MintPlanner: React.FC<{ title?: string; onSuccess?: () => void; refreshTrigger?: number }> = ({
  title = "Mint against collateral (CDP)",
  onSuccess,
  refreshTrigger,
}) => {
  // Core state
  const [mintAmountInput, setMintAmountInput] = useState("");
  const [riskBuffer, setRiskBuffer] = useState(1.5);
  const [isMaxMode, setIsMaxMode] = useState(false);
  const [vaultCandidates, setVaultCandidates] = useState<VaultCandidate[]>([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"quick" | "advanced">("quick");
  const [showProjectedCosts, setShowProjectedCosts] = useState(false);
  const [showVaultBreakdown, setShowVaultBreakdown] = useState(false);

  // Progress modal state
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [currentProgressStep, setCurrentProgressStep] = useState<MintStep>("depositing");
  const [progressTransactions, setProgressTransactions] = useState<Array<{
    symbol: string;
    type: "deposit" | "mint";
    amount: string;
    status: "pending" | "processing" | "completed" | "error";
    hash?: string;
    error?: string;
  }>>([]);
  const [progressError, setProgressError] = useState<string | undefined>();

  // Contexts
  const { fetchAllPrices } = useOracleContext();
  const { toast } = useToast();
  const { userRewards } = useRewardsUserInfo();

  // Data fetching
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
    setLoading(true);
    setError(null);
    fetchAllPrices()
      .catch(() => setError("Could not load CDP data"))
      .finally(() => setLoading(false));
  }, [fetchAllPrices, refreshTrigger]);

  // Derived values
  const mintAmount = useMemo(() => {
    const parsed = parseFloat((mintAmountInput || "").replace(/,/g, ""));
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [mintAmountInput]);

  const mintAmountWei = useMemo(() => parseInputToWei(mintAmountInput), [mintAmountInput]);

  const maxAllocations = useMemo<PlanItem[]>(() => {
    if (vaultCandidates.length === 0) return [];
    try {
      const result = getMaxAllocations(vaultCandidates, riskBuffer);
      return convertAllocationsToPlanItems(result, vaultCandidates);
    } catch {
      return [];
    }
  }, [riskBuffer, vaultCandidates]);

  const { optimalAllocations, debtFloorHit, debtCeilingHit } = useMemo(() => {
    if (isMaxMode) return { optimalAllocations: maxAllocations, debtFloorHit: false, debtCeilingHit: false };
    if (mintAmountWei <= 0n || vaultCandidates.length === 0) return { optimalAllocations: [], debtFloorHit: false, debtCeilingHit: false };
    
    try {
      const result = getOptimalAllocations(mintAmountWei, riskBuffer, vaultCandidates);
      return {
        optimalAllocations: convertAllocationsToPlanItems(result.allocations, vaultCandidates),
        debtFloorHit: result.debtFloorHit,
        debtCeilingHit: result.debtCeilingHit,
      };
    } catch {
      return { optimalAllocations: [], debtFloorHit: false, debtCeilingHit: false };
    }
  }, [mintAmountWei, riskBuffer, vaultCandidates, isMaxMode, maxAllocations]);

  const totalHeadroomWei = useMemo(() => 
    vaultCandidates.length === 0 ? 0n : computeTotalHeadroom(riskBuffer, vaultCandidates),
  [riskBuffer, vaultCandidates]);

  const totalMaxMintWei = useMemo(() => 
    maxAllocations.reduce((sum, a) => sum + parseUnits(a.mintAmount, 18), 0n),
  [maxAllocations]);

  const shouldLockInput = maxAllocations.length === 0 || totalMaxMintWei === 0n;
  const exceedsMaxCollateral = !isMaxMode && mintAmountWei > 0n && mintAmountWei > totalHeadroomWei;

  // MAX mode effects
  useEffect(() => {
    if (isMaxMode && totalMaxMintWei > 0n) {
      const maxMint = formatUnits(totalMaxMintWei, 18).replace(/\.?0+$/, "");
      setMintAmountInput(formatNumberWithCommas(maxMint));
    }
    if (isMaxMode && (maxAllocations.length === 0 || totalMaxMintWei === 0n)) {
      setIsMaxMode(false);
      setMintAmountInput("");
    }
  }, [isMaxMode, totalMaxMintWei, maxAllocations.length]);

  const handleMaxClick = useCallback(() => {
    if (totalMaxMintWei > 0n) {
      const maxMint = formatUnits(totalMaxMintWei, 18).replace(/\.?0+$/, "");
      setMintAmountInput(formatNumberWithCommas(maxMint));
      setIsMaxMode(true);
    }
  }, [totalMaxMintWei]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const cursorPosition = e.target.selectionStart || 0;
    
    if (rawValue === "") {
      setMintAmountInput("");
      setIsMaxMode(false);
      return;
    }
    
    const beforeCursor = rawValue.substring(0, cursorPosition);
    const beforeCursorNoCommas = parseCommaNumber(beforeCursor);
    const parsed = parseCommaNumber(rawValue);
    
    if (parsed === "" || parsed === "." || /^\d*\.?\d*$/.test(parsed)) {
      const formatted = formatNumberWithCommas(parsed);
      setMintAmountInput(formatted);
      
      if (totalMaxMintWei > 0n) {
        const maxMint = formatUnits(totalMaxMintWei, 18).replace(/\.?0+$/, "");
        const normalizedInput = parsed.replace(/\.?0+$/, "");
        setIsMaxMode(normalizedInput === maxMint.replace(/\.?0+$/, ""));
      } else {
        setIsMaxMode(false);
      }
      
      setTimeout(() => {
        const input = e.target;
        if (input) {
          let unformattedPos = 0;
          let formattedPos = 0;
          while (formattedPos < formatted.length && unformattedPos < beforeCursorNoCommas.length) {
            if (formatted[formattedPos] !== ",") unformattedPos++;
            formattedPos++;
          }
          input.setSelectionRange(formattedPos, formattedPos);
        }
      }, 0);
    }
  }, [totalMaxMintWei]);

  // Computed display values
  const supportedAssetsWithBalances = useMemo(() => {
    return vaultCandidates.map((c) => {
      const decimals = c.assetScale.toString().length - 1;
      const priceUSD = parseFloat(formatUnits(c.oraclePrice, 18));
      const depositedAmount = parseFloat(formatUnits(c.currentCollateral, decimals));
      const walletAmount = parseFloat(formatUnits(c.potentialCollateral, decimals));
      
      return {
        assetAddress: c.assetAddress,
        symbol: c.symbol,
        depositedAmount,
        depositedUSD: depositedAmount * priceUSD,
        walletAmount,
        walletUSD: walletAmount * priceUSD,
        totalAmount: depositedAmount + walletAmount,
        totalUSD: (depositedAmount + walletAmount) * priceUSD,
      };
    }).sort((a, b) => b.totalUSD - a.totalUSD);
  }, [vaultCandidates]);

  const weightedAverageAPR = useMemo(() => {
    if (optimalAllocations.length === 0) return 0;
    let totalMint = 0, weightedSum = 0;
    
    for (const a of optimalAllocations) {
      const mint = parseFloat(a.mintAmount);
      if (isFinite(mint) && isFinite(a.stabilityFeeRate) && mint > 0 && a.stabilityFeeRate >= 0) {
        totalMint += mint;
        weightedSum += mint * a.stabilityFeeRate;
      }
    }
    
    const result = totalMint > 0 ? weightedSum / totalMint : 0;
    return isFinite(result) ? result : 0;
  }, [optimalAllocations]);

  const projectedInterestCosts = useMemo(() => {
    if (!isFinite(mintAmount) || mintAmount <= 0 || !isFinite(weightedAverageAPR) || weightedAverageAPR <= 0) {
      return { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
    }
    return {
      daily: getCompoundInterest(mintAmount, weightedAverageAPR, SECONDS_PER_DAY),
      weekly: getCompoundInterest(mintAmount, weightedAverageAPR, SECONDS_PER_WEEK),
      monthly: getCompoundInterest(mintAmount, weightedAverageAPR, SECONDS_PER_MONTH),
      yearly: getCompoundInterest(mintAmount, weightedAverageAPR, SECONDS_PER_YEAR),
    };
  }, [mintAmount, weightedAverageAPR]);

  // Transaction handling
  const handleQuickMint = useCallback(async () => {
    if (mintAmount <= 0 || optimalAllocations.length === 0) return;

    setTransactionLoading(true);
    setProgressModalOpen(true);
    setProgressError(undefined);
    
    try {
      await fetchAllPrices();
      const { existingVaults, potentialVaults } = await cdpService.getVaultCandidates();
      const freshCandidates = [...existingVaults, ...potentialVaults];
      
      let freshAllocations: PlanItem[];
      if (isMaxMode) {
        const maxResult = getMaxAllocations(freshCandidates, riskBuffer);
        freshAllocations = convertAllocationsToPlanItems(maxResult, freshCandidates);
      } else {
        const freshTargetMintUSD = parseUnits(mintAmount.toFixed(18), 18);
        const result = getOptimalAllocations(freshTargetMintUSD, riskBuffer, freshCandidates);
        freshAllocations = convertAllocationsToPlanItems(result.allocations, freshCandidates);
      }

      const transactions: Array<{ type: "deposit" | "mint"; asset: string; amount: string; symbol: string }> = [];
      for (const allocation of freshAllocations) {
        if (parseFloat(allocation.depositAmount || "0") > 0) {
          transactions.push({ type: "deposit", asset: allocation.assetAddress, amount: allocation.depositAmount, symbol: allocation.symbol });
        }
        if (parseFloat(allocation.mintAmount || "0") > 0) {
          transactions.push({ type: "mint", asset: allocation.assetAddress, amount: allocation.mintAmount, symbol: allocation.symbol });
        }
      }

      setProgressTransactions(transactions.map(tx => ({
        symbol: tx.symbol,
        type: tx.type,
        amount: formatUSD(parseFloat(tx.amount), tx.type === "deposit" ? 4 : 2),
        status: "pending" as const,
      })));

      let allSuccessful = true;
      let currentTxIndex = 0;

      // Process deposits
      setCurrentProgressStep("depositing");
      for (const tx of transactions) {
        if (tx.type !== "deposit") continue;

        setProgressTransactions(prev => {
          const updated = [...prev];
          updated[currentTxIndex] = { ...updated[currentTxIndex], status: "processing" };
          return updated;
        });

        try {
          const result = await cdpService.deposit(tx.asset, tx.amount);
          if (result.status.toLowerCase() !== "success") {
            allSuccessful = false;
            setProgressTransactions(prev => {
              const updated = [...prev];
              updated[currentTxIndex] = { ...updated[currentTxIndex], status: "error", error: `Deposit failed: ${result.status}` };
              return updated;
            });
            throw new Error(`Deposit failed for ${tx.symbol}: ${result.status}`);
          }

          setProgressTransactions(prev => {
            const updated = [...prev];
            updated[currentTxIndex] = { ...updated[currentTxIndex], status: "completed", hash: result.hash };
            return updated;
          });
          await fetchAllPrices();
        } catch (err) {
          setProgressError(err instanceof Error ? err.message : "Deposit transaction failed");
          setCurrentProgressStep("error");
          throw err;
        }
        currentTxIndex++;
      }

      // Process mints
      setCurrentProgressStep("minting");
      for (const tx of transactions) {
        if (tx.type !== "mint") continue;

        setProgressTransactions(prev => {
          const updated = [...prev];
          updated[currentTxIndex] = { ...updated[currentTxIndex], status: "processing" };
          return updated;
        });

        try {
          const maxMintResult = await cdpService.getMaxMint(tx.asset);
          const maxMintableWei = BigInt(maxMintResult.maxAmount);
          const plannedMintWei = parseUnits(tx.amount, 18);
          const safeMaxMintableWei = (maxMintableWei * (BPS_SCALE - SAFETY_BUFFER_BPS)) / BPS_SCALE;

          if (plannedMintWei > safeMaxMintableWei) {
            if (safeMaxMintableWei <= 0n) {
              setProgressTransactions(prev => {
                const updated = [...prev];
                updated[currentTxIndex] = { ...updated[currentTxIndex], status: "error", error: "Insufficient collateral after deposits" };
                return updated;
              });
              currentTxIndex++;
              continue;
            }
            tx.amount = formatUnits(safeMaxMintableWei, 18);
          }

          const result = await cdpService.mint(tx.asset, tx.amount);
          if (result.status.toLowerCase() !== "success") {
            allSuccessful = false;
            setProgressTransactions(prev => {
              const updated = [...prev];
              updated[currentTxIndex] = { ...updated[currentTxIndex], status: "error", error: `Mint failed: ${result.status}` };
              return updated;
            });
            throw new Error(`Mint failed for ${tx.symbol}: ${result.status}`);
          }

          setProgressTransactions(prev => {
            const updated = [...prev];
            updated[currentTxIndex] = { ...updated[currentTxIndex], status: "completed", hash: result.hash };
            return updated;
          });
        } catch (err) {
          setProgressError(err instanceof Error ? err.message : "Mint transaction failed");
          setCurrentProgressStep("error");
          throw err;
        }
        currentTxIndex++;
      }

      if (allSuccessful) setCurrentProgressStep("complete");
      await Promise.all([fetchVaultCandidates(), fetchAllPrices()]);
      setMintAmountInput("");
      setIsMaxMode(false);
      if (onSuccess) onSuccess();
    } catch {
      try { await Promise.all([fetchVaultCandidates(), fetchAllPrices()]); } catch { /* silent refetch */ }
    } finally {
      setTransactionLoading(false);
    }
  }, [mintAmount, optimalAllocations, fetchVaultCandidates, fetchAllPrices, onSuccess, riskBuffer, isMaxMode]);

  const getButtonText = () => {
    if (transactionLoading) return "Processing...";
    if (shouldLockInput) return "Insufficient Collateral: Move Risk Slider to the right";
    if (mintAmount <= 0 && !isMaxMode) return "Enter mint amount";
    if (exceedsMaxCollateral) return "Insufficient Collateral: Decrease Mint Amount or move Risk Slider to the right";
    if (optimalAllocations.length === 0 && debtFloorHit) return "Debt Floor: Increase Mint Amount";
    if (optimalAllocations.length === 0 && totalHeadroomWei <= 0n) return "Vaults at Capacity: Move Risk Slider to the right";
    if (optimalAllocations.length === 0) return "No vaults available";
    return isMaxMode ? "Confirm Max Mint" : "Confirm Quick Mint";
  };

  return (
    <>
      <style>{`
        .risk-slider-track { background-color: hsl(var(--secondary)) !important; }
        .risk-slider-range { background-color: var(--risk-slider-color, #10b981) !important; transition: background-color 0.2s ease; }
      `}</style>
      <div className="space-y-6">
        <div className="flex items-center justify-between px-6 pb-4">
          <h1 className="text-2xl font-bold">{title}</h1>
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as "quick" | "advanced")}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
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
                      <button type="button" aria-label="How Quick Mint allocations are determined" className="text-muted-foreground hover:text-foreground transition-colors">
                        <Info className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="w-48 text-sm">
                      Quick Mint finds an optimal collateral allocation by ranking vaults by stability fee and proposing deposit/mint amounts that satisfy your target risk value, constrained by your asset balances.
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
                    onChange={handleInputChange}
                    placeholder="0"
                    inputMode="decimal"
                    className={`pr-20 ${isMaxMode ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800" : ""}`}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    {totalMaxMintWei > 0n && (
                      <Button
                        type="button"
                        variant={isMaxMode ? "default" : "ghost"}
                        size="sm"
                        className={`h-6 px-2 text-xs font-medium ${isMaxMode ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-primary hover:text-primary/80"}`}
                        onClick={handleMaxClick}
                      >
                        MAX
                      </Button>
                    )}
                    <span className="text-muted-foreground text-sm">USDST</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <label className="text-sm font-medium cursor-help">Risk</label>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-sm">
                        Lower value = More Risk
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <span className="text-sm font-semibold" style={{ color: getRiskColor(riskBuffer) }}>
                    {riskBuffer === 1.0 ? "No Buffer" : `${riskBuffer.toFixed(2)}x`}
                  </span>
                </div>
                <div style={{ "--risk-slider-color": getRiskColor(riskBuffer) } as React.CSSProperties}>
                  <Slider
                    value={[3.5 - riskBuffer]}
                    onValueChange={(v) => setRiskBuffer(3.5 - v[0])}
                    min={1}
                    max={2.5}
                    step={0.01}
                    className="w-full risk-slider"
                    trackClassName="risk-slider-track"
                    rangeClassName="risk-slider-range"
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ChevronLeft className="h-3 w-3" />
                    Less Risk
                  </span>
                  <span className="flex items-center gap-1">
                    More Risk
                    <ChevronRight className="h-3 w-3" />
                  </span>
                </div>
              </div>

              <Button
                disabled={(mintAmount <= 0 && !isMaxMode) || optimalAllocations.length === 0 || transactionLoading || exceedsMaxCollateral || shouldLockInput}
                onClick={handleQuickMint}
                className="w-full"
              >
                {getButtonText()}
              </Button>

              <Separator />

              {shouldLockInput ? (
                <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Insufficient Collateral</p>
                  <p className="text-xs text-red-700 dark:text-red-300">
                    Zero USDST can be minted with your current asset balances and selected Risk value. Try moving the Risk Slider to the right to increase headroom.
                  </p>
                </div>
              ) : mintAmount <= 0 && !isMaxMode ? (
                <div className="p-3 rounded-md bg-muted border border-border text-center">
                  <p className="text-sm text-muted-foreground">Enter a mint amount and select a risk value to see your optimal mint plan</p>
                </div>
              ) : exceedsMaxCollateral ? null : optimalAllocations.length > 0 ? (
                <>
                  <VaultBreakdown allocations={optimalAllocations} open={showVaultBreakdown} onOpenChange={setShowVaultBreakdown} />
                  {(debtFloorHit || debtCeilingHit) && (
                    <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                      <p className="text-xs text-amber-800 dark:text-amber-200">
                        ⚠️ One or more vaults have hit a debt {debtFloorHit && debtCeilingHit ? "floor/ceiling" : debtFloorHit ? "floor" : "ceiling"}. Effective mint amount may be lower than requested.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                  <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                    {debtFloorHit ? "Debt floor prevents allocation" : totalHeadroomWei <= 0n ? "Vaults at capacity for current risk value" : "No suitable vaults found"}
                  </p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
                    {debtFloorHit
                      ? "Each vault requires a minimum debt amount. Try increasing your mint amount or use a different vault."
                      : totalHeadroomWei <= 0n
                      ? "Your vaults have reached their borrowing limit at the current risk value. Try moving the Risk Slider to the right to allow more borrowing."
                      : "No vaults are available for minting at this time."}
                  </p>
                  {totalHeadroomWei > 0n && supportedAssetsWithBalances.length > 0 && (
                    <div className="space-y-2 text-xs text-yellow-800 dark:text-yellow-200">
                      {supportedAssetsWithBalances.map((asset) => (
                        <div key={asset.assetAddress} className="space-y-0.5">
                          <div className="flex justify-between font-medium">
                            <span>{asset.symbol} Total:</span>
                            <span>{formatUSD(asset.totalAmount, 4)} {isFinite(asset.totalUSD) ? `($${formatUSD(asset.totalUSD, 2)})` : ""}</span>
                          </div>
                          <div className="flex justify-between text-yellow-700 dark:text-yellow-300 pl-2">
                            <span>Deposited:</span>
                            <span>{formatUSD(asset.depositedAmount, 4)} {isFinite(asset.depositedUSD) ? `($${formatUSD(asset.depositedUSD, 2)})` : ""}</span>
                          </div>
                          <div className="flex justify-between text-yellow-700 dark:text-yellow-300 pl-2">
                            <span>Wallet:</span>
                            <span>{formatUSD(asset.walletAmount, 4)} {isFinite(asset.walletUSD) ? `($${formatUSD(asset.walletUSD, 2)})` : ""}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {mintAmount > 0 && weightedAverageAPR > 0 && (
                <Collapsible open={showProjectedCosts} onOpenChange={setShowProjectedCosts}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full flex items-center justify-between p-3 rounded-md bg-muted border border-border hover:bg-muted/80">
                      <span className="text-sm font-semibold text-foreground">Projected Interest Costs (APR: {formatPercentage(weightedAverageAPR)})</span>
                      <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showProjectedCosts ? "rotate-180" : ""}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="p-3 pt-0 rounded-md bg-muted border border-border border-t-0 rounded-t-none">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2">
                        <div><p className="text-muted-foreground">Daily</p><p className="font-semibold text-foreground">${formatRoundedWithCommas(roundByMagnitude(projectedInterestCosts.daily.toString()))}</p></div>
                        <div><p className="text-muted-foreground">Weekly</p><p className="font-semibold text-foreground">${formatRoundedWithCommas(roundByMagnitude(projectedInterestCosts.weekly.toString()))}</p></div>
                        <div><p className="text-muted-foreground">Monthly</p><p className="font-semibold text-foreground">${formatRoundedWithCommas(roundByMagnitude(projectedInterestCosts.monthly.toString()))}</p></div>
                        <div><p className="text-muted-foreground">Yearly</p><p className="font-semibold text-foreground">${formatRoundedWithCommas(roundByMagnitude(projectedInterestCosts.yearly.toString()))}</p></div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {userRewards && (() => {
                const cdpActivity = userRewards.activities.find((a) => {
                  const name = a.activity.name.toLowerCase();
                  return name.includes("cdp") || name.includes("mint") || (name.includes("borrow") && !name.includes("lending"));
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

        <MintProgressModal
          open={progressModalOpen}
          currentStep={currentProgressStep}
          transactions={progressTransactions}
          error={progressError}
          onClose={() => {
            setProgressModalOpen(false);
            setCurrentProgressStep("depositing");
            setProgressTransactions([]);
            setProgressError(undefined);
          }}
        />
      </div>
    </>
  );
};

export default MintPlanner;
