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

  const { data: vaultRows } = await cirrus.get(accessToken, `/${SaveUSDSTVault}`, {
    params: {
      address: `eq.${config.saveUsdstVault}`,
      select: "address,assetToken,_managedAssets::text,_totalSupply::text",
    }
  });

  const vault = vaultRows?.[0];
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
  const pricePerShare = totalShares === 0n ? DECIMALS : (pricingAssets * DECIMALS) / totalShares;

  priceMap.set(vault.address, pricePerShare.toString());
};

// Cached vault→asset mapping populated by addYieldVaultTokenPrices, consumed by getCarryVaultUsdPriceMap
let _yieldVaultAssetMap = new Map<string, string>();

/** NAV per carry-vault share (underlying base units per share, WAD) for portfolio price × balance math. */
const addYieldVaultTokenPrices = async (
  accessToken: string,
  priceMap: OraclePriceMap
): Promise<void> => {
  const vaultAddrs = [config.ethCarryVault, config.wbtcCarryVault, config.usdcYieldVault].filter(
    (a): a is string => typeof a === "string" && a.replace(/^0x/i, "").length > 0
  );
  if (!vaultAddrs.length) return;

  const assetMap = new Map<string, string>();

  await Promise.all(vaultAddrs.map(async (vaultAddress) => {
    const { data: rows } = await cirrus.get(accessToken, `/${YieldVault}`, {
      params: {
        address: `eq.${vaultAddress}`,
        select: "address,_asset,deployedAssets::text,_totalSupply::text",
      },
    });
    const v = rows?.[0];
    if (!v?._asset || !v.address) return;

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
    const totalShares = BigInt(v._totalSupply || "0");
    const pricePerShare = totalShares === 0n ? DECIMALS : (totalAssets * DECIMALS) / totalShares;
    priceMap.set(v.address, pricePerShare.toString());
    assetMap.set(String(v.address).toLowerCase(), String(v._asset).toLowerCase());
  }));

  _yieldVaultAssetMap = assetMap;
};

/**
 * USD-denominated per-share price for each carry vault (1e18 WAD).
 * Reuses the underlying NAV already stored in priceMap by addYieldVaultTokenPrices
 * and multiplies by the asset's USD oracle price. No additional Cirrus calls.
 */
export const getCarryVaultUsdPriceMap = (
  priceMap: OraclePriceMap
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [vaultAddr, assetAddr] of _yieldVaultAssetMap) {
    const navStr = priceMap.get(vaultAddr) || priceMap.get(vaultAddr.toLowerCase()) || "0";
    const nav = BigInt(navStr);
    if (nav === 0n) continue;

    const assetUsdStr = priceMap.get(assetAddr) || priceMap.get(assetAddr.toLowerCase()) || "0";
    const assetUsd = BigInt(assetUsdStr);
    if (assetUsd === 0n) continue;

    out.set(vaultAddr, ((nav * assetUsd) / DECIMALS).toString());
  }
  return out;
};

let _completePriceMapCache: { data: Map<string, string>; expiry: number } | null = null;
const COMPLETE_PRICE_MAP_TTL = 30_000;

export const getCompletePriceMap = async (
  accessToken: string
): Promise<Map<string, string>> => {
  if (_completePriceMapCache && Date.now() < _completePriceMapCache.expiry) {
    return _completePriceMapCache.data;
  }
  const priceMap = await getOraclePrices(accessToken);
  await Promise.all([
    addMTokenPrice(accessToken, priceMap),
    addSTokenPrice(accessToken, priceMap),
    addLPTokenPrices(accessToken, priceMap),
    addVaultTokenPrice(accessToken, priceMap),
    addSaveUsdstTokenPrice(accessToken, priceMap),
    addYieldVaultTokenPrices(accessToken, priceMap),
  ]);
  _completePriceMapCache = { data: priceMap, expiry: Date.now() + COMPLETE_PRICE_MAP_TTL };
  return priceMap;
};