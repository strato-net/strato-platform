import { RawGetPool, RawToken } from "@mercata/shared-types";

export const LIVE_POOL_SELECT_FIELDS = "address,tokenABalance::text,tokenBBalance::text,aToBRatio::text,bToARatio::text,lpToken:lpToken_fkey(_totalSupply::text)";

const POOL_FETCH_CACHE_TTL_MS = 3_600_000;
const TRADING_VOLUME_CACHE_TTL_MS = 3_600_000;
const STABLE_POOL_FEE_CACHE_TTL_MS = 3_600_000;
const MULTI_TOKEN_STABLE_POOL_CACHE_TTL_MS = 3_600_000;
const MULTI_TOKEN_TOKEN_METADATA_CACHE_TTL_MS = 3_600_000;

type CachedMultiTokenStablePool = {
  address: string;
  lpToken: string;
  fee: string;
  coins: { coinIndex: number; tokenAddress: string }[];
};

let poolFetchCache: {
  key: string;
  expiresAt: number;
  poolData: Partial<RawGetPool>[];
  factoryData: unknown;
} | undefined;

let tradingVolumeCache: {
  key: string;
  expiresAt: number;
  volumeMap: Map<string, string>;
} | undefined;

let stablePoolFeeCache: {
  key: string;
  expiresAt: number;
  feeMap: Map<string, number>;
} | undefined;

let multiTokenStablePoolCache: {
  expiresAt: number;
  stablePools: CachedMultiTokenStablePool[];
} | undefined;

let multiTokenTokenMetadataCache: {
  key: string;
  expiresAt: number;
  tokenMetadataMap: Map<string, RawToken>;
} | undefined;

const getAddressSetCacheKey = (addresses: string[]): string =>
  addresses.map(address => address.toLowerCase()).sort().join(",");

export const getPoolFetchCacheKey = (params: Record<string, string>): string =>
  JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));

const stripTokenBalances = <T extends { balances?: unknown[] } | undefined>(token: T): T =>
  token
    ? { ...token, balances: [] } as T
    : token;

const stripLPTokenLiveFields = <T extends { balances?: unknown[]; _totalSupply?: string } | undefined>(token: T): T =>
  token
    ? { ...token, balances: [], _totalSupply: "0" } as T
    : token;

const stripLivePoolFields = (pools: RawGetPool[]): Partial<RawGetPool>[] =>
  pools.map(({ tokenABalance, tokenBBalance, aToBRatio, bToARatio, ...pool }) => ({
    ...pool,
    tokenA: stripTokenBalances(pool.tokenA),
    tokenB: stripTokenBalances(pool.tokenB),
    lpToken: stripLPTokenLiveFields(pool.lpToken),
  }));

export const applyLivePoolFields = (cachedPools: Partial<RawGetPool>[], livePools: RawGetPool[]): RawGetPool[] => {
  const livePoolByAddress = new Map(livePools.map(pool => [pool.address.toLowerCase(), pool]));
  return cachedPools.map((pool) => {
    const livePool = livePoolByAddress.get((pool.address || "").toLowerCase());
    return {
      ...pool,
      lpToken: pool.lpToken
        ? { ...pool.lpToken, _totalSupply: livePool?.lpToken?._totalSupply || "0" }
        : pool.lpToken,
      tokenABalance: livePool?.tokenABalance || "0",
      tokenBBalance: livePool?.tokenBBalance || "0",
      aToBRatio: livePool?.aToBRatio || "0",
      bToARatio: livePool?.bToARatio || "0",
    } as RawGetPool;
  });
};

export const getCachedPoolFetch = (key: string) =>
  poolFetchCache?.key === key && poolFetchCache.expiresAt > Date.now()
    ? poolFetchCache
    : undefined;

export const setCachedPoolFetch = (
  key: string,
  poolData: RawGetPool[],
  factoryData: unknown
) => {
  poolFetchCache = {
    key,
    expiresAt: Date.now() + POOL_FETCH_CACHE_TTL_MS,
    poolData: stripLivePoolFields(poolData),
    factoryData,
  };
};

