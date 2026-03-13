import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { ensureHexPrefix } from "../../utils/utils";
import { BridgeToken } from "@mercata/shared-types";

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

export const normalizeBridgeAddress = (value: string): string => ensureHexPrefix(value).toLowerCase();

export const toBridgeChainId = (value: unknown): string => String(value ?? "");

export const getBridgePairKey = (externalToken: string, externalChainId: string): string =>
  `${normalizeBridgeAddress(externalToken)}-${externalChainId}`;

export const isMappingTrue = (value: unknown): boolean => value === true || value === "true";

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
  const baseParams: Record<string, string> = {
    address: `eq.${constants.mercataBridge}`,
    ...Object.fromEntries(
      Object.entries(rawParams).filter(([key, v]) => 
        v !== undefined && !excludeFields.includes(key)
      )
    ),
    ...(userAddress && {
      [`value->>${queryType === 'deposit' ? 'stratoRecipient' : 'stratoSender'}`]:
        `eq.${userAddress}`
    })
  };

  return baseParams;
}

export function enrichTransactionData(
  results: any[],
  routes: BridgeToken[],
  type: 'withdrawal' | 'deposit'
) {
  const normalizeOptionalAddress = (value: unknown): string =>
    typeof value === "string" && value.length > 0 ? normalizeBridgeAddress(value) : "";

  const getTxRouteParts = (result: any): { externalToken: string; externalChainId: string; stratoToken: string } => {
    const info = type === "withdrawal" ? result?.WithdrawalInfo : result?.DepositInfo;
    return {
      externalToken: normalizeOptionalAddress(info?.externalToken),
      externalChainId: type === "withdrawal"
        ? toBridgeChainId(info?.externalChainId)
        : toBridgeChainId(result?.externalChainId ?? info?.externalChainId),
      stratoToken: normalizeOptionalAddress(info?.stratoToken)
    };
  };

  const externalPairMap = new Map<string, { externalName: string; externalSymbol: string }>();
  const stratoMap = new Map<string, { stratoTokenName: string; stratoTokenSymbol: string }>();

  for (const route of routes) {
    const externalToken = normalizeBridgeAddress(route.externalToken);
    const stratoToken = normalizeBridgeAddress(route.stratoToken);
    const pairKey = getBridgePairKey(externalToken, route.externalChainId);
    if (!externalPairMap.has(pairKey) || route.isDefaultRoute) {
      externalPairMap.set(pairKey, {
        externalName: route.externalName || "-",
        externalSymbol: route.externalSymbol || "-"
      });
    }
    if (!stratoMap.has(stratoToken)) {
      stratoMap.set(stratoToken, {
        stratoTokenName: route.stratoTokenName || "-",
        stratoTokenSymbol: route.stratoTokenSymbol || "-"
      });
    }
  }

  return results.map((result: any) => {
    const { externalToken, externalChainId, stratoToken } = getTxRouteParts(result);
    const pairKey =
      externalToken && externalChainId
        ? getBridgePairKey(externalToken, externalChainId)
        : "";

    const externalMeta = pairKey ? externalPairMap.get(pairKey) : undefined;
    const stratoMeta = stratoToken ? stratoMap.get(stratoToken) : undefined;

    return {
      ...result,
      stratoTokenName: stratoMeta?.stratoTokenName || "-",
      stratoTokenSymbol: stratoMeta?.stratoTokenSymbol || "-",
      externalName: externalMeta?.externalName || "-",
      externalSymbol: externalMeta?.externalSymbol || "-"
    };
  });
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

// Bridge-specific helper function to enrich assets with token metadata
export function enrichAssetsWithTokenData(
  assets: BridgeableAssetRoute[],
  tokenMap: Map<string, { name?: string; symbol?: string; image?: string }>
): BridgeToken[] {
  const enriched: BridgeToken[] = new Array(assets.length);
  for (let i = 0; i < assets.length; i++) {
    const route = assets[i];
    const assetInfo = route.AssetInfo;
    const lower = assetInfo.stratoToken.toLowerCase();
    const tokenKey = lower.startsWith("0x") ? lower.slice(2) : lower;
    const tokenMeta = tokenMap.get(tokenKey);

    enriched[i] = {
      ...assetInfo,
      stratoTokenName: tokenMeta?.name ?? "",
      stratoTokenSymbol: tokenMeta?.symbol ?? "",
      stratoTokenImage: tokenMeta?.image,
      isDefaultRoute: route.isDefaultRoute,
      id: route.id
    };
  }
  return enriched;
}

const toBridgeAssetInfo = (value: unknown, externalToken: string, externalChainId: string): BridgeAssetInfo | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as {
    enabled?: unknown;
    externalName?: unknown;
    externalSymbol?: unknown;
    externalDecimals?: unknown;
    maxPerWithdrawal?: unknown;
    stratoToken?: unknown;
  };
  if (typeof raw.stratoToken !== "string" || raw.stratoToken.length === 0) return null;

  return {
    externalChainId,
    externalToken,
    externalName: typeof raw.externalName === "string" ? raw.externalName : "",
    externalSymbol: typeof raw.externalSymbol === "string" ? raw.externalSymbol : "",
    externalDecimals: raw.externalDecimals != null ? String(raw.externalDecimals) : "",
    maxPerWithdrawal: raw.maxPerWithdrawal != null ? String(raw.maxPerWithdrawal) : "0",
    stratoToken: normalizeBridgeAddress(raw.stratoToken),
    enabled: raw.enabled === true
  };
};

