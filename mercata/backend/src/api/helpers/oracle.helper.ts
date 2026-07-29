import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { calculateLPTokenPrice } from "./swapping.helper";
import { getExchangeRateFromCirrus } from "../services/lending.service";
import { getOraclePrices } from "../services/oracle.service";
import { getSafetyModuleConfig } from "../services/safety.service";
import { getVaultShareTokenPrice } from "../services/vault.service";
import * as config from "../../config/config";
import { OraclePriceMap } from "@mercata/shared-types";

const { Token, DECIMALS, Pool, LendingPool, SaveUSDSTVault, lendingRegistry, YieldVault } = constants;
const RAY = 10n ** 27n;

const getActiveAssets = (totalAssets: bigint, totalClaimableAssets: bigint): bigint =>
  totalAssets > totalClaimableAssets ? totalAssets - totalClaimableAssets : 0n;

const minBigInt = (...values: bigint[]): bigint =>
  values.reduce((min, value) => value < min ? value : min);

const normalizeAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

const isZeroAddress = (value: string | undefined | null): boolean => {
  const normalized = normalizeAddress(value);
  return !normalized || /^0+$/.test(normalized);
};

const rpow = (x: bigint, n: bigint, base: bigint): bigint => {
  if (x === 0n) return n === 0n ? base : 0n;

  let z = n % 2n === 0n ? base : x;
  const half = base / 2n;
  for (n /= 2n; n > 0n; n /= 2n) {
    x = ((x * x) + half) / base;
    if (n % 2n === 1n) {
      z = ((z * x) + half) / base;
    }
  }

  return z;
};

const addMTokenPrice = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  const [{ data: lendingData }, exchangeRate] = await Promise.all([
    cirrus.get(accessToken, `/${LendingPool}`, {
      params: {
        select: "mToken",
        registry: `eq.${lendingRegistry}`
      }
    }),
    getExchangeRateFromCirrus(accessToken)
  ]);
  priceMap.set(lendingData[0].mToken, exchangeRate);
};

const addSTokenPrice = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  const { safetyModule, sToken } = getSafetyModuleConfig();

  // Fetch managedAssets and totalShares in parallel
  const [smRes, stRes] = await Promise.all([
    cirrus.get(accessToken, `/BlockApps-SafetyModule`, {
      params: {
        address: `eq.${safetyModule.address}`,
        select: "_managedAssets::text"
      }
    }),
    cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `eq.${sToken.address}`,
        select: "_totalSupply::text"
      }
    })
  ]);

  const managedAssets = BigInt(smRes.data?.[0]?._managedAssets ?? "0");
  const totalShares   = BigInt(stRes.data?.[0]?._totalSupply ?? "0");

  const exchangeRate = calculateSTokenPrice(
    managedAssets,
    totalShares
  );

  priceMap.set(sToken.address, exchangeRate.toString());
}

export const calculateSTokenPrice = (managedAssets: bigint, totalShares: bigint): bigint => {
  // If no shares exist, define price = 1e18 (initial exchange rate)
  if (totalShares === 0n) {
    return DECIMALS;
  }

  // exchangeRate = (managedAssets / totalShares) * 1e18
  return (managedAssets * DECIMALS) / totalShares;
};

const addLPTokenPrices = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  const { data: poolData } = await cirrus.get(accessToken, `/${Pool}`, {
    params: {
      poolFactory: `eq.${config.poolFactory}`,
      select: "tokenA,tokenB,tokenABalance::text,tokenBBalance::text,lpToken:lpToken_fkey(address,_totalSupply::text)"
    }
  });

  poolData.forEach((pool: any) => {
    const lpTokenPrice = calculateLPTokenPrice(
      pool.tokenABalance || "0",
      pool.tokenBBalance || "0",
      priceMap.get(pool.tokenA) || "0",
      priceMap.get(pool.tokenB) || "0",
      pool.lpToken._totalSupply
    );
    priceMap.set(pool.lpToken.address, lpTokenPrice);
  });
};

const addVaultTokenPrice = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  const { shareTokenAddress, pricePerShare } = await getVaultShareTokenPrice(accessToken);
  if (shareTokenAddress && pricePerShare !== "0") {
    priceMap.set(shareTokenAddress, pricePerShare);
  }
};

