import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix, ensure } from "../../utils/utils";
import { fetchBalances } from "../helpers/cirrusHelpers";
import { 
  buildQueryParams, 
  enrichTransactionData, 
  executeParallelQueries, 
  QUERY_CONFIGS 
} from "../helpers/bridge.helper";

const { MercataBridge, Token } = constants;

const assetParams = (mint: boolean, token: string) => ({
  select: "stratoTokenAddress:key,assetInfo:value",
  key: `eq.${token}`,
  "value->>enabled": "eq.true",
  ...(mint ? { "value->>mintUSDST": "eq.true" } : {}),
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

  const [balances, bridgeAssets] = await Promise.all([
    fetchBalances(accessToken, userAddress, addresses),
    cirrus.get(accessToken, `/${MercataBridge}-assets`, { params: assetParams(mintUSDST, approveToken) }).then(r => r.data)
  ]);

  ensure((balances.get(approveToken) ?? 0n) >= requiredApprove, "Insufficient token balance");
  ensure(requiredUSDST === 0n || (balances.get(constants.USDST) ?? 0n) >= requiredUSDST, "Insufficient USDST for gas");
  ensure(bridgeAssets.length > 0, mintUSDST ? "Asset not enabled for USDST minting" : "Asset not enabled");

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

  const enrichedData = enrichTransactionData(results, bridgeAssets, config.enrichmentType);
  
  return { data: enrichedData, totalCount };
};

export const getBridgeableTokens = async (accessToken: string, chainId: string) => {
  const params = {
    select: "stratoTokenAddress:key,AssetInfo:value",
    "value->>enabled": "eq.true",
    "value->>mintUSDST": "eq.false",
    "value->>externalChainId": `eq.${chainId}`,
    address: `eq.${constants.mercataBridge}`
  };
  const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, { params });
  if (!assets.length) return [];
  const tokenAddresses = assets.map((a: any) => a.stratoTokenAddress).filter(Boolean);
  const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, {
    params: { select: "address,_name,_symbol", address: `in.(${tokenAddresses.join(",")})` }
  });
  const tokenMap = new Map(tokenData.map((t: any) => [t.address, { name: t._name, symbol: t._symbol }]));
  return assets.map((a: any) => {
    const info = tokenMap.get(a.stratoTokenAddress) as { name?: string; symbol?: string } | undefined;
    if (a.AssetInfo.externalToken) a.AssetInfo.externalToken = ensureHexPrefix(a.AssetInfo.externalToken);
    return { stratoTokenAddress: a.stratoTokenAddress, stratoTokenName: info?.name || "", stratoTokenSymbol: info?.symbol || "", ...a.AssetInfo };
  });
};

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
  try {
    const { data: assets } = await cirrus.get(accessToken, `/${MercataBridge}-assets`, {
      params: {
        select: "stratoTokenAddress:key,AssetInfo:value",
        address: `eq.${constants.mercataBridge}`
      }
    });

    if (!assets.length) return new Map();

    const tokenAddresses = assets.map((asset: any) => asset.stratoTokenAddress).filter(Boolean);
    const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, {
      params: { select: "address,_name,_symbol", address: `in.(${tokenAddresses.join(",")})` }
    });

    const tokenMap = new Map(tokenData.map((t: any) => [t.address, { name: t._name, symbol: t._symbol }]));

    return new Map<string, any>(assets.map((asset: any) => [
      asset.stratoTokenAddress,
      {
        ...asset.AssetInfo,
        stratoToken: asset.stratoTokenAddress,
        stratoTokenName: (tokenMap.get(asset.stratoTokenAddress) as any)?.name || "",
        stratoTokenSymbol: (tokenMap.get(asset.stratoTokenAddress) as any)?.symbol || ""
      }
    ]));
  } catch (error) {
    console.error("Error in getBridgeAssets:", error);
    throw error;
  }
};
