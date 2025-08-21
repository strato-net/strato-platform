import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

interface QueryConfig {
  tableName: string;
  selectFields: string;
  countField: string;
  enrichmentType: 'withdrawal' | 'deposit';
}

interface EnrichmentConfig {
  chainIdField: string;
  tokenField: string;
  statusField: string;
}

const QUERY_CONFIGS: Record<string, QueryConfig> = {
  withdrawal: {
    tableName: `${constants.MercataBridge}-withdrawals`,
    selectFields: "withdrawalId:key,withdrawalInfo:value,block_timestamp,transaction_hash",
    countField: "count()",
    enrichmentType: 'withdrawal'
  },
  deposit: {
    tableName: `${constants.MercataBridge}-deposits`,
    selectFields: "chainId:key,depositInfo:value,block_timestamp,transaction_hash",
    countField: "count()",
    enrichmentType: 'deposit'
  }
};

const ENRICHMENT_CONFIGS: Record<string, EnrichmentConfig> = {
  withdrawal: {
    chainIdField: 'withdrawalInfo?.destChainId',
    tokenField: 'withdrawalInfo?.token',
    statusField: 'withdrawalInfo?.bridgeStatus'
  },
  deposit: {
    chainIdField: 'chainId',
    tokenField: 'depositInfo?.token',
    statusField: 'depositInfo?.bridgeStatus'
  }
};

export function buildQueryParams(
  rawParams: Record<string, string | undefined>,
  userAddress?: string,
  excludeFields: string[] = []
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
    baseParams["value->>user"] = `eq.${userAddress}`;
  }

  return baseParams;
}

export function enrichTransactionData(
  results: any[],
  bridgeAssets: any[],
  enrichmentType: 'withdrawal' | 'deposit'
) {
  const config = ENRICHMENT_CONFIGS[enrichmentType];
  
  return results.map((result: any) => {
    const chainId = enrichmentType === 'withdrawal' 
      ? result.withdrawalInfo?.destChainId 
      : String(result.chainId);
    
    const token = enrichmentType === 'withdrawal'
      ? result.withdrawalInfo?.token
      : result.depositInfo?.token;

    const matchingAsset = bridgeAssets.find((asset: any) => 
      asset.value.chainId === chainId && asset.key === token
    );

    const { stratoToken, stratoTokenName, stratoTokenSymbol, value } = matchingAsset || {};

    return {
      ...result,
      status: result[config.statusField.split('?')[0]]?.bridgeStatus || 0,
      stratoToken: stratoToken || "-",
      stratoTokenName: stratoTokenName || "-",
      stratoTokenSymbol: stratoTokenSymbol || "-",
      extName: value?.extName || "-",
      extToken: value?.extToken || "-"
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

export { QUERY_CONFIGS };
