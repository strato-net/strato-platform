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
  externalAssets: Map<string, any>,
  type: 'withdrawal' | 'deposit'
) {
  return results.map((result: any) => {    
    const externalToken = type === 'withdrawal'
      ? result.WithdrawalInfo?.externalToken
      : result.DepositInfo?.externalToken;

    const matchingAsset = externalAssets.get(externalToken);

    return {
      ...result,
      stratoTokenName: matchingAsset?.stratoTokenName || "-",
      stratoTokenSymbol: matchingAsset?.stratoTokenSymbol || "-",
      externalName: matchingAsset?.externalName || "-",
      externalSymbol: matchingAsset?.externalSymbol || "-",
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
export function enrichAssetsWithTokenData(assets: any[], tokenMap: Map<string, any>) {
  return assets.map((asset: any) => {
    const info = tokenMap.get(asset.AssetInfo.stratoToken);
    if (asset?.externalToken) {
      asset.AssetInfo.externalToken = ensureHexPrefix(asset.AssetInfo.externalToken);
    }
    return {
      ...asset.AssetInfo,
      stratoTokenName: info?.name || "",
      stratoTokenSymbol: info?.symbol || "",
      id: `${asset.externalToken}-${asset.externalChainId}`
    };
  });
}

export { QUERY_CONFIGS };
