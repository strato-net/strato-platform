/**
 * FixedPriceSale Service — read sale state from Cirrus and build buy/admin transactions.
 *
 * Reads mirror the on-chain math: USD value is in 1e18, payment amount is computed
 * via the on-chain PriceOracle reading (1e18 = $1) just like Vault.sol.
 */

import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { FunctionInput } from "../../types/types";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";

const {
  FixedPriceSale: FixedPriceSaleTable,
  Token,
  PriceOracle,
} = constants;

const WAD = 10n ** 18n;
// Fallback used only if the on-chain `priceQuantizationUSD` field is missing
// (e.g. pre-quantization sale deploys). Matches the contract's initializer default.
const DEFAULT_PRICE_QUANTIZATION = 10n ** 16n; // $0.01

/** Round `raw` to the nearest `step` using half-up rounding. Mirrors `_quantizedPaymentPrice` in FixedPriceSale.sol. */
const quantizePrice = (raw: bigint, step: bigint): bigint => {
  if (step <= 0n) return raw;
  return ((raw + step / 2n) / step) * step;
};

const safeBigInt = (value: string | number | null | undefined): bigint => {
  if (value === null || value === undefined) return 0n;
  const s = String(value).trim();
  if (s === "") return 0n;
  if (/^-?\d+$/.test(s)) return BigInt(s);
  if (/^-?\d+\.\d+$/.test(s)) return BigInt(s.split(".")[0] || "0");
  return 0n;
};

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface SalePaymentToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: string; // 1e18 = $1
  images?: { value: string }[];
}

export interface SaleInfo {
  address: string;
  saleToken: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    images?: { value: string }[];
  } | null;
  pricePerTokenUSD: string; // 1e18 = $1 (USD per sale token)
  hardCap: string;
  totalSold: string;
  remainingForSale: string;
  perWalletCap: string; // 0 = disabled
  inventory: string; // sale-token balance held by the sale contract
  startTime: string; // unix seconds
  endTime: string; // unix seconds
  paused: boolean;
  active: boolean;
  priceOracle: string;
  paymentTokens: SalePaymentToken[];
}

export interface UserSalePosition {
  purchased: string;
  remainingForWallet: string; // 0 if cap disabled OR cap fully consumed; see saleInfo.perWalletCap
}

export interface SalePurchaseRecord {
  buyer: string;
  paymentToken: string;
  paymentTokenSymbol: string;
  saleAmount: string;
  paymentAmount: string;
  usdValue: string;
  timestamp: string;
  hash?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const getSaleAddress = (): string | null => config.fixedPriceSale || null;

interface SaleRowState {
  address: string;
  saleToken: string;
  priceOracle: string;
  pricePerTokenUSD: string;
  hardCap: string;
  totalSold: string;
  perWalletCap: string;
  startTime: string;
  endTime: string;
  paused: boolean;
  priceQuantizationUSD: string;
  supportedPayments: string[];
}

const fetchSaleState = async (
  accessToken: string,
  saleAddress: string
): Promise<SaleRowState | null> => {
  try {
    const [{ data: saleRows }, { data: paymentRows }] = await Promise.all([
      cirrus.get(accessToken, `/${FixedPriceSaleTable}`, {
        params: {
          select:
            "address,saleToken,priceOracle,pricePerTokenUSD::text,hardCap::text,totalSold::text,perWalletCap::text,startTime::text,endTime::text,_paused,priceQuantizationUSD::text",
          address: `eq.${saleAddress}`,
        },
      }),
      cirrus.get(accessToken, `/${FixedPriceSaleTable}-supportedPayments`, {
        params: {
          select: "value",
          address: `eq.${saleAddress}`,
        },
      }),
    ]);

    const row = saleRows?.[0];
    if (!row) return null;

    return {
      address: row.address,
      saleToken: row.saleToken,
      priceOracle: row.priceOracle,
      pricePerTokenUSD: row.pricePerTokenUSD || "0",
      hardCap: row.hardCap || "0",
      totalSold: row.totalSold || "0",
      perWalletCap: row.perWalletCap || "0",
      startTime: row.startTime || "0",
      endTime: row.endTime || "0",
      paused: row._paused || false,
      priceQuantizationUSD: row.priceQuantizationUSD || DEFAULT_PRICE_QUANTIZATION.toString(),
      supportedPayments: (paymentRows || [])
        .map((p: any) => p.value)
        .filter((addr: string) => addr && addr !== constants.ZERO_ADDRESS),
    };
  } catch (error) {
    console.error("Error fetching sale state:", error);
    return null;
  }
};

const fetchTokenInfo = async (
  accessToken: string,
  tokenAddresses: string[]
): Promise<Map<string, { symbol: string; name: string; decimals: number; images?: { value: string }[] }>> => {
  const result = new Map<string, { symbol: string; name: string; decimals: number; images?: { value: string }[] }>();
  if (!tokenAddresses.length) return result;

  try {
    const { data } = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `in.(${tokenAddresses.join(",")})`,
        select: `address,_symbol,_name,customDecimals,images:${Token}-images(value)`,
      },
    });
    for (const t of data || []) {
      result.set(t.address, {
        symbol: t._symbol || "UNKNOWN",
        name: t._name || "Unknown Token",
        decimals: typeof t.customDecimals === "number" ? t.customDecimals : 18,
        images: t.images,
      });
    }
  } catch (error) {
    console.error("Error fetching token info:", error);
  }
  for (const addr of tokenAddresses) {
    if (!result.has(addr)) {
      result.set(addr, { symbol: "UNKNOWN", name: "Unknown Token", decimals: 18 });
    }
  }
  return result;
};

const fetchTokenBalance = async (
  accessToken: string,
  tokenAddress: string,
  holder: string
): Promise<string> => {
  try {
    const { data } = await cirrus.get(accessToken, `/${Token}-_balances`, {
      params: {
        select: "value::text",
        address: `eq.${tokenAddress}`,
        key: `eq.${holder}`,
      },
    });
    return data?.[0]?.value || "0";
  } catch (error) {
    console.error(`Error fetching balance for ${tokenAddress}:`, error);
    return "0";
  }
};

const fetchPrices = async (
  accessToken: string,
  oracleAddress: string,
  assetAddresses: string[]
): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  if (!assetAddresses.length || !oracleAddress) return result;
  try {
    const { data } = await cirrus.get(accessToken, `/${PriceOracle}-prices`, {
      params: {
        address: `eq.${oracleAddress}`,
        key: `in.(${assetAddresses.join(",")})`,
        select: "key,value::text",
      },
    });
    for (const row of data || []) {
      result.set(row.key, row.value || "0");
    }
  } catch (error) {
    console.error("Error fetching oracle prices:", error);
  }
  return result;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC READS
// ═══════════════════════════════════════════════════════════════════════════════

export const getSaleInfo = async (accessToken: string): Promise<SaleInfo | null> => {
  const saleAddress = getSaleAddress();
  if (!saleAddress) return null;

  const state = await fetchSaleState(accessToken, saleAddress);
  if (!state) return null;

  const tokenInfoMap = await fetchTokenInfo(accessToken, [
    state.saleToken,
    ...state.supportedPayments,
  ]);

  const [priceMap, inventoryRaw] = await Promise.all([
    fetchPrices(accessToken, state.priceOracle, state.supportedPayments),
    fetchTokenBalance(accessToken, state.saleToken, saleAddress),
  ]);

  const saleTokenInfo = tokenInfoMap.get(state.saleToken) || null;
  // Display the quantized price (what the contract will actually charge against),
  // not the raw oracle reading, so the UI matches the on-chain buy math.
  const quantizationStep = safeBigInt(state.priceQuantizationUSD) || DEFAULT_PRICE_QUANTIZATION;
  const paymentTokens: SalePaymentToken[] = state.supportedPayments.map((addr) => {
    const info = tokenInfoMap.get(addr) || { symbol: "UNKNOWN", name: "Unknown Token", decimals: 18 };
    const rawPrice = safeBigInt(priceMap.get(addr));
    const priceUsd = rawPrice > 0n ? quantizePrice(rawPrice, quantizationStep).toString() : "0";
    return {
      address: addr,
      symbol: info.symbol,
      name: info.name,
      decimals: info.decimals,
      priceUsd,
      images: info.images,
    };
  });

  const hardCapBN = safeBigInt(state.hardCap);
  const soldBN = safeBigInt(state.totalSold);
  const remainingBN = hardCapBN > soldBN ? hardCapBN - soldBN : 0n;

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const startBN = safeBigInt(state.startTime);
  const endBN = safeBigInt(state.endTime);
  const active = !state.paused && nowSec >= startBN && nowSec < endBN;

  return {
    address: saleAddress,
    saleToken: saleTokenInfo
      ? {
          address: state.saleToken,
          symbol: saleTokenInfo.symbol,
          name: saleTokenInfo.name,
          decimals: saleTokenInfo.decimals,
          images: saleTokenInfo.images,
        }
      : null,
    pricePerTokenUSD: state.pricePerTokenUSD,
    hardCap: state.hardCap,
    totalSold: state.totalSold,
    remainingForSale: remainingBN.toString(),
    perWalletCap: state.perWalletCap,
    inventory: inventoryRaw,
    startTime: state.startTime,
    endTime: state.endTime,
    paused: state.paused,
    active,
    priceOracle: state.priceOracle,
    paymentTokens,
  };
};

export const getUserPosition = async (
  accessToken: string,
  userAddress: string
): Promise<UserSalePosition> => {
  const saleAddress = getSaleAddress();
  if (!saleAddress) return { purchased: "0", remainingForWallet: "0" };

  try {
    const [{ data: purchasedRows }, { data: saleRows }] = await Promise.all([
      cirrus.get(accessToken, `/${FixedPriceSaleTable}-purchased`, {
        params: {
          select: "value::text",
          address: `eq.${saleAddress}`,
          key: `eq.${userAddress}`,
        },
      }),
      cirrus.get(accessToken, `/${FixedPriceSaleTable}`, {
        params: {
          select: "perWalletCap::text",
          address: `eq.${saleAddress}`,
        },
      }),
    ]);

    const purchased = purchasedRows?.[0]?.value || "0";
    const cap = safeBigInt(saleRows?.[0]?.perWalletCap || "0");
    const purchasedBN = safeBigInt(purchased);

    let remaining = "0";
    if (cap > 0n && cap > purchasedBN) {
      remaining = (cap - purchasedBN).toString();
    }
    return { purchased, remainingForWallet: remaining };
  } catch (error) {
    console.error("Error fetching user sale position:", error);
    return { purchased: "0", remainingForWallet: "0" };
  }
};

/**
 * Quote how much `paymentToken` is needed to buy `saleAmount` sale tokens.
 * Pure read — mirrors the on-chain quoteBuy math without consulting on-chain caps/window.
 */
export const quoteBuy = async (
  accessToken: string,
  paymentToken: string,
  saleAmount: string
): Promise<{ paymentAmount: string; usdValue: string; paymentPrice: string }> => {
  const saleAddress = getSaleAddress();
  if (!saleAddress) {
    throw new Error("Fixed price sale not configured");
  }

  const state = await fetchSaleState(accessToken, saleAddress);
  if (!state) {
    throw new Error("Sale not found");
  }
  if (!state.supportedPayments.includes(paymentToken)) {
    throw new Error("Payment token not supported");
  }

  const saleAmountBN = safeBigInt(saleAmount);
  if (saleAmountBN <= 0n) {
    throw new Error("saleAmount must be > 0");
  }

  const priceMap = await fetchPrices(accessToken, state.priceOracle, [paymentToken]);
  const rawPaymentPrice = safeBigInt(priceMap.get(paymentToken));
  if (rawPaymentPrice <= 0n) {
    throw new Error("Oracle returned zero price for payment token");
  }
  // Apply the same half-up quantization the contract uses so the quoted
  // paymentAmount matches what `buy()` will actually charge.
  const quantizationStep = safeBigInt(state.priceQuantizationUSD) || DEFAULT_PRICE_QUANTIZATION;
  const paymentPrice = quantizePrice(rawPaymentPrice, quantizationStep);
  if (paymentPrice <= 0n) {
    throw new Error("Quantized payment price rounds to zero");
  }

  const pricePerTokenUSD = safeBigInt(state.pricePerTokenUSD);
  const usdValue = (saleAmountBN * pricePerTokenUSD) / WAD;
  const paymentAmount = (usdValue * WAD) / paymentPrice;

  return {
    paymentAmount: paymentAmount.toString(),
    usdValue: usdValue.toString(),
    paymentPrice: paymentPrice.toString(),
  };
};

