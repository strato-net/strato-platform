import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";
import { getOraclePrices } from "./oracle.service";
import { FunctionInput } from "../../types/types";

const { SaveUSDSTVault, Token, USDST } = constants;

const WAD = 10n ** 18n;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  tvlUsd: string;
  totalShares: string;
  exchangeRate: string;
  apy: string;
  paused: boolean;
}

export interface SaveUsdstUserInfo extends SaveUsdstInfo {
  walletAssets: string;
  userShares: string;
  redeemableAssets: string;
  maxDeposit: string;
  maxRedeem: string;
  maxWithdraw: string;
  userTotalDepositedAssets: string;
  userTotalWithdrawnAssets: string;
  userNetDepositedAssets: string;
  userAllTimeEarningsAssets: string;
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
  tvlUsd: "0",
  totalShares: "0",
  exchangeRate: WAD.toString(),
  apy: "-",
  paused: false,
});

const emptyUserInfo = (): SaveUsdstUserInfo => ({
  ...emptyInfo(),
  walletAssets: "0",
  userShares: "0",
  redeemableAssets: "0",
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

const getFirstSaveUsdstDepositDate = async (
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

    if (!data?.length || !data[0]?.block_timestamp) {
      return null;
    }

    return { timestamp: new Date(data[0].block_timestamp) };
  } catch (error) {
    console.warn("Failed to fetch first saveUSDST deposit timestamp:", error);
    return null;
  }
};

const getHistoricalVaultStorageSnapshot = async (
  accessToken: string,
  vaultAddress: string,
  timestampIso: string
): Promise<{ managedAssets: bigint; totalShares: bigint } | null> => {
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
    if (!storageData) {
      return null;
    }

    return {
      managedAssets: parseBigIntLike(storageData._managedAssets),
      totalShares: parseBigIntLike(storageData._totalSupply),
    };
  } catch (error) {
    console.warn("Failed to fetch historical saveUSDST storage snapshot:", error);
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
  } catch (error) {
    console.warn("Failed to fetch historical saveUSDST asset balance:", error);
    return 0n;
  }
};

const getSaveUsdstApy = async (
  accessToken: string,
  vaultAddress: string,
  assetAddress: string,
  pricingAssetsNow: bigint,
  totalSharesNow: bigint
): Promise<string> => {
  if (!vaultAddress || !assetAddress || totalSharesNow <= 0n || pricingAssetsNow <= 0n) {
    return "0.00";
  }

  try {
    const firstDeposit = await getFirstSaveUsdstDepositDate(accessToken, vaultAddress);
    if (!firstDeposit?.timestamp) {
      return "0.00";
    }

    const nowMs = Date.now();
    const thirtyDaysAgoMs = nowMs - 30 * DAY_MS;
    const inceptionMs = firstDeposit.timestamp.getTime();
    if (!Number.isFinite(inceptionMs)) {
      return "-";
    }

    const startMs = Math.max(thirtyDaysAgoMs, inceptionMs);
    const lookbackDays = Math.max(1, (nowMs - startMs) / DAY_MS);
    const startTimestamp = new Date(startMs + 1).toISOString();

    const [historicalStorage, historicalAssetBalance] = await Promise.all([
      getHistoricalVaultStorageSnapshot(accessToken, vaultAddress, startTimestamp),
      getHistoricalAssetBalance(accessToken, assetAddress, vaultAddress, startTimestamp),
    ]);

    if (!historicalStorage) {
      return "-";
    }

    const pricingAssetsStart =
      historicalAssetBalance < historicalStorage.managedAssets
        ? historicalAssetBalance
        : historicalStorage.managedAssets;
    const totalSharesStart = historicalStorage.totalShares;
    const rateNow = getExchangeRate(pricingAssetsNow, totalSharesNow);
    const rateStart = getExchangeRate(
      pricingAssetsStart > 0n ? pricingAssetsStart : 0n,
      totalSharesStart > 0n ? totalSharesStart : 0n
    );

    if (rateStart <= 0n) {
      return "0.00";
    }

    const periodReturnScaled = ((rateNow - rateStart) * WAD) / rateStart;
    const periodReturn = Number(periodReturnScaled) / 1e18;
    if (!Number.isFinite(periodReturn)) {
      return "-";
    }
    if (periodReturn <= -1) {
      return "-";
    }

    // Keep saveUSDST native APY on a stable 30-day annualization basis so
    // very new vault history does not explode the displayed yield.
    const annualizationDays = Math.max(30, lookbackDays);
    const apy = (Math.pow(1 + periodReturn, 365 / annualizationDays) - 1) * 100;
    if (!Number.isFinite(apy)) {
      return "-";
    }

    return apy.toFixed(2);
  } catch (error) {
    console.warn("Failed to compute saveUSDST APY:", error);
    return "-";
  }
};

const requireSaveUsdstVaultAddress = (): string => {
  const vaultAddress = config.saveUsdstVault || process.env.SAVE_USDST_VAULT || "";
  if (!vaultAddress) {
    throw new Error("SAVE_USDST_VAULT is not configured");
  }
  return vaultAddress;
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

  const { data } = await cirrus.get(accessToken, `/${SaveUSDSTVault}`, {
    params: {
      address: `eq.${config.saveUsdstVault}`,
      select: "address,assetToken,_managedAssets::text,_paused,_symbol,_totalSupply::text",
    },
  });

  return data?.[0] || null;
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
  const apy = await getSaveUsdstApy(
    accessToken,
    vaultAddress,
    assetAddress,
    pricingAssets,
    totalShares
  );

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
    tvlUsd: tvlUsd.toString(),
    totalShares: totalShares.toString(),
    exchangeRate: exchangeRate.toString(),
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
  const totalShares = parseBigIntLike(info.totalShares);
  const redeemableAssets =
    userShares > 0n && totalShares > 0n && pricingAssets > 0n
      ? (userShares * pricingAssets) / totalShares
      : 0n;

  const userNetDepositedAssets = flows.totalDepositedAssets - flows.totalWithdrawnAssets;
  const userAllTimeEarningsAssets = redeemableAssets - userNetDepositedAssets;

  return {
    ...info,
    walletAssets: walletAssets.toString(),
    userShares: userShares.toString(),
    redeemableAssets: redeemableAssets.toString(),
    maxDeposit: info.paused ? "0" : walletAssets.toString(),
    maxRedeem: info.paused ? "0" : userShares.toString(),
    maxWithdraw: info.paused ? "0" : redeemableAssets.toString(),
    userTotalDepositedAssets: flows.totalDepositedAssets.toString(),
    userTotalWithdrawnAssets: flows.totalWithdrawnAssets.toString(),
    userNetDepositedAssets: userNetDepositedAssets.toString(),
    userAllTimeEarningsAssets: userAllTimeEarningsAssets.toString(),
  };
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
