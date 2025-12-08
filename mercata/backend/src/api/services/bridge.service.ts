import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus, bridge } from "../../utils/mercataApiHelper";
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
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, WithdrawalRequestParams, AutoSaveRequestParams, WithdrawalSummaryResponse, TransactionResponse } from "@mercata/shared-types";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { toUTCTime } from "../helpers/cirrusHelpers";

const { MercataBridge, Token, mercataBridge, USDST, DECIMALS } = constants;

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
): Promise<TransactionResponse> => {
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

export const requestAutoSave = async (
  accessToken: string,
  {
    externalChainId,
    externalTxHash,
  }: AutoSaveRequestParams,
  userAddress: string
) : Promise<TransactionResponse> => {
  const params: AutoSaveRequestParams = {
    externalChainId,
    externalTxHash,
  };

  // Bridge service handles transaction execution and polling internally,
  // so we just call it directly and return the result
  const response = await bridge.post<TransactionResponse>(accessToken, `/request-autosave`, params);
  return response.data;
};

export const getBridgeTransactions = async (
  accessToken: string,
  type: 'withdrawal' | 'deposit',
  userAddress: string | undefined,
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
    key2: `eq.${chainId}`,
    address: `eq.${mercataBridge}`
  };
  
  const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, { params });
  if (!assets?.length) return [];
  
  const tokenAddresses = assets.map((a: any) => a.AssetInfo.stratoToken).filter(Boolean);
  const tokenMap = await getTokenMetadata(accessToken, tokenAddresses);
  
  return enrichAssetsWithTokenData(assets, tokenMap).map((token) => ({
    ...token,
    bridgeable: token.stratoToken !== USDST
  }));
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

export const getWithdrawalSummary = async (
  accessToken: string,
  userAddress: string
): Promise<WithdrawalSummaryResponse> => {
  const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, {
    params: {
      select: "value->>stratoToken",
      "value->>enabled": "eq.true",
      address: `eq.${mercataBridge}`
    }
  });

  const stratoTokens = [...new Set((assets || []).map((a: any) => a.stratoToken).filter(Boolean))];
  const thirtyDaysAgoUTC = toUTCTime(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  const [balances, prices, pending, completed] = await Promise.all([
    stratoTokens.length > 0
      ? cirrus.get(accessToken, `/${Token}-_balances`, {
          params: {
            select: "address,balance:value::text",
            key: `eq.${userAddress}`,
            address: `in.(${stratoTokens.join(",")})`
          }
        })
      : Promise.resolve({ data: [] }),
    getCompletePriceMap(accessToken),
    cirrus.get(accessToken, `/${MercataBridge}-withdrawals`, {
      params: {
        select: "count()",
        address: `eq.${mercataBridge}`,
        "value->>stratoSender": `eq.${userAddress}`,
        "value->>bridgeStatus": "in.(1,2)"
      }
    }),
    cirrus.get(accessToken, `/${MercataBridge}-withdrawals`, {
      params: {
        select: "value->>stratoToken,value->>stratoTokenAmount",
        address: `eq.${mercataBridge}`,
        "value->>stratoSender": `eq.${userAddress}`,
        "value->>bridgeStatus": "eq.3",
        block_timestamp: `gte.${thirtyDaysAgoUTC}`
      }
    })
  ]);

  let availableUSD = 0n;
  for (const b of balances.data || []) {
    const balance = BigInt(b.balance || "0");
    const price = BigInt(prices.get(b.address) || "0");
    if (balance > 0n && price > 0n) {
      availableUSD += (balance * price) / DECIMALS;
    }
  }

  let withdrawnUSD = 0n;
  for (const w of completed.data || []) {
    if (!w.stratoToken || !w.stratoTokenAmount) continue;
    const amount = BigInt(w.stratoTokenAmount || "0");
    const price = BigInt(prices.get(w.stratoToken) || "0");
    if (amount > 0n && price > 0n) {
      withdrawnUSD += (amount * price) / DECIMALS;
    }
  }
  
  return {
    totalWithdrawn30d: withdrawnUSD.toString(),
    pendingWithdrawals: pending.data?.[0]?.count || 0,
    availableToWithdraw: availableUSD.toString()
  };
};

