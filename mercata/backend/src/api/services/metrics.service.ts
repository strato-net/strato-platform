import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getOraclePrices } from "./oracle.service";
import { getCDPStats } from "./cdp.service";
import { getPool, getPublicLiquidityInfo } from "./lending.service";
import { getSaveUsdstInfo } from "./saveUsdst.service";
import { getPublicSafetyModuleInfo, getSafetyModuleConfig } from "./safety.service";
import { getVaultInfo } from "./vault.service";
import { getPools } from "./swapping.service";
import { getBridgeableTokens } from "./bridge.service";
import {
  buildTokenClassificationContext,
  classifyToken,
} from "./tokenClassification.service";

const { Token, USDST, CollateralVault, LendingPool, PriceOracle } = constants;
const WAD = 10n ** 18n;
const METHODOLOGY_VERSION = "1";

interface TokenRecord {
  address: string;
  _name?: string;
  _symbol?: string;
  _totalSupply?: string;
  customDecimals?: number | string;
}

interface MetricBucketSummary {
  totalUsd: string;
}

interface TvlAssetSummary {
  address: string;
  symbol: string;
  decimals: number;
  amount: string;
  priceUsd: string;
  totalUsd: string;
}

interface TvlPoolSummary {
  address: string;
  isStable: boolean;
  totalUsd: string;
  assets: TvlAssetSummary[];
}

interface TvlPositionSummary extends TvlAssetSummary {
  sourceBucket: string;
  sourceKey: string;
}

interface TvlMetrics {
  timestamp: string;
  methodologyVersion: string;
  totalUsd: string;
  assets: TvlAssetSummary[];
  positions: TvlPositionSummary[];
  breakdown: {
    cdp: MetricBucketSummary & { assets: TvlAssetSummary[] };
    lendingSupply: MetricBucketSummary & {
      address: string;
      symbol: string;
      decimals: number;
      amount: string;
      priceUsd: string;
    };
    lendingCollateral: MetricBucketSummary & { assets: TvlAssetSummary[] };
    pools: MetricBucketSummary & { pools: TvlPoolSummary[] };
    saveUsdst: MetricBucketSummary & {
      address: string;
      symbol: string;
      decimals: number;
      amount: string;
      priceUsd: string;
    };
    safetyModule: MetricBucketSummary & {
      address: string;
      symbol: string;
      decimals: number;
      amount: string;
      priceUsd: string;
    };
    vaults: MetricBucketSummary & { assets: TvlAssetSummary[] };
  };
}

interface StablecoinAssetSummary {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  priceUsd: string;
  totalUsd: string;
}

interface StablecoinMetrics {
  timestamp: string;
  methodologyVersion: string;
  totalUsd: string;
  assets: StablecoinAssetSummary[];
}

const normalizeAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase();

const parseBigIntLike = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  if (value === null || value === undefined) return 0n;

  const raw = String(value).trim();
  if (!raw) return 0n;
  if (/^-?\d+$/.test(raw)) return BigInt(raw);
  return 0n;
};

const pow10 = (decimals: number): bigint => 10n ** BigInt(decimals);

const toDecimals = (value: number | string | undefined, fallback = 18): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return fallback;
};

const mulDiv = (amount: string, priceUsd: string, scale: bigint): string => {
  const amountBig = parseBigIntLike(amount);
  const priceBig = parseBigIntLike(priceUsd);
  if (amountBig === 0n || priceBig === 0n) return "0";
  return ((amountBig * priceBig) / scale).toString();
};

const sumUsd = (values: string[]): string =>
  values.reduce((sum, value) => sum + parseBigIntLike(value), 0n).toString();

const getActiveTokens = async (accessToken: string): Promise<TokenRecord[]> => {
  const response = await cirrus.get(accessToken, `/${Token}`, {
    params: {
      select: "address,_name,_symbol,_totalSupply::text,customDecimals",
      status: "eq.2",
      _totalSupply: "gt.0",
    },
  });

  return (response.data || []) as TokenRecord[];
};

const buildTokenMap = (tokens: TokenRecord[]): Map<string, TokenRecord> =>
  new Map(tokens.map((token) => [normalizeAddress(token.address), token]));

