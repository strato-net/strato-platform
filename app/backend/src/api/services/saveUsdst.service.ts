import { cirrus, strato } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";
import { getOraclePrices } from "./oracle.service";
import { FunctionInput } from "../../types/types";
import { computePerSecondRateApy } from "../helpers/earnYield.helper";
import { getHistoryParams } from "../helpers/history.helper";

const { SaveUSDSTVault, Token, USDST } = constants;

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;

export interface SaveUsdstInfo {
  configured: boolean;
  deployed: boolean;
  vaultAddress: string;
  assetAddress: string;
  assetSymbol: string;
  shareSymbol: string;
  totalManagedAssets: string;
  totalAssets: string;
  pricingAssets: string;
  projectedPricingAssets: string;
  tvlUsd: string;
  projectedTvlUsd: string;
  totalShares: string;
  exchangeRate: string;
  projectedExchangeRate: string;
  pendingAccrual: string;
  pendingAccrualTarget: string;
  apy: string;
  paused: boolean;
}

export interface SaveUsdstUserInfo extends SaveUsdstInfo {
  walletAssets: string;
  userShares: string;
  redeemableAssets: string;
  projectedRedeemableAssets: string;
  maxDeposit: string;
  maxRedeem: string;
  maxWithdraw: string;
  userTotalDepositedAssets: string;
  userTotalWithdrawnAssets: string;
  userNetDepositedAssets: string;
  userAllTimeEarningsAssets: string;
}

export interface SaveUsdstHistoryPoint {
  timestamp: number;
  exchangeRate: string;
  pricingAssets: string;
  totalShares: string;
}

export interface SaveUsdstActionState {
  vaultAddress: string;
  assetAddress: string;
  shareSymbol: string;
  projectedExchangeRate: string;
  paused: boolean;
}

const emptyInfo = (): SaveUsdstInfo => ({
  configured: Boolean(config.saveUsdstVault),
  deployed: false,
  vaultAddress: config.saveUsdstVault || "",
  assetAddress: USDST,
  assetSymbol: "USDST",
  shareSymbol: "saveUSDST",
  totalManagedAssets: "0",
  totalAssets: "0",
  pricingAssets: "0",
  projectedPricingAssets: "0",
  tvlUsd: "0",
  projectedTvlUsd: "0",
  totalShares: "0",
  exchangeRate: WAD.toString(),
  projectedExchangeRate: WAD.toString(),
  pendingAccrual: "0",
  pendingAccrualTarget: "0",
  apy: "-",
  paused: false,
});

const emptyUserInfo = (): SaveUsdstUserInfo => ({
  ...emptyInfo(),
  walletAssets: "0",
  userShares: "0",
  redeemableAssets: "0",
  projectedRedeemableAssets: "0",
  maxDeposit: "0",
  maxRedeem: "0",
  maxWithdraw: "0",
  userTotalDepositedAssets: "0",
  userTotalWithdrawnAssets: "0",
  userNetDepositedAssets: "0",
  userAllTimeEarningsAssets: "0",
});

const normalizeAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

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

const parseEventAttributes = (attributes: unknown): Record<string, any> => {
  if (!attributes) return {};
  if (typeof attributes === "string") {
    try {
      return JSON.parse(attributes);
    } catch {
      return {};
    }
  }
  if (typeof attributes === "object") return attributes as Record<string, any>;
  return {};
};

const getExchangeRate = (pricingAssets: bigint, totalShares: bigint): bigint => {
  if (totalShares <= 0n) return WAD;
  if (pricingAssets <= 0n) return 0n;
  return (pricingAssets * WAD) / totalShares;
};

const minBigInt = (...values: bigint[]): bigint =>
  values.reduce((min, value) => value < min ? value : min);

const parseCirrusTimestamp = (value: string | undefined | null): number => {
  if (!value) return 0;
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) return parsed;

  const fallback = Date.parse(value);
  return Number.isFinite(fallback) ? fallback : 0;
};

