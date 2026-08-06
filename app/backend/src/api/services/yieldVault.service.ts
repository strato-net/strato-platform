import { cirrus, strato } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import * as config from "../../config/config";
import {
  yieldBenchmarks,
  compositeYieldMap,
  OFF_CHAIN_DISPLAY_FLOOR_USD,
  OFF_CHAIN_EVENT_WINDOW_DAYS,
} from "../../config/config";
import { getServiceToken } from "../../utils/authHelper";
import { getOraclePrices } from "./oracle.service";
import {
  computePerSecondRateApy,
  getYieldWindowBounds,
  getYieldExchangeRateRowsCached,
  indexYieldHistoryRows,
  mergeBackfillRows,
  computeExchangeRateAPY,
} from "../helpers/earnYield.helper";
import { getHistoryParams } from "../helpers/history.helper";
import { toUTCTime } from "../helpers/cirrusHelpers";
import { FunctionInput } from "../../types/types";

const {
  YieldVault,
  Token,
  CDPEngine,
  CDPRegistry,
  cdpRegistry,
  priceOracle,
  mercataBridge,
} = constants;

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
const DAY_MS = 24 * 60 * 60 * 1000;
const SECONDS_PER_YEAR = 31_536_000n;
const MAX_DISPLAYED_OUTFLOWS = 5;

/**
 * Maker-style fixed-point exponent — same algorithm as CDPEngine._rpow.
 * Used to compound a per-second RAY rate into an annual factor.
 */
const rpowRay = (x: bigint, n: bigint): bigint => {
  let z = n % 2n !== 0n ? x : RAY;
  let xCopy = x;
  for (let nCopy = n / 2n; nCopy !== 0n; nCopy = nCopy / 2n) {
    xCopy = (xCopy * xCopy) / RAY;
    if (nCopy % 2n !== 0n) {
      z = (z * xCopy) / RAY;
    }
  }
  return z;
};

/**
 * Convert a per-second stability-fee rate (RAY) to a per-year decimal
 * (e.g. RAY = 1.000000001547125957... per second → ~5% APR → 0.05).
 */
const stabilityFeeRayToAnnualDecimal = (rateRay: bigint): number => {
  if (rateRay <= RAY) return 0;
  const annualFactor = rpowRay(rateRay, SECONDS_PER_YEAR);
  if (annualFactor <= RAY) return 0;
  // (annualFactor - RAY) / RAY → fraction in [0, ~big)
  // Convert with sub-RAY precision via 1e18 scaling.
  const scaled = ((annualFactor - RAY) * WAD) / RAY;
  return Number(scaled) / 1e18;
};

/**
 * Convert a positive WAD value (1e18-scaled USD) to a Number safely without
 * blowing past 2^53. Loses sub-cent precision for huge values; that's fine
 * for APY display.
 */
const wadToFloat = (wad: bigint): number => {
  if (wad === 0n) return 0;
  const sign = wad < 0n ? -1 : 1;
  const abs = wad < 0n ? -wad : wad;
  // 1e18 / 1e6 = 1e12; Number(abs / 1e6) is safe up to ~9e15 → 9e21 wad → ~9e3 trillion USD.
  return (sign * Number(abs / 1_000_000n)) / 1e12;
};

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
  deployedAssets: string;
  totalShares: string;
  exchangeRate: string;
  projectedActiveAssets: string;
  projectedExchangeRate: string;
  /** Oracle USD price (WAD) per 1 full underlying token. */
  assetPriceWad: string;
  /** Vault TVL in USD (WAD): (idle + deployed underlying) × assetPriceWad / 10^decimals. */
  tvlUsd: string;
  projectedTvlUsd: string;
  apy: string;
  accrualInitialized: boolean;
  fundedApy: string;
  pendingAccrual: string;
  pendingAccrualTarget: string;
  paused: boolean;
  minIdleBps: string;
  totalQueuedShares: string;
  totalClaimableAssets: string;
  strategyHoldings: YieldVaultStrategyHolding[];
  maxDeploy: string;
  minIdleRequirement: string;
  deployBlockedReason: string | null;
}

export interface YieldVaultHistoryPoint {
  timestamp: number;
  exchangeRate: string;
  totalAssets: string;
  tvlUsd: string;
  totalShares: string;
}

export interface YieldVaultPendingWithdrawal {
  requestId: string;
  shares: string;
  estimatedAssets: string;
  receiver: string;
}

/**
 * One row of a strategy's composition. Aggregates everything the strategy
 * "controls" of a given asset: ERC-20 wallet balance + CDP collateral locked
 * in the CDPEngine. Liabilities (USDST debt) are tracked separately on
 * `YieldVaultStrategyHolding.usdstDebt` and not netted here.
 */
export interface StrategyAsset {
  tokenAddress: string;
  tokenSymbol: string;
  decimals: number;
  /** Total raw token units = walletBalance + cdpCollateral. */
  amount: string;
}

export interface YieldVaultStrategyHolding {
  strategyAddress: string;
  deployedAssets: string;
  /**
   * Assets controlled by the strategy (ERC-20 wallet + CDP collateral),
   * merged per token address.
   */
  composition: StrategyAsset[];
  /**
   * Total USDST borrowed by this strategy across all CDP positions, in
   * 18-decimal units. Accrued at the indexed rateAccumulator (slightly
   * under-states real-time interest until the next on-chain accrual).
   */
  usdstDebt: string;
  /**
   * Forward-looking Base APY for this strategy, in percent (decimal points,
   * e.g. 4.83 for 4.83%). Computed as:
   *   net annual yield (USD) / equity (USD) × 100
   * where `net annual yield = Σ (asset × baseApy) − Σ (debt × stabilityFee)`,
   * priced via the oracle, and `equity = deployedAssets × ETH/USD`.
   * `null` when inputs are missing (no oracle price for ETH, no benchmark
   * yields for any held asset, etc.).
   */
  baseApyPct: number | null;
  /**
   * USD value (1e18 WAD) of capital currently bridged out via MercataBridge
   * within the rolling lookback window (`OFF_CHAIN_EVENT_WINDOW_DAYS`).
   * Computed as: pooled outbound − pooled inbound at current oracle prices,
   * clamped to ≥ 0. Subtracted from equity in the Base APY calc so the
   * displayed APY reflects "yield on actually-productive equity".
   */
  offChainUsdWad: string;
  /**
   * Recent `WithdrawalCompleted` bridge-outs from this strategy within the
   * lookback window (most-recent first, capped). Display-only — populated for
   * UX transparency, not used in Base APY math (which uses the pooled total).
   */
  recentOutflows: RecentBridgeOutflow[];
}

export interface RecentBridgeOutflow {
  tokenAddress: string;
  tokenSymbol: string;
  decimals: number;
  amount: string;
  timestampMs: number;
}

interface StrategyTokenBalance {
  tokenAddress: string;
  tokenSymbol: string;
  decimals: number;
  balance: string;
}

interface StrategyCdpPosition {
  assetAddress: string;
  assetSymbol: string;
  collateralDecimals: number;
  collateral: string;
  debtUsdst: string;
  /** Per-second RAY-scaled stability fee for this collateral asset. */
  stabilityFeeRateRay: string;
}

interface StrategyApyContext {
  /** Full oracle priceMap (key → price WAD). */
  priceMap: Map<string, string>;
  /** Per-token base APY decimal (e.g. 0.045 for 4.5%) keyed by token address. */
  baseApyMap: Map<string, number>;
  /** Vault underlying asset address (e.g. ETH for the ETH carry vault). */
  vaultAssetAddress: string;
  /** Vault underlying decimals. */
  vaultAssetDecimals: number;
  /** Vault underlying USD price (WAD per 1 full token). */
  vaultAssetPriceWad: bigint;
}

