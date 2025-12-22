import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const MintPlannerAlt: React.FC<{ title?: string; onSuccess?: () => void; refreshTrigger?: number }> = ({
  title = "Mint Maximum Amount",
  onSuccess,
  refreshTrigger,
}) => {
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

  // Calculate max mint amount for current risk factor
  const maxMintWei = useMemo(() => {
    if (vaultCandidates.length === 0) return 0n;
    return computeTotalHeadroom(riskFactor, vaultCandidates);
  }, [riskFactor, vaultCandidates]);

  const maxMintAmount = useMemo(() => {
    if (maxMintWei <= 0n) return 0;
    return parseFloat(formatUnits(maxMintWei, 18));
  }, [maxMintWei]);

  // Get optimal allocations for the max mint amount
  const optimalAllocations = useMemo<OptimalAllocation[]>(() => {
    if (maxMintWei <= 0n || vaultCandidates.length === 0) return [];
    try {
      return getOptimalAllocations(maxMintWei, riskFactor, vaultCandidates);
    } catch {
      return [];
    }
  }, [maxMintWei, riskFactor, vaultCandidates]);

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
    if (maxMintAmount <= 0 || weightedAverageAPR <= 0) {
      return { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
    }
    
    return {
      daily: getCompoundInterest(maxMintAmount, weightedAverageAPR, SECONDS_PER_DAY),
      weekly: getCompoundInterest(maxMintAmount, weightedAverageAPR, SECONDS_PER_WEEK),
      monthly: getCompoundInterest(maxMintAmount, weightedAverageAPR, SECONDS_PER_MONTH),
      yearly: getCompoundInterest(maxMintAmount, weightedAverageAPR, SECONDS_PER_YEAR),
    };
  }, [maxMintAmount, weightedAverageAPR]);

  const handleMint = useCallback(async () => {
    if (maxMintAmount <= 0 || optimalAllocations.length === 0) return;

    setTransactionLoading(true);
    try {
      await fetchAllPrices();
      const { existingVaults, potentialVaults } = await cdpService.getVaultCandidates();
      const freshCandidates = [...existingVaults, ...potentialVaults];
      const freshTargetMintUSD = parseUnits(maxMintAmount.toFixed(18), 18);
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
          title: "Mint Complete",
          description: "All transactions completed successfully",
        });
      }
      await Promise.all([fetchVaultCandidates(), fetchAllPrices()]);
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
  }, [maxMintAmount, optimalAllocations, toast, fetchVaultCandidates, fetchAllPrices, onSuccess, riskFactor]);

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
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Card>
          <CardContent className="space-y-4 pt-6">
            {maxMintAmount > 0 && (
              <div className="p-4 rounded-md bg-muted border border-border">
                <p className="text-sm text-muted-foreground mb-1">Mint Amount</p>
                <p className="text-2xl font-bold text-foreground">
                  {formatUSD(maxMintAmount, 2)} USDST
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Risk Factor</label>
                <span 
                  className="text-sm font-semibold"
                  style={{
                    color: getRiskColor(riskFactor)
                  }}
                >
                  {riskFactor === 1.0 ? "No Buffer" : `${riskFactor.toFixed(1)}x`}
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
                  This value will determine the size of the safety buffer between each vault's target CR and the protocol minimum.
                </span>
              </div>
            </div>

            <Button 
              disabled={maxMintAmount <= 0 || optimalAllocations.length === 0 || transactionLoading} 
              onClick={handleMint}
              className="w-full"
            >
              {transactionLoading
                ? "Processing..."
                : maxMintAmount <= 0 
                ? "No Available Collateral"
                : optimalAllocations.length === 0
                ? "No vaults available"
                : "Confirm Mint"}
            </Button>

            <Separator />

            {maxMintAmount <= 0 ? (
              <div className="p-3 rounded-md bg-muted border border-border text-center">
                <p className="text-sm text-muted-foreground">Adjust the risk factor to see available mint capacity</p>
              </div>
            ) : optimalAllocations.length > 0 ? (
              <VaultBreakdown
                allocations={optimalAllocations}
                open={showVaultBreakdown}
                onOpenChange={setShowVaultBreakdown}
              />
            ) : (
              <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">No suitable vaults found.</p>
              </div>
            )}

            {maxMintAmount > 0 && weightedAverageAPR > 0 && (
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
                  key={maxMintAmount}
                  userRewards={userRewards}
                  activityName={cdpActivity.activity.name}
                  inputAmount={maxMintAmount > 0 ? maxMintAmount.toString() : undefined}
                  actionLabel="Mint"
                />
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default MintPlannerAlt;
