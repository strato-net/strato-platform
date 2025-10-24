import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix } from "../../utils/utils";
import { getTokenMetadata } from "../helpers/cirrusHelpers";
import { 
  buildQueryParams, 
  enrichTransactionData, 
  executeParallelQueries, 
  enrichAssetsWithTokenData,
  QUERY_CONFIGS 
} from "../helpers/bridge.helper";
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, WithdrawalRequestParams, WithdrawalRequestResponse } from "@mercata/shared-types";

const { MercataBridge, Token, mercataBridge, USDST } = constants;

export const requestWithdrawal = async (
  accessToken: string,
  {
    externalChainId,
    externalRecipient,
    externalToken,
    stratoToken,
    stratoTokenAmount,
  }: WithdrawalRequestParams,
  userAddress: string
): Promise<WithdrawalRequestResponse> => {
  const tx = await buildFunctionTx(
    [
      {
        contractName: extractContractName(Token),
        contractAddress: stratoToken,
        method: "approve",
        args: { spender: constants.mercataBridge, value: stratoTokenAmount },
      },
      {
        contractName: extractContractName(MercataBridge),
        contractAddress: constants.mercataBridge,
        method: "requestWithdrawal",
        args: {
          externalChainId,
          externalRecipient,
          externalToken,
          stratoTokenAmount,
        },
      },
    ],
    userAddress,
    accessToken
  );

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );
};

export const getBridgeTransactions = async (
  accessToken: string,
  type: 'withdrawal' | 'deposit',
  userAddress: string,
  rawParams: Record<string, string | undefined> = {}
): Promise<BridgeTransactionResponse> => {
  const externalAssets = await getBridgeAssets(accessToken);
  const config = QUERY_CONFIGS[type];
  
  const dataParams = {
    select: config.selectFields,
    ...buildQueryParams(rawParams, userAddress, [], type)
  };

  const countParams = {
    select: config.countField,
    ...buildQueryParams(rawParams, userAddress, ['limit', 'offset', 'order', 'select'], type)
  };

  const { results, totalCount } = await executeParallelQueries(
    accessToken, config, dataParams, countParams
  );

  if (!results.length) {
    return { data: [], totalCount };
  }

  const enrichedData = enrichTransactionData(results, externalAssets, type);
  
  return { data: enrichedData, totalCount };
};

export const getBridgeableTokens = async (accessToken: string, chainId: string): Promise<BridgeToken[]> => {
  const params = {
    select: "externalToken:key,externalChainId:key2,AssetInfo:value",
    "value->>enabled": "eq.true",
    "value->>stratoToken": `neq.${USDST}`,
    key2: `eq.${chainId}`,
    address: `eq.${mercataBridge}`
  };
  
  const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, { params });
  if (!assets?.length) return [];
  
  const tokenAddresses = assets.map((a: any) => a.externalToken).filter(Boolean);
  const tokenMap = await getTokenMetadata(accessToken, tokenAddresses);
  
  return enrichAssetsWithTokenData(assets, tokenMap);
};

export const getRedeemableTokens = async (accessToken: string, chainId: string): Promise<BridgeToken[]> => {
  const params = {
    select: "externalToken:key,externalChainId:key2,AssetInfo:value",
    "value->>enabled": "eq.true",
    "value->>stratoToken": `eq.${USDST}`,
    key2: `eq.${chainId}`,
    address: `eq.${mercataBridge}`
  };
  
  const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, { params });
  if (!assets?.length) return [];
  
  const tokenAddresses = assets.map((a: any) => a.externalToken).filter(Boolean);
  const tokenMap = await getTokenMetadata(accessToken, tokenAddresses);
  
  return enrichAssetsWithTokenData(assets, tokenMap);
};

export const getNetworkConfigs = async (accessToken: string): Promise<NetworkConfig[]> => { 
  const { data } = await cirrus.get(accessToken, `/${MercataBridge}-chains`, {
    params: {
      select: "externalChainId:key,ChainInfo:value",
      "value->>enabled": "eq.true",
      address: `eq.${mercataBridge}`
    }
  });
  return data.map((c: any) => {
    if (c.ChainInfo.depositRouter) c.ChainInfo.depositRouter = ensureHexPrefix(c.ChainInfo.depositRouter);
    return { externalChainId: c.externalChainId, chainInfo: c.ChainInfo };
  });
};

export const getBridgeAssets = async (accessToken: string) => {
  const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, {
    params: {
      select: "externalToken:key,externalChainId:key2,AssetInfo:value",
      address: `eq.${mercataBridge}`
    }
  });

  if (!assets?.length) return new Map();

  const tokenAddresses = assets.map((asset: any) => asset.AssetInfo.stratoToken).filter(Boolean);
  const tokenMap = await getTokenMetadata(accessToken, tokenAddresses);

  return new Map(assets.map((asset: any) => [
    asset.externalToken,
    {
      ...asset.AssetInfo,
      stratoTokenName: tokenMap.get(asset.AssetInfo.stratoToken)?.name || "",
      stratoTokenSymbol: tokenMap.get(asset.AssetInfo.stratoToken)?.symbol || ""
    }
  ]));
};

