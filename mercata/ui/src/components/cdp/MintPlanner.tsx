import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCDP } from "@/context/CDPContext";
import { useOracleContext } from "@/context/OracleContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { cdpService, AssetConfig, VaultData } from "@/services/cdpService";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import {
  USE_DUMMY_DATA,
  dummyVaults,
  dummyAssets,
  dummyPrices,
  dummyActiveTokens,
} from "./dummyData";

type Allocation = {
  vault: AssetConfig & { address: string; symbol: string };
  borrowAmount: number;
  crAfter: number;
  type: "existing" | "new";
  requiredCollateralUSD?: number;
  requiredCollateralTokens?: number;
  collateralInVaultUSD?: number;
  collateralInVaultTokens?: number;
  stabilityFee?: number;
};

const formatUSD = (value: number, decimals = 2) =>
  isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "0.00";

// Format percentage with reasonable precision (matches MintWidget)
const formatPercentage = (num: number, decimals: number = 2): string => {
  if (isNaN(num)) return '0.00%';
  return num.toFixed(decimals) + '%';
};

// Constants for exponential interest calculations (matches contract)
const RAY = BigInt(10) ** BigInt(27);
const SECONDS_PER_DAY = 86400n;
const SECONDS_PER_WEEK = 604800n;
const SECONDS_PER_MONTH = 2592000n; // 30 days
const SECONDS_PER_YEAR = 31536000n; // 365 days

// Fixed-point exponentiation (matches contract's _rpow)
const rpow = (x: bigint, n: bigint, ray: bigint = RAY): bigint => {
  let z = n % 2n !== 0n ? x : ray;
  let xCopy = x;
  let nCopy = n;
  for (nCopy = nCopy / 2n; nCopy !== 0n; nCopy = nCopy / 2n) {
    xCopy = (xCopy * xCopy) / ray;
    if (nCopy % 2n !== 0n) {
      z = (z * xCopy) / ray;
    }
  }
  return z;
};

// Convert annual percentage (e.g., 2.8 for 2.8% APR) to per-second RAY rate
const convertAnnualPercentageToPerSecondRate = (annualPercentage: number): bigint => {
  // Target: (1 + annualPercentage/100) = (1 + rate)^secondsPerYear
  // So: rate = (1 + annualPercentage/100)^(1/secondsPerYear) - 1
  // In RAY: targetFactor = RAY + (annualPercentage/100) * RAY
  const targetAnnualFactorRay = RAY + BigInt(Math.floor((annualPercentage / 100) * Number(RAY)));
  
  // Binary search for per-second rate
  let low = RAY;
  let high = RAY + (RAY / 100n);
  
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2n;
    const result = rpow(mid, SECONDS_PER_YEAR);
    
    if (result < targetAnnualFactorRay) {
      low = mid;
    } else {
      high = mid;
    }
    
    if (high - low <= 1n) {
      break;
    }
  }
  
  const lowResult = rpow(low, SECONDS_PER_YEAR);
  const highResult = rpow(high, SECONDS_PER_YEAR);
  const lowDiff = lowResult > targetAnnualFactorRay ? lowResult - targetAnnualFactorRay : targetAnnualFactorRay - lowResult;
  const highDiff = highResult > targetAnnualFactorRay ? highResult - targetAnnualFactorRay : targetAnnualFactorRay - highResult;
  
  return lowDiff < highDiff ? low : high;
};

// Calculate compound interest (matches contract's per-second compounding)
const getCompoundInterest = (
  debtUSD: number,
  annualPercentage: number,
  seconds: bigint
): number => {
  if (debtUSD <= 0 || annualPercentage <= 0) return 0;
  
  const debtWei = parseUnits(debtUSD.toFixed(18), 18);
  const perSecondRate = convertAnnualPercentageToPerSecondRate(annualPercentage);
  const factor = rpow(perSecondRate, seconds);
  const interestWei = (debtWei * (factor - RAY)) / RAY;
  
  return parseFloat(formatUnits(interestWei, 18));
};

