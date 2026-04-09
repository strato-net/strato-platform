import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";
import { getServiceToken } from "../../utils/authHelper";
import { getOraclePrices } from "./oracle.service";
import { FunctionInput } from "../../types/types";

const { YieldVault, Token } = constants;

const WAD = 10n ** 18n;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface YieldVaultDef {
  key: string;
  address: string;
  name: string;
  assetSymbol: string;
  shareSymbol: string;
}

export interface YieldVaultInfo {
  key: string;
  configured: boolean;
  deployed: boolean;
  vaultAddress: string;
  assetAddress: string;
  assetSymbol: string;
  shareSymbol: string;
  name: string;
  decimals: number;
  totalAssets: string;
  idleAssets: string;
  totalShares: string;
  exchangeRate: string;
  /** Oracle USD price (WAD) per 1 full underlying token. */
  assetPriceWad: string;
  /** Vault TVL in USD (WAD): (idle + deployed underlying) × assetPriceWad / 10^decimals. */
  tvlUsd: string;
  apy: string;
  paused: boolean;
}

export interface YieldVaultUserInfo extends YieldVaultInfo {
  walletAssets: string;
  userShares: string;
  redeemableAssets: string;
  /** User NAV in USD (WAD): ERC4626 underlying claim for userShares × oracle / 10^decimals. */
  positionUsd: string;
  maxDeposit: string;
  maxRedeem: string;
}

/** Keys and display metadata only; addresses come from config / env. */
const CARRY_VAULT_ENTRIES: (Omit<YieldVaultDef, "address"> & { getAddress: () => string })[] = [
  { key: "eth-carry",  name: "ETH Carry Vault",  assetSymbol: "ETH",  shareSymbol: "carryETH",  getAddress: () => config.ethCarryVault },
  { key: "wbtc-carry", name: "wBTC Carry Vault", assetSymbol: "wBTC", shareSymbol: "carryWBTC", getAddress: () => config.wbtcCarryVault },
];

const parseBigIntLike = (value: unknown): bigint => {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  const raw = String(value).trim();
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
};

const getExchangeRate = (totalAssets: bigint, totalShares: bigint): bigint => {
  if (totalShares <= 0n) return WAD;
  if (totalAssets <= 0n) return 0n;
  return (totalAssets * WAD) / totalShares;
};

const tokenDecimalsUnit = (underlyingDecimals: number): bigint => {
  const d =
    Number.isFinite(underlyingDecimals) && underlyingDecimals >= 0 && underlyingDecimals <= 78
      ? underlyingDecimals
      : 18;
  return 10n ** BigInt(d);
};

/** Underlying amount (base units) × oracle (WAD per token) → USD in WAD. */
const underlyingUsdWad = (amountBaseUnits: bigint, priceWad: bigint, underlyingDecimals: number): bigint => {
  if (priceWad <= 0n || amountBaseUnits <= 0n) return 0n;
  const unit = tokenDecimalsUnit(underlyingDecimals);
  return (amountBaseUnits * priceWad) / unit;
};

function getVaultRegistry(): YieldVaultDef[] {
  return CARRY_VAULT_ENTRIES.map(({ getAddress, ...entry }) => ({
    ...entry,
    address: getAddress(),
  }));
}

export function resolveVaultDef(key: string): YieldVaultDef | null {
  return getVaultRegistry().find((v) => v.key === key) || null;
}

export function listVaultDefs(): YieldVaultDef[] {
  return getVaultRegistry();
}

function emptyInfo(def: YieldVaultDef | null, key: string): YieldVaultInfo {
  return {
    key,
    configured: Boolean(def?.address),
    deployed: false,
    vaultAddress: def?.address || "",
    assetAddress: "",
    assetSymbol: def?.assetSymbol || "",
    shareSymbol: def?.shareSymbol || "",
    name: def?.name || "",
    decimals: 18,
    totalAssets: "0",
    idleAssets: "0",
    totalShares: "0",
    exchangeRate: WAD.toString(),
    assetPriceWad: "0",
    tvlUsd: "0",
    apy: "-",
    paused: false,
  };
}

