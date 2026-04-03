import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

const { Vault, Token } = constants;
const WAD = BigInt(10) ** BigInt(18);

export interface VaultPerformanceMetrics {
  apy: string;
  alpha: string;
}

export const safeBigInt = (value: string | null | undefined): bigint => {
  if (!value) return 0n;
  const trimmed = value.trim();
  if (trimmed === "") return 0n;
  if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed);

  const sciMatch = trimmed.match(/^(-?\d+\.?\d*)[eE]([+-]?\d+)$/);
  if (sciMatch) {
    const [, mantissa, exponent] = sciMatch;
    const exp = parseInt(exponent, 10);
    const [intPart, decPart = ""] = mantissa.replace("-", "").split(".");
    const isNegative = mantissa.startsWith("-");
    const combined = intPart + decPart;
    const shift = exp - decPart.length;

    let result: string;
    if (shift >= 0) {
      result = combined + "0".repeat(shift);
    } else {
      const cutPoint = combined.length + shift;
      result = cutPoint > 0 ? combined.slice(0, cutPoint) : "0";
    }

    return BigInt(isNegative ? "-" + result : result);
  }

  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return BigInt(trimmed.split(".")[0] || "0");
  }

  return 0n;
};

export const computeEquityFromMaps = (
  addrs: string[],
  balances: Map<string, string>,
  prices: Map<string, string>,
): bigint => addrs.reduce(
  (sum, addr) => sum + (safeBigInt(balances.get(addr)) * safeBigInt(prices.get(addr))) / WAD,
  0n
);

const getTokenTotalSupply = async (
  accessToken: string,
  tokenAddress: string
): Promise<string> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        select: "_totalSupply::text",
        address: `eq.${tokenAddress}`,
      },
    });

    return data?.[0]?._totalSupply || "0";
  } catch {
    return "0";
  }
};

const getHistoricalTokenBalance = async (
  accessToken: string,
  tokenAddress: string,
  holderAddress: string,
  date: string
): Promise<string> => {
  try {
    const { data } = await cirrus.get(accessToken, "/history@mapping", {
      params: {
        select: "value::text",
        address: `eq.${tokenAddress}`,
        collection_name: "eq._balances",
        "key->>key": `eq.${holderAddress}`,
        valid_from: `lte.${date}`,
        valid_to: `gte.${date}`,
      },
    });

    const value = data?.[0]?.value;
    if (!value || value === "") return "0";
    return value;
  } catch {
    return "0";
  }
};

const getHistoricalAssetPrice = async (
  accessToken: string,
  oracleAddress: string,
  assetAddress: string,
  date: string
): Promise<string> => {
  try {
    const { data } = await cirrus.get(accessToken, "/history@mapping", {
      params: {
        select: "value::text",
        address: `eq.${oracleAddress}`,
        collection_name: "eq.prices",
        "key->>key": `eq.${assetAddress}`,
        valid_from: `lte.${date}`,
        valid_to: `gte.${date}`,
      },
    });

    const value = data?.[0]?.value;
    if (!value || value === "") return "0";
    return value;
  } catch {
    return "0";
  }
};

const getFirstDepositDate = async (
  accessToken: string,
  vaultAddress: string
): Promise<{ date: string; timestamp: Date } | null> => {
  try {
    const { data: depositEvents } = await cirrus.get(accessToken, `/${Vault}-Deposited`, {
      params: {
        select: "block_timestamp",
        address: `eq.${vaultAddress}`,
        order: "block_timestamp.asc",
        limit: "1",
      },
    });

    if (!depositEvents?.length || !depositEvents[0]?.block_timestamp) {
      return null;
    }

    const timestamp = new Date(depositEvents[0].block_timestamp);
    const date = timestamp.toISOString().split("T")[0];
    return { date, timestamp };
  } catch {
    return null;
  }
};

export const computeVaultPerformanceMetrics = async (
  accessToken: string,
  vaultAddress: string,
  currentEquity: bigint,
  currentTotalShares: bigint,
  shareTokenAddress: string,
  botExecutor: string,
  priceOracleAddress: string,
  supportedAssets: string[],
  currentPrices: Map<string, string>
): Promise<VaultPerformanceMetrics> => {
  const noData = { apy: "-", alpha: "-" };
  try {
    if (currentTotalShares <= 0n || currentEquity <= 0n) return noData;

    const currentNAV = (currentEquity * WAD) / currentTotalShares;
    const firstDeposit = await getFirstDepositDate(accessToken, vaultAddress);
    if (!firstDeposit) return noData;

    const now = new Date();
    const dayAfterFirstDeposit = new Date(firstDeposit.timestamp.getTime() + 24 * 60 * 60 * 1000);
    const earliestStartDate = dayAfterFirstDeposit.toISOString().split("T")[0];
    const todayStr = now.toISOString().split("T")[0];
    if (earliestStartDate >= todayStr) return noData;

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = thirtyDaysAgo >= dayAfterFirstDeposit
      ? thirtyDaysAgo.toISOString().split("T")[0]
      : earliestStartDate;

    const startDateObj = new Date(startDate + "T00:00:00Z");
    const actualDays = Math.max((now.getTime() - startDateObj.getTime()) / (24 * 60 * 60 * 1000), 1);

    const { data: histStorage } = await cirrus.get(accessToken, "/history@storage", {
      params: {
        address: `eq.${shareTokenAddress}`,
        valid_from: `lte.${startDate}`,
        valid_to: `gte.${startDate}`,
        select: "data",
      },
    });
    const histTotalSupply = safeBigInt(histStorage?.[0]?.data?._totalSupply);
    if (histTotalSupply <= 0n) return noData;

    let histEquity = 0n;
    let hodlEquity = 0n;
    for (const assetAddress of supportedAssets) {
      const histBalanceBN = safeBigInt(await getHistoricalTokenBalance(accessToken, assetAddress, botExecutor, startDate));
      const histPriceBN = safeBigInt(await getHistoricalAssetPrice(accessToken, priceOracleAddress, assetAddress, startDate));

      if (histPriceBN > 0n) {
        histEquity += (histBalanceBN * histPriceBN) / WAD;
      }

      const currentPriceBN = safeBigInt(currentPrices.get(assetAddress));
      if (currentPriceBN > 0n) {
        hodlEquity += (histBalanceBN * currentPriceBN) / WAD;
      }
    }

    if (histEquity <= 0n) return noData;

    const histNAV = (histEquity * WAD) / histTotalSupply;
    if (histNAV <= 0n) return noData;

    const vaultReturn = Number(((currentNAV - histNAV) * WAD) / histNAV) / 1e18;
    if (vaultReturn <= -1 || !isFinite(vaultReturn)) return noData;

    const vaultApy = Math.pow(1 + vaultReturn, 365 / actualDays) - 1;

    const hodlReturn = Number(((hodlEquity - histEquity) * WAD) / histEquity) / 1e18;
    const hodlApy = hodlReturn <= -1 ? -1 : Math.pow(1 + hodlReturn, 365 / actualDays) - 1;

    const alpha = vaultApy - hodlApy;

    return {
      apy: (vaultApy * 100).toFixed(2),
      alpha: (alpha * 100).toFixed(2),
    };
  } catch {
    return noData;
  }
};