const buildClassificationContext = async (
  accessToken: string
) => {
  const [lendingInfo, saveInfo, pools, bridgeTokens] = await Promise.all([
    getPublicLiquidityInfo(accessToken),
    getSaveUsdstInfo(accessToken),
    getPools(accessToken, undefined) as Promise<any[]>,
    getBridgeableTokens(accessToken).catch(() => []),
  ]);

  let vaultInfo;
  try {
    vaultInfo = await getVaultInfo(accessToken);
  } catch {
    vaultInfo = { shareTokenAddress: "" };
  }

  const classificationContext = buildTokenClassificationContext({
    lendingReceiptTokenAddresses: [lendingInfo?.withdrawable?.address],
    safetyReceiptTokenAddresses: [getSafetyModuleConfig().sToken.address],
    vaultShareTokenAddresses: [vaultInfo.shareTokenAddress],
    lpTokenAddresses: (pools || []).map((pool: any) => pool.lpToken?.address).filter(Boolean),
    receiptTokenSymbols: [saveInfo.shareSymbol],
    bridgeStablecoinAddresses: (bridgeTokens || [])
      .filter((token: any) => ["USDC", "USDT", "USDST"].includes((token.stratoTokenSymbol || "").toUpperCase()))
      .map((token: any) => token.stratoToken),
  });

  return {
    classificationContext,
  };
};

const buildAssetSummary = (
  tokenMap: Map<string, TokenRecord>,
  params: {
    address: string;
    symbol?: string;
    amount?: string;
    priceUsd?: string;
    totalUsd?: string;
    fallbackDecimals?: number;
  }
): TvlAssetSummary => {
  const normalizedAddress = normalizeAddress(params.address);
  const token = tokenMap.get(normalizedAddress);
  return {
    address: params.address,
    symbol: params.symbol || token?._symbol || params.address,
    decimals: toDecimals(token?.customDecimals, params.fallbackDecimals ?? 18),
    amount: params.amount || "0",
    priceUsd: params.priceUsd || "0",
    totalUsd: params.totalUsd || "0",
  };
};

const aggregateAssets = (assets: TvlAssetSummary[]): TvlAssetSummary[] => {
  const grouped = new Map<string, TvlAssetSummary>();

  for (const asset of assets) {
    const key = normalizeAddress(asset.address);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...asset });
      continue;
    }

    existing.amount = (parseBigIntLike(existing.amount) + parseBigIntLike(asset.amount)).toString();
    existing.totalUsd = (parseBigIntLike(existing.totalUsd) + parseBigIntLike(asset.totalUsd)).toString();
    if (existing.priceUsd === "0" && asset.priceUsd !== "0") {
      existing.priceUsd = asset.priceUsd;
    }
  }

  return Array.from(grouped.values()).sort((left, right) => {
    const leftUsd = parseBigIntLike(left.totalUsd);
    const rightUsd = parseBigIntLike(right.totalUsd);
    if (leftUsd === rightUsd) return left.symbol.localeCompare(right.symbol);
    return rightUsd > leftUsd ? 1 : -1;
  });
};

const buildPositions = (entries: Array<{ sourceBucket: string; sourceKey: string; asset: TvlAssetSummary }>): TvlPositionSummary[] =>
  entries.map(({ sourceBucket, sourceKey, asset }) => ({
    ...asset,
    sourceBucket,
    sourceKey,
  }));