function emptyUserInfo(def: YieldVaultDef | null, key: string): YieldVaultUserInfo {
  return {
    ...emptyInfo(def, key),
    walletAssets: "0",
    userShares: "0",
    redeemableAssets: "0",
    positionUsd: "0",
    maxDeposit: "0",
    maxRedeem: "0",
  };
}

const getVaultState = async (
  vaultAddress: string
): Promise<Record<string, any> | null> => {
  const serviceToken = await getServiceToken();
  const { data } = await cirrus.get(serviceToken, `/${YieldVault}`, {
    params: {
      address: `eq.${vaultAddress}`,
      select: "address,_asset,_totalSupply::text,_symbol,_name,_paused,vaultInitialized,deployedAssets::text,_underlyingDecimals",
    },
  });
  return data?.[0] || null;
};

const getAssetBalance = async (
  accessToken: string,
  tokenAddress: string,
  ownerAddress: string
): Promise<string> => {
  const { data } = await cirrus.get(accessToken, `/${Token}-_balances`, {
    params: {
      address: `eq.${tokenAddress}`,
      key: `eq.${ownerAddress}`,
      select: "value::text",
    },
  });
  return data?.[0]?.value || "0";
};

const getShareBalance = async (
  accessToken: string,
  vaultAddress: string,
  ownerAddress: string
): Promise<string> => {
  const { data } = await cirrus.get(accessToken, `/${YieldVault}-_balances`, {
    params: {
      address: `eq.${vaultAddress}`,
      key: `eq.${ownerAddress}`,
      select: "value::text",
    },
  });
  return data?.[0]?.value || "0";
};

const getFirstDepositDate = async (
  accessToken: string,
  vaultAddress: string
): Promise<{ timestamp: Date } | null> => {
  try {
    const { data } = await cirrus.get(accessToken, "/event", {
      params: {
        address: `eq.${vaultAddress}`,
        event_name: "eq.Deposit",
        select: "block_timestamp",
        order: "block_timestamp.asc",
        limit: "1",
      },
    });
    if (!data?.length || !data[0]?.block_timestamp) return null;
    return { timestamp: new Date(data[0].block_timestamp) };
  } catch {
    return null;
  }
};

const getHistoricalStorageSnapshot = async (
  accessToken: string,
  vaultAddress: string,
  timestampIso: string
): Promise<{ totalSupply: bigint; deployedAssets: bigint } | null> => {
  try {
    const { data } = await cirrus.get(accessToken, "/history@storage", {
      params: {
        address: `eq.${vaultAddress}`,
        valid_from: `lte.${timestampIso}`,
        valid_to: `gte.${timestampIso}`,
        select: "data",
      },
    });
    const storageData = data?.[0]?.data;
    if (!storageData) return null;
    return {
      totalSupply: parseBigIntLike(storageData._totalSupply),
      deployedAssets: parseBigIntLike(storageData.deployedAssets),
    };
  } catch {
    return null;
  }
};

const getHistoricalAssetBalance = async (
  accessToken: string,
  tokenAddress: string,
  holderAddress: string,
  timestampIso: string
): Promise<bigint> => {
  try {
    const { data } = await cirrus.get(accessToken, "/history@mapping", {
      params: {
        select: "value::text",
        address: `eq.${tokenAddress}`,
        collection_name: "eq._balances",
        "key->>key": `eq.${holderAddress}`,
        valid_from: `lte.${timestampIso}`,
        valid_to: `gte.${timestampIso}`,
      },
    });
    return parseBigIntLike(data?.[0]?.value);
  } catch {
    return 0n;
  }
};