const addSaveUsdstTokenPrice = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  if (!config.saveUsdstVault) {
    return;
  }

  const [{ data: vaultRows }, { data: storageRows }] = await Promise.all([
    cirrus.get(accessToken, `/${SaveUSDSTVault}`, {
      params: {
        address: `eq.${config.saveUsdstVault}`,
        select: "address,assetToken,_managedAssets::text,_totalSupply::text",
      }
    }),
    cirrus.get(accessToken, "/storage", {
      params: {
        address: `eq.${config.saveUsdstVault}`,
        select: "data->>perSecondSavingsRate,data->>lastAccrual,data->>rewardDistributor",
        limit: "1",
      }
    }),
  ]);

  const vault = vaultRows?.[0] ? { ...vaultRows[0], ...storageRows?.[0] } : null;
  if (!vault?.address || !vault?.assetToken) {
    return;
  }

  const { data: balanceRows } = await cirrus.get(accessToken, `/${Token}-_balances`, {
    params: {
      address: `eq.${vault.assetToken}`,
      key: `eq.${vault.address}`,
      select: "value::text",
    }
  });

  const managedAssets = BigInt(vault._managedAssets || "0");
  const totalShares = BigInt(vault._totalSupply || "0");
  const liveBalance = BigInt(balanceRows?.[0]?.value || "0");
  const pricingAssets = liveBalance < managedAssets ? liveBalance : managedAssets;
  let projectedPricingAssets = pricingAssets;

  const perSecondSavingsRate = BigInt(vault.perSecondSavingsRate || "0");
  const lastAccrual = BigInt(vault.lastAccrual || "0");
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (
    totalShares > 0n &&
    managedAssets > 0n &&
    perSecondSavingsRate > RAY &&
    nowSec > lastAccrual &&
    !isZeroAddress(vault.rewardDistributor)
  ) {
    const growthFactor = rpow(perSecondSavingsRate, nowSec - lastAccrual, RAY);
    const targetAmount = (managedAssets * (growthFactor - RAY)) / RAY;
    if (targetAmount > 0n) {
      try {
        const [{ data: distributorBalanceRows }, { data: allowanceRows }] = await Promise.all([
          cirrus.get(accessToken, `/${Token}-_balances`, {
            params: {
              address: `eq.${vault.assetToken}`,
              key: `eq.${vault.rewardDistributor}`,
              select: "value::text",
            }
          }),
          cirrus.get(accessToken, `/${Token}-_allowances`, {
            params: {
              address: `eq.${vault.assetToken}`,
              key: `eq.${vault.rewardDistributor}`,
              key2: `eq.${vault.address}`,
              select: "value::text",
              limit: "1",
            }
          }),
        ]);
        projectedPricingAssets += minBigInt(
          targetAmount,
          BigInt(distributorBalanceRows?.[0]?.value || "0"),
          BigInt(allowanceRows?.[0]?.value || "0")
        );
      } catch {
        projectedPricingAssets = pricingAssets;
      }
    }
  }

  const pricePerShare = totalShares === 0n ? DECIMALS : (projectedPricingAssets * DECIMALS) / totalShares;

  priceMap.set(vault.address, pricePerShare.toString());
};

const yieldVaultAddresses = (): string[] =>
  [config.ethCarryVault, config.wbtcCarryVault, config.usdcYieldVault].filter(
    (a): a is string => typeof a === "string" && a.replace(/^0x/i, "").length > 0
  );

type YieldVaultPricingState = {
  address: string;
  assetAddress: string;
  totalShares: bigint;
  /**
   * Pricing base the vault actually uses (YieldVault._projectedActiveAssets):
   * reconciled active assets — which exclude donations sitting above
   * `accountedAssets` — plus the accrual the reward distributor can fund now.
   */
  projectedActiveAssets: bigint;
};

/**
 * Share-pricing inputs for one carry/yield vault. The funded-accrual fields come
 * from `/storage` because they were appended by the proxy upgrade; a vault that
 * has not been upgraded reports `accrualInitialized` false and prices exactly as
 * it did before (reconciled = economic assets, no pending accrual).
 */
const getYieldVaultPricingState = async (
  accessToken: string,
  vaultAddress: string
): Promise<YieldVaultPricingState | null> => {
  const [{ data: rows }, { data: storageRows }] = await Promise.all([
    cirrus.get(accessToken, `/${YieldVault}`, {
      params: {
        address: `eq.${vaultAddress}`,
        select: "address,_asset,deployedAssets::text,_totalSupply::text,totalClaimableAssets::text",
      },
    }),
    cirrus
      .get(accessToken, "/storage", {
        params: {
          address: `eq.${vaultAddress}`,
          select:
            "data->>perSecondSavingsRate,data->>lastAccrual,data->>rewardDistributor,data->>accrualInitialized,data->>accountedAssets",
          limit: "1",
        },
      })
      .catch(() => ({ data: [] as Array<Record<string, any>> })),
  ]);

  const v = rows?.[0] ? { ...rows[0], ...storageRows?.[0] } : null;
  if (!v?._asset || !v.address) return null;

  const { data: balRows } = await cirrus.get(accessToken, `/${Token}-_balances`, {
    params: {
      address: `eq.${v._asset}`,
      key: `eq.${vaultAddress}`,
      select: "value::text",
    },
  });

  const idle = BigInt(balRows?.[0]?.value || "0");
  const deployed = BigInt(v.deployedAssets || "0");
  const totalAssets = idle + deployed;
  const totalClaimableAssets = BigInt(v.totalClaimableAssets || "0");
  const totalShares = BigInt(v._totalSupply || "0");

  const accrualInitialized = String(v.accrualInitialized ?? "").toLowerCase() === "true";
  const accountedAssets = BigInt(v.accountedAssets || "0");
  const hasStrayAssets = accrualInitialized && totalAssets > accountedAssets;
  const reconciledAssets = hasStrayAssets ? accountedAssets : totalAssets;
  const strayAssets = hasStrayAssets ? totalAssets - accountedAssets : 0n;
  const reconciledActiveAssets = getActiveAssets(reconciledAssets, totalClaimableAssets);

  const state: YieldVaultPricingState = {
    address: String(v.address),
    assetAddress: String(v._asset),
    totalShares,
    projectedActiveAssets: reconciledActiveAssets,
  };

  const perSecondSavingsRate = BigInt(v.perSecondSavingsRate || "0");
  const lastAccrual = BigInt(v.lastAccrual || "0");
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (
    !accrualInitialized ||
    totalShares === 0n ||
    perSecondSavingsRate <= RAY ||
    nowSec <= lastAccrual ||
    isZeroAddress(v.rewardDistributor)
  ) {
    return state;
  }

  const growthFactor = rpow(perSecondSavingsRate, nowSec - lastAccrual, RAY);
  const targetAmount = (reconciledActiveAssets * (growthFactor - RAY)) / RAY;
  if (targetAmount <= 0n) return state;

  try {
    const [{ data: distributorBalanceRows }, { data: allowanceRows }] = await Promise.all([
      cirrus.get(accessToken, `/${Token}-_balances`, {
        params: {
          address: `eq.${v._asset}`,
          key: `eq.${v.rewardDistributor}`,
          select: "value::text",
        },
      }),
      cirrus.get(accessToken, `/${Token}-_allowances`, {
        params: {
          address: `eq.${v._asset}`,
          key: `eq.${v.rewardDistributor}`,
          key2: `eq.${v.address}`,
          select: "value::text",
          limit: "1",
        },
      }),
    ]);

    const available =
      normalizeAddress(v.rewardDistributor) === normalizeAddress(v.address)
        ? BigInt(distributorBalanceRows?.[0]?.value || "0")
        : BigInt(distributorBalanceRows?.[0]?.value || "0") + strayAssets;

    state.projectedActiveAssets += minBigInt(
      targetAmount,
      available,
      BigInt(allowanceRows?.[0]?.value || "0")
    );
  } catch {
    // leave the price at the reconciled base if the funding reads fail
  }

  return state;
};

/** NAV per carry-vault share (underlying base units per share, WAD) for portfolio price × balance math. */
const addYieldVaultTokenPrices = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  for (const vaultAddress of yieldVaultAddresses()) {
    const state = await getYieldVaultPricingState(accessToken, vaultAddress);
    if (!state) continue;

    const pricePerShare =
      state.totalShares === 0n
        ? DECIMALS
        : (state.projectedActiveAssets * DECIMALS) / state.totalShares;
    priceMap.set(state.address, pricePerShare.toString());
  }
};

/**
 * USD-denominated per-share price for each carry vault (1e18 WAD).
 * Composes the vault's underlying-per-share NAV (idle + deployed) / totalShares with the
 * asset's USD oracle price. Keyed by vault address (lowercased, no 0x prefix).
 *
 * Rationale: `priceMap` already stores the underlying-denominated price (ETH per share for
 * the ETH carry vault) for portfolio math; consumers that need the USD value of a stake
 * denominated in carry-vault shares must apply the asset's USD oracle on top.
 */
export const getCarryVaultUsdPriceMap = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<Map<string, string>> => {
  const out = new Map<string, string>();

  for (const vaultAddress of yieldVaultAddresses()) {
    const state = await getYieldVaultPricingState(accessToken, vaultAddress);
    if (!state || state.totalShares === 0n) continue;

    const pricePerShareUnderlying =
      (state.projectedActiveAssets * DECIMALS) / state.totalShares;

    const assetKey = state.assetAddress.toLowerCase();
    const assetUsdPriceStr = priceMap.get(assetKey) || priceMap.get(state.assetAddress) || "0";
    const assetUsdPriceWad = BigInt(assetUsdPriceStr);
    if (assetUsdPriceWad === 0n) continue;

    const pricePerShareUsdWad = (pricePerShareUnderlying * assetUsdPriceWad) / DECIMALS;
    out.set(state.address.toLowerCase(), pricePerShareUsdWad.toString());
  }
  return out;
};

export const getCompletePriceMap = async (
  accessToken: string
): Promise<Map<string, string>> => {
  const priceMap = await getOraclePrices(accessToken);
  await Promise.all([
    addMTokenPrice(accessToken, priceMap),
    addSTokenPrice(accessToken, priceMap),
    addLPTokenPrices(accessToken, priceMap),
    addVaultTokenPrice(accessToken, priceMap),
    addSaveUsdstTokenPrice(accessToken, priceMap),
    addYieldVaultTokenPrices(accessToken, priceMap),
  ]);
  return priceMap;
};