const isHistoricalRowActive = (
  row: { valid_from?: string; valid_to?: string },
  timestamp: number
): boolean => {
  const validFrom = parseCirrusTimestamp(row.valid_from);
  const validTo = row.valid_to === "infinity"
    ? Number.MAX_SAFE_INTEGER
    : parseCirrusTimestamp(row.valid_to);

  return validFrom <= timestamp && timestamp <= validTo;
};

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

const requireSaveUsdstVaultAddress = (): string => {
  const vaultAddress = config.saveUsdstVault || process.env.SAVE_USDST_VAULT || "";
  if (!vaultAddress) {
    throw new Error("SAVE_USDST_VAULT is not configured");
  }
  return vaultAddress;
};

export const getSaveUsdstActionState = async (
  accessToken: string
): Promise<SaveUsdstActionState | null> => {
  const info = await getSaveUsdstInfo(accessToken);
  if (!info.deployed) return null;

  return {
    vaultAddress: info.vaultAddress,
    assetAddress: info.assetAddress,
    shareSymbol: info.shareSymbol,
    projectedExchangeRate: info.projectedExchangeRate,
    paused: info.paused,
  };
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

const getTokenAllowance = async (
  accessToken: string,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<string> => {
  const { data } = await cirrus.get(accessToken, `/${Token}-_allowances`, {
    params: {
      address: `eq.${tokenAddress}`,
      key: `eq.${ownerAddress}`,
      key2: `eq.${spenderAddress}`,
      select: "value::text",
      limit: "1",
    },
  });

  return data?.[0]?.value || "0";
};

const getVaultShareBalance = async (
  accessToken: string,
  vaultAddress: string,
  ownerAddress: string
): Promise<string> => {
  const { data } = await cirrus.get(accessToken, `/${SaveUSDSTVault}-_balances`, {
    params: {
      address: `eq.${vaultAddress}`,
      key: `eq.${ownerAddress}`,
      select: "value::text",
    },
  });

  if (data?.[0]?.value) {
    return data[0].value;
  }

  return await getAssetBalance(accessToken, vaultAddress, ownerAddress);
};

const getVaultState = async (accessToken: string): Promise<Record<string, any> | null> => {
  if (!config.saveUsdstVault) {
    return null;
  }

  const [{ data }, { data: storageRows }] = await Promise.all([
    cirrus.get(accessToken, `/${SaveUSDSTVault}`, {
      params: {
        address: `eq.${config.saveUsdstVault}`,
        select: "address,assetToken,_managedAssets::text,_paused,_symbol,_totalSupply::text",
      },
    }),
    cirrus.get(accessToken, "/storage", {
      params: {
        address: `eq.${config.saveUsdstVault}`,
        select: "data->>perSecondSavingsRate,data->>lastAccrual,data->>rewardDistributor",
        limit: "1",
      },
    }),
  ]);

  return data?.[0] ? { ...data[0], ...storageRows?.[0] } : null;
};

const getPendingAccrual = async (
  accessToken: string,
  vaultState: Record<string, any>,
  vaultAddress: string,
  assetAddress: string,
  totalManagedAssets: bigint,
  totalShares: bigint
): Promise<{ targetAmount: bigint; fundedAmount: bigint }> => {
  const perSecondSavingsRate = parseBigIntLike(vaultState.perSecondSavingsRate);
  const lastAccrual = parseBigIntLike(vaultState.lastAccrual);
  const rewardDistributor = vaultState.rewardDistributor || "";
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  if (
    totalShares <= 0n ||
    totalManagedAssets <= 0n ||
    perSecondSavingsRate <= RAY ||
    nowSec <= lastAccrual ||
    isZeroAddress(rewardDistributor)
  ) {
    return { targetAmount: 0n, fundedAmount: 0n };
  }

  const growthFactor = rpow(perSecondSavingsRate, nowSec - lastAccrual, RAY);
  const targetAmount = (totalManagedAssets * (growthFactor - RAY)) / RAY;
  if (targetAmount <= 0n) {
    return { targetAmount: 0n, fundedAmount: 0n };
  }

  let fundedAmount = 0n;
  try {
    const [distributorBalanceRaw, allowanceRaw] = await Promise.all([
      getAssetBalance(accessToken, assetAddress, rewardDistributor),
      getTokenAllowance(accessToken, assetAddress, rewardDistributor, vaultAddress),
    ]);

    fundedAmount = minBigInt(
      targetAmount,
      parseBigIntLike(distributorBalanceRaw),
      parseBigIntLike(allowanceRaw)
    );
  } catch {
    fundedAmount = 0n;
  }

  return { targetAmount, fundedAmount };
};

const getUserFlowTotals = async (
  accessToken: string,
  vaultAddress: string,
  userAddress: string
): Promise<{ totalDepositedAssets: bigint; totalWithdrawnAssets: bigint }> => {
  const normalizedUser = normalizeAddress(userAddress);
  if (!vaultAddress || !normalizedUser) {
    return { totalDepositedAssets: 0n, totalWithdrawnAssets: 0n };
  }

  const pageSize = 1000;
  let offset = 0;
  let totalDepositedAssets = 0n;
  let totalWithdrawnAssets = 0n;

  try {
    while (true) {
      const response = await cirrus.get(accessToken, "/event", {
        params: {
          address: `eq.${vaultAddress}`,
          event_name: "in.(Deposit,Withdraw)",
          select: "event_name,attributes,transaction_sender,block_timestamp",
          order: "block_timestamp.asc",
          limit: `${pageSize}`,
          offset: `${offset}`,
        },
      });

      const events = response?.data || [];
      if (!Array.isArray(events) || events.length === 0) break;

      for (const event of events) {
        const attrs = parseEventAttributes(event.attributes);
        const actor = normalizeAddress(
          attrs.owner ||
            attrs.ownerAddress ||
            attrs.receiver ||
            attrs.caller ||
            event.transaction_sender
        );

        if (!actor || actor !== normalizedUser) continue;

        if (event.event_name === "Deposit") {
          totalDepositedAssets += parseBigIntLike(attrs.assets);
        } else if (event.event_name === "Withdraw") {
          totalWithdrawnAssets += parseBigIntLike(attrs.assets);
        }
      }

      if (events.length < pageSize) break;
      offset += pageSize;
    }
  } catch (error) {
    console.warn("Failed to compute saveUSDST flow totals:", error);
  }

  return { totalDepositedAssets, totalWithdrawnAssets };
};

export const getSaveUsdstInfo = async (accessToken: string): Promise<SaveUsdstInfo> => {
  const fallback = emptyInfo();
  const vaultState = await getVaultState(accessToken);

  if (!vaultState) {
    return fallback;
  }

  const vaultAddress = vaultState.address || config.saveUsdstVault;
  const assetAddress = vaultState.assetToken || USDST;
  const [assetToken, liveAssetBalance, assetPriceMap] = await Promise.all([
    cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `eq.${assetAddress}`,
        select: "_symbol",
      },
    }),
    getAssetBalance(accessToken, assetAddress, vaultAddress),
    getOraclePrices(accessToken, {
      key: `eq.${assetAddress}`,
      select: "asset:key,price:value::text",
    }),
  ]);

  const totalManagedAssets = parseBigIntLike(vaultState._managedAssets);
  const totalAssets = parseBigIntLike(liveAssetBalance);
  const pricingAssets = totalAssets < totalManagedAssets ? totalAssets : totalManagedAssets;
  const assetPrice = parseBigIntLike(
    assetPriceMap.get(assetAddress) || assetPriceMap.get(assetAddress.toLowerCase()) || "0"
  );
  const tvlUsd = assetPrice > 0n ? (pricingAssets * assetPrice) / WAD : 0n;
  const totalShares = parseBigIntLike(vaultState._totalSupply);
  const exchangeRate = getExchangeRate(pricingAssets, totalShares);
  const pendingAccrual = await getPendingAccrual(
    accessToken,
    vaultState,
    vaultAddress,
    assetAddress,
    totalManagedAssets,
    totalShares
  );
  const projectedPricingAssets = pricingAssets + pendingAccrual.fundedAmount;
  const projectedTvlUsd = assetPrice > 0n ? (projectedPricingAssets * assetPrice) / WAD : 0n;
  const projectedExchangeRate = getExchangeRate(projectedPricingAssets, totalShares);
  const apy = computePerSecondRateApy(vaultState.perSecondSavingsRate);

  return {
    configured: true,
    deployed: true,
    vaultAddress,
    assetAddress,
    assetSymbol: assetToken?.data?.[0]?._symbol || "USDST",
    shareSymbol: vaultState._symbol || "saveUSDST",
    totalManagedAssets: totalManagedAssets.toString(),
    totalAssets: totalAssets.toString(),
    pricingAssets: pricingAssets.toString(),
    projectedPricingAssets: projectedPricingAssets.toString(),
    tvlUsd: tvlUsd.toString(),
    projectedTvlUsd: projectedTvlUsd.toString(),
    totalShares: totalShares.toString(),
    exchangeRate: exchangeRate.toString(),
    projectedExchangeRate: projectedExchangeRate.toString(),
    pendingAccrual: pendingAccrual.fundedAmount.toString(),
    pendingAccrualTarget: pendingAccrual.targetAmount.toString(),
    apy,
    paused: Boolean(vaultState._paused),
  };
};

