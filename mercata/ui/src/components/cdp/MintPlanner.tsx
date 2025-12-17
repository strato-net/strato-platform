import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Slider } from "@/components/ui/slider";
import { ChevronDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOracleContext } from "@/context/OracleContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { cdpService, AssetConfig, VaultData } from "@/services/cdpService";
import { api } from "@/lib/axios";
import { getOptimalAllocations } from "@/services/mintPlanService";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { CompactRewardsDisplay } from "@/components/rewards/CompactRewardsDisplay";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import MintWidget from "./MintWidget";
import {
  USE_DUMMY_DATA,
  dummyVaults,
  dummyAssets,
  dummyPrices,
  dummyActiveTokens,
} from "./dummyData";

type Allocation = {
  vault: AssetConfig & { address: string; symbol: string };
  mintAmount: number;
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

// Helper functions for mint planning algorithm have been moved to @/services/mintPlanService

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

// buildMintPlan has been moved to @/services/mintPlanService - imported above

const MintPlanner: React.FC<{ title?: string; onSuccess?: () => void; refreshTrigger?: number }> = ({
  title = "Mint against collateral (CDP)",
  onSuccess,
  refreshTrigger,
}) => {
  const [mintAmountInput, setMintAmountInput] = useState<string>("");
  const [riskFactor, setRiskFactor] = useState<number>(1.5);

  // Calculate color based on risk factor (1-2.5)
  // Green at 1.5 (default), redder as it goes lower, faint green as it goes higher
  const getRiskColor = useCallback((factor: number): string => {
    if (factor <= 1.5) {
      // Red to green (1.0 -> 1.5): Lower factor = more risky = redder
      const ratio = (factor - 1.0) / 0.5; // 0 at 1.0, 1 at 1.5
      const r = Math.round(239 + (16 - 239) * ratio); // Red (239) -> Green (16)
      const g = Math.round(68 + (185 - 68) * ratio);  // Red (68) -> Green (185)
      const b = Math.round(68 + (129 - 68) * ratio); // Red (68) -> Green (129)
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Green to faint green (1.5 -> 2.5): Higher factor = more conservative = faint green
      const ratio = (factor - 1.5) / 1.0; // 0 at 1.5, 1 at 2.5
      // Start with green (16, 185, 129) and fade to less faint green (180, 220, 180)
      const r = Math.round(16 + (180 - 16) * ratio);
      const g = Math.round(185 + (220 - 185) * ratio);
      const b = Math.round(129 + (180 - 129) * ratio);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }, []);
  const [assets, setAssets] = useState<AssetConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositInputs, setDepositInputs] = useState<Record<string, string>>({});
  const [selectedVaults, setSelectedVaults] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showProjectedCosts, setShowProjectedCosts] = useState(false);
  const [showVaultBreakdown, setShowVaultBreakdown] = useState(false);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [globalDebtInfo, setGlobalDebtInfo] = useState<Record<string, { currentTotalDebt: string }>>({});
  const [vaults, setVaults] = useState<VaultData[]>([]);
  const { prices: realPrices, fetchAllPrices } = useOracleContext();
  const { activeTokens: realActiveTokens } = useUserTokens();
  const { toast } = useToast();
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  // Use dummy data if enabled, otherwise use real data
  const prices = USE_DUMMY_DATA ? dummyPrices : realPrices;
  const activeTokens = USE_DUMMY_DATA ? dummyActiveTokens : realActiveTokens;

  // Fetch vaults directly like VaultsList.tsx
  const fetchVaults = useCallback(async () => {
    if (USE_DUMMY_DATA) {
      setVaults(dummyVaults);
      return;
    }
    try {
      const fetchedVaults = await cdpService.getVaults();
      setVaults(fetchedVaults);
    } catch (error) {
      console.error("Failed to fetch vaults:", error);
      setVaults([]);
    }
  }, []);

  useEffect(() => {
    fetchVaults();
  }, [fetchVaults, refreshTrigger]);

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
        
        // Fetch global debt info for all assets
        const debtInfoMap: Record<string, { currentTotalDebt: string }> = {};
        await Promise.all(
          (assetConfigs || []).map(async (asset) => {
            try {
              const debtInfo = await cdpService.getAssetDebtInfo(asset.asset);
              debtInfoMap[asset.asset.toLowerCase()] = debtInfo;
            } catch (e) {
              // If fetching fails, use 0 as fallback
              debtInfoMap[asset.asset.toLowerCase()] = { currentTotalDebt: "0" };
            }
          })
        );
        setGlobalDebtInfo(debtInfoMap);
      } catch (e) {
        setError("Could not load CDP data");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchAllPrices, refreshTrigger]);

  // Log user balances of supported assets when data is available
  useEffect(() => {
    if (assets.length === 0 || activeTokens.length === 0) {
      return;
    }

    console.log("=== MintPlanner: User Balances of Supported Assets ===");
    console.log(`Total supported assets: ${assets.length}`);
    console.log(`Total active tokens: ${activeTokens.length}`);

    const supportedAssetsByAddress = new Map<string, AssetConfig>();
    assets.forEach((asset) => {
      if (asset.isSupported && !asset.isPaused) {
        supportedAssetsByAddress.set(asset.asset.toLowerCase(), asset);
      }
    });

    console.log(`Total supported/unpaused assets: ${supportedAssetsByAddress.size}`);

    const supportedAssetsWithBalance: Array<{
      asset: AssetConfig;
      token: typeof activeTokens[0];
      balance: bigint;
      balanceFormatted: string;
    }> = [];

    activeTokens.forEach((token) => {
      if (!token.address) return;
      
      const assetLower = token.address.toLowerCase();
      const asset = supportedAssetsByAddress.get(assetLower);
      
      if (asset) {
        const balance = BigInt(token.balance || "0");
        if (balance > 0n) {
          const decimals = (token as any).decimals || 18;
          const balanceFormatted = formatUnits(balance, decimals);
          supportedAssetsWithBalance.push({
            asset,
            token,
            balance,
            balanceFormatted,
          });
        }
      }
    });

    console.log(`Total supported assets with balance: ${supportedAssetsWithBalance.length}`);
    if (supportedAssetsWithBalance.length === 0) {
      console.warn("⚠️ No supported assets with balance found!");
      console.log("Supported assets:", Array.from(supportedAssetsByAddress.values()).map(a => `${a.symbol} (${a.asset})`));
      console.log("User tokens:", activeTokens.map(t => `${(t as any).symbol || 'N/A'} (${t.address}) - Balance: ${t.balance || "0"}`));
    } else {
      supportedAssetsWithBalance.forEach((item, idx) => {
        const price = prices[item.asset.asset.toLowerCase()];
        const priceFormatted = price ? parseFloat(formatUnits(BigInt(price), 18)).toFixed(2) : "N/A";
        const balanceUSD = price && item.balanceFormatted !== "0"
          ? (parseFloat(item.balanceFormatted) * parseFloat(formatUnits(BigInt(price), 18))).toFixed(2)
          : "N/A";
        console.log(
          `${idx + 1}. ${item.asset.symbol} (${item.asset.asset}): ` +
          `${item.balanceFormatted} tokens, ` +
          `Balance: ${item.balance.toString()}, ` +
          `Price: $${priceFormatted}, ` +
          `Value: $${balanceUSD}`
        );
      });
    }
  }, [assets, activeTokens, prices]);

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

  const mintAmount = useMemo(() => {
    const parsed = parseFloat((mintAmountInput || "").replace(/,/g, ""));
    if (!isFinite(parsed) || parsed <= 0) return 0;
    return parsed;
  }, [mintAmountInput]);

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

  // Helper function to get effective CR for a vault based on risk factor
  const getEffectiveCR = useCallback((assetAddress: string): number => {
    const config = assets.find((a) => a.asset.toLowerCase() === assetAddress.toLowerCase());
    const minCR = config?.minCR || 200; // Fallback to 200 if not found
    return minCR * riskFactor;
  }, [riskFactor, assets]);

  const plan = useMemo(() => {
    if (mintAmount <= 0 || assets.length === 0) {
      return { allocations: [] as Allocation[], newVault: null as Allocation | null, projectedCR: 0, remaining: mintAmount };
    }

    let remaining = mintAmount;
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
      const effectiveCR = getEffectiveCR(vault.asset);
      const maxMintAtTarget = Math.max(0, (collateralUSD * 100) / effectiveCR - debtUSD);
      if (maxMintAtTarget <= 0 || remaining <= 0) return;

      const mintHere = Math.min(maxMintAtTarget, remaining);
      if (mintHere > 0) {
        const totalDebt = debtUSD + mintHere;
        const crAfter = totalDebt > 0 ? (collateralUSD / totalDebt) * 100 : effectiveCR;
        const collateralTokens = parseFloat(formatUnits(BigInt(vault.collateralAmount || "0"), vault.collateralAmountDecimals || 18));
        const priceUSD = priceForAsset(vault.asset, vault);
        allocations.push({
          vault: { ...config!, address: vault.asset, symbol: config?.symbol || vault.symbol || "Asset" },
          mintAmount: mintHere,
          crAfter,
          type: "existing",
          collateralInVaultUSD: collateralUSD,
          collateralInVaultTokens: collateralTokens,
          stabilityFee: config?.stabilityFeeRate,
        });
        remaining = Math.max(0, remaining - mintHere);
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
        const effectiveCR = getEffectiveCR(choice.config.asset);
        const requiredCollateralUSD = (remaining * effectiveCR) / 100;
        const requiredCollateralTokens = priceUSD > 0 ? requiredCollateralUSD / priceUSD : 0;
        newVault = {
          vault: { ...choice.config, address: choice.config.asset || "", symbol: choice.config.symbol || "Asset" },
          mintAmount: remaining,
          crAfter: effectiveCR,
          type: "new",
          requiredCollateralUSD,
          requiredCollateralTokens,
          stabilityFee: choice.config.stabilityFeeRate,
        };
        remaining = 0;
      }
    }

    const totalDebt = allocations.reduce((sum, a) => sum + a.mintAmount, 0) + (newVault?.mintAmount || 0);
    const totalCollateralUSD =
      allocations.reduce((sum, a) => sum + (a.collateralInVaultUSD || 0), 0) + (newVault?.requiredCollateralUSD || 0);
    const projectedCR = totalDebt > 0 ? (totalCollateralUSD / totalDebt) * 100 : 0;

    return { allocations, newVault, projectedCR, remaining };
  }, [assets, mintAmount, vaults, activeTokens, priceForAsset, getEffectiveCR]);

  // Calculate required collateral USD based on per-vault CR and mint allocation
  const requiredCollateralUSD = useMemo(() => {
    if (mintAmount <= 0 || selectedVaults.size === 0) return 0;
    
    // Calculate mint allocation per vault (proportional to collateral)
    const vaultCollaterals = assetSummaries
      .filter((a) => selectedVaults.has(a.address))
      .map((asset) => {
        const depositAmount = parseFloat(depositInputs[asset.address] || "0");
        const depositUSD = depositAmount * (asset.priceUSD || 0);
        const totalCollateralUSD = (asset.existingCollateralUSD || 0) + depositUSD;
        return { asset, totalCollateralUSD };
      });

    const totalCollateralAllVaults = vaultCollaterals.reduce(
      (sum, v) => sum + v.totalCollateralUSD,
      0
    );

    if (totalCollateralAllVaults === 0) return 0;

    // Calculate required collateral for each vault based on its effective CR
    let totalRequired = 0;
    for (const { asset, totalCollateralUSD } of vaultCollaterals) {
      const mintAllocation = (totalCollateralUSD / totalCollateralAllVaults) * mintAmount;
      const effectiveCR = getEffectiveCR(asset.address);
      const requiredForVault = (mintAllocation * effectiveCR) / 100;
      totalRequired += requiredForVault;
    }

    return totalRequired;
  }, [mintAmount, selectedVaults, assetSummaries, depositInputs, getEffectiveCR]);

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
    if (mintAmount <= 0) return 0;
    const totalCollateralUSD = existingCollateralUSD + depositTotals.depositUSD;
    return mintAmount > 0 ? (totalCollateralUSD / mintAmount) * 100 : 0;
  }, [mintAmount, depositTotals.depositUSD, existingCollateralUSD]);

  const collateralGapUSD = Math.max(0, requiredCollateralUSD - (existingCollateralUSD + depositTotals.depositUSD));

  // Calculate total existing collateral from all vaults (for quick mint planning)
  const totalExistingCollateralUSD = useMemo(() => {
    return assetSummaries.reduce((sum, a) => sum + (a.existingCollateralUSD || 0), 0);
  }, [assetSummaries]);

  // Get optimal allocations using the service function
  const allocations = useMemo(() => {
    if (mintAmount <= 0 || assets.length === 0) {
      return [];
    }

    console.log("=== MintPlanner: Calling getOptimalAllocations ===");
    console.log(`  mintAmount: ${mintAmount}, assets: ${assets.length}, vaults: ${vaults.length}, activeTokens: ${activeTokens.length}`);

    const targetMintUSD = parseUnits(mintAmount.toFixed(18), 18);
    const result = getOptimalAllocations(
      targetMintUSD,
      riskFactor,
      assets,
      vaults,
      activeTokens,
      prices,
      globalDebtInfo
    );
    
    console.log(`=== MintPlanner: getOptimalAllocations returned ${result.length} allocations ===`);
    return result;
  }, [mintAmount, riskFactor, assets, vaults, activeTokens, prices, globalDebtInfo]);

  // Calculate weighted average APR based on actual mint allocations
  const weightedAverageAPR = useMemo(() => {
    if (allocations.length === 0) return 0;
    
    let totalMintAmount = 0;
    let weightedSum = 0;
    
    for (const allocation of allocations) {
      const mintAmount = parseFloat(allocation.mintAmount);
      if (mintAmount > 0) {
        totalMintAmount += mintAmount;
        weightedSum += mintAmount * allocation.stabilityFeeRate;
      }
    }
    
    return totalMintAmount > 0 ? weightedSum / totalMintAmount : 0;
  }, [allocations]);

  // Calculate projected interest costs using exponential compounding
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

  // Apply allocations to selected vaults and deposits
  useEffect(() => {
    if (!showAdvanced && allocations.length > 0) {
      const selectedVaultsSet = new Set(allocations.map(a => a.assetAddress));
      const depositsMap: Record<string, string> = {};
      allocations.forEach(a => {
        if (parseFloat(a.depositAmount) > 0) {
          depositsMap[a.assetAddress] = a.depositAmount;
        }
      });
      setSelectedVaults(selectedVaultsSet);
      setDepositInputs(depositsMap);
    }
  }, [showAdvanced, allocations]);

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

  // Handle Quick Mint confirmation - execute deposits and mints
  const handleQuickMint = useCallback(async () => {
    if (mintAmount <= 0 || selectedVaults.size === 0) return;

    setTransactionLoading(true);
    try {
      // Refresh vaults and prices BEFORE calculating allocations to avoid stale data
      await Promise.all([
        fetchVaults(),
        fetchAllPrices(),
      ]);

      // Re-fetch fresh data directly for calculations (state may not have updated yet)
      const [freshVaults, freshActiveTokens, freshPricesResponse] = await Promise.all([
        USE_DUMMY_DATA ? Promise.resolve(dummyVaults) : cdpService.getVaults(),
        USE_DUMMY_DATA ? Promise.resolve(dummyActiveTokens) : Promise.resolve(realActiveTokens), // activeTokens should be relatively fresh
        USE_DUMMY_DATA ? Promise.resolve(dummyPrices) : (async () => {
          // Fetch prices directly from API to ensure we have the latest
          const response = await api.get('/oracle/price');
          const allPrices = response.data || [];
          if (Array.isArray(allPrices)) {
            return allPrices.reduce((acc: Record<string, string>, item: { asset?: string; price?: string }) => {
              if (item.asset && item.price) {
                acc[item.asset.toLowerCase()] = item.price;
              }
              return acc;
            }, {});
          }
          return {};
        })(),
      ]);

      const freshPrices = freshPricesResponse;

      // Recalculate assetSummaries with fresh data (matching the useMemo logic)
      const tokensByAddress = freshActiveTokens.reduce<
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

      const freshAssetSummaries = freshVaults
        .map((v) => {
          const config = assetByAddress[v.asset.toLowerCase()];
          const tokenInfo = tokensByAddress[v.asset.toLowerCase()];
          const decimals = v.collateralAmountDecimals || tokenInfo?.decimals || 18;
          const priceWei = freshPrices[v.asset] || "0";
          const priceUSD = priceWei ? parseFloat(formatUnits(BigInt(priceWei), 18)) : 0;
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
            .filter((a) => !freshVaults.find((v) => v.asset.toLowerCase() === a.asset.toLowerCase()))
            .map((a) => {
              const tokenInfo = tokensByAddress[a.asset.toLowerCase()];
              const decimals = tokenInfo?.decimals || 18;
              const priceWei = freshPrices[a.asset] || "0";
              const priceUSD = priceWei ? parseFloat(formatUnits(BigInt(priceWei), 18)) : 0;
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
        .filter((a) => a.priceUSD > 0 && (a.balanceTokens > 0 || a.existingCollateralTokens > 0))
        .filter((a) => selectedVaults.has(a.address));

      // Use the allocations from getOptimalAllocations (same as displayed in UI)
      // Recalculate allocations with fresh data to match what's displayed
      const freshTargetMintUSD = parseUnits(mintAmount.toFixed(18), 18);
      const freshAllocations = getOptimalAllocations(
        freshTargetMintUSD,
        riskFactor,
        assets,
        freshVaults,
        freshActiveTokens,
        freshPrices,
        globalDebtInfo
      );

      const transactions: Array<{ type: "deposit" | "mint"; asset: string; amount: string; symbol: string }> = [];

      // Prepare transactions based on allocations (matching what's displayed in UI)
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

        // Add mint transaction using the allocation amount (matching UI display)
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

      // Execute transactions sequentially with validation
      const SAFETY_BUFFER_PERCENT = 0.001; // 0.1% buffer to account for strict < comparison and rounding
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
          
          // Show individual success toast for deposit
          toast({
            title: `Deposit Successful: ${tx.symbol}`,
            description: `Deposited ${formatUSD(parseFloat(tx.amount), 4)} ${tx.symbol}. Tx: ${result.hash}`,
          });
          
          // Refresh vault state and prices after deposit to get updated max mintable
          await Promise.all([
            fetchVaults(),
            fetchAllPrices(),
          ]);
        } else {
          // Before minting, validate against actual on-chain max mintable amount
          try {
            const maxMintResult = await cdpService.getMaxMint(tx.asset);
            const maxMintableUSD = parseFloat(formatUnits(maxMintResult.maxAmount, 18));
            const plannedMintUSD = parseFloat(tx.amount);
            
            // Apply safety buffer: use 99.9% of max to account for strict < comparison
            const safeMaxMintableUSD = maxMintableUSD * (1 - SAFETY_BUFFER_PERCENT);
            
            if (plannedMintUSD > safeMaxMintableUSD) {
              // Clamp to safe maximum
              const clampedMintUSD = Math.max(0, safeMaxMintableUSD);
              
              if (clampedMintUSD < plannedMintUSD * 0.99) {
                // Significant reduction - warn user
                toast({
                  title: "Mint Amount Adjusted",
                  description: `Planned ${formatUSD(plannedMintUSD, 2)} USDST for ${tx.symbol}, but only ${formatUSD(clampedMintUSD, 2)} USDST is available. This may be due to price changes or debt accrual.`,
                  variant: "default",
                });
              }
              
              if (clampedMintUSD <= 0) {
                // Skip this mint - insufficient collateral
                toast({
                  title: `Mint Skipped: ${tx.symbol}`,
                  description: `Insufficient collateral after deposits. Planned: ${formatUSD(plannedMintUSD, 2)} USDST`,
                  variant: "default",
                });
                continue;
              }
              
              // Update transaction amount to clamped value
              tx.amount = clampedMintUSD.toString();
            }
          } catch (error) {
            console.error(`Failed to get max mint for ${tx.symbol}:`, error);
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
          
          // Show individual success toast for mint
          toast({
            title: `Mint Successful: ${tx.symbol}`,
            description: `Minted ${formatUSD(parseFloat(tx.amount), 2)} USDST from ${tx.symbol}. Tx: ${result.hash}`,
          });
        }
      }

      // Show final summary toast if all transactions succeeded
      // Add a small delay to ensure the last individual transaction toast is visible first
      if (allSuccessful) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        toast({
          title: "Quick Mint Complete",
          description: "All transactions completed successfully",
        });
      }

      // Refresh vault data
      await fetchVaults();
      await fetchAllPrices();

      // Reset form
      setMintAmountInput("");
      setDepositInputs({});
      setSelectedVaults(new Set());

      // Call onSuccess callback to refresh parent components
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error("Quick Mint failed:", error);
      const errorMessage = error instanceof Error ? error.message : "Transaction failed. Please try again.";
      toast({
        title: "Transaction Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setTransactionLoading(false);
    }
  }, [mintAmount, selectedVaults, depositInputs, toast, fetchVaults, fetchAllPrices, onSuccess, assets, realActiveTokens]);

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
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Quick Mint Section - hidden when Advanced is shown */}
      {!showAdvanced && (
        <Card>
          <CardHeader>
            <CardTitle>Quick Mint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mint Amount Input */}
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
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">USDST</span>
              </div>
              <div className="h-2"></div>
            </div>

            {/* Risk Buffer Selection */}
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
              <div className="text-sm text-gray-600">
                <span>
                  Mint up to each vault's minCR × {riskFactor.toFixed(1)}
                </span>
              </div>
            </div>

            <Button 
              disabled={mintAmount <= 0 || collateralGapUSD > 0 || selectedVaults.size === 0 || transactionLoading} 
              onClick={handleQuickMint}
              className="w-full"
            >
              {transactionLoading
                ? "Processing..."
                : mintAmount <= 0 
                ? "Enter mint amount"
                : collateralGapUSD > 0
                ? `Need +$${formatUSD(collateralGapUSD)} more collateral`
                : selectedVaults.size === 0
                ? "No vaults available"
                : "Confirm Quick Mint"}
            </Button>

            <Separator />

            {mintAmount <= 0 ? (
              <div className="p-3 rounded-md bg-gray-50 border border-gray-200 text-center">
                <p className="text-sm text-gray-600">Enter a mint amount and select risk level to see the automated plan</p>
              </div>
            ) : allocations.length > 0 ? (
              <Collapsible open={showVaultBreakdown} onOpenChange={setShowVaultBreakdown}>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between p-3 rounded-md bg-gray-50 border border-gray-200 hover:bg-gray-100"
                  >
                    <span className="text-sm font-semibold text-gray-700">
                      Vault Breakdown
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ${
                        showVaultBreakdown ? "rotate-180" : ""
                      }`}
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
                          className="p-3 rounded-md border border-gray-200 bg-white"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-semibold text-gray-900">{allocation.symbol}</p>
                            <Badge variant="outline">
                              {formatPercentage(allocation.stabilityFeeRate)}
                            </Badge>
                          </div>
                          <div className="space-y-1 text-sm text-gray-600">
                            <p className="text-xs text-gray-500">
                              • Non-collateral balance: {formatUSD(userBalance, 4)} {allocation.symbol} (${formatUSD(userBalanceUSD, 2)})
                            </p>
                            {depositAmount > 0 ? (
                              <p>
                                • Add collateral: {formatUSD(depositAmount, 4)} {allocation.symbol} (${formatUSD(parseFloat(allocation.depositAmountUSD))})
                              </p>
                            ) : existingCollateralUSD > 0 ? (
                              <p>• Use existing collateral: ${formatUSD(existingCollateralUSD)}</p>
                            ) : null}
                            <p className="font-semibold text-gray-900">
                              • Mint: {formatUSD(parseFloat(allocation.mintAmount), 2)} USDST
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200">
                <p className="text-sm text-gray-700">No suitable vaults found. Check that you have balances in supported assets.</p>
              </div>
            )}

            {mintAmount > 0 && weightedAverageAPR > 0 && (
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

            {userRewards && (() => {
              const cdpActivity = userRewards.activities.find(a => {
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

      {/* Advanced Section - shown when showAdvanced is true */}
      {showAdvanced && (
        <div className="border border-gray-200 bg-white rounded-xl p-4">
          <MintWidget onSuccess={onSuccess} title={title} />
        </div>
      )}
    </div>
    </>
  );
};

export default MintPlanner;
