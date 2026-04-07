import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { ensureHexPrefix } from "../../utils/utils";
import { BridgeToken } from "@mercata/shared-types";

// ============================================================================
// TYPES
// ============================================================================

interface QueryConfig {
  tableName: string;
  selectFields: string;
  countField: string;
}

export type BridgeMappingRow = {
  collection_name?: string;
  externalToken?: string;
  externalChainId?: string | number;
  targetStratoToken?: string;
  mappingValue?: unknown;
};

export type BridgeAssetInfo = {
  externalChainId: string;
  externalToken: string;
  externalName: string;
  externalSymbol: string;
  externalDecimals: string;
  maxPerWithdrawal: string;
  stratoToken: string;
  enabled: boolean;
};

export type BridgeableAssetRoute = {
  id: string;
  externalToken: string;
  externalChainId: string;
  AssetInfo: BridgeAssetInfo;
  isDefaultRoute: boolean;
};

// ============================================================================
// UTILS
// ============================================================================

export const normalizeBridgeAddress = (value: string): string => ensureHexPrefix(value).toLowerCase();
export const toBridgeChainId = (value: unknown): string => String(value ?? "");
export const isMappingTrue = (value: unknown): boolean => value === true || value === "true";

export const getBridgePairKey = (externalToken: string, externalChainId: string): string =>
  `${normalizeBridgeAddress(externalToken)}-${externalChainId}`;

const stripHex = (addr: string): string => {
  const l = addr.toLowerCase();
  return l.startsWith("0x") ? l.slice(2) : l;
};

const normalizeAddr = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? stripHex(normalizeBridgeAddress(value)) : "";

// ============================================================================
// QUERY CONFIGS & EXECUTION
// ============================================================================

const QUERY_CONFIGS: Record<string, QueryConfig> = {
  withdrawal: {
    tableName: `${constants.MercataBridge}-withdrawals`,
    selectFields: "withdrawalId:key,WithdrawalInfo:value,block_timestamp",
    countField: "count()",
  },
  deposit: {
    tableName: `${constants.MercataBridge}-deposits`,
    selectFields: "externalChainId:key,externalTxHash:key2,DepositInfo:value,block_timestamp",
    countField: "count()",
  }
};

export function buildQueryParams(
  rawParams: Record<string, string | undefined>,
  userAddress: string | undefined,
  excludeFields: string[],
  queryType: 'withdrawal' | 'deposit'
): Record<string, string> {
  return {
    address: `eq.${constants.mercataBridge}`,
    ...Object.fromEntries(
      Object.entries(rawParams).filter(([key, v]) => v !== undefined && !excludeFields.includes(key))
    ),
    ...(userAddress && {
      [`value->>${queryType === 'deposit' ? 'stratoRecipient' : 'stratoSender'}`]: `eq.${userAddress}`
    })
  };
}

export async function executeParallelQueries(
  accessToken: string,
  config: QueryConfig,
  dataParams: Record<string, string>,
  countParams: Record<string, string>
) {
  const [dataResponse, countResponse] = await Promise.all([
    cirrus.get(accessToken, `/${config.tableName}`, { params: dataParams }),
    cirrus.get(accessToken, `/${config.tableName}`, { params: countParams })
  ]);
  return {
    results: dataResponse.data || [],
    totalCount: countResponse.data?.[0]?.count || 0
  };
}

// ============================================================================
// TRANSACTION ENRICHMENT
// ============================================================================

type TxParts = { externalToken: string; externalChainId: string; stratoToken: string };

function extractTxParts(result: any, type: 'withdrawal' | 'deposit'): TxParts {
  const info = type === "withdrawal" ? result?.WithdrawalInfo : result?.DepositInfo;
  return {
    externalToken: normalizeAddr(info?.externalToken),
    externalChainId: type === "withdrawal"
      ? toBridgeChainId(info?.externalChainId)
      : toBridgeChainId(result?.externalChainId ?? info?.externalChainId),
    stratoToken: normalizeAddr(info?.stratoToken),
  };
}