export const getSaveUsdstUserInfo = async (
  accessToken: string,
  userAddress: string
): Promise<SaveUsdstUserInfo> => {
  const info = await getSaveUsdstInfo(accessToken);
  if (!info.deployed) {
    return {
      ...emptyUserInfo(),
      configured: info.configured,
      vaultAddress: info.vaultAddress,
    };
  }

  const [walletAssetsRaw, userSharesRaw, flows] = await Promise.all([
    getAssetBalance(accessToken, info.assetAddress, userAddress),
    getVaultShareBalance(accessToken, info.vaultAddress, userAddress),
    getUserFlowTotals(accessToken, info.vaultAddress, userAddress),
  ]);

  const walletAssets = parseBigIntLike(walletAssetsRaw);
  const userShares = parseBigIntLike(userSharesRaw);
  const pricingAssets = parseBigIntLike(info.pricingAssets);
  const projectedPricingAssets = parseBigIntLike(info.projectedPricingAssets);
  const totalShares = parseBigIntLike(info.totalShares);
  const redeemableAssets =
    userShares > 0n && totalShares > 0n && pricingAssets > 0n
      ? (userShares * pricingAssets) / totalShares
      : 0n;
  const projectedRedeemableAssets =
    userShares > 0n && totalShares > 0n && projectedPricingAssets > 0n
      ? (userShares * projectedPricingAssets) / totalShares
      : 0n;

  const userNetDepositedAssets = flows.totalDepositedAssets - flows.totalWithdrawnAssets;
  const userAllTimeEarningsAssets = projectedRedeemableAssets - userNetDepositedAssets;

  return {
    ...info,
    walletAssets: walletAssets.toString(),
    userShares: userShares.toString(),
    redeemableAssets: redeemableAssets.toString(),
    projectedRedeemableAssets: projectedRedeemableAssets.toString(),
    maxDeposit: info.paused ? "0" : walletAssets.toString(),
    maxRedeem: info.paused ? "0" : userShares.toString(),
    maxWithdraw: info.paused ? "0" : projectedRedeemableAssets.toString(),
    userTotalDepositedAssets: flows.totalDepositedAssets.toString(),
    userTotalWithdrawnAssets: flows.totalWithdrawnAssets.toString(),
    userNetDepositedAssets: userNetDepositedAssets.toString(),
    userAllTimeEarningsAssets: userAllTimeEarningsAssets.toString(),
  };
};

