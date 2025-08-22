import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix } from "../../utils/utils";
import { 
  buildQueryParams, 
  enrichTransactionData, 
  executeParallelQueries, 
  QUERY_CONFIGS 
} from "../helpers/bridge.helper";

const { MercataBridge, Token } = constants;

export const bridgeOut = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  const { destChainId, token, amount, destAddress } = body;

  if (!constants.mercataBridge) {
    throw new Error("Bridge contract address not configured");
  }

  const tx = buildFunctionTx([
    {
      contractName: extractContractName(Token),
      contractAddress: token || "",
      method: "approve",
      args: { spender: constants.mercataBridge, value: amount },
    },
    {
      contractName: extractContractName(MercataBridge),
      contractAddress: constants.mercataBridge,
      method: "requestWithdrawal",
      args: { destChainId, token, amount, destAddress },
    }
  ]);

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  return { status, hash, message: "Withdrawal request submitted successfully" };
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
    ...buildQueryParams(rawParams, userAddress)
  };

  const countParams = {
    select: config.countField,
    ...buildQueryParams(rawParams, userAddress, ['limit', 'offset', 'order', 'select'])
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
    select: "stratoTokenAddress:key,assetInfo:value",
    "value->>enabled": "eq.true",
    "value->>chainId": `eq.${chainId}`,
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
    if (a.assetInfo.extToken) a.assetInfo.extToken = ensureHexPrefix(a.assetInfo.extToken);
    return { stratoTokenAddress: a.stratoTokenAddress, stratoTokenName: info?.name || "", stratoTokenSymbol: info?.symbol || "", ...a.assetInfo };
  });
};

export const getNetworkConfigs = async (accessToken: string) => {
  try {
    const { data } = await cirrus.get(accessToken, `/${MercataBridge}-chains`, {
      params: {
        select: "chainId:key,ChainInfo:value",
        "value->>enabled": "eq.true",
        address: `eq.${constants.mercataBridge}`
      }
    });
    return data.map((c: any) => {
      if (c.ChainInfo.depositRouter) c.ChainInfo.depositRouter = ensureHexPrefix(c.ChainInfo.depositRouter);
      return { chainId: c.chainId, chainInfo: c.ChainInfo };
    });
  } catch (e) {
    throw e;
  }
};

export const getBridgeAssets = async (accessToken: string) => {
  try {
    const { data: bridgeData } = await cirrus.get(accessToken, `/BlockApps-Mercata-MercataBridge`, {
      params: {
        select: "assets:BlockApps-Mercata-MercataBridge-assets(*)",
        address: `eq.${constants.mercataBridge}`
      }
    });

    const assets = bridgeData?.[0]?.assets || [];
    if (!assets.length) return [];

    const tokenAddresses = assets.map((asset: any) => asset.key);
    const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, {
      params: { select: "address,_name,_symbol", address: `in.(${tokenAddresses.join(",")})` }
    });

    const tokenMap = new Map(tokenData.map((t: any) => [t.address, { name: t._name, symbol: t._symbol }]));

    return assets.map((asset: any) => {
      const tokenInfo = tokenMap.get(asset.key) as { name?: string; symbol?: string } | undefined;
      return {
        key: asset.key,
        root: asset.root,
        value: asset.value,
        address: asset.address,
        stratoToken: asset.key,
        stratoTokenName: tokenInfo?.name || "",
        stratoTokenSymbol: tokenInfo?.symbol || ""
      };
    });
  } catch (error) {
    console.error("Error in getBridgeAssets:", error);
    throw error;
  }
};

export const getTokenLimit = async (accessToken: string, tokenAddress: string) => {
  try {
    const { data: [tokenLimit] = [] } = await cirrus.get(accessToken, `/${MercataBridge}-tokenLimits`, {
      params: {
        select: "token:key,tokenLimit:value",
        "key": `eq.${tokenAddress}`,
        address: `eq.${constants.mercataBridge}`
      }
    });

    const maxPerTx = tokenLimit?.tokenLimit?.maxPerTx || "0";
    const isUnlimited = maxPerTx === "0" || maxPerTx === 0;

    return { token: tokenAddress, maxPerTx: maxPerTx.toString(), isUnlimited };
  } catch (error) {
    console.error("Error in getTokenLimit:", error);
    return { token: tokenAddress, maxPerTx: "0", isUnlimited: true };
  }
};