function collectUniqueAddresses(results: any[], type: 'withdrawal' | 'deposit') {
  const stratoTokens = new Set<string>();
  const externalTokens = new Set<string>();
  const txHashes: string[] = [];
  for (const r of results) {
    const { externalToken, stratoToken } = extractTxParts(r, type);
    if (stratoToken) stratoTokens.add(stratoToken);
    if (externalToken) externalTokens.add(externalToken);
    if (type === "deposit" && r.externalTxHash) txHashes.push(r.externalTxHash);
  }
  return { stratoTokens, externalTokens, txHashes };
}

async function fetchTokenSymbols(accessToken: string, addresses: Set<string>): Promise<Map<string, { name: string; symbol: string }>> {
  if (!addresses.size) return new Map();
  const { data } = await cirrus.get(accessToken, `/${constants.Token}`, {
    params: { select: "address,_symbol,_name", address: `in.(${[...addresses].join(",")})` }
  });
  return new Map((data || []).map((t: any) => [t.address, { name: t._name || "-", symbol: t._symbol || "-" }]));
}

async function fetchExternalMeta(accessToken: string, tokens: Set<string>): Promise<Map<string, { externalName: string; externalSymbol: string }>> {
  if (!tokens.size) return new Map();
  const { data } = await cirrus.get(accessToken, `/${constants.MercataBridge}-assets`, {
    params: {
      address: `eq.${constants.mercataBridge}`,
      key: `in.(${[...tokens].join(",")})`,
      select: "key,value->>externalName,value->>externalSymbol,value->>externalChainId",
    }
  });
  const map = new Map<string, { externalName: string; externalSymbol: string }>();
  for (const a of data || []) {
    const key = getBridgePairKey(normalizeBridgeAddress(a.key), toBridgeChainId(a.externalChainId));
    if (!map.has(key)) map.set(key, { externalName: a.externalName || "-", externalSymbol: a.externalSymbol || "-" });
  }
  return map;
}

async function fetchDepositEvents(accessToken: string, txHashes: string[]): Promise<Map<string, any>> {
  if (!txHashes.length) return new Map();
  const { data } = await cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      select: "event_name,attributes",
      address: `eq.${constants.mercataBridge}`,
      or: "(event_name.eq.AutoForged,event_name.eq.AutoSaved)",
      "attributes->>externalTxHash": `in.(${txHashes.join(",")})`,
    }
  });
  const map = new Map<string, any>();
  for (const e of data || []) {
    const hash = e.attributes?.externalTxHash;
    if (hash) map.set(hash, e);
  }
  return map;
}

function applyDepositOutcome(enriched: any, eventMap: Map<string, any>, stratoMap: Map<string, { name: string; symbol: string }>) {
  const evt = eventMap.get(enriched.externalTxHash);
  if (evt?.event_name === "AutoForged") {
    const addr = stripHex(evt.attributes.metalToken || "");
    enriched.depositOutcome = "forge";
    enriched.finalToken = addr;
    enriched.finalTokenSymbol = stratoMap.get(addr)?.symbol || "-";
    enriched.finalAmount = evt.attributes.metalAmount || "0";
  } else if (evt?.event_name === "AutoSaved") {
    enriched.depositOutcome = "save";
    enriched.finalAmount = evt.attributes.mTokenAmount || "0";
  } else {
    enriched.depositOutcome = "bridge";
  }
}

export async function enrichTransactionData(
  accessToken: string,
  results: any[],
  type: 'withdrawal' | 'deposit'
) {
  if (!results.length) return results;

  const { stratoTokens, externalTokens, txHashes } = collectUniqueAddresses(results, type);

  const [stratoMap, externalMap, eventMap] = await Promise.all([
    fetchTokenSymbols(accessToken, stratoTokens),
    fetchExternalMeta(accessToken, externalTokens),
    type === "deposit" ? fetchDepositEvents(accessToken, txHashes) : Promise.resolve(new Map<string, any>()),
  ]);

  const metalAddrs = new Set<string>();
  for (const [, evt] of eventMap) {
    if (evt.event_name === "AutoForged" && evt.attributes?.metalToken) {
      const addr = stripHex(evt.attributes.metalToken);
      if (!stratoMap.has(addr)) metalAddrs.add(addr);
    }
  }
  if (metalAddrs.size) {
    const metalMap = await fetchTokenSymbols(accessToken, metalAddrs);
    for (const [k, v] of metalMap) stratoMap.set(k, v);
  }

  return results.map((r: any) => {
    const { externalToken, externalChainId, stratoToken } = extractTxParts(r, type);
    const pairKey = externalToken && externalChainId ? getBridgePairKey(normalizeBridgeAddress(externalToken), externalChainId) : "";
    const extMeta = pairKey ? externalMap.get(pairKey) : undefined;
    const strMeta = stratoToken ? stratoMap.get(stratoToken) : undefined;

    const enriched: any = {
      ...r,
      stratoTokenName: strMeta?.name || "-",
      stratoTokenSymbol: strMeta?.symbol || "-",
      externalName: extMeta?.externalName || "-",
      externalSymbol: extMeta?.externalSymbol || "-",
    };

    if (type === "deposit" && r.externalTxHash) applyDepositOutcome(enriched, eventMap, stratoMap);

    return enriched;
  });
}