const computeApy = async (
  accessToken: string,
  vaultAddress: string,
  assetAddress: string,
  totalAssetsNow: bigint,
  totalSharesNow: bigint
): Promise<string> => {
  if (!vaultAddress || !assetAddress || totalSharesNow <= 0n || totalAssetsNow <= 0n) {
    return "0.00";
  }

  try {
    const firstDeposit = await getFirstDepositDate(accessToken, vaultAddress);
    if (!firstDeposit?.timestamp) return "0.00";

    const nowMs = Date.now();
    const thirtyDaysAgoMs = nowMs - 30 * DAY_MS;
    const inceptionMs = firstDeposit.timestamp.getTime();
    if (!Number.isFinite(inceptionMs)) return "-";

    const startMs = Math.max(thirtyDaysAgoMs, inceptionMs);
    const lookbackDays = Math.max(1, (nowMs - startMs) / DAY_MS);
    const startTimestamp = new Date(startMs + 1).toISOString();

    const [historicalStorage, historicalAssetBal] = await Promise.all([
      getHistoricalStorageSnapshot(accessToken, vaultAddress, startTimestamp),
      getHistoricalAssetBalance(accessToken, assetAddress, vaultAddress, startTimestamp),
    ]);

    if (!historicalStorage) return "-";

    const rateNow = getExchangeRate(totalAssetsNow, totalSharesNow);
    const historicalTotalAssets = (historicalAssetBal > 0n ? historicalAssetBal : 0n) + historicalStorage.deployedAssets;
    const rateStart = getExchangeRate(
      historicalTotalAssets,
      historicalStorage.totalSupply > 0n ? historicalStorage.totalSupply : 0n
    );

    if (rateStart <= 0n) return "0.00";

    const periodReturnScaled = ((rateNow - rateStart) * WAD) / rateStart;
    const periodReturn = Number(periodReturnScaled) / 1e18;
    if (!Number.isFinite(periodReturn) || periodReturn <= -1) return "-";

    const annualizationDays = Math.max(30, lookbackDays);
    const apy = (Math.pow(1 + periodReturn, 365 / annualizationDays) - 1) * 100;
    if (!Number.isFinite(apy)) return "-";
    return apy.toFixed(2);
  } catch {
    return "-";
  }
};

export const getYieldVaultInfo = async (
  _accessToken: string,
  key: string
): Promise<YieldVaultInfo> => {
  const def = resolveVaultDef(key);
  const fallback = emptyInfo(def, key);
  if (!def?.address) return fallback;

  // All vault-level reads use the service token so every caller sees the same
  // public state (deployedAssets, _underlyingDecimals, oracle prices, etc.)
  // regardless of Cirrus column-level ACL on their personal token.
  const serviceToken = await getServiceToken();

  const vaultState = await getVaultState(def.address);
  if (!vaultState) return fallback;
  if (!vaultState.vaultInitialized) return { ...fallback, configured: true };

  const assetAddress = vaultState._asset || "";
  if (!assetAddress) return fallback;

  const [assetTokenData, liveAssetBalance, filteredPrices] = await Promise.all([
    cirrus.get(serviceToken, `/${Token}`, {
      params: { address: `eq.${assetAddress}`, select: "_symbol" },
    }),
    getAssetBalance(serviceToken, assetAddress, def.address),
    getOraclePrices(serviceToken, {
      key: `eq.${assetAddress}`,
      select: "asset:key,price:value::text",
    }),
  ]);

  const idleAssets = parseBigIntLike(liveAssetBalance);
  const deployedAssets = parseBigIntLike(vaultState.deployedAssets);
  const totalAssets = idleAssets + deployedAssets;
  const totalShares = parseBigIntLike(vaultState._totalSupply);
  const decimals = Number(vaultState._underlyingDecimals ?? 18);
  const exchangeRate = getExchangeRate(totalAssets, totalShares);

  let assetPrice = parseBigIntLike(
    filteredPrices.get(assetAddress) || filteredPrices.get(assetAddress.toLowerCase()) || "0"
  );
  if (assetPrice <= 0n) {
    const allPrices = await getOraclePrices(serviceToken);
    const norm = assetAddress.toLowerCase().replace(/^0x/, "");
    for (const [k, v] of allPrices) {
      if (!k || !v) continue;
      if (k.toLowerCase().replace(/^0x/, "") === norm) {
        assetPrice = parseBigIntLike(v);
        break;
      }
    }
  }
  const tvlUsd = underlyingUsdWad(idleAssets + deployedAssets, assetPrice, decimals);
  const apy = await computeApy(serviceToken, def.address, assetAddress, totalAssets, totalShares);

  return {
    key,
    configured: true,
    deployed: true,
    vaultAddress: def.address,
    assetAddress,
    assetSymbol: assetTokenData?.data?.[0]?._symbol || def.assetSymbol,
    shareSymbol: vaultState._symbol || def.shareSymbol,
    name: def.name,
    decimals,
    totalAssets: totalAssets.toString(),
    idleAssets: idleAssets.toString(),
    totalShares: totalShares.toString(),
    exchangeRate: exchangeRate.toString(),
    assetPriceWad: assetPrice.toString(),
    tvlUsd: tvlUsd.toString(),
    apy,
    paused: Boolean(vaultState._paused),
  };
};