const getLendingCollateralAssets = async (
  accessToken: string,
  tokenMap: Map<string, TokenRecord>
): Promise<TvlAssetSummary[]> => {
  const registry = await getPool(accessToken, {
    select:
      `lendingPool:lendingPool_fkey(` +
        `borrowableAsset,assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value)` +
      `),` +
      `collateralVault:collateralVault_fkey(address),` +
      `oracle:priceOracle_fkey(prices:${PriceOracle}-prices(asset:key,price:value::text))`,
  });

  const collateralVaultAddress = registry.collateralVault?.address;
  if (!collateralVaultAddress) return [];

  const borrowableAsset = normalizeAddress(registry.lendingPool?.borrowableAsset);
  const assetConfigMap = new Map<string, any>();
  (registry.lendingPool?.assetConfigs || []).forEach((config: any) => {
    assetConfigMap.set(normalizeAddress(config.asset), config.AssetConfig || {});
  });

  const priceMap = new Map<string, string>();
  (registry.oracle?.prices || []).forEach((price: any) => {
    priceMap.set(normalizeAddress(price.asset), price.price || "0");
  });

  const response = await cirrus.get(accessToken, `/${CollateralVault}-userCollaterals`, {
    params: {
      address: `eq.${collateralVaultAddress}`,
      select: "asset:key2,amount:value::text",
      value: "gt.0",
    },
  });

  const totals = new Map<string, bigint>();
  for (const entry of response.data || []) {
    const asset = normalizeAddress(entry.asset);
    if (!asset || asset === borrowableAsset) continue;
    totals.set(asset, (totals.get(asset) || 0n) + parseBigIntLike(entry.amount));
  }

  return Array.from(totals.entries()).map(([address, amount]) => {
    const token = tokenMap.get(address);
    const config = assetConfigMap.get(address);
    const unitScale = parseBigIntLike(config?.unitScale || pow10(toDecimals(token?.customDecimals, 18)).toString());
    const priceUsd = priceMap.get(address) || "0";
    const totalUsd = mulDiv(amount.toString(), priceUsd, unitScale);
    return buildAssetSummary(tokenMap, {
      address,
      symbol: token?._symbol,
      amount: amount.toString(),
      priceUsd,
      totalUsd,
      fallbackDecimals: toDecimals(token?.customDecimals, 18),
    });
  });
};