export const getCachedTradingVolume = (poolAddresses: string[]): Map<string, string> | undefined => {
  const key = getAddressSetCacheKey(poolAddresses);
  return tradingVolumeCache?.key === key && tradingVolumeCache.expiresAt > Date.now()
    ? new Map(tradingVolumeCache.volumeMap)
    : undefined;
};

export const setCachedTradingVolume = (
  poolAddresses: string[],
  volumeMap: Map<string, string>
) => {
  tradingVolumeCache = {
    key: getAddressSetCacheKey(poolAddresses),
    expiresAt: Date.now() + TRADING_VOLUME_CACHE_TTL_MS,
    volumeMap: new Map(volumeMap),
  };
};

export const getCachedStablePoolFees = (addresses: string[]): Map<string, number> | undefined => {
  const key = getAddressSetCacheKey(addresses);
  return stablePoolFeeCache?.key === key && stablePoolFeeCache.expiresAt > Date.now()
    ? new Map(stablePoolFeeCache.feeMap)
    : undefined;
};

export const setCachedStablePoolFees = (
  addresses: string[],
  feeMap: Map<string, number>
) => {
  stablePoolFeeCache = {
    key: getAddressSetCacheKey(addresses),
    expiresAt: Date.now() + STABLE_POOL_FEE_CACHE_TTL_MS,
    feeMap: new Map(feeMap),
  };
};

export const getCachedMultiTokenStablePools = (): CachedMultiTokenStablePool[] | undefined =>
  multiTokenStablePoolCache && multiTokenStablePoolCache.expiresAt > Date.now()
    ? multiTokenStablePoolCache.stablePools.map(pool => ({
      ...pool,
      coins: pool.coins.map(coin => ({ ...coin })),
    }))
    : undefined;

export const setCachedMultiTokenStablePools = (stablePools: CachedMultiTokenStablePool[]) => {
  multiTokenStablePoolCache = {
    expiresAt: Date.now() + MULTI_TOKEN_STABLE_POOL_CACHE_TTL_MS,
    stablePools: stablePools.map(pool => ({
      ...pool,
      coins: pool.coins.map(coin => ({ ...coin })),
    })),
  };
};

const getLiveFieldAddressSet = (addresses: string[] = []): Set<string> =>
  new Set(addresses.map(address => address.toLowerCase()));

const stripCachedTokenMetadata = (
  token: RawToken,
  liveTotalSupplyAddresses: Set<string>
): RawToken => ({
  ...token,
  balances: [],
  ...(liveTotalSupplyAddresses.has(token.address.toLowerCase()) ? { _totalSupply: "0" } : {}),
});

export const getCachedMultiTokenTokenMetadata = (
  tokenAddresses: string[],
  liveTotalSupplyAddresses: string[] = []
): Map<string, RawToken> | undefined => {
  const key = getAddressSetCacheKey(tokenAddresses);
  const liveTotalSupplyAddressSet = getLiveFieldAddressSet(liveTotalSupplyAddresses);
  return multiTokenTokenMetadataCache?.key === key && multiTokenTokenMetadataCache.expiresAt > Date.now()
    ? new Map([...multiTokenTokenMetadataCache.tokenMetadataMap].map(([address, token]) => [
      address,
      stripCachedTokenMetadata(token, liveTotalSupplyAddressSet),
    ]))
    : undefined;
};

export const setCachedMultiTokenTokenMetadata = (
  tokenAddresses: string[],
  tokenMetadataMap: Map<string, RawToken>,
  liveTotalSupplyAddresses: string[] = []
) => {
  const liveTotalSupplyAddressSet = getLiveFieldAddressSet(liveTotalSupplyAddresses);
  multiTokenTokenMetadataCache = {
    key: getAddressSetCacheKey(tokenAddresses),
    expiresAt: Date.now() + MULTI_TOKEN_TOKEN_METADATA_CACHE_TTL_MS,
    tokenMetadataMap: new Map([...tokenMetadataMap].map(([address, token]) => [
      address,
      stripCachedTokenMetadata(token, liveTotalSupplyAddressSet),
    ])),
  };
};