export const getYieldVaultUserInfo = async (
  accessToken: string,
  key: string,
  userAddress: string
): Promise<YieldVaultUserInfo> => {
  const info = await getYieldVaultInfo(accessToken, key);
  const def = resolveVaultDef(key);
  if (!info.deployed) return emptyUserInfo(def, key);

  const [walletAssetsRaw, userSharesRaw] = await Promise.all([
    getAssetBalance(accessToken, info.assetAddress, userAddress),
    getShareBalance(accessToken, info.vaultAddress, userAddress),
  ]);

  const walletAssets = parseBigIntLike(walletAssetsRaw);
  const userShares = parseBigIntLike(userSharesRaw);
  const totalAssets = parseBigIntLike(info.totalAssets);
  const idleAssets = parseBigIntLike(info.idleAssets);
  const totalShares = parseBigIntLike(info.totalShares);

  const redeemableAssets =
    userShares > 0n && totalShares > 0n
      ? (userShares * (totalAssets + 1n)) / (totalShares + 1n)
      : 0n;

  const idleShares =
    totalAssets > 0n && totalShares > 0n
      ? (idleAssets * (totalShares + 1n)) / (totalAssets + 1n)
      : idleAssets;
  const maxRedeem = userShares < idleShares ? userShares : idleShares;

  const assetPrice = parseBigIntLike(info.assetPriceWad);
  const positionUsd = underlyingUsdWad(redeemableAssets, assetPrice, info.decimals);

  return {
    ...info,
    walletAssets: walletAssets.toString(),
    userShares: userShares.toString(),
    redeemableAssets: redeemableAssets.toString(),
    positionUsd: positionUsd.toString(),
    maxDeposit: walletAssets.toString(),
    maxRedeem: maxRedeem.toString(),
  };
};

export const depositYieldVault = async (
  accessToken: string,
  key: string,
  userAddress: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const info = await getYieldVaultInfo(accessToken, key);
  if (!info.deployed) throw new Error(`Yield vault ${key} is not deployed`);

  const txs: FunctionInput[] = [
    {
      contractName: "Token",
      contractAddress: info.assetAddress,
      method: "approve",
      args: { spender: info.vaultAddress, value: amount },
    },
    {
      contractName: "YieldVault",
      contractAddress: info.vaultAddress,
      method: "deposit",
      args: { assets: amount, receiver: userAddress },
    },
  ];

  const builtTx = await buildFunctionTx(txs, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const redeemYieldVault = async (
  accessToken: string,
  key: string,
  userAddress: string,
  sharesAmount: string
): Promise<{ status: string; hash: string }> => {
  const info = await getYieldVaultInfo(accessToken, key);
  if (!info.deployed) throw new Error(`Yield vault ${key} is not deployed`);

  const builtTx = await buildFunctionTx(
    {
      contractName: "YieldVault",
      contractAddress: info.vaultAddress,
      method: "redeem",
      args: { shares: sharesAmount, receiver: userAddress, ownerAddr: userAddress },
    },
    userAddress,
    accessToken
  );

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const redeemAllYieldVault = async (
  accessToken: string,
  key: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const userInfo = await getYieldVaultUserInfo(accessToken, key, userAddress);
  const redeemable = parseBigIntLike(userInfo.maxRedeem);
  if (redeemable <= 0n) {
    throw new Error("No redeemable shares (vault may have capital deployed or no shares held)");
  }
  return await redeemYieldVault(accessToken, key, userAddress, userInfo.maxRedeem);
};
