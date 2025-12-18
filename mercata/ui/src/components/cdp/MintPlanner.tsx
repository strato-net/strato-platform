import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { ChevronDown } from "lucide-react";
import { useOracleContext } from "@/context/OracleContext";
import { cdpService, VaultCandidate } from "@/services/cdpService";
import { getOptimalAllocations, computeTotalHeadroom } from "@/services/mintPlanService";
import {
  SECONDS_PER_DAY,
  SECONDS_PER_WEEK,
  SECONDS_PER_MONTH,
  SECONDS_PER_YEAR,
  getCompoundInterest,
} from "@/services/cdpUtils";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { CompactRewardsDisplay } from "@/components/rewards/CompactRewardsDisplay";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import MintWidget from "./MintWidget";

type OptimalAllocation = ReturnType<typeof getOptimalAllocations>[number];

const formatUSD = (value: number, decimals = 2) =>
  isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "0.00";
const formatPercentage = (num: number, decimals: number = 2): string => {
  if (isNaN(num)) return '0.00%';
  return num.toFixed(decimals) + '%';
};


const VaultBreakdown: React.FC<{
  allocations: OptimalAllocation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ allocations, open, onOpenChange }) => {
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
  const [riskFactor, setRiskFactor] = useState<number>(1.5);

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
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  const optimalAllocations = useMemo<OptimalAllocation[]>(() => {
    if (mintAmountWei <= 0n || vaultCandidates.length === 0) return [];
    try {
      return getOptimalAllocations(mintAmountWei, riskFactor, vaultCandidates);
    } catch {
      return [];
    }
  }, [mintAmountWei, riskFactor, vaultCandidates]);

  const totalHeadroomWei = useMemo(() => {
    if (vaultCandidates.length === 0) return 0n;
    return computeTotalHeadroom(riskFactor, vaultCandidates);
  }, [riskFactor, vaultCandidates]);

  const exceedsMaxCollateral = mintAmountWei > 0n && mintAmountWei > totalHeadroomWei;

  const supportedAssetsWithBalances = useMemo(() => {
    return vaultCandidates.map((c) => {
      const balance = parseFloat(formatUnits(BigInt(c.userNonCollateralBalance || "0"), c.collateralAmountDecimals));
      const priceUSD = parseFloat(formatUnits(BigInt(c.oraclePrice || "0"), 18));
      return {
        assetAddress: c.assetAddress,
        symbol: c.symbol,
        balance,
        balanceUSD: balance * priceUSD,
      };
    }).sort((a, b) => b.balanceUSD - a.balanceUSD);
  }, [vaultCandidates]);

  const weightedAverageAPR = useMemo(() => {
    if (optimalAllocations.length === 0) return 0;
    
    let totalMintAmount = 0;
    let weightedSum = 0;
    
    for (const allocation of optimalAllocations) {
      const mintAmount = parseFloat(allocation.mintAmount);
      if (mintAmount > 0) {
        totalMintAmount += mintAmount;
        weightedSum += mintAmount * allocation.stabilityFeeRate;
      }
    }
    
    return totalMintAmount > 0 ? weightedSum / totalMintAmount : 0;
  }, [optimalAllocations]);

  const projectedInterestCosts = useMemo(() => {
    if (mintAmount <= 0 || weightedAverageAPR <= 0) {
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
      const freshAllocations = getOptimalAllocations(
        freshTargetMintUSD,
        riskFactor,
        freshCandidates
      );

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
      await Promise.all([fetchVaultCandidates(), fetchAllPrices()]);
      setMintAmountInput("");
      if (onSuccess) onSuccess();
    } catch (error) {
      toast({
        title: "Transaction Failed",
        description: error instanceof Error ? error.message : "Transaction failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setTransactionLoading(false);
    }
  }, [mintAmount, optimalAllocations, toast, fetchVaultCandidates, fetchAllPrices, onSuccess, riskFactor]);

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
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? "Show Quick Mint" : "Show Advanced"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!showAdvanced && (
        <Card>
          <CardHeader>
            <CardTitle>Quick Mint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Mint Amount (USDST)</label>
              <div className="relative">
                <Input
                  value={mintAmountInput}
                  onChange={(e) => setMintAmountInput(e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  className="pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">USDST</span>
              </div>
              <div className="h-2"></div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Risk Factor</label>
                <span 
                  className="text-sm font-semibold"
                  style={{
                    color: getRiskColor(riskFactor)
                  }}
                >
                  {riskFactor.toFixed(1)}x
                </span>
              </div>
              <div className="relative w-full">
                <div style={{ '--risk-slider-color': getRiskColor(riskFactor) } as React.CSSProperties}>
                  <Slider
                    value={[3.5 - riskFactor]}
                    onValueChange={(value) => setRiskFactor(3.5 - value[0])}
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
                  Mint up to each vault's minCR × {riskFactor.toFixed(1)}
                </span>
              </div>
            </div>

            <Button 
              disabled={mintAmount <= 0 || optimalAllocations.length === 0 || transactionLoading || exceedsMaxCollateral} 
              onClick={handleQuickMint}
              className="w-full"
            >
              {transactionLoading
                ? "Processing..."
                : mintAmount <= 0 
                ? "Enter mint amount"
                : exceedsMaxCollateral
                ? "Insufficient Collateral: Decrease Mint Amount or Risk Factor"
                : optimalAllocations.length === 0
                ? "No vaults available"
                : "Confirm Quick Mint"}
            </Button>

            <Separator />

            {mintAmount <= 0 ? (
              <div className="p-3 rounded-md bg-muted border border-border text-center">
                <p className="text-sm text-muted-foreground">Enter a mint amount and select risk level to see the automated plan</p>
              </div>
            ) : exceedsMaxCollateral ? null : optimalAllocations.length > 0 ? (
              <VaultBreakdown
                allocations={optimalAllocations}
                open={showVaultBreakdown}
                onOpenChange={setShowVaultBreakdown}
              />
            ) : (
              <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">No suitable vaults found.</p>
                <div className="space-y-1 text-xs text-yellow-800 dark:text-yellow-200">
                  {supportedAssetsWithBalances.length > 0 ? (
                    supportedAssetsWithBalances.map((asset) => (
                      <div key={asset.assetAddress} className="flex justify-between">
                        <span>{asset.symbol}:</span>
                        <span className="font-medium">
                          {formatUSD(asset.balance, 4)} {isFinite(asset.balanceUSD) ? `(${formatUSD(asset.balanceUSD, 2)})` : ""}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-yellow-700 dark:text-yellow-300">No supported assets available</p>
                  )}
                </div>
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
                        <p className="font-semibold text-foreground">${formatUSD(projectedInterestCosts.daily, 4)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Weekly</p>
                        <p className="font-semibold text-foreground">${formatUSD(projectedInterestCosts.weekly, 4)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Monthly</p>
                        <p className="font-semibold text-foreground">${formatUSD(projectedInterestCosts.monthly, 2)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Yearly</p>
                        <p className="font-semibold text-foreground">${formatUSD(projectedInterestCosts.yearly, 2)}</p>
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

      {showAdvanced && (
        <div className="border border-border bg-card rounded-xl p-4">
          <MintWidget onSuccess={onSuccess} title={title} />
        </div>
      )}
    </div>
    </>
  );
};

export default MintPlanner;