const MintPlanner: React.FC<{ title?: string; onSuccess?: () => void }> = ({
  title = "Borrow against collateral (CDP)",
}) => {
  const [borrowAmountInput, setBorrowAmountInput] = useState<string>("");
  const [targetCR, setTargetCR] = useState<number>(215);
  const [assets, setAssets] = useState<AssetConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositInputs, setDepositInputs] = useState<Record<string, string>>({});
  const [selectedVaults, setSelectedVaults] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showProjectedCosts, setShowProjectedCosts] = useState(false);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const { vaults: realVaults, refreshVaults } = useCDP();
  const { prices: realPrices, fetchAllPrices } = useOracleContext();
  const { activeTokens: realActiveTokens } = useUserTokens();
  const { toast } = useToast();

  // Use dummy data if enabled, otherwise use real data
  const vaults = USE_DUMMY_DATA ? dummyVaults : realVaults;
  const prices = USE_DUMMY_DATA ? dummyPrices : realPrices;
  const activeTokens = USE_DUMMY_DATA ? dummyActiveTokens : realActiveTokens;

  useEffect(() => {
    const loadData = async () => {
      if (USE_DUMMY_DATA) {
        setAssets(dummyAssets);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [assetConfigs] = await Promise.all([
          cdpService.getAssets(true),
          fetchAllPrices(),
        ]);
        setAssets(assetConfigs || []);
      } catch (e) {
        setError("Could not load CDP data");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchAllPrices]);

  const priceForAsset = useCallback((assetAddress: string, fallbackVault?: VaultData) => {
    const oraclePrice = prices[assetAddress?.toLowerCase() || ""];
    if (oraclePrice) {
      try {
        return parseFloat(formatUnits(BigInt(oraclePrice), 18));
      } catch {
        // ignore
      }
    }
    if (fallbackVault) {
      try {
        const collateralTokens = parseFloat(formatUnits(BigInt(fallbackVault.collateralAmount || "0"), fallbackVault.collateralAmountDecimals || 18));
        const collateralUSD = parseFloat(formatUnits(BigInt(fallbackVault.collateralValueUSD || "0"), 18));
        if (collateralTokens > 0) {
          return collateralUSD / collateralTokens;
        }
      } catch {
        // ignore
      }
    }
    return 0;
  }, [prices]);

  const borrowAmount = useMemo(() => {
    const parsed = parseFloat((borrowAmountInput || "").replace(/,/g, ""));
    if (!isFinite(parsed) || parsed <= 0) return 0;
    return parsed;
  }, [borrowAmountInput]);

  const assetSummaries = useMemo(() => {
    const tokensByAddress = activeTokens.reduce<
      Record<string, { symbol: string; balance: string; decimals?: number }>
    >((acc, t) => {
      if (t.address)
        acc[t.address.toLowerCase()] = {
          symbol: t.symbol || t.name || "Asset",
          balance: t.balance || "0",
          decimals: (t as { decimals?: number })?.decimals,
        };
      return acc;
    }, {});

    const assetByAddress = assets.reduce<Record<string, AssetConfig>>((acc, a) => {
      acc[a.asset.toLowerCase()] = a;
      return acc;
    }, {});

    return vaults
      .map((v) => {
        const config = assetByAddress[v.asset.toLowerCase()];
        const tokenInfo = tokensByAddress[v.asset.toLowerCase()];
        const decimals = v.collateralAmountDecimals || tokenInfo?.decimals || 18;
        const priceUSD = priceForAsset(v.asset, v);
        const existingCollateralTokens = parseFloat(formatUnits(BigInt(v.collateralAmount || "0"), decimals));
        const existingCollateralUSD = parseFloat(formatUnits(BigInt(v.collateralValueUSD || "0"), 18));
        const debtUSD = parseFloat(formatUnits(BigInt(v.debtValueUSD || "0"), 18));
        const balanceTokens = tokenInfo ? parseFloat(formatUnits(BigInt(tokenInfo.balance || "0"), decimals)) : 0;
        return {
          address: v.asset,
          symbol: config?.symbol || v.symbol || tokenInfo?.symbol || "Asset",
          stabilityFee: config?.stabilityFeeRate,
          priceUSD,
          existingCollateralTokens,
          existingCollateralUSD,
          debtUSD,
          balanceTokens,
          decimals,
        };
      })
      // add supported assets user holds but no vault yet
      .concat(
        assets
          .filter((a) => !vaults.find((v) => v.asset.toLowerCase() === a.asset.toLowerCase()))
          .map((a) => {
            const tokenInfo = tokensByAddress[a.asset.toLowerCase()];
            const decimals = tokenInfo?.decimals || 18;
            const priceUSD = priceForAsset(a.asset);
            const balanceTokens = tokenInfo ? parseFloat(formatUnits(BigInt(tokenInfo.balance || "0"), decimals)) : 0;
            return {
              address: a.asset,
              symbol: a.symbol || tokenInfo?.symbol || "Asset",
              stabilityFee: a.stabilityFeeRate,
              priceUSD,
              existingCollateralTokens: 0,
              existingCollateralUSD: 0,
              debtUSD: 0,
              balanceTokens,
              decimals,
            };
          })
      )
      .filter((a) => a.priceUSD > 0 && (a.balanceTokens > 0 || a.existingCollateralTokens > 0));
  }, [activeTokens, assets, priceForAsset, vaults]);

  const plan = useMemo(() => {
    if (borrowAmount <= 0 || targetCR <= 0 || assets.length === 0) {
      return { allocations: [] as Allocation[], newVault: null as Allocation | null, projectedCR: 0, remaining: borrowAmount };
    }

    let remaining = borrowAmount;
    const allocations: Allocation[] = [];

    const assetByAddress = assets.reduce<Record<string, AssetConfig>>((acc, a) => {
      acc[a.asset.toLowerCase()] = a;
      return acc;
    }, {});

    const sortableVaults = vaults
      .filter((v) => {
        try {
          return BigInt(v.collateralAmount || "0") > 0n;
        } catch {
          return false;
        }
      })
      .map((v) => {
        const config = assetByAddress[v.asset.toLowerCase()];
        return { vault: v, config };
      })
      .filter((v) => v.config)
      .sort((a, b) => (a.config!.stabilityFeeRate || 0) - (b.config!.stabilityFeeRate || 0));

    sortableVaults.forEach(({ vault, config }) => {
      const collateralUSD = parseFloat(formatUnits(BigInt(vault.collateralValueUSD || "0"), 18));
      const debtUSD = parseFloat(formatUnits(BigInt(vault.debtValueUSD || "0"), 18));
      const maxBorrowAtTarget = Math.max(0, (collateralUSD * 100) / targetCR - debtUSD);
      if (maxBorrowAtTarget <= 0 || remaining <= 0) return;

      const borrowHere = Math.min(maxBorrowAtTarget, remaining);
      if (borrowHere > 0) {
        const totalDebt = debtUSD + borrowHere;
        const crAfter = totalDebt > 0 ? (collateralUSD / totalDebt) * 100 : targetCR;
        const collateralTokens = parseFloat(formatUnits(BigInt(vault.collateralAmount || "0"), vault.collateralAmountDecimals || 18));
        const priceUSD = priceForAsset(vault.asset, vault);
        allocations.push({
          vault: { ...config!, address: vault.asset, symbol: config?.symbol || vault.symbol || "Asset" },
          borrowAmount: borrowHere,
          crAfter,
          type: "existing",
          collateralInVaultUSD: collateralUSD,
          collateralInVaultTokens: collateralTokens,
          stabilityFee: config?.stabilityFeeRate,
        });
        remaining = Math.max(0, remaining - borrowHere);
      }
    });

    let newVault: Allocation | null = null;
    if (remaining > 0) {
      const tokensByAddress = activeTokens.reduce<Record<string, { symbol: string; balance: string }>>((acc, t) => {
        if (t.address) acc[t.address.toLowerCase()] = { symbol: t.symbol || t.name || "Asset", balance: t.balance || "0" };
        return acc;
      }, {});

      const scoredAssets = assets
        .map((a) => {
          const hasBalance = tokensByAddress[a.asset.toLowerCase()];
          const balanceTokens = hasBalance ? parseFloat(formatUnits(BigInt(hasBalance.balance || "0"), 18)) : 0;
          const priceUSD = priceForAsset(a.asset);
          return {
            config: a,
            hasBalance,
            balanceTokens,
            priceUSD,
            fee: a.stabilityFeeRate ?? 0,
          };
        })
        // prefer assets the user holds, then lowest fee
        .sort((a, b) => {
          if (!!b.hasBalance !== !!a.hasBalance) return b.hasBalance ? 1 : -1;
          return a.fee - b.fee;
        });

      const choice = scoredAssets[0];
      if (choice?.config) {
        const priceUSD = choice.priceUSD || 0;
        const requiredCollateralUSD = (remaining * targetCR) / 100;
        const requiredCollateralTokens = priceUSD > 0 ? requiredCollateralUSD / priceUSD : 0;
        newVault = {
          vault: { ...choice.config, address: choice.config.asset || "", symbol: choice.config.symbol || "Asset" },
          borrowAmount: remaining,
          crAfter: targetCR,
          type: "new",
          requiredCollateralUSD,
          requiredCollateralTokens,
          stabilityFee: choice.config.stabilityFeeRate,
        };
        remaining = 0;
      }
    }

    const totalDebt = allocations.reduce((sum, a) => sum + a.borrowAmount, 0) + (newVault?.borrowAmount || 0);
    const totalCollateralUSD =
      allocations.reduce((sum, a) => sum + (a.collateralInVaultUSD || 0), 0) + (newVault?.requiredCollateralUSD || 0);
    const projectedCR = totalDebt > 0 ? (totalCollateralUSD / totalDebt) * 100 : 0;

    return { allocations, newVault, projectedCR, remaining };
  }, [assets, borrowAmount, targetCR, vaults, activeTokens, priceForAsset]);

  const requiredCollateralUSD = useMemo(() => {
    if (borrowAmount <= 0) return 0;
    return (borrowAmount * targetCR) / 100;
  }, [borrowAmount, targetCR]);

  const existingCollateralUSD = useMemo(() => {
    return assetSummaries
      .filter((a) => selectedVaults.has(a.address))
      .reduce((sum, a) => sum + (a.existingCollateralUSD || 0), 0);
  }, [assetSummaries, selectedVaults]);

  const depositTotals = useMemo(() => {
    return assetSummaries
      .filter((a) => selectedVaults.has(a.address))
      .reduce(
        (acc, a) => {
          const raw = depositInputs[a.address] || "0";
          const valTokens = parseFloat(raw.replace(/,/g, ""));
          const depositTokens = isFinite(valTokens) && valTokens > 0 ? valTokens : 0;
          const depositUSD = depositTokens * (a.priceUSD || 0);
          acc.depositUSD += depositUSD;
          acc.depositTokensByAsset[a.address] = depositTokens;
          return acc;
        },
        { depositUSD: 0, depositTokensByAsset: {} as Record<string, number> }
      );
  }, [assetSummaries, depositInputs, selectedVaults]);

  const projectedCR = useMemo(() => {
    if (borrowAmount <= 0) return 0;
    const totalCollateralUSD = existingCollateralUSD + depositTotals.depositUSD;
    return borrowAmount > 0 ? (totalCollateralUSD / borrowAmount) * 100 : 0;
  }, [borrowAmount, depositTotals.depositUSD, existingCollateralUSD]);

  const collateralGapUSD = Math.max(0, requiredCollateralUSD - (existingCollateralUSD + depositTotals.depositUSD));

  // Calculate weighted average APR based on selected vaults (matches MintWidget approach)
  const weightedAverageAPR = useMemo(() => {
    if (selectedVaults.size === 0) return 0;
    
    // Get the first selected asset's stability fee rate (matching MintWidget's approach)
    // MintWidget uses: depositAsset?.stabilityFeeRate || 5.54
    const selectedAssets = assetSummaries.filter((a) => selectedVaults.has(a.address));
    if (selectedAssets.length === 0) return 0;
    
    // Use the first selected asset's stability fee rate, with fallback
    const firstAsset = selectedAssets[0];
    return firstAsset?.stabilityFee || 0;
  }, [assetSummaries, selectedVaults]);

  // Calculate projected interest costs using exponential compounding
  const projectedInterestCosts = useMemo(() => {
    if (borrowAmount <= 0 || weightedAverageAPR <= 0) {
      return { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
    }
    
    return {
      daily: getCompoundInterest(borrowAmount, weightedAverageAPR, SECONDS_PER_DAY),
      weekly: getCompoundInterest(borrowAmount, weightedAverageAPR, SECONDS_PER_WEEK),
      monthly: getCompoundInterest(borrowAmount, weightedAverageAPR, SECONDS_PER_MONTH),
      yearly: getCompoundInterest(borrowAmount, weightedAverageAPR, SECONDS_PER_YEAR),
    };
  }, [borrowAmount, weightedAverageAPR]);

  // Calculate total existing collateral from all vaults (for quick borrow planning)
  const totalExistingCollateralUSD = useMemo(() => {
    return assetSummaries.reduce((sum, a) => sum + (a.existingCollateralUSD || 0), 0);
  }, [assetSummaries]);

  // Auto-select optimal vaults and calculate deposits for Quick Borrow
  // Algorithm: Prioritize lowest stability fee rate, allocate borrow amount per vault,
  // add deposits until target CR is reached, then move to next vault
  const quickBorrowPlan = useMemo(() => {
    if (borrowAmount <= 0 || targetCR <= 0 || assetSummaries.length === 0) {
      return { selectedVaults: new Set<string>(), autoDeposits: {} };
    }

    // Sort assets by lowest stability fee rate first
    const sortedAssets = [...assetSummaries].sort((a, b) => {
      const feeA = a.stabilityFee || 999;
      const feeB = b.stabilityFee || 999;
      return feeA - feeB;
    });

    const autoSelected = new Set<string>();
    const autoDeposits: Record<string, string> = {};
    let remainingBorrowAmount = borrowAmount;

    // Allocate borrow amount across vaults, prioritizing lowest fee
    for (const asset of sortedAssets) {
      if (remainingBorrowAmount <= 0) break;

      const priceUSD = asset.priceUSD || 0;
      if (priceUSD <= 0) continue;

      const existingCollateralUSD = asset.existingCollateralUSD || 0;
      const existingDebtUSD = asset.debtUSD || 0;
      const balanceTokens = asset.balanceTokens || 0;

      // Try to allocate as much borrow amount as possible to this vault
      // Start by checking what we can borrow with existing collateral
      let borrowAllocation = 0;
      let depositTokens = 0;

      if (existingCollateralUSD > 0) {
        // Calculate max borrow with existing collateral at target CR
        const maxBorrowWithExisting = Math.max(0, (existingCollateralUSD * 100) / targetCR - existingDebtUSD);
        borrowAllocation = Math.min(remainingBorrowAmount, maxBorrowWithExisting);
      }

      // If we allocated some borrow amount, check if we need more collateral
      // If we didn't allocate (or allocated less than remaining), try adding deposits
      if (borrowAllocation < remainingBorrowAmount && balanceTokens > 0) {
        // Calculate required collateral for remaining borrow amount
        const totalDebtIfAllRemaining = existingDebtUSD + remainingBorrowAmount;
        const requiredCollateralForAllRemaining = (totalDebtIfAllRemaining * targetCR) / 100;
        const additionalCollateralNeeded = Math.max(0, requiredCollateralForAllRemaining - existingCollateralUSD);

        // Try to add deposits to meet the requirement
        if (additionalCollateralNeeded > 0) {
          const maxDepositUSD = balanceTokens * priceUSD;
          const depositUSD = Math.min(maxDepositUSD, additionalCollateralNeeded);
          depositTokens = depositUSD / priceUSD;

          if (depositTokens > 0) {
            // Recalculate how much we can borrow with existing + new deposits
            const totalCollateralAfter = existingCollateralUSD + depositUSD;
            const maxBorrowWithDeposits = Math.max(0, (totalCollateralAfter * 100) / targetCR - existingDebtUSD);
            borrowAllocation = Math.min(remainingBorrowAmount, maxBorrowWithDeposits);
          }
        }
      }

      // If we can borrow something from this vault, use it
      if (borrowAllocation > 0) {
        autoSelected.add(asset.address);
        remainingBorrowAmount -= borrowAllocation;

        // Recalculate exact deposit needed for the final borrow allocation
        const finalTotalDebt = existingDebtUSD + borrowAllocation;
        const finalRequiredCollateral = (finalTotalDebt * targetCR) / 100;
        const finalAdditionalNeeded = Math.max(0, finalRequiredCollateral - existingCollateralUSD);

        if (finalAdditionalNeeded > 0 && balanceTokens > 0) {
          const finalDepositUSD = Math.min(balanceTokens * priceUSD, finalAdditionalNeeded);
          const finalDepositTokens = finalDepositUSD / priceUSD;
          if (finalDepositTokens > 0) {
            autoDeposits[asset.address] = finalDepositTokens.toFixed(6);
          }
        }
        // If no additional collateral needed, vault is selected but no deposit
      }
    }

    return { selectedVaults: autoSelected, autoDeposits };
  }, [borrowAmount, targetCR, assetSummaries]);

  // Apply quick borrow plan when in quick mode
  useEffect(() => {
    if (!showAdvanced && borrowAmount > 0 && targetCR > 0) {
      setSelectedVaults(quickBorrowPlan.selectedVaults);
      setDepositInputs(quickBorrowPlan.autoDeposits);
    }
  }, [showAdvanced, borrowAmount, targetCR, quickBorrowPlan]);

  const toggleVaultSelection = (address: string) => {
    setSelectedVaults((prev) => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  };

  // Handle Quick Borrow confirmation - execute deposits and mints
  const handleQuickBorrow = useCallback(async () => {
    if (borrowAmount <= 0 || selectedVaults.size === 0) return;

    setTransactionLoading(true);
    try {
      // Calculate borrow allocations per vault (same logic as display)
      const vaultCollaterals = assetSummaries
        .filter((a) => selectedVaults.has(a.address))
        .map((asset) => {
          const depositAmount = parseFloat(depositInputs[asset.address] || "0");
          const depositUSD = depositAmount * (asset.priceUSD || 0);
          const totalCollateralUSD = (asset.existingCollateralUSD || 0) + depositUSD;
          return { asset, totalCollateralUSD, depositAmount, depositUSD };
        });

      const totalCollateralAllVaults = vaultCollaterals.reduce(
        (sum, v) => sum + v.totalCollateralUSD,
        0
      );

      const transactions: Array<{ type: "deposit" | "mint"; asset: string; amount: string; symbol: string }> = [];

      // Prepare transactions: deposits first, then mints
      for (const { asset, totalCollateralUSD, depositAmount } of vaultCollaterals) {
        // Add deposit transaction if needed
        if (depositAmount > 0) {
          transactions.push({
            type: "deposit",
            asset: asset.address,
            amount: depositAmount.toString(),
            symbol: asset.symbol,
          });
        }

        // Calculate borrow allocation for this vault (proportional to collateral)
        const borrowAllocation =
          totalCollateralAllVaults > 0
            ? (totalCollateralUSD / totalCollateralAllVaults) * borrowAmount
            : 0;

        // Add mint transaction if there's a borrow allocation
        if (borrowAllocation > 0) {
          transactions.push({
            type: "mint",
            asset: asset.address,
            amount: borrowAllocation.toString(),
            symbol: asset.symbol,
          });
        }
      }

      // Execute transactions sequentially
      const results: string[] = [];
      let lastTxHash = "";
      for (const tx of transactions) {
        let result;
        if (tx.type === "deposit") {
          result = await cdpService.deposit(tx.asset, tx.amount);
          if (result.status.toLowerCase() !== "success") {
            throw new Error(`Deposit failed for ${tx.symbol}: ${result.status}`);
          }
          results.push(`Deposited ${formatUSD(parseFloat(tx.amount), 4)} ${tx.symbol}`);
          lastTxHash = result.hash;
        } else {
          result = await cdpService.mint(tx.asset, tx.amount);
          if (result.status.toLowerCase() !== "success") {
            throw new Error(`Mint failed for ${tx.symbol}: ${result.status}`);
          }
          results.push(`Borrowed ${formatUSD(parseFloat(tx.amount), 2)} USDST from ${tx.symbol}`);
          lastTxHash = result.hash;
        }
      }

      // Show success toast
      toast({
        title: "Quick Borrow Successful",
        description: `${results.join(". ")}. Tx: ${lastTxHash}`,
      });

      // Refresh vault data
      await refreshVaults();
      await fetchAllPrices();

      // Reset form
      setBorrowAmountInput("");
      setDepositInputs({});
      setSelectedVaults(new Set());
    } catch (error) {
      console.error("Quick Borrow failed:", error);
      const errorMessage = error instanceof Error ? error.message : "Transaction failed. Please try again.";
      toast({
        title: "Transaction Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setTransactionLoading(false);
    }
  }, [borrowAmount, selectedVaults, assetSummaries, depositInputs, toast, refreshVaults, fetchAllPrices]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Quick Borrow Section - hidden when Advanced is shown */}
      {!showAdvanced && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Quick Borrow</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                Advanced
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Borrow Amount Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Borrow Amount (USDST)</label>
              <div className="relative">
                <Input
                  value={borrowAmountInput}
                  onChange={(e) => setBorrowAmountInput(e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  className="pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">USDST</span>
              </div>
              <div className="h-2"></div>
            </div>

            {/* Target CR Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Risk (CR)</label>
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span>Higher CR → safer, needs more collateral</span>
                <span className="font-semibold">{targetCR}% CR</span>
              </div>
              <Slider
                value={[targetCR]}
                min={150}
                max={400}
                step={5}
                onValueChange={([v]) => setTargetCR(v)}
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>150%</span>
                <span>215% (example)</span>
                <span>400%</span>
              </div>
            </div>

            <Separator />

            {borrowAmount <= 0 ? (
              <div className="p-3 rounded-md bg-gray-50 border border-gray-200 text-center">
                <p className="text-sm text-gray-600">Enter a borrow amount and select target CR to see the automated plan</p>
              </div>
            ) : selectedVaults.size > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">
                    Vault Breakdown
                    {weightedAverageAPR > 0 && ` • APR: ${formatPercentage(weightedAverageAPR)}`}
                  </p>
                </div>
                <div className="space-y-2">
                  {(() => {
                    // Calculate total collateral per vault (existing + new deposits)
                    const vaultCollaterals = assetSummaries
                      .filter((a) => selectedVaults.has(a.address))
                      .map((asset) => {
                        const depositAmount = parseFloat(depositInputs[asset.address] || "0");
                        const depositUSD = depositAmount * (asset.priceUSD || 0);
                        const totalCollateralUSD = (asset.existingCollateralUSD || 0) + depositUSD;
                        return { asset, totalCollateralUSD, depositAmount, depositUSD };
                      });

                    // Calculate total collateral across all selected vaults
                    const totalCollateralAllVaults = vaultCollaterals.reduce(
                      (sum, v) => sum + v.totalCollateralUSD,
                      0
                    );

                    // Allocate borrow amount proportionally based on collateral
                    return vaultCollaterals.map(({ asset, totalCollateralUSD, depositAmount, depositUSD }) => {
                      const borrowAllocation =
                        totalCollateralAllVaults > 0
                          ? (totalCollateralUSD / totalCollateralAllVaults) * borrowAmount
                          : 0;

                      return (
                        <div
                          key={asset.address}
                          className="p-3 rounded-md border border-gray-200 bg-white"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-semibold text-gray-900">{asset.symbol}</p>
                            <Badge variant="outline">
                              {asset.stabilityFee ? formatPercentage(asset.stabilityFee) : "CDP asset"}
                            </Badge>
                          </div>
                          <div className="space-y-1 text-sm text-gray-600">
                            {depositAmount > 0 ? (
                              <p>
                                • Add collateral: {formatUSD(depositAmount, 4)} {asset.symbol} (${formatUSD(depositUSD)})
                              </p>
                            ) : asset.existingCollateralUSD > 0 ? (
                              <p>• Use existing collateral: ${formatUSD(asset.existingCollateralUSD)}</p>
                            ) : null}
                            <p className="font-semibold text-gray-900">
                              • Borrow against: {formatUSD(borrowAllocation, 2)} USDST
                            </p>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200">
                <p className="text-sm text-gray-700">No suitable vaults found. Check that you have balances in supported assets.</p>
              </div>
            )}

            {borrowAmount > 0 && weightedAverageAPR > 0 && (
              <Collapsible open={showProjectedCosts} onOpenChange={setShowProjectedCosts}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between p-3 rounded-md bg-gray-50 border border-gray-200 hover:bg-gray-100"
                  >
                    <span className="text-sm font-semibold text-gray-700">
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
                  <div className="p-3 pt-0 rounded-md bg-gray-50 border border-gray-200 border-t-0 rounded-t-none">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2">
                      <div>
                        <p className="text-gray-600">Daily</p>
                        <p className="font-semibold">${formatUSD(projectedInterestCosts.daily, 4)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Weekly</p>
                        <p className="font-semibold">${formatUSD(projectedInterestCosts.weekly, 4)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Monthly</p>
                        <p className="font-semibold">${formatUSD(projectedInterestCosts.monthly, 2)}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">Yearly</p>
                        <p className="font-semibold">${formatUSD(projectedInterestCosts.yearly, 2)}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Interest calculated using exponential compounding (per-second) matching contract behavior
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            <Button 
              disabled={borrowAmount <= 0 || collateralGapUSD > 0 || selectedVaults.size === 0 || transactionLoading} 
              onClick={handleQuickBorrow}
              className="w-full"
            >
              {transactionLoading
                ? "Processing..."
                : borrowAmount <= 0 
                ? "Enter borrow amount"
                : collateralGapUSD > 0
                ? `Need +$${formatUSD(collateralGapUSD)} more collateral`
                : selectedVaults.size === 0
                ? "No vaults available"
                : "Confirm Quick Borrow"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Advanced Section - shown when showAdvanced is true */}
      {showAdvanced && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>1) Borrow amount</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAdvanced(false)}
                >
                  Quick Borrow
                </Button>
              </div>
            </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Input
              value={borrowAmountInput}
              onChange={(e) => setBorrowAmountInput(e.target.value)}
              placeholder="150"
              inputMode="decimal"
              className="pr-12"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">USDST</span>
          </div>
          <div className="flex gap-2">
            {[150, 250, 500].map((preset) => (
              <Button key={preset} variant="outline" size="sm" onClick={() => setBorrowAmountInput(String(preset))}>
                {preset} USDST
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2) Choose target risk (CR)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>Higher CR → safer, needs more collateral</span>
            <div className="flex items-center gap-3">
              <span className="font-semibold">{targetCR}% CR</span>
              {borrowAmount > 0 && (
                <span className="font-semibold text-blue-600">
                  ${formatUSD(requiredCollateralUSD)} collateral needed
                </span>
              )}
            </div>
          </div>
          <Slider
            value={[targetCR]}
            min={150}
            max={400}
            step={5}
            onValueChange={([v]) => setTargetCR(v)}
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>150%</span>
            <span>215% (example)</span>
            <span>400%</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3) Allocate collateral across vaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 rounded-md bg-gray-50">
              <p className="text-gray-600">Target collateral (USD)</p>
              <p className="text-lg font-semibold">${formatUSD(requiredCollateralUSD)}</p>
            </div>
            <div className="p-3 rounded-md bg-gray-50">
              <p className="text-gray-600">Planned collateral (existing + deposits)</p>
              <p className="text-lg font-semibold">${formatUSD(existingCollateralUSD + depositTotals.depositUSD)}</p>
              <p className="text-xs text-gray-500">Existing: ${formatUSD(existingCollateralUSD)} • Deposits: ${formatUSD(depositTotals.depositUSD)}</p>
            </div>
            <div className="p-3 rounded-md bg-gray-50">
              <p className="text-gray-600">Projected CR</p>
              <p className="text-lg font-semibold">{formatUSD(projectedCR)}%</p>
              {collateralGapUSD > 0 ? (
                <p className="text-xs text-red-600">Need +${formatUSD(collateralGapUSD)} collateral to hit target</p>
              ) : (
                <p className="text-xs text-green-700">Target met or exceeded</p>
              )}
            </div>
          </div>

          {borrowAmount > 0 && weightedAverageAPR > 0 && (
            <Collapsible open={showProjectedCosts} onOpenChange={setShowProjectedCosts}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full flex items-center justify-between p-3 rounded-md bg-gray-50 border border-gray-200 hover:bg-gray-100"
                >
                  <span className="text-sm font-semibold text-gray-700">
                    Projected Interest Costs (Weighted APR: {formatPercentage(weightedAverageAPR)})
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-200 ${
                      showProjectedCosts ? "rotate-180" : ""
                    }`}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-3 pt-0 rounded-md bg-gray-50 border border-gray-200 border-t-0 rounded-t-none">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2">
                    <div>
                      <p className="text-gray-600">Daily</p>
                      <p className="font-semibold">${formatUSD(projectedInterestCosts.daily, 4)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Weekly</p>
                      <p className="font-semibold">${formatUSD(projectedInterestCosts.weekly, 4)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Monthly</p>
                      <p className="font-semibold">${formatUSD(projectedInterestCosts.monthly, 2)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Yearly</p>
                      <p className="font-semibold">${formatUSD(projectedInterestCosts.yearly, 2)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Interest calculated using exponential compounding (per-second) matching contract behavior
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          <Separator />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Stability Fee</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Collateral</TableHead>
                <TableHead className="text-right">Deposit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assetSummaries.map((asset) => {
                const currentInput = depositInputs[asset.address] || "";
                const balanceDisplay = formatUSD(asset.balanceTokens, 4);
                const existingDisplay = formatUSD(asset.existingCollateralTokens, 4);
                const maxDeposit = asset.balanceTokens;
                const isSelected = selectedVaults.has(asset.address);
                const depositUSD = (parseFloat(currentInput || "0") || 0) * (asset.priceUSD || 0);
                
                return (
                  <TableRow
                    key={asset.address}
                    className={`cursor-pointer ${isSelected ? "bg-blue-50" : "opacity-60"}`}
                    onClick={() => toggleVaultSelection(asset.address)}
                  >
                    <TableCell>
                      <div className="font-medium">{asset.symbol}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={isSelected ? "default" : "outline"}>
                        {asset.stabilityFee ? formatPercentage(asset.stabilityFee) : "N/A"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium">{balanceDisplay}</div>
                      <div className="text-xs text-gray-500">
                        ${formatUSD(asset.balanceTokens * (asset.priceUSD || 0))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-medium">{existingDisplay}</div>
                      <div className="text-xs text-gray-500">
                        ${formatUSD(asset.existingCollateralUSD)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Input
                          value={currentInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDepositInputs((prev) => ({ ...prev, [asset.address]: val }));
                          }}
                          placeholder="0.00"
                          inputMode="decimal"
                          disabled={!isSelected}
                          className={`w-24 h-8 text-right ${!isSelected ? "bg-gray-100" : ""}`}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDepositInputs((prev) => ({ ...prev, [asset.address]: maxDeposit.toString() }))}
                          disabled={maxDeposit <= 0 || !isSelected}
                        >
                          Max
                        </Button>
                      </div>
                      {isSelected && depositUSD > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          ${formatUSD(depositUSD)}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
};

export default MintPlanner;