export const getTvlMetrics = async (accessToken: string): Promise<TvlMetrics> => {
  const [priceMap, tokens, cdpStats, safetyInfo] = await Promise.all([
    getOraclePrices(accessToken),
    getActiveTokens(accessToken),
    getCDPStats(accessToken, ""),
    getPublicSafetyModuleInfo(accessToken),
  ]);

  const tokenMap = buildTokenMap(tokens);
  const {
    lendingInfo,
    saveInfo,
    pools,
  } = await Promise.all([
    getPublicLiquidityInfo(accessToken),
    getSaveUsdstInfo(accessToken),
    getPools(accessToken, undefined) as Promise<any[]>,
  ]).then(([lendingInfo, saveInfo, pools]) => ({
    lendingInfo,
    saveInfo,
    pools,
  }));

  let vaultInfo;
  try {
    vaultInfo = await getVaultInfo(accessToken);
  } catch {
    vaultInfo = {
      totalEquity: "0",
      assets: [],
      shareTokenAddress: "",
    };
  }

  const lendingCollateralAssets = await getLendingCollateralAssets(accessToken, tokenMap);

  const cdpAssets: TvlAssetSummary[] = (cdpStats.assets || []).map((asset) =>
    buildAssetSummary(tokenMap, {
      address: asset.asset,
      symbol: asset.symbol,
      amount: asset.totalCollateral,
      priceUsd: priceMap.get(asset.asset) || "0",
      totalUsd: asset.collateralValueUSD,
    })
  );

  const lendingSupplyAddress = lendingInfo?.supplyable?.address || USDST;
  const lendingSupplyToken = tokenMap.get(normalizeAddress(lendingSupplyAddress));
  const lendingSupplyDecimals = toDecimals(lendingSupplyToken?.customDecimals, 18);
  const lendingSupplySymbol = lendingInfo?.supplyable?._symbol || lendingSupplyToken?._symbol || "USDST";
  const lendingSupplyPrice = lendingInfo?.supplyable?.price || priceMap.get(lendingSupplyAddress) || WAD.toString();
  const lendingSupplyUsd = mulDiv(
    lendingInfo?.totalUSDSTSupplied || "0",
    lendingSupplyPrice,
    pow10(lendingSupplyDecimals)
  );

  const poolSummaries: TvlPoolSummary[] = (pools || []).map((pool: any) => {
    const poolAssets: TvlAssetSummary[] = pool.coins?.length
      ? pool.coins.map((coin: any) =>
          buildAssetSummary(tokenMap, {
            address: coin.address,
            symbol: coin._symbol,
            amount: coin.poolBalance,
            priceUsd: coin.price,
            totalUsd: mulDiv(
              coin.poolBalance || "0",
              coin.price || "0",
              pow10(toDecimals(coin.customDecimals, 18))
            ),
            fallbackDecimals: toDecimals(coin.customDecimals, 18),
          })
        )
      : [
          buildAssetSummary(tokenMap, {
            address: pool.tokenA.address,
            symbol: pool.tokenA._symbol,
            amount: pool.tokenA.poolBalance,
            priceUsd: pool.tokenA.price,
            totalUsd: mulDiv(
              pool.tokenA.poolBalance || "0",
              pool.tokenA.price || "0",
              pow10(toDecimals(pool.tokenA.customDecimals, 18))
            ),
            fallbackDecimals: toDecimals(pool.tokenA.customDecimals, 18),
          }),
          buildAssetSummary(tokenMap, {
            address: pool.tokenB.address,
            symbol: pool.tokenB._symbol,
            amount: pool.tokenB.poolBalance,
            priceUsd: pool.tokenB.price,
            totalUsd: mulDiv(
              pool.tokenB.poolBalance || "0",
              pool.tokenB.price || "0",
              pow10(toDecimals(pool.tokenB.customDecimals, 18))
            ),
            fallbackDecimals: toDecimals(pool.tokenB.customDecimals, 18),
          }),
        ];

    return {
      address: pool.address,
      isStable: Boolean(pool.isStable),
      totalUsd: pool.totalLiquidityUSD || "0",
      assets: poolAssets,
    };
  });
  const poolsTotalUsd = sumUsd(poolSummaries.map((pool) => pool.totalUsd));

  const saveAssetToken = tokenMap.get(normalizeAddress(saveInfo.assetAddress));
  const savePrice = priceMap.get(saveInfo.assetAddress) || WAD.toString();
  const saveAmount = saveInfo.pricingAssets || saveInfo.totalAssets || "0";
  const saveDecimals = toDecimals(saveAssetToken?.customDecimals, 18);
  const saveUsd = mulDiv(saveAmount, savePrice, pow10(saveDecimals));

  const safetyConfig = getSafetyModuleConfig();
  const safetyAssetAddress = safetyConfig.asset.address || USDST;
  const safetyAssetToken = tokenMap.get(normalizeAddress(safetyAssetAddress));
  const safetyPrice = priceMap.get(safetyAssetAddress) || WAD.toString();
  const safetyDecimals = toDecimals(safetyAssetToken?.customDecimals, 18);
  const safetyUsd = mulDiv(
    safetyInfo.totalAssets || "0",
    safetyPrice,
    pow10(safetyDecimals)
  );

  const vaultAssets: TvlAssetSummary[] = (vaultInfo.assets || []).map((asset: any) =>
    buildAssetSummary(tokenMap, {
      address: asset.address,
      symbol: asset.symbol,
      amount: asset.balance,
      priceUsd: asset.priceUsd,
      totalUsd: asset.valueUsd,
      fallbackDecimals: toDecimals(tokenMap.get(normalizeAddress(asset.address))?.customDecimals, 18),
    })
  );
  const vaultTotalUsd = vaultInfo.totalEquity || "0";

  const allPositions = buildPositions([
    ...cdpAssets.map((asset) => ({ sourceBucket: "cdp", sourceKey: asset.address, asset })),
    {
      sourceBucket: "lendingSupply",
      sourceKey: lendingSupplyAddress,
      asset: buildAssetSummary(tokenMap, {
        address: lendingSupplyAddress,
        symbol: lendingSupplySymbol,
        amount: lendingInfo.totalUSDSTSupplied || "0",
        priceUsd: lendingSupplyPrice,
        totalUsd: lendingSupplyUsd,
        fallbackDecimals: lendingSupplyDecimals,
      }),
    },
    ...lendingCollateralAssets.map((asset) => ({ sourceBucket: "lendingCollateral", sourceKey: asset.address, asset })),
    ...poolSummaries.flatMap((pool) =>
      pool.assets.map((asset) => ({
        sourceBucket: "pools",
        sourceKey: `${pool.address}:${asset.address}`,
        asset,
      }))
    ),
    {
      sourceBucket: "saveUsdst",
      sourceKey: saveInfo.assetAddress || USDST,
      asset: buildAssetSummary(tokenMap, {
        address: saveInfo.assetAddress || USDST,
        symbol: saveInfo.assetSymbol || "USDST",
        amount: saveAmount,
        priceUsd: savePrice,
        totalUsd: saveUsd,
        fallbackDecimals: saveDecimals,
      }),
    },
    {
      sourceBucket: "safetyModule",
      sourceKey: safetyAssetAddress,
      asset: buildAssetSummary(tokenMap, {
        address: safetyAssetAddress,
        symbol: safetyAssetToken?._symbol || "USDST",
        amount: safetyInfo.totalAssets || "0",
        priceUsd: safetyPrice,
        totalUsd: safetyUsd,
        fallbackDecimals: safetyDecimals,
      }),
    },
    ...vaultAssets.map((asset) => ({ sourceBucket: "vaults", sourceKey: asset.address, asset })),
  ]);
  const aggregatedAssets = aggregateAssets(allPositions.map((position) => ({
    address: position.address,
    symbol: position.symbol,
    decimals: position.decimals,
    amount: position.amount,
    priceUsd: position.priceUsd,
    totalUsd: position.totalUsd,
  })));

  const totalUsd = sumUsd([
    cdpStats.totalCollateralValueUSD || "0",
    lendingSupplyUsd,
    sumUsd(lendingCollateralAssets.map((asset) => asset.totalUsd)),
    poolsTotalUsd,
    saveUsd,
    safetyUsd,
    vaultTotalUsd,
  ]);

  return {
    timestamp: new Date().toISOString(),
    methodologyVersion: METHODOLOGY_VERSION,
    totalUsd,
    assets: aggregatedAssets,
    positions: allPositions,
    breakdown: {
      cdp: {
        totalUsd: cdpStats.totalCollateralValueUSD || "0",
        assets: cdpAssets,
      },
      lendingSupply: {
        totalUsd: lendingSupplyUsd,
        address: lendingSupplyAddress,
        symbol: lendingSupplySymbol,
        decimals: lendingSupplyDecimals,
        amount: lendingInfo.totalUSDSTSupplied || "0",
        priceUsd: lendingSupplyPrice,
      },
      lendingCollateral: {
        totalUsd: sumUsd(lendingCollateralAssets.map((asset) => asset.totalUsd)),
        assets: lendingCollateralAssets,
      },
      pools: {
        totalUsd: poolsTotalUsd,
        pools: poolSummaries,
      },
      saveUsdst: {
        totalUsd: saveUsd,
        address: saveInfo.assetAddress || USDST,
        symbol: saveInfo.assetSymbol || "USDST",
        decimals: saveDecimals,
        amount: saveAmount,
        priceUsd: savePrice,
      },
      safetyModule: {
        totalUsd: safetyUsd,
        address: safetyAssetAddress,
        symbol: safetyAssetToken?._symbol || "USDST",
        decimals: safetyDecimals,
        amount: safetyInfo.totalAssets || "0",
        priceUsd: safetyPrice,
      },
      vaults: {
        totalUsd: vaultTotalUsd,
        assets: vaultAssets,
      },
    },
  };
};

