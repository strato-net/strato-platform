import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix, ensure } from "../../utils/utils";
import { fetchTokenBalances, getTokenMetadata } from "../helpers/cirrusHelpers";
import { 
  buildQueryParams, 
  enrichTransactionData, 
  executeParallelQueries, 
  enrichAssetsWithTokenData,
  QUERY_CONFIGS 
} from "../helpers/bridge.helper";

const { MercataBridge, Token } = constants;

const assetParams = (mint: boolean, externalChainId: string, token: string) => ({
  select: "count()",
  key: `eq.${token}`,
  key2: `eq.${externalChainId}`,
  "value->>permissions": mint ? "in.(2,3)" : "in.(1,3)", // 2,3 for mint, 1,3 for wrap
  address: `eq.${constants.mercataBridge}`,
});

export const requestWithdrawal = async (
  accessToken: string,
  body: Record<string, string>,
  userAddress: string,
  mintUSDST = false
) => {
  const { externalChainId, stratoToken, stratoTokenAmount, externalRecipient } = body;
  const approveToken = mintUSDST ? constants.USDST : stratoToken;

  const actions = [
    { contractName: extractContractName(Token), contractAddress: approveToken, method: "approve", args: { spender: constants.mercataBridge, value: stratoTokenAmount } },
    { contractName: extractContractName(MercataBridge), contractAddress: constants.mercataBridge, method: "requestWithdrawal", args: { externalChainId, externalRecipient, stratoToken, stratoTokenAmount, mintUSDST } },
  ];
  const txFeeWei = BigInt(actions.length) * constants.GAS_FEE_WEI;

  const amount = BigInt(stratoTokenAmount);
  const requiredApprove = amount + (mintUSDST ? txFeeWei : 0n);
  const requiredUSDST = mintUSDST ? 0n : txFeeWei;

  const addresses = mintUSDST ? [constants.USDST] : [approveToken, constants.USDST];

  const [balances, assetCount] = await Promise.all([
    fetchTokenBalances(accessToken, userAddress, addresses),
    cirrus.get(accessToken, `/${MercataBridge}-assets`, { params: assetParams(mintUSDST, externalChainId, approveToken) }).then(r => r.data?.[0]?.count || 0)
  ]);

  ensure((balances.get(approveToken) ?? 0n) >= requiredApprove, "Insufficient token balance");
  ensure(requiredUSDST === 0n || (balances.get(constants.USDST) ?? 0n) >= requiredUSDST, "Insufficient USDST for gas");
  ensure(assetCount > 0, mintUSDST ? "Asset not enabled for USDST minting" : "Asset not enabled for wrapping");

  const tx = buildFunctionTx(actions);

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash, message: "Withdrawal request submitted" };
};

export const getBridgeTransactions = async (
  accessToken: string,
  type: 'withdrawal' | 'deposit',
  userAddress?: string,
  rawParams: Record<string, string | undefined> = {}
) => {
  const bridgeAssets = await getBridgeAssets(accessToken);
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

  const enrichedData = enrichTransactionData(results, bridgeAssets, type);
  
  return { data: enrichedData, totalCount };
};

export const getBridgeableTokens = async (accessToken: string, chainId: string, mintUSDST = false) => {
  const params = {
    select: "stratoToken:key,externalChainId:key2,AssetInfo:value",
    "value->>permissions": mintUSDST ? "in.(2,3)" : "in.(1,3)", // 2,3 for mint, 1,3 for wrap
    externalChainId: `eq.${chainId}`,
    address: `eq.${constants.mercataBridge}`
  };
  
  const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, { params });
  if (!assets?.length) return [];
  
  const tokenAddresses = assets.map((a: any) => a.stratoToken).filter(Boolean);
  const tokenMap = await getTokenMetadata(accessToken, tokenAddresses);
  
  return enrichAssetsWithTokenData(assets, tokenMap, 'stratoToken');
};

export const getRedeemableTokens = async (accessToken: string, chainId: string) => 
  getBridgeableTokens(accessToken, chainId, true);

export const getNetworkConfigs = async (accessToken: string) => {
  try {
    const { data } = await cirrus.get(accessToken, `/${MercataBridge}-chains`, {
      params: {
        select: "externalChainId:key,ChainInfo:value",
        "value->>enabled": "eq.true",
        address: `eq.${constants.mercataBridge}`
      }
    });
    return data.map((c: any) => {
      if (c.ChainInfo.depositRouter) c.ChainInfo.depositRouter = ensureHexPrefix(c.ChainInfo.depositRouter);
      return { externalChainId: c.externalChainId, chainInfo: c.ChainInfo };
    });
  } catch (e) {
    throw e;
  }
};

export const getBridgeAssets = async (accessToken: string) => {
  const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, {
    params: {
      select: "stratoToken:key,externalChainId:key2,AssetInfo:value",
      address: `eq.${constants.mercataBridge}`
    }
  });

  if (!assets?.length) return new Map();

  const tokenAddresses = assets.map((asset: any) => asset.stratoToken).filter(Boolean);
  const tokenMap = await getTokenMetadata(accessToken, tokenAddresses);

  return new Map(assets.map((asset: any) => [
    asset.stratoToken,
    {
      ...asset.AssetInfo,
      stratoToken: asset.stratoToken,
      externalChainId: asset.externalChainId,
      stratoTokenName: tokenMap.get(asset.stratoToken)?.name || "",
      stratoTokenSymbol: tokenMap.get(asset.stratoToken)?.symbol || ""
    }
  ]));
};