export interface YieldVaultUserInfo extends YieldVaultInfo {
  walletAssets: string;
  userShares: string;
  redeemableAssets: string;
  projectedRedeemableAssets: string;
  /** User NAV in USD (WAD): ERC4626 underlying claim for userShares × oracle / 10^decimals. */
  positionUsd: string;
  projectedPositionUsd: string;
  maxDeposit: string;
  maxRedeem: string;
  maxWithdraw: string;
  claimableAssets: string;
  activeRequestId: string;
  pendingWithdrawal: YieldVaultPendingWithdrawal | null;
}

/** Keys and display metadata only; addresses come from config / env. */
const CARRY_VAULT_ENTRIES: (Omit<YieldVaultDef, "address"> & { getAddress: () => string })[] = [
  { key: "eth-carry",  name: "ETH Yield Vault",  assetSymbol: "ETH",  shareSymbol: "carryETH",  getAddress: () => config.ethCarryVault },
  { key: "wbtc-carry", name: "wBTC Carry Vault", assetSymbol: "wBTC", shareSymbol: "carryWBTC", getAddress: () => config.wbtcCarryVault },
  { key: "usdc-yield", name: "USDC Yield Vault", assetSymbol: "USDC", shareSymbol: "yieldUSDC", getAddress: () => config.usdcYieldVault },
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

const parseBooleanLike = (value: unknown): boolean =>
  value === true || String(value).trim().toLowerCase() === "true";

const normalizeAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

const getExchangeRate = (totalAssets: bigint, totalShares: bigint): bigint => {
  if (totalShares <= 0n) return WAD;
  if (totalAssets <= 0n) return 0n;
  return (totalAssets * WAD) / totalShares;
};

const getActiveAssets = (totalAssets: bigint, totalClaimableAssets: bigint): bigint =>
  totalAssets > totalClaimableAssets ? totalAssets - totalClaimableAssets : 0n;

const getFreeIdleAssets = (idleAssets: bigint, totalClaimableAssets: bigint): bigint =>
  idleAssets > totalClaimableAssets ? idleAssets - totalClaimableAssets : 0n;

const minBigInt = (...values: bigint[]): bigint =>
  values.reduce((min, value) => value < min ? value : min);

const isZeroAddress = (value: string | undefined | null): boolean => {
  const normalized = normalizeAddress(value);
  return !normalized || /^0+$/.test(normalized);
};

const rpowAccrual = (x: bigint, n: bigint, base: bigint): bigint => {
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

const parseCirrusTimestamp = (value: string | undefined | null): number => {
  if (!value) return 0;
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = Date.parse(hasTimezone ? value : `${value}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
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

const previewRedeemAssets = (shares: bigint, totalAssets: bigint, totalShares: bigint): bigint => {
  if (shares <= 0n) return 0n;
  if (totalShares <= 0n) return shares;
  if (totalAssets <= 0n) return 0n;
  return (shares * totalAssets) / totalShares;
};

const previewRedeemShares = (assets: bigint, totalAssets: bigint, totalShares: bigint): bigint => {
  if (assets <= 0n) return 0n;
  if (totalAssets <= 0n || totalShares <= 0n) return assets;
  return (assets * totalShares) / totalAssets;
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
    deployedAssets: "0",
    totalShares: "0",
    exchangeRate: WAD.toString(),
    projectedActiveAssets: "0",
    projectedExchangeRate: WAD.toString(),
    assetPriceWad: "0",
    tvlUsd: "0",
    projectedTvlUsd: "0",
    apy: "-",
    accrualInitialized: false,
    fundedApy: "0.00",
    pendingAccrual: "0",
    pendingAccrualTarget: "0",
    paused: false,
    minIdleBps: "0",
    totalQueuedShares: "0",
    totalClaimableAssets: "0",
    strategyHoldings: [],
    maxDeploy: "0",
    minIdleRequirement: "0",
    deployBlockedReason: null,
  };
}

function emptyUserInfo(def: YieldVaultDef | null, key: string): YieldVaultUserInfo {
  return {
    ...emptyInfo(def, key),
    walletAssets: "0",
    userShares: "0",
    redeemableAssets: "0",
    projectedRedeemableAssets: "0",
    positionUsd: "0",
    projectedPositionUsd: "0",
    maxDeposit: "0",
    maxRedeem: "0",
    maxWithdraw: "0",
    claimableAssets: "0",
    activeRequestId: "0",
    pendingWithdrawal: null,
  };
}

const getVaultState = async (
  serviceToken: string,
  vaultAddress: string
): Promise<Record<string, any> | null> => {
  const [{ data }, storageResponse] = await Promise.all([
    cirrus.get(serviceToken, `/${YieldVault}`, {
      params: {
        address: `eq.${vaultAddress}`,
        select:
          "address,_asset,_totalSupply::text,_symbol,_name,_paused,vaultInitialized,deployedAssets::text,_underlyingDecimals,minIdleBps::text,totalQueuedShares::text,totalClaimableAssets::text",
      },
    }),
    cirrus.get(serviceToken, "/storage", {
      params: {
        address: `eq.${vaultAddress}`,
        select:
          "data->>accrualInitialized,data->>accrualBaseAssets,data->>perSecondSavingsRate,data->>lastAccrual,data->>rewardDistributor",
        limit: "1",
      },
    }).catch(() => ({ data: [] })),
  ]);
  return data?.[0] ? { ...data[0], ...storageResponse.data?.[0] } : null;
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

const getPendingAccrual = async (
  accessToken: string,
  vaultState: Record<string, any>,
  vaultAddress: string,
  assetAddress: string,
  totalShares: bigint
): Promise<{ targetAmount: bigint; fundedAmount: bigint }> => {
  const accrualInitialized = parseBooleanLike(vaultState.accrualInitialized);
  const accrualBaseAssets = parseBigIntLike(vaultState.accrualBaseAssets);
  const perSecondSavingsRate = parseBigIntLike(vaultState.perSecondSavingsRate);
  const lastAccrual = parseBigIntLike(vaultState.lastAccrual);
  const rewardDistributor = String(vaultState.rewardDistributor || "");
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  if (
    !accrualInitialized ||
    totalShares <= 0n ||
    accrualBaseAssets <= 0n ||
    perSecondSavingsRate <= RAY ||
    nowSec <= lastAccrual ||
    isZeroAddress(rewardDistributor)
  ) {
    return { targetAmount: 0n, fundedAmount: 0n };
  }

  const growthFactor = rpowAccrual(perSecondSavingsRate, nowSec - lastAccrual, RAY);
  const targetAmount = (accrualBaseAssets * (growthFactor - RAY)) / RAY;
  if (targetAmount <= 0n) {
    return { targetAmount: 0n, fundedAmount: 0n };
  }

  try {
    const [balance, allowance] = await Promise.all([
      getAssetBalance(accessToken, assetAddress, rewardDistributor),
      getTokenAllowance(accessToken, assetAddress, rewardDistributor, vaultAddress),
    ]);
    return {
      targetAmount,
      fundedAmount: minBigInt(
        targetAmount,
        parseBigIntLike(balance),
        parseBigIntLike(allowance)
      ),
    };
  } catch {
    return { targetAmount, fundedAmount: 0n };
  }
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

const getYieldVaultMappingValue = async (
  accessToken: string,
  vaultAddress: string,
  mappingName: string,
  key: string
): Promise<string> => {
  const { data } = await cirrus.get(accessToken, `/${YieldVault}-${mappingName}`, {
    params: {
      address: `eq.${vaultAddress}`,
      key: `eq.${key}`,
      select: "value::text",
    },
  });
  return data?.[0]?.value || "0";
};

const getYieldVaultRequest = async (
  accessToken: string,
  vaultAddress: string,
  requestId: string
): Promise<Record<string, any> | null> => {
  const { data } = await cirrus.get(accessToken, `/${YieldVault}-requests`, {
    params: {
      address: `eq.${vaultAddress}`,
      key: `eq.${requestId}`,
      select: "value",
    },
  });
  return data?.[0]?.value || null;
};

/**
 * Per-token ERC-20 balances held at `strategyAddress`. Discovered by querying
 * the Token contract's `_balances` mapping with `key = strategyAddress` and
 * `value > 0`, then batch-resolving symbol/decimals from the Token table.
 *
 * This intentionally surfaces gross holdings only; debt-side positions (e.g.
 * USDST borrowed against collateral) are tracked elsewhere and not netted here.
 */
const getStrategyTokenHoldings = async (
  serviceToken: string,
  strategyAddress: string
): Promise<StrategyTokenBalance[]> => {
  const { data: balRows } = await cirrus.get(serviceToken, `/${Token}-_balances`, {
    params: {
      key: `eq.${strategyAddress}`,
      value: "gt.0",
      select: "address,value::text",
      order: "value.desc",
    },
  });

  const rows = (balRows || []) as Array<{ address?: string; value?: string }>;
  if (rows.length === 0) return [];

  const tokenAddresses = Array.from(
    new Set(
      rows
        .map((r) => String(r.address || "").trim())
        .filter((addr) => addr.length > 0)
    )
  );
  if (tokenAddresses.length === 0) return [];

  const { data: metaRows } = await cirrus.get(serviceToken, `/${Token}`, {
    params: {
      address: `in.(${tokenAddresses.join(",")})`,
      select: "address,_symbol,customDecimals",
    },
  });

  const metaMap = new Map<string, { symbol: string; decimals: number }>();
  for (const row of (metaRows || []) as Array<Record<string, unknown>>) {
    const addr = String(row.address || "");
    if (!addr) continue;
    metaMap.set(addr, {
      symbol: String(row._symbol || ""),
      decimals: Number(row.customDecimals ?? 18),
    });
  }

  return rows.map((r) => {
    const rawAddr = String(r.address || "");
    const meta = metaMap.get(rawAddr);
    return {
      tokenAddress: normalizeAddress(rawAddr),
      tokenSymbol: meta?.symbol || "",
      decimals: Number.isFinite(meta?.decimals) ? (meta!.decimals as number) : 18,
      balance: String(r.value || "0"),
    };
  });
};

/**
 * Resolve the active CDPEngine address from the registry. Returns "" if not
 * configured. Cached-free per call; the registry select is a tiny FK lookup.
 */
const getCdpEngineAddress = async (serviceToken: string): Promise<string> => {
  if (!cdpRegistry) return "";
  try {
    const { data } = await cirrus.get(serviceToken, `/${CDPRegistry}`, {
      params: {
        address: `eq.${cdpRegistry}`,
        select: "cdpEngine:cdpEngine_fkey(address)",
      },
    });
    return String(data?.[0]?.cdpEngine?.address || "");
  } catch {
    return "";
  }
};

/**
 * CDP positions opened by `strategyAddress` against the CDPEngine.
 *
 * Reads `CDPEngine-vaults` keyed on (user=strategyAddress, asset=*) and
 * accrues each row's USDST debt with the indexed `rateAccumulator`:
 *     debtUSDST = scaledDebt * rateAccumulator / RAY
 *
 * The rate accumulator stored in Cirrus is the last on-chain value; it under-
 * states by the seconds since the last `_accrue` call. This matches how the
 * existing CDP service reports user debt.
 */
const getStrategyCdpPositions = async (
  serviceToken: string,
  cdpEngineAddress: string,
  strategyAddress: string
): Promise<StrategyCdpPosition[]> => {
  if (!cdpEngineAddress || !strategyAddress) return [];

  const { data: vaultRows } = await cirrus.get(serviceToken, `/${CDPEngine}-vaults`, {
    params: {
      address: `eq.${cdpEngineAddress}`,
      key: `eq.${strategyAddress}`,
      select: "asset:key2,Vault:value",
    },
  });

  const rows = (vaultRows || []) as Array<{
    asset?: string;
    Vault?: { collateral?: string; scaledDebt?: string };
  }>;
  if (rows.length === 0) return [];

  const assetAddresses = Array.from(
    new Set(
      rows
        .map((r) => String(r.asset || "").trim())
        .filter((addr) => addr.length > 0)
    )
  );
  if (assetAddresses.length === 0) return [];

  const [{ data: stateRows }, { data: configRows }, { data: tokenRows }] = await Promise.all([
    cirrus.get(serviceToken, `/${CDPEngine}-collateralGlobalStates`, {
      params: {
        address: `eq.${cdpEngineAddress}`,
        key: `in.(${assetAddresses.join(",")})`,
        select: "asset:key,CollateralGlobalState:value",
      },
    }),
    cirrus.get(serviceToken, `/${CDPEngine}-collateralConfigs`, {
      params: {
        address: `eq.${cdpEngineAddress}`,
        key: `in.(${assetAddresses.join(",")})`,
        select: "asset:key,CollateralConfig:value",
      },
    }),
    cirrus.get(serviceToken, `/${Token}`, {
      params: {
        address: `in.(${assetAddresses.join(",")})`,
        select: "address,_symbol,customDecimals",
      },
    }),
  ]);

  const rateMap = new Map<string, bigint>();
  for (const row of (stateRows || []) as Array<Record<string, any>>) {
    const asset = String(row.asset || "");
    const rateRaw = row?.CollateralGlobalState?.rateAccumulator;
    if (!asset || !rateRaw) continue;
    try {
      rateMap.set(asset, BigInt(rateRaw));
    } catch {
      // skip malformed
    }
  }

  const stabilityFeeMap = new Map<string, string>();
  for (const row of (configRows || []) as Array<Record<string, any>>) {
    const asset = String(row.asset || "");
    const stabRaw = row?.CollateralConfig?.stabilityFeeRate;
    if (!asset || !stabRaw) continue;
    stabilityFeeMap.set(asset, String(stabRaw));
  }

  const tokenMap = new Map<string, { symbol: string; decimals: number }>();
  for (const row of (tokenRows || []) as Array<Record<string, unknown>>) {
    const addr = String(row.address || "");
    if (!addr) continue;
    tokenMap.set(addr, {
      symbol: String(row._symbol || ""),
      decimals: Number(row.customDecimals ?? 18),
    });
  }

  const positions: StrategyCdpPosition[] = [];
  for (const r of rows) {
    const rawAddr = String(r.asset || "");
    if (!rawAddr) continue;

    let collateral = 0n;
    let scaledDebt = 0n;
    try {
      collateral = BigInt(r.Vault?.collateral || "0");
      scaledDebt = BigInt(r.Vault?.scaledDebt || "0");
    } catch {
      continue;
    }
    if (collateral === 0n && scaledDebt === 0n) continue;

    const rate = rateMap.get(rawAddr) ?? RAY;
    const debtUsdst = (scaledDebt * rate) / RAY;
    const meta = tokenMap.get(rawAddr);
    const stabilityFeeRateRay = stabilityFeeMap.get(rawAddr) || RAY.toString();

    positions.push({
      assetAddress: normalizeAddress(rawAddr),
      assetSymbol: meta?.symbol || "",
      collateralDecimals: meta?.decimals ?? 18,
      collateral: collateral.toString(),
      debtUsdst: debtUsdst.toString(),
      stabilityFeeRateRay: stabilityFeeRateRay,
    });
  }

  return positions;
};

/**
 * Per-token base APY decimal (e.g. 0.045 for 4.5%) for the protocol's
 * yield-bearing benchmarks, mirroring the `source: "base"` entries published
 * by `addBaseYieldApys` in earn.service.ts.
 *
 * Uses the cached exchange-rate-history fetcher so this stays cheap on
 * repeated /info refreshes.
 */
const getStrategyBaseApyMap = async (
  serviceToken: string
): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  try {
    const { windowStart, windowEndExclusive, anchorsMs } = getYieldWindowBounds(Date.now());
    const exchangeRateAddrs = (yieldBenchmarks || [])
      .map((b) => String(b?.tokenAddress || "").trim())
      .filter((addr) => addr.length > 0);

    if (exchangeRateAddrs.length === 0) return out;

    const rows = await getYieldExchangeRateRowsCached(serviceToken, {
      priceOracle,
      exchangeRateAddrs,
      windowStart,
      windowEndExclusive,
      anchorsMs,
    });

    const history = indexYieldHistoryRows(mergeBackfillRows(rows ?? []));

    for (const benchmark of yieldBenchmarks) {
      const tokenAddress = String(benchmark?.tokenAddress || "").trim();
      if (!tokenAddress) continue;

      const apyStr = computeExchangeRateAPY(tokenAddress, history, anchorsMs);
      if (!apyStr) continue;

      const underlying = compositeYieldMap?.[tokenAddress];
      const underlyingApyStr = underlying
        ? computeExchangeRateAPY(underlying, history, anchorsMs)
        : null;

      const totalPct =
        parseFloat(apyStr) + (underlyingApyStr ? parseFloat(underlyingApyStr) : 0);
      if (!Number.isFinite(totalPct) || totalPct <= 0) continue;

      out.set(tokenAddress.toLowerCase(), totalPct / 100);
    }
  } catch {
    // degrade silently — base APY computation is best-effort
  }
  return out;
};

/**
 * Per-strategy forward Base APY, denominated to the vault's underlying:
 *   netAnnualUSD = Σ (compositionUsd_i × baseApy_i) − Σ (cdpDebtUsd_j × stabRate_j)
 *   equityUsd    = deployedAssets × ETH/USD
 *   baseApyPct   = netAnnualUSD / equityUsd × 100
 *
 * The percent is invariant to whether you express both legs in USD or ETH (the
 * ETH/USD factor cancels), so we render this as the strategy's ETH APY for
 * the ETH carry vault.
 */
const computeStrategyBaseApyPct = (
  deployedAssets: bigint,
  composition: StrategyAsset[],
  cdpPositions: StrategyCdpPosition[],
  ctx: StrategyApyContext,
  offChainUsdWad: bigint = 0n
): number | null => {
  if (deployedAssets <= 0n) return null;
  if (ctx.vaultAssetPriceWad <= 0n) return null;

  // equity in USD WAD = deployedAssets × ETH/USD / 10^vaultAssetDecimals.
  // Subtract off-chain capital so the APY ratio reflects yield earned on the
  // currently-productive equity. Implicitly assumes the off-chain portion will
  // earn whatever rate the on-chain portion is currently earning (self-
  // consistent: rebasing the denominator while leaving the numerator alone).
  const vaultAssetUnit = 10n ** BigInt(ctx.vaultAssetDecimals);
  if (vaultAssetUnit === 0n) return null;
  const grossEquityUsdWad = (deployedAssets * ctx.vaultAssetPriceWad) / vaultAssetUnit;
  const equityUsdWad =
    offChainUsdWad > 0n && grossEquityUsdWad > offChainUsdWad
      ? grossEquityUsdWad - offChainUsdWad
      : grossEquityUsdWad;
  if (equityUsdWad <= 0n) return null;

  // Sum gross asset yield in USD/yr.
  // Numeric path (Number, not bigint) because APY is a small decimal we can
  // multiply against per-asset USD value directly.
  let grossYieldUsd = 0;
  let yieldComponents = 0;
  for (const asset of composition) {
    const apyDec = ctx.baseApyMap.get(asset.tokenAddress.toLowerCase());
    if (!apyDec || apyDec <= 0) continue;

    const priceWadStr =
      ctx.priceMap.get(asset.tokenAddress) ||
      ctx.priceMap.get(asset.tokenAddress.toLowerCase()) ||
      "0";
    let priceWad = 0n;
    try {
      priceWad = BigInt(priceWadStr);
    } catch {
      priceWad = 0n;
    }
    if (priceWad <= 0n) continue;

    let amount = 0n;
    try {
      amount = BigInt(asset.amount);
    } catch {
      amount = 0n;
    }
    if (amount <= 0n) continue;

    const tokenUnit = 10n ** BigInt(asset.decimals);
    if (tokenUnit === 0n) continue;
    const amountUsdWad = (amount * priceWad) / tokenUnit;
    if (amountUsdWad <= 0n) continue;

    grossYieldUsd += wadToFloat(amountUsdWad) * apyDec;
    yieldComponents += 1;
  }

  // Sum borrow cost in USD/yr (USDST debt × per-asset annualized stability fee).
  let borrowCostUsd = 0;
  for (const pos of cdpPositions) {
    let debt = 0n;
    try {
      debt = BigInt(pos.debtUsdst || "0");
    } catch {
      debt = 0n;
    }
    if (debt <= 0n) continue;

    let stabRay = 0n;
    try {
      stabRay = BigInt(pos.stabilityFeeRateRay || RAY.toString());
    } catch {
      stabRay = RAY;
    }
    const annualDec = stabilityFeeRayToAnnualDecimal(stabRay);
    if (annualDec <= 0) continue;

    // USDST is 18 decimals and ≈ $1, so debtUsd ≈ debt / 1e18.
    borrowCostUsd += wadToFloat(debt) * annualDec;
  }

  // If we have no benchmark yields and no debt, we can't say anything.
  if (yieldComponents === 0 && borrowCostUsd === 0) return null;

  const netUsd = grossYieldUsd - borrowCostUsd;
  const equityUsd = wadToFloat(equityUsdWad);
  if (equityUsd <= 0) return null;

  const apyPct = (netUsd / equityUsd) * 100;
  if (!Number.isFinite(apyPct)) return null;
  return Number(apyPct.toFixed(2));
};

const getStrategyHoldings = async (
  accessToken: string,
  vaultAddress: string,
  apyCtx: StrategyApyContext | null
): Promise<YieldVaultStrategyHolding[]> => {
  const { data } = await cirrus.get(accessToken, `/${YieldVault}-strategyDebt`, {
    params: {
      address: `eq.${vaultAddress}`,
      value: "gt.0",
      select: "key,value::text",
      order: "value.desc",
    },
  });

  const baseHoldings = (data || []).map((row: Record<string, unknown>) => ({
    strategyAddress: normalizeAddress(String(row.key || "")),
    deployedAssets: String(row.value || "0"),
  }));

  if (baseHoldings.length === 0) return [];

  // Resolve CDPEngine once for all strategies; per-strategy CDP queries reuse it.
  const cdpEngineAddress = await getCdpEngineAddress(accessToken);

  // Off-chain capital tracking needs the priceMap that lives on apyCtx; if the
  // caller didn't provide it, we just degrade to empty (no off-chain data).
  const offChainPriceMap = apyCtx?.priceMap;

  const [tokenBalanceLists, cdpPositionLists, offChainCapitalList] = await Promise.all([
    Promise.all(
      baseHoldings.map((h: { strategyAddress: string }) =>
        getStrategyTokenHoldings(accessToken, h.strategyAddress).catch(
          () => [] as StrategyTokenBalance[]
        )
      )
    ),
    Promise.all(
      baseHoldings.map((h: { strategyAddress: string }) =>
        cdpEngineAddress
          ? getStrategyCdpPositions(accessToken, cdpEngineAddress, h.strategyAddress).catch(
              () => [] as StrategyCdpPosition[]
            )
          : Promise.resolve([] as StrategyCdpPosition[])
      )
    ),
    Promise.all(
      baseHoldings.map((h: { strategyAddress: string }) =>
        offChainPriceMap
          ? getStrategyOffChainCapital(accessToken, h.strategyAddress, offChainPriceMap).catch(
              () => ({ offChainUsdWad: "0", recentOutflows: [] as RecentBridgeOutflow[] })
            )
          : Promise.resolve({ offChainUsdWad: "0", recentOutflows: [] as RecentBridgeOutflow[] })
      )
    ),
  ]);

  return baseHoldings.map(
    (h: { strategyAddress: string; deployedAssets: string }, i: number) => {
      const composition = mergeStrategyComposition(
        tokenBalanceLists[i],
        cdpPositionLists[i]
      );
      const usdstDebt = sumUsdstDebt(cdpPositionLists[i]);
      const { offChainUsdWad, recentOutflows } = offChainCapitalList[i];

      let baseApyPct: number | null = null;
      if (apyCtx) {
        let deployed = 0n;
        try {
          deployed = BigInt(h.deployedAssets || "0");
        } catch {
          deployed = 0n;
        }
        let offChainBig = 0n;
        try {
          offChainBig = BigInt(offChainUsdWad || "0");
        } catch {
          offChainBig = 0n;
        }
        try {
          baseApyPct = computeStrategyBaseApyPct(
            deployed,
            composition,
            cdpPositionLists[i],
            apyCtx,
            offChainBig
          );
        } catch {
          baseApyPct = null;
        }
      }

      return {
        ...h,
        composition,
        usdstDebt,
        baseApyPct,
        offChainUsdWad,
        recentOutflows,
      };
    }
  );
};

/**
 * Merge ERC-20 wallet balances and CDP collateral into a single per-token
 * composition list. Token symbol/decimals come from whichever source resolved
 * them first. Sorted by symbol alphabetically (case-insensitive) so that the
 * UI renders predictably across refreshes.
 */
const mergeStrategyComposition = (
  tokenBalances: StrategyTokenBalance[],
  cdpPositions: StrategyCdpPosition[]
): StrategyAsset[] => {
  const merged = new Map<
    string,
    { tokenAddress: string; tokenSymbol: string; decimals: number; amount: bigint }
  >();

  const upsert = (
    addr: string,
    symbol: string,
    decimals: number,
    delta: bigint
  ) => {
    if (!addr || delta === 0n) return;
    const existing = merged.get(addr);
    if (existing) {
      existing.amount += delta;
      if (!existing.tokenSymbol && symbol) existing.tokenSymbol = symbol;
    } else {
      merged.set(addr, {
        tokenAddress: addr,
        tokenSymbol: symbol || "",
        decimals: Number.isFinite(decimals) ? decimals : 18,
        amount: delta,
      });
    }
  };

  for (const tb of tokenBalances) {
    let bal = 0n;
    try {
      bal = BigInt(tb.balance || "0");
    } catch {
      bal = 0n;
    }
    upsert(tb.tokenAddress, tb.tokenSymbol, tb.decimals, bal);
  }

  for (const pos of cdpPositions) {
    let coll = 0n;
    try {
      coll = BigInt(pos.collateral || "0");
    } catch {
      coll = 0n;
    }
    upsert(pos.assetAddress, pos.assetSymbol, pos.collateralDecimals, coll);
  }

  return Array.from(merged.values())
    .filter((row) => row.amount > 0n)
    .map((row) => ({
      tokenAddress: row.tokenAddress,
      tokenSymbol: row.tokenSymbol,
      decimals: row.decimals,
      amount: row.amount.toString(),
    }))
    .sort((a, b) => {
      const sa = (a.tokenSymbol || a.tokenAddress).toLowerCase();
      const sb = (b.tokenSymbol || b.tokenAddress).toLowerCase();
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return 0;
    });
};

const sumUsdstDebt = (cdpPositions: StrategyCdpPosition[]): string => {
  let total = 0n;
  for (const pos of cdpPositions) {
    try {
      total += BigInt(pos.debtUsdst || "0");
    } catch {
      // skip malformed
    }
  }
  return total.toString();
};

/**
 * Pooled off-chain capital tracking via MercataBridge events.
 *
 * For each strategy address, sums `WithdrawalRequested` (assets that left the
 * strategy's wallet on Strato — bridge takes custody at request-time, *before*
 * the L1 leg completes) minus `DepositCompleted` (assets that arrived back),
 * within the last `OFF_CHAIN_EVENT_WINDOW_DAYS` days. `WithdrawalAborted`
 * events are subtracted so refunded withdrawals don't get counted as off-chain.
 *
 * Both sides priced at *current* oracle prices, so a clean ETH→wstETH
 * round-trip nets to ~$0 (the wstETH/ETH peg is enforced by the oracle).
 *
 * The window does the heavy lifting: it caps slippage residual accumulation
 * (otherwise dozens of round-trips would compound into a phantom off-chain
 * balance) and ages out stale unfinished bridges. Display floor in
 * `OFF_CHAIN_DISPLAY_FLOOR_USD` is the noise cutoff for sub-cent oracle drift.
 *
 * Returns `{ offChainUsdWad, recentOutflows }`. `recentOutflows` is the most
 * recent N non-aborted WithdrawalRequested events, used by the UI to show
 * users *what* has been bridged out (informational only — the math uses the
 * pooled total).
 *
 * Note on event field names (mind the schema differences):
 *   WithdrawalRequested → attributes.user, attributes.token, attributes.stratoTokenAmount, attributes.withdrawalId
 *   WithdrawalAborted   → attributes.withdrawalId
 *   DepositCompleted    → attributes.stratoRecipient, attributes.stratoToken, attributes.stratoTokenAmount
 */
const getStrategyOffChainCapital = async (
  serviceToken: string,
  strategyAddress: string,
  priceMap: Map<string, string>
): Promise<{ offChainUsdWad: string; recentOutflows: RecentBridgeOutflow[] }> => {
  const empty = { offChainUsdWad: "0", recentOutflows: [] as RecentBridgeOutflow[] };
  if (!mercataBridge || !strategyAddress) return empty;

  const cutoffMs = Date.now() - OFF_CHAIN_EVENT_WINDOW_DAYS * DAY_MS;
  const cutoffStr = toUTCTime(new Date(cutoffMs));

  const [outflowsRes, inflowsRes, abortedRes] = await Promise.all([
    cirrus
      .get(serviceToken, "/event", {
        params: {
          address: `eq.${mercataBridge}`,
          event_name: "eq.WithdrawalRequested",
          "attributes->>user": `eq.${strategyAddress}`,
          block_timestamp: `gte.${cutoffStr}`,
          select: "attributes,block_timestamp",
          order: "block_timestamp.desc",
        },
      })
      .catch(() => ({ data: [] as Array<Record<string, any>> })),
    cirrus
      .get(serviceToken, "/event", {
        params: {
          address: `eq.${mercataBridge}`,
          event_name: "eq.DepositCompleted",
          "attributes->>stratoRecipient": `eq.${strategyAddress}`,
          block_timestamp: `gte.${cutoffStr}`,
          select: "attributes,block_timestamp",
        },
      })
      .catch(() => ({ data: [] as Array<Record<string, any>> })),
    cirrus
      .get(serviceToken, "/event", {
        params: {
          address: `eq.${mercataBridge}`,
          event_name: "eq.WithdrawalAborted",
          block_timestamp: `gte.${cutoffStr}`,
          select: "attributes",
        },
      })
      .catch(() => ({ data: [] as Array<Record<string, any>> })),
  ]);

  const allOutflows = (outflowsRes.data || []) as Array<{
    attributes: Record<string, any>;
    block_timestamp?: string;
  }>;
  const inflows = (inflowsRes.data || []) as Array<{
    attributes: Record<string, any>;
    block_timestamp?: string;
  }>;
  const abortedRows = (abortedRes.data || []) as Array<{
    attributes: Record<string, any>;
  }>;

  // Build set of aborted withdrawalIds (as strings — IDs are uint256, may exceed Number safety).
  const abortedIds = new Set<string>();
  for (const e of abortedRows) {
    const id = String(e.attributes?.withdrawalId ?? "").trim();
    if (id) abortedIds.add(id);
  }

  // Drop any WithdrawalRequested that has a matching WithdrawalAborted in the window
  // — those funds were refunded to the strategy and never left for real.
  const outflows = allOutflows.filter((e) => {
    const id = String(e.attributes?.withdrawalId ?? "").trim();
    return !id || !abortedIds.has(id);
  });

  if (outflows.length === 0 && inflows.length === 0) return empty;

  const tokenAddresses = new Set<string>();
  for (const e of outflows) {
    const addr = String(e.attributes?.token || "").trim();
    if (addr) tokenAddresses.add(addr);
  }
  for (const e of inflows) {
    const addr = String(e.attributes?.stratoToken || "").trim();
    if (addr) tokenAddresses.add(addr);
  }

  const validAddresses = Array.from(tokenAddresses).filter((a) => a.length > 0);
  const metaMap = new Map<string, { symbol: string; decimals: number }>();
  if (validAddresses.length > 0) {
    try {
      const { data: tokenRows } = await cirrus.get(serviceToken, `/${Token}`, {
        params: {
          address: `in.(${validAddresses.join(",")})`,
          select: "address,_symbol,customDecimals",
        },
      });
      for (const row of (tokenRows || []) as Array<Record<string, unknown>>) {
        const addr = String(row.address || "");
        if (!addr) continue;
        metaMap.set(addr, {
          symbol: String(row._symbol || ""),
          decimals: Number(row.customDecimals ?? 18),
        });
      }
    } catch {
      // proceed with empty metaMap; events without symbol/decimals are skipped
    }
  }

  const sumUsdWad = (
    events: Array<{ attributes: Record<string, any> }>,
    tokenAttr: "token" | "stratoToken"
  ) => {
    let total = 0n;
    for (const e of events) {
      const tokenAddr = String(e.attributes?.[tokenAttr] || "").trim();
      const amountStr = String(e.attributes?.stratoTokenAmount || "0");
      if (!tokenAddr) continue;
      const meta = metaMap.get(tokenAddr);
      if (!meta) continue;
      const priceStr =
        priceMap.get(tokenAddr) || priceMap.get(tokenAddr.toLowerCase()) || "0";
      let priceWad = 0n;
      let amount = 0n;
      try {
        priceWad = BigInt(priceStr);
        amount = BigInt(amountStr);
      } catch {
        continue;
      }
      if (priceWad <= 0n || amount <= 0n) continue;
      const unit = 10n ** BigInt(meta.decimals);
      if (unit === 0n) continue;
      total += (amount * priceWad) / unit;
    }
    return total;
  };

  const outflowsUsdWad = sumUsdWad(outflows, "token");
  const inflowsUsdWad = sumUsdWad(inflows, "stratoToken");
  const offChainUsdWad =
    outflowsUsdWad > inflowsUsdWad ? outflowsUsdWad - inflowsUsdWad : 0n;

  // For the display list: only show outflows newer than the most-recent inflow.
  // The mental model is "since the last time something came back, here's what's
  // been sent out". The pooled USD math above is unchanged — this filter is
  // display-only. (Edge case: when bridges interleave out-of-order, an older
  // unmatched outflow can be hidden while the headline still shows it; rare.)
  let lastInflowMs = 0;
  for (const e of inflows) {
    if (!e.block_timestamp) continue;
    const ts = new Date(e.block_timestamp).getTime();
    if (Number.isFinite(ts) && ts > lastInflowMs) lastInflowMs = ts;
  }
  const outflowsForDisplay = lastInflowMs > 0
    ? outflows.filter((e) => {
        if (!e.block_timestamp) return false;
        const ts = new Date(e.block_timestamp).getTime();
        return Number.isFinite(ts) && ts > lastInflowMs;
      })
    : outflows;

  const recentOutflows: RecentBridgeOutflow[] = [];
  for (const e of outflowsForDisplay.slice(0, MAX_DISPLAYED_OUTFLOWS)) {
    const tokenAddr = String(e.attributes?.token || "").trim();
    if (!tokenAddr) continue;
    const meta = metaMap.get(tokenAddr);
    const amountStr = String(e.attributes?.stratoTokenAmount || "0");
    let timestampMs = 0;
    try {
      const ts = e.block_timestamp ? new Date(e.block_timestamp).getTime() : 0;
      if (Number.isFinite(ts)) timestampMs = ts;
    } catch {
      timestampMs = 0;
    }
    recentOutflows.push({
      tokenAddress: normalizeAddress(tokenAddr),
      tokenSymbol: meta?.symbol || "",
      decimals: meta?.decimals ?? 18,
      amount: amountStr,
      timestampMs,
    });
  }

  return {
    offChainUsdWad: offChainUsdWad.toString(),
    recentOutflows,
  };
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
): Promise<{ totalSupply: bigint; deployedAssets: bigint; totalClaimableAssets: bigint } | null> => {
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
      totalClaimableAssets: parseBigIntLike(storageData.totalClaimableAssets),
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
  activeAssetsNow: bigint,
  totalSharesNow: bigint
): Promise<string> => {
  if (!vaultAddress || !assetAddress || totalSharesNow <= 0n || activeAssetsNow <= 0n) {
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

    const rateNow = getExchangeRate(activeAssetsNow, totalSharesNow);
    const historicalTotalAssets = (historicalAssetBal > 0n ? historicalAssetBal : 0n) + historicalStorage.deployedAssets;
    const historicalActiveAssets = getActiveAssets(
      historicalTotalAssets,
      historicalStorage.totalClaimableAssets
    );
    const rateStart = getExchangeRate(
      historicalActiveAssets,
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

  const vaultState = await getVaultState(serviceToken, def.address);
  if (!vaultState) return fallback;
  if (!vaultState.vaultInitialized) return { ...fallback, configured: true };

  const assetAddress = vaultState._asset || "";
  if (!assetAddress) return fallback;

  // Pull metadata, balances, the full oracle price map, and the per-token
  // base APY map in one parallel batch. We need the full price map (not just
  // the vault's underlying) so that `computeStrategyBaseApyPct` can USD-price
  // every asset the strategy holds.
  const [assetTokenData, liveAssetBalance, priceMap, baseApyMap] = await Promise.all([
    cirrus.get(serviceToken, `/${Token}`, {
      params: { address: `eq.${assetAddress}`, select: "_symbol" },
    }),
    getAssetBalance(serviceToken, assetAddress, def.address),
    getOraclePrices(serviceToken),
    getStrategyBaseApyMap(serviceToken),
  ]);

  const idleAssets = parseBigIntLike(liveAssetBalance);
  const deployedAssets = parseBigIntLike(vaultState.deployedAssets);
  const totalAssets = idleAssets + deployedAssets;
  const totalClaimableAssets = parseBigIntLike(vaultState.totalClaimableAssets);
  const activeAssets = getActiveAssets(totalAssets, totalClaimableAssets);
  const freeIdleAssets = getFreeIdleAssets(idleAssets, totalClaimableAssets);
  const totalShares = parseBigIntLike(vaultState._totalSupply);
  const accrualInitialized = parseBooleanLike(vaultState.accrualInitialized);
  const pendingAccrual = await getPendingAccrual(
    serviceToken,
    vaultState,
    def.address,
    assetAddress,
    totalShares
  );
  const projectedActiveAssets = activeAssets + pendingAccrual.fundedAmount;
  const decimals = Number(vaultState._underlyingDecimals ?? 18);
  const exchangeRate = getExchangeRate(activeAssets, totalShares);
  const projectedExchangeRate = getExchangeRate(projectedActiveAssets, totalShares);
  const minIdleBps = parseBigIntLike(vaultState.minIdleBps);
  const totalQueuedShares = parseBigIntLike(vaultState.totalQueuedShares);
  const minIdleRequirement =
    minIdleBps > 0n ? (activeAssets * minIdleBps + 9999n) / 10000n : 0n;
  const maxDeploy =
    totalQueuedShares > 0n || freeIdleAssets <= minIdleRequirement
      ? 0n
      : freeIdleAssets - minIdleRequirement;
  const deployBlockedReason =
    totalQueuedShares > 0n
      ? "Withdrawal queue is open"
      : freeIdleAssets <= minIdleRequirement
        ? "Idle reserve requirement reached"
        : null;

  let assetPrice = 0n;
  {
    const direct =
      priceMap.get(assetAddress) || priceMap.get(assetAddress.toLowerCase());
    if (direct) {
      assetPrice = parseBigIntLike(direct);
    } else {
      const norm = assetAddress.toLowerCase().replace(/^0x/, "");
      for (const [k, v] of priceMap) {
        if (!k || !v) continue;
        if (k.toLowerCase().replace(/^0x/, "") === norm) {
          assetPrice = parseBigIntLike(v);
          break;
        }
      }
    }
  }

  const apyCtx: StrategyApyContext = {
    priceMap,
    baseApyMap,
    vaultAssetAddress: assetAddress,
    vaultAssetDecimals: decimals,
    vaultAssetPriceWad: assetPrice,
  };
  const strategyHoldings = await getStrategyHoldings(
    serviceToken,
    def.address,
    apyCtx
  ).catch(() => [] as YieldVaultStrategyHolding[]);

  const tvlUsd = underlyingUsdWad(totalAssets, assetPrice, decimals);
  const projectedTvlUsd = underlyingUsdWad(
    totalAssets + pendingAccrual.fundedAmount,
    assetPrice,
    decimals
  );
  const apy = accrualInitialized
    ? "-"
    : await computeApy(serviceToken, def.address, assetAddress, activeAssets, totalShares);
  const fundedApy = accrualInitialized
    ? computePerSecondRateApy(String(vaultState.perSecondSavingsRate || "0"))
    : "0.00";

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
    deployedAssets: deployedAssets.toString(),
    totalShares: totalShares.toString(),
    exchangeRate: exchangeRate.toString(),
    projectedActiveAssets: projectedActiveAssets.toString(),
    projectedExchangeRate: projectedExchangeRate.toString(),
    assetPriceWad: assetPrice.toString(),
    tvlUsd: tvlUsd.toString(),
    projectedTvlUsd: projectedTvlUsd.toString(),
    apy,
    accrualInitialized,
    fundedApy,
    pendingAccrual: pendingAccrual.fundedAmount.toString(),
    pendingAccrualTarget: pendingAccrual.targetAmount.toString(),
    paused: Boolean(vaultState._paused),
    minIdleBps: String(vaultState.minIdleBps || "0"),
    totalQueuedShares: String(vaultState.totalQueuedShares || "0"),
    totalClaimableAssets: totalClaimableAssets.toString(),
    strategyHoldings,
    maxDeploy: maxDeploy.toString(),
    minIdleRequirement: minIdleRequirement.toString(),
    deployBlockedReason,
  };
};

export const getYieldVaultHistory = async (
  _accessToken: string,
  key: string,
  duration = "all",
  end?: string
): Promise<YieldVaultHistoryPoint[]> => {
  const def = resolveVaultDef(key);
  if (!def?.address) return [];

  const serviceToken = await getServiceToken();
  const vaultState = await getVaultState(serviceToken, def.address);
  if (!vaultState?.vaultInitialized || !vaultState._asset) return [];

  const assetAddress = String(vaultState._asset);
  const decimals = Number(vaultState._underlyingDecimals ?? 18);
  const params = getHistoryParams(duration, end, 90);
  const startTime = new Date(
    params.endTimestamp - params.interval * params.numTicks
  ).toISOString();
  const endTime = new Date(params.endTimestamp).toISOString();

  const [storageRes, balanceRes, priceRes] = await Promise.all([
    cirrus.get(serviceToken, "/history@storage", {
      params: {
        address: `eq.${def.address}`,
        valid_from: `lte.${endTime}`,
        valid_to: `gte.${startTime}`,
        select: "data,valid_from,valid_to",
      },
    }),
    cirrus.get(serviceToken, "/history@mapping", {
      params: {
        address: `eq.${assetAddress}`,
        collection_name: "eq._balances",
        "key->>key": `eq.${def.address}`,
        valid_from: `lte.${endTime}`,
        valid_to: `gte.${startTime}`,
        select: "value::text,valid_from,valid_to",
      },
    }),
    cirrus.get(serviceToken, "/history@mapping", {
      params: {
        address: `eq.${priceOracle}`,
        collection_name: "eq.prices",
        "key->>key": `eq.${assetAddress}`,
        valid_from: `lte.${endTime}`,
        valid_to: `gte.${startTime}`,
        select: "value::text,valid_from,valid_to",
      },
    }),
  ]);

  const storageRows = Array.isArray(storageRes.data) ? storageRes.data : [];
  const balanceRows = Array.isArray(balanceRes.data) ? balanceRes.data : [];
  const priceRows = Array.isArray(priceRes.data) ? priceRes.data : [];
  const points: YieldVaultHistoryPoint[] = [];

  for (let i = 0; i <= params.numTicks; i += 1) {
    const timestamp =
      params.endTimestamp - params.interval * (params.numTicks - i);
    const storage = storageRows.find((row: any) =>
      isHistoricalRowActive(row, timestamp)
    );
    if (!storage?.data) continue;

    const balance = balanceRows.find((row: any) =>
      isHistoricalRowActive(row, timestamp)
    );
    const price = priceRows.find((row: any) =>
      isHistoricalRowActive(row, timestamp)
    );
    const idleAssets = parseBigIntLike(balance?.value);
    const deployedAssets = parseBigIntLike(storage.data.deployedAssets);
    const totalAssets = idleAssets + deployedAssets;
    const activeAssets = getActiveAssets(
      totalAssets,
      parseBigIntLike(storage.data.totalClaimableAssets)
    );
    const totalShares = parseBigIntLike(storage.data._totalSupply);
    const exchangeRate = getExchangeRate(activeAssets, totalShares);

    if (totalShares <= 0n || exchangeRate <= 0n) continue;

    points.push({
      timestamp,
      exchangeRate: exchangeRate.toString(),
      totalAssets: totalAssets.toString(),
      tvlUsd: underlyingUsdWad(
        totalAssets,
        parseBigIntLike(price?.value),
        decimals
      ).toString(),
      totalShares: totalShares.toString(),
    });
  }

  return points;
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
  const totalQueuedShares = parseBigIntLike(info.totalQueuedShares);
  const totalClaimableAssets = parseBigIntLike(info.totalClaimableAssets);
  const activeAssets = getActiveAssets(totalAssets, totalClaimableAssets);
  const projectedActiveAssets = parseBigIntLike(info.projectedActiveAssets);
  const freeIdleAssets = getFreeIdleAssets(idleAssets, totalClaimableAssets);

  const [claimableAssetsRaw, activeRequestIdRaw] = await Promise.all([
    getYieldVaultMappingValue(accessToken, info.vaultAddress, "claimableAssets", userAddress).catch(() => "0"),
    getYieldVaultMappingValue(accessToken, info.vaultAddress, "activeRequestId", userAddress).catch(() => "0"),
  ]);

  const redeemableAssets = previewRedeemAssets(userShares, activeAssets, totalShares);
  const projectedRedeemableAssets = previewRedeemAssets(
    userShares,
    projectedActiveAssets,
    totalShares
  );
  const idleShares = totalQueuedShares > 0n ? 0n : previewRedeemShares(freeIdleAssets, activeAssets, totalShares);
  const maxRedeem = userShares < idleShares ? userShares : idleShares;
  const maxWithdraw = totalQueuedShares > 0n
    ? 0n
    : redeemableAssets < freeIdleAssets ? redeemableAssets : freeIdleAssets;
  const claimableAssets = parseBigIntLike(claimableAssetsRaw);
  const activeRequestId = parseBigIntLike(activeRequestIdRaw);

  const assetPrice = parseBigIntLike(info.assetPriceWad);
  const positionUsd = underlyingUsdWad(redeemableAssets, assetPrice, info.decimals);
  const projectedPositionUsd = underlyingUsdWad(
    projectedRedeemableAssets,
    assetPrice,
    info.decimals
  );

  let pendingWithdrawal: YieldVaultPendingWithdrawal | null = null;
  if (activeRequestId > 0n) {
    const request = await getYieldVaultRequest(accessToken, info.vaultAddress, activeRequestId.toString()).catch(
      () => null
    );
    const pendingShares = parseBigIntLike(request?.shares);
    if (pendingShares > 0n) {
      pendingWithdrawal = {
        requestId: activeRequestId.toString(),
        shares: pendingShares.toString(),
        estimatedAssets: previewRedeemAssets(pendingShares, activeAssets, totalShares).toString(),
        receiver: normalizeAddress(request?.receiver),
      };
    }
  }

  return {
    ...info,
    walletAssets: walletAssets.toString(),
    userShares: userShares.toString(),
    redeemableAssets: redeemableAssets.toString(),
    projectedRedeemableAssets: projectedRedeemableAssets.toString(),
    positionUsd: positionUsd.toString(),
    projectedPositionUsd: projectedPositionUsd.toString(),
    maxDeposit: walletAssets.toString(),
    maxRedeem: maxRedeem.toString(),
    maxWithdraw: maxWithdraw.toString(),
    claimableAssets: claimableAssets.toString(),
    activeRequestId: activeRequestId.toString(),
    pendingWithdrawal,
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
      method: "redeemOrQueue",
      args: { shares: sharesAmount, receiver: userAddress, owner_: userAddress },
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
  const shares = parseBigIntLike(userInfo.userShares);
  if (shares <= 0n) {
    throw new Error("No vault shares to withdraw");
  }
  return await redeemYieldVault(accessToken, key, userAddress, userInfo.userShares);
};

export const claimYieldVault = async (
  accessToken: string,
  key: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const userInfo = await getYieldVaultUserInfo(accessToken, key, userAddress);
  const claimable = parseBigIntLike(userInfo.claimableAssets);
  if (claimable <= 0n) {
    throw new Error("No claimable assets");
  }

  const builtTx = await buildFunctionTx(
    {
      contractName: "YieldVault",
      contractAddress: userInfo.vaultAddress,
      method: "claim",
      args: { receiver: userAddress },
    },
    userAddress,
    accessToken
  );

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

const executeYieldVaultAdminCall = async (
  accessToken: string,
  userAddress: string,
  key: string,
  method: string,
  args: Record<string, unknown>
): Promise<{ status: string; hash: string }> => {
  const info = await getYieldVaultInfo(accessToken, key);
  if (!info.deployed) throw new Error(`Yield vault ${key} is not deployed`);

  const builtTx = await buildFunctionTx(
    {
      contractName: "YieldVault",
      contractAddress: info.vaultAddress,
      method,
      args,
    },
    userAddress,
    accessToken
  );

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

export const setYieldVaultStrategyApproval = async (
  accessToken: string,
  key: string,
  userAddress: string,
  strategy: string,
  approved: boolean
): Promise<{ status: string; hash: string }> => {
  return executeYieldVaultAdminCall(accessToken, userAddress, key, "setStrategyApproval", {
    strategy,
    approved,
  });
};

export const setYieldVaultMinIdleBps = async (
  accessToken: string,
  key: string,
  userAddress: string,
  minIdleBps: string
): Promise<{ status: string; hash: string }> => {
  return executeYieldVaultAdminCall(accessToken, userAddress, key, "setMinIdleBps", {
    minIdleBps_: minIdleBps,
  });
};

export const deployYieldVaultCapital = async (
  accessToken: string,
  key: string,
  userAddress: string,
  strategy: string,
  assets: string
): Promise<{ status: string; hash: string }> => {
  return executeYieldVaultAdminCall(accessToken, userAddress, key, "deployCapital", {
    to: strategy,
    assets,
  });
};

export const returnYieldVaultCapital = async (
  accessToken: string,
  key: string,
  userAddress: string,
  strategy: string,
  assets: string
): Promise<{ status: string; hash: string }> => {
  return executeYieldVaultAdminCall(accessToken, userAddress, key, "returnCapital", {
    from: strategy,
    assets,
  });
};

export const reportYieldVaultStrategyLoss = async (
  accessToken: string,
  key: string,
  userAddress: string,
  strategy: string,
  loss: string
): Promise<{ status: string; hash: string }> => {
  return executeYieldVaultAdminCall(accessToken, userAddress, key, "reportStrategyLoss", {
    strategy,
    loss,
  });
};

export const processYieldVaultQueue = async (
  accessToken: string,
  key: string,
  userAddress: string,
  maxRequests: string,
  maxAssets: string
): Promise<{ status: string; hash: string }> => {
  return executeYieldVaultAdminCall(accessToken, userAddress, key, "processQueue", {
    maxRequests,
    maxAssets,
  });
};