export const getSaveUsdstHistory = async (
  accessToken: string,
  duration = "all",
  end?: string
): Promise<SaveUsdstHistoryPoint[]> => {
  const vaultState = await getVaultState(accessToken);
  if (!vaultState) return [];

  const vaultAddress = vaultState.address || config.saveUsdstVault;
  const assetAddress = vaultState.assetToken || USDST;
  const params = getHistoryParams(duration, end, 90);
  const startTime = new Date(params.endTimestamp - (params.interval * params.numTicks)).toISOString();
  const endTime = new Date(params.endTimestamp).toISOString();

  const [storageRes, balanceRes] = await Promise.all([
    cirrus.get(accessToken, "/history@storage", {
      params: {
        address: `eq.${vaultAddress}`,
        valid_from: `lte.${endTime}`,
        valid_to: `gte.${startTime}`,
        select: "data,valid_from,valid_to",
      },
    }),
    cirrus.get(accessToken, "/history@mapping", {
      params: {
        address: `eq.${assetAddress}`,
        collection_name: "eq._balances",
        "key->>key": `eq.${vaultAddress}`,
        valid_from: `lte.${endTime}`,
        valid_to: `gte.${startTime}`,
        select: "value::text,valid_from,valid_to",
      },
    }),
  ]);

  const storageRows = Array.isArray(storageRes.data) ? storageRes.data : [];
  const balanceRows = Array.isArray(balanceRes.data) ? balanceRes.data : [];
  const points: SaveUsdstHistoryPoint[] = [];

  for (let i = 0; i <= params.numTicks; i += 1) {
    const timestamp = params.endTimestamp - (params.interval * (params.numTicks - i));
    const storage = storageRows.find((row: any) => isHistoricalRowActive(row, timestamp));
    if (!storage?.data) continue;

    const balance = balanceRows.find((row: any) => isHistoricalRowActive(row, timestamp));
    const totalManagedAssets = parseBigIntLike(storage.data._managedAssets);
    const totalShares = parseBigIntLike(storage.data._totalSupply);
    const totalAssets = parseBigIntLike(balance?.value);
    const pricingAssets = totalAssets < totalManagedAssets ? totalAssets : totalManagedAssets;
    const exchangeRate = getExchangeRate(pricingAssets, totalShares);

    if (totalShares <= 0n || exchangeRate <= 0n) continue;

    points.push({
      timestamp,
      exchangeRate: exchangeRate.toString(),
      pricingAssets: pricingAssets.toString(),
      totalShares: totalShares.toString(),
    });
  }

  return points;
};