// ============================================================================
// BRIDGEABLE TOKEN ROUTES (used by /bridgeableTokens/:chainId endpoint)
// ============================================================================

export function enrichAssetsWithTokenData(
  assets: BridgeableAssetRoute[],
  tokenMap: Map<string, { name?: string; symbol?: string; image?: string }>
): BridgeToken[] {
  return assets.map((route) => {
    const tokenKey = stripHex(route.AssetInfo.stratoToken);
    const meta = tokenMap.get(tokenKey);
    return {
      ...route.AssetInfo,
      stratoTokenName: meta?.name ?? "",
      stratoTokenSymbol: meta?.symbol ?? "",
      stratoTokenImage: meta?.image,
      isDefaultRoute: route.isDefaultRoute,
      id: route.id,
    };
  });
}

const toBridgeAssetInfo = (value: unknown, externalToken: string, externalChainId: string): BridgeAssetInfo | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.stratoToken !== "string" || raw.stratoToken.length === 0) return null;
  return {
    externalChainId,
    externalToken,
    externalName: typeof raw.externalName === "string" ? raw.externalName : "",
    externalSymbol: typeof raw.externalSymbol === "string" ? raw.externalSymbol : "",
    externalDecimals: raw.externalDecimals != null ? String(raw.externalDecimals) : "",
    maxPerWithdrawal: raw.maxPerWithdrawal != null ? String(raw.maxPerWithdrawal) : "0",
    stratoToken: normalizeBridgeAddress(raw.stratoToken),
    enabled: raw.enabled === true,
  };
};

export function parseBridgeRouteMappings(mappings: BridgeMappingRow[]): BridgeableAssetRoute[] {
  const assetByPair = new Map<string, BridgeAssetInfo>();
  const routeTokensByPair = new Map<string, Set<string>>();

  for (const row of mappings) {
    const externalToken = row?.externalToken;
    const externalChainId = toBridgeChainId(row?.externalChainId);
    if (!externalToken || !externalChainId) continue;
    const normalized = normalizeBridgeAddress(externalToken);
    const pairKey = getBridgePairKey(normalized, externalChainId);

    if (row.collection_name === "assets") {
      const info = toBridgeAssetInfo(row.mappingValue, normalized, externalChainId);
      if (info) assetByPair.set(pairKey, info);
    } else if (row.collection_name === "assetRouteEnabled" && isMappingTrue(row.mappingValue) && row.targetStratoToken) {
      const tokens = routeTokensByPair.get(pairKey) || new Set<string>();
      tokens.add(normalizeBridgeAddress(row.targetStratoToken));
      routeTokensByPair.set(pairKey, tokens);
    }
  }

  const routes: BridgeableAssetRoute[] = [];
  for (const [pairKey, asset] of assetByPair) {
    const explicitTokens = routeTokensByPair.get(pairKey) || new Set<string>();
    const { externalToken, externalChainId, stratoToken: defaultToken } = asset;

    routes.push({
      id: `${externalToken}-${externalChainId}-${defaultToken}`,
      externalToken, externalChainId, isDefaultRoute: true,
      AssetInfo: { ...asset, enabled: asset.enabled || explicitTokens.has(defaultToken) },
    });

    for (const stratoToken of explicitTokens) {
      if (stratoToken === defaultToken) continue;
      routes.push({
        id: `${externalToken}-${externalChainId}-${stratoToken}`,
        externalToken, externalChainId, isDefaultRoute: false,
        AssetInfo: { ...asset, stratoToken, enabled: true },
      });
    }
  }

  return routes;
}

export { QUERY_CONFIGS };