export const getRecentPurchases = async (
  accessToken: string,
  limit: number = 20
): Promise<{ purchases: SalePurchaseRecord[] }> => {
  const saleAddress = getSaleAddress();
  if (!saleAddress) return { purchases: [] };

  try {
    const { data: events } = await cirrus.get(accessToken, `/${FixedPriceSaleTable}-Purchased`, {
      params: {
        select: "buyer,paymentToken,saleAmount::text,paymentAmount::text,usdValue::text,block_timestamp,transaction_hash",
        address: `eq.${saleAddress}`,
        order: "block_timestamp.desc",
        limit: limit.toString(),
      },
    });

    const paymentTokenAddrs: string[] = Array.from(
      new Set<string>((events || []).map((e: any) => e.paymentToken as string).filter(Boolean))
    );
    const tokenInfoMap = await fetchTokenInfo(accessToken, paymentTokenAddrs);

    const purchases: SalePurchaseRecord[] = (events || []).map((e: any) => ({
      buyer: e.buyer || "",
      paymentToken: e.paymentToken || "",
      paymentTokenSymbol: tokenInfoMap.get(e.paymentToken)?.symbol || "UNKNOWN",
      saleAmount: e.saleAmount || "0",
      paymentAmount: e.paymentAmount || "0",
      usdValue: e.usdValue || "0",
      timestamp: e.block_timestamp || "",
      hash: e.transaction_hash,
    }));

    return { purchases };
  } catch (error) {
    console.error("Error fetching recent purchases:", error);
    return { purchases: [] };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// WRITES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build approve(paymentToken→sale) + buy(saleAmount) as a parallel tx pair.
 */
export const buy = async (
  accessToken: string,
  userAddress: string,
  body: { paymentToken: string; saleAmount: string; paymentAmount: string }
): Promise<{ status: string; hash: string }> => {
  const saleAddress = getSaleAddress();
  if (!saleAddress) {
    throw new Error("Fixed price sale not configured");
  }

  const { paymentToken, saleAmount, paymentAmount } = body;

  const tx: FunctionInput[] = [
    {
      contractName: extractContractName(Token),
      contractAddress: paymentToken,
      method: "approve",
      args: { spender: saleAddress, value: paymentAmount },
    },
    {
      contractName: extractContractName(FixedPriceSaleTable),
      contractAddress: saleAddress,
      method: "buy",
      args: { paymentToken, saleAmount },
    },
  ];

  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

const callSaleMethod = async (
  accessToken: string,
  userAddress: string,
  method: string,
  args: Record<string, any>
): Promise<{ status: string; hash: string }> => {
  const saleAddress = getSaleAddress();
  if (!saleAddress) {
    throw new Error("Fixed price sale not configured");
  }

  const builtTx = await buildFunctionTx(
    {
      contractName: extractContractName(FixedPriceSaleTable),
      contractAddress: saleAddress,
      method,
      args,
    },
    userAddress,
    accessToken
  );

  return postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

// Admin
export const pauseSale = (accessToken: string, userAddress: string) =>
  callSaleMethod(accessToken, userAddress, "pause", {});

export const unpauseSale = (accessToken: string, userAddress: string) =>
  callSaleMethod(accessToken, userAddress, "unpause", {});

export const addPaymentToken = (
  accessToken: string,
  userAddress: string,
  body: { paymentToken: string }
) => callSaleMethod(accessToken, userAddress, "addPaymentToken", { paymentToken: body.paymentToken });

export const removePaymentToken = (
  accessToken: string,
  userAddress: string,
  body: { paymentToken: string }
) => callSaleMethod(accessToken, userAddress, "removePaymentToken", { paymentToken: body.paymentToken });

export const setPricePerToken = (
  accessToken: string,
  userAddress: string,
  body: { pricePerTokenUSD: string }
) => callSaleMethod(accessToken, userAddress, "setPricePerToken", { newPricePerTokenUSD: body.pricePerTokenUSD });

export const setHardCap = (
  accessToken: string,
  userAddress: string,
  body: { hardCap: string }
) => callSaleMethod(accessToken, userAddress, "setHardCap", { newHardCap: body.hardCap });

export const setPerWalletCap = (
  accessToken: string,
  userAddress: string,
  body: { perWalletCap: string }
) => callSaleMethod(accessToken, userAddress, "setPerWalletCap", { newPerWalletCap: body.perWalletCap });

export const setSchedule = (
  accessToken: string,
  userAddress: string,
  body: { startTime: string; endTime: string }
) =>
  callSaleMethod(accessToken, userAddress, "setSchedule", {
    newStartTime: body.startTime,
    newEndTime: body.endTime,
  });

export const sweepProceeds = (
  accessToken: string,
  userAddress: string,
  body: { paymentToken: string; to: string; amount: string }
) =>
  callSaleMethod(accessToken, userAddress, "sweepProceeds", {
    paymentToken: body.paymentToken,
    to: body.to,
    amount: body.amount,
  });

export const sweepUnsold = (
  accessToken: string,
  userAddress: string,
  body: { to: string }
) => callSaleMethod(accessToken, userAddress, "sweepUnsold", { to: body.to });