export const depositSaveUsdst = async (
  accessToken: string,
  userAddress: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const info = await getSaveUsdstInfo(accessToken);
  const vaultAddress = requireSaveUsdstVaultAddress();
  if (!info.deployed) {
    throw new Error("saveUSDST vault is not deployed");
  }

  const txs: FunctionInput[] = [
    {
      contractName: "Token",
      contractAddress: info.assetAddress || USDST,
      method: "approve",
      args: {
        spender: vaultAddress,
        value: amount,
      },
    },
    {
      contractName: "SaveUSDSTVault",
      contractAddress: vaultAddress,
      method: "deposit",
      args: {
        assets: amount,
        receiver: userAddress,
      },
    },
  ];

  const builtTx = await buildFunctionTx(txs, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const redeemSaveUsdst = async (
  accessToken: string,
  userAddress: string,
  sharesAmount: string
): Promise<{ status: string; hash: string }> => {
  const info = await getSaveUsdstInfo(accessToken);
  const vaultAddress = requireSaveUsdstVaultAddress();
  if (!info.deployed) {
    throw new Error("saveUSDST vault is not deployed");
  }

  const builtTx = await buildFunctionTx(
    {
      contractName: "SaveUSDSTVault",
      contractAddress: vaultAddress,
      method: "redeem",
      args: {
        shares: sharesAmount,
        receiver: userAddress,
        ownerAddress: userAddress,
      },
    },
    userAddress,
    accessToken
  );

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const redeemAllSaveUsdst = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const userInfo = await getSaveUsdstUserInfo(accessToken, userAddress);
  if (parseBigIntLike(userInfo.userShares) <= 0n) {
    throw new Error("No saveUSDST shares to redeem");
  }

  return await redeemSaveUsdst(accessToken, userAddress, userInfo.userShares);
};