export function parseBridgeRouteMappings(
  mappings: BridgeMappingRow[]
): BridgeableAssetRoute[] {
  const assetByPair = new Map<string, BridgeAssetInfo>();
  const explicitRouteTokensByPair = new Map<string, Set<string>>();

  const addExplicitRouteToken = (pairKey: string, stratoToken: string): void => {
    const normalizedStratoToken = normalizeBridgeAddress(stratoToken);
    const tokens = explicitRouteTokensByPair.get(pairKey);
    if (tokens) {
      tokens.add(normalizedStratoToken);
      return;
    }
    explicitRouteTokensByPair.set(pairKey, new Set<string>([normalizedStratoToken]));
  };

  for (const row of mappings) {
    const externalToken = row?.externalToken;
    const externalChainId = toBridgeChainId(row?.externalChainId);
    if (!externalToken || !externalChainId) continue;
    const normalizedExternalToken = normalizeBridgeAddress(externalToken);

    const pairKey = getBridgePairKey(normalizedExternalToken, externalChainId);

    switch (row.collection_name) {
      case "assets": {
        const assetInfo = toBridgeAssetInfo(row.mappingValue, normalizedExternalToken, externalChainId);
        if (!assetInfo) break;

        assetByPair.set(pairKey, assetInfo);
        break;
      }
      case "assetRouteEnabled": {
        if (!isMappingTrue(row.mappingValue) || !row.targetStratoToken) break;
        addExplicitRouteToken(pairKey, row.targetStratoToken);
        break;
      }
      default:
        break;
    }
  }

  const routes: BridgeableAssetRoute[] = [];

  for (const [pairKey, asset] of assetByPair.entries()) {
    const explicitRouteTokens = explicitRouteTokensByPair.get(pairKey) || new Set<string>();
    const externalToken = asset.externalToken;
    const externalChainId = asset.externalChainId;
    const defaultStratoToken = asset.stratoToken;
    const defaultRouteExplicitEnabled = explicitRouteTokens.has(defaultStratoToken);
    const defaultRouteEnabled = asset.enabled || defaultRouteExplicitEnabled;

    routes.push({
      id: `${externalToken}-${externalChainId}-${defaultStratoToken}`,
      externalToken,
      externalChainId,
      isDefaultRoute: true,
      AssetInfo: {
        ...asset,
        externalToken,
        externalChainId,
        stratoToken: defaultStratoToken,
        enabled: defaultRouteEnabled
      }
    });

    for (const stratoToken of explicitRouteTokens.values()) {
      if (stratoToken === defaultStratoToken) continue;
      routes.push({
        id: `${externalToken}-${externalChainId}-${stratoToken}`,
        externalToken,
        externalChainId,
        isDefaultRoute: false,
        AssetInfo: {
          ...asset,
          externalToken,
          externalChainId,
          stratoToken,
          enabled: true
        }
      });
    }
  }

  return routes;
}

export { QUERY_CONFIGS };
