import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { ensureHexPrefix } from "../../utils/utils";

interface QueryConfig {
  tableName: string;
  selectFields: string;
  countField: string;
}

const QUERY_CONFIGS: Record<string, QueryConfig> = {
  withdrawal: {
    tableName: `${constants.MercataBridge}-withdrawals`,
    selectFields: "withdrawalId:key,WithdrawalInfo:value,block_timestamp,transaction_hash",
    countField: "count()",
  },
  deposit: {
    tableName: `${constants.MercataBridge}-deposits`,
    selectFields: "externalChainId:key,externalTxHash:key2,DepositInfo:value,block_timestamp,transaction_hash",
    countField: "count()",
  }
};

export function buildQueryParams(
  rawParams: Record<string, string | undefined>,
  userAddress?: string,
  excludeFields: string[] = [],
  queryType?: 'withdrawal' | 'deposit'
): Record<string, string> {
  const baseParams: Record<string, string> = {
    address: `eq.${constants.mercataBridge}`,
    ...Object.fromEntries(
      Object.entries(rawParams).filter(([key, v]) => 
        v !== undefined && !excludeFields.includes(key)
      )
    )
  };

  if (userAddress) {
    // For withdrawals, use stratoSender; for deposits, use stratoRecipient
    const userField = queryType === 'deposit' ? 'stratoRecipient' : 'stratoSender';
    baseParams[`value->>${userField}`] = `eq.${userAddress}`;
  }

  return baseParams;
}

export function enrichTransactionData(
  results: any[],
  bridgeAssets: Map<string, any>,
  type: 'withdrawal' | 'deposit'
) {
  return results.map((result: any) => {    
    const token = type === 'withdrawal'
      ? result.WithdrawalInfo?.stratoToken
      : result.DepositInfo?.stratoToken;

    const matchingAsset = bridgeAssets.get(token);

    return {
      ...result,
      stratoToken: matchingAsset?.stratoToken || "-",
      stratoTokenName: matchingAsset?.stratoTokenName || "-",
      stratoTokenSymbol: matchingAsset?.stratoTokenSymbol || "-",
      externalName: matchingAsset?.externalName || "-",
      externalSymbol: matchingAsset?.externalSymbol || "-",
      externalToken: matchingAsset?.externalToken || "-"
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
export function enrichAssetsWithTokenData(assets: any[], tokenMap: Map<string, any>, keyField: string) {
  return assets.map((asset: any) => {
    const tokenKey = asset[keyField];
    const info = tokenMap.get(tokenKey);
    if (asset.AssetInfo?.externalToken) {
      asset.AssetInfo.externalToken = ensureHexPrefix(asset.AssetInfo.externalToken);
    }
    return {
      [keyField]: tokenKey,
      stratoTokenName: info?.name || "",
      stratoTokenSymbol: info?.symbol || "",
      ...asset.AssetInfo,
      externalChainId: asset.externalChainId
    };
  });
}

export { QUERY_CONFIGS };