export const getStablecoinMetrics = async (accessToken: string): Promise<StablecoinMetrics> => {
  const [tokens, priceMap] = await Promise.all([
    getActiveTokens(accessToken),
    getOraclePrices(accessToken),
  ]);
  const { classificationContext } = await buildClassificationContext(accessToken);

  const assets: StablecoinAssetSummary[] = tokens
    .map((token) => ({
      token,
      classification: classifyToken(token, classificationContext),
    }))
    .filter(({ classification }) => classification.classification.includeInStablecoinSupply)
    .map(({ token, classification }) => {
      const decimals = toDecimals(token.customDecimals, 18);
      const priceUsd = priceMap.get(token.address) || WAD.toString();
      const totalSupply = token._totalSupply || "0";
      const totalUsd = mulDiv(totalSupply, priceUsd, pow10(decimals));

      return {
        address: token.address,
        name: token._name || token._symbol || token.address,
        symbol: token._symbol || "UNKNOWN",
        decimals,
        totalSupply,
        priceUsd,
        totalUsd,
      };
    })
    .sort((left, right) => {
      const leftUsd = parseBigIntLike(left.totalUsd);
      const rightUsd = parseBigIntLike(right.totalUsd);
      if (leftUsd === rightUsd) return left.symbol.localeCompare(right.symbol);
      return rightUsd > leftUsd ? 1 : -1;
    });

  return {
    timestamp: new Date().toISOString(),
    methodologyVersion: METHODOLOGY_VERSION,
    totalUsd: sumUsd(assets.map((asset) => asset.totalUsd)),
    assets,
  };
};
