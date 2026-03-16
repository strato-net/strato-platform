import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus, bridge } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix } from "../../utils/utils";
import { getTokenMetadata } from "../helpers/cirrusHelpers";
import { 
  buildQueryParams, 
  BridgeMappingRow,
  enrichTransactionData, 
  enrichAssetsWithTokenData,
  executeParallelQueries,
  parseBridgeRouteMappings,
  QUERY_CONFIGS 
} from "../helpers/bridge.helper";
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, WithdrawalRequestParams, DepositActionRequestParams, WithdrawalSummaryResponse, TransactionResponse, DepositAction } from "@mercata/shared-types";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getOraclePrices } from "./oracle.service";
import { toUTCTime } from "../helpers/cirrusHelpers";

const { MercataBridge, Token, LendingPool, LendingRegistry, mercataBridge, DECIMALS } = constants;

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
          stratoToken,
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

export const requestDepositAction = async (
  accessToken: string,
  {
    externalChainId,
    externalTxHash,
    action,
    targetToken,
  }: DepositActionRequestParams,
  userAddress: string
) : Promise<TransactionResponse> => {
  const response = await bridge.post<TransactionResponse>(accessToken, `/request-deposit-action`, {
    externalChainId,
    externalTxHash,
    action,
    targetToken,
  });
  return response.data;
};

export const getBridgeTransactions = async (
  accessToken: string,
  type: 'withdrawal' | 'deposit',
  userAddress: string | undefined,
  rawParams: Record<string, string | undefined> = {}
): Promise<BridgeTransactionResponse> => {
  const bridgeRoutes = await getBridgeableTokens(accessToken);
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

  const enrichedData = enrichTransactionData(results, bridgeRoutes, type);
  
  return { data: enrichedData, totalCount };
};

export const getBridgeableTokens = async (accessToken: string, chainId?: string): Promise<BridgeToken[]> => {
  const params: Record<string, string> = {
    select: "collection_name,externalToken:key->>key,externalChainId:key->>key2,targetStratoToken:key->>key3,mappingValue:value",
    collection_name: "in.(assets,assetRouteEnabled)",
    address: `eq.${mercataBridge}`
  };
  if (chainId) params["key->>key2"] = `eq.${chainId}`;

  const { data: mappings } = await cirrus.get(accessToken, "/mapping", { params });
  if (!Array.isArray(mappings) || !mappings.length) return [];

  const routes = parseBridgeRouteMappings(mappings as BridgeMappingRow[]);
  if (!routes.length) return [];

  const tokenAddressSet = new Set<string>();
  for (const { AssetInfo } of routes) {
    const token = AssetInfo?.stratoToken;
    if (!token) continue;
    const lower = token.toLowerCase();
    tokenAddressSet.add(lower.startsWith("0x") ? lower.slice(2) : lower);
  }
  const tokenMap = await getTokenMetadata(accessToken, [...tokenAddressSet]);

  return enrichAssetsWithTokenData(routes, tokenMap);
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

export const getWithdrawalSummary = async (
  accessToken: string,
  userAddress: string
): Promise<WithdrawalSummaryResponse> => {
  const routes = await getBridgeableTokens(accessToken);
  const stratoTokens = [...new Set(routes.map((route) => route.stratoToken).filter(Boolean))];
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
        select: "value->>stratoToken,value->>stratoTokenAmount",
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
      availableUSD += (balance * price) / DECIMALS / DECIMALS;
    }
  }

  let pendingUSD = 0n;
  for (const p of pending.data || []) {
    if (!p.stratoToken || !p.stratoTokenAmount) continue;
    const amount = BigInt(p.stratoTokenAmount || "0");
    const price = BigInt(prices.get(p.stratoToken) || "0");
    if (amount > 0n && price > 0n) {
      pendingUSD += (amount * price) / DECIMALS;
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
    pendingWithdrawals: pendingUSD.toString(),
    availableToWithdraw: availableUSD.toString()
  };
};

export const getDepositActions = async (accessToken: string): Promise<DepositAction[]> => {
  const key = (r: any) => typeof r.key === "object" ? r.key.key : r.key;
  const val = (r: any) => typeof r.value === "string" ? JSON.parse(r.value) : r.value ?? {};

  const [{ data: mappings = [] }, { data: [pool] = [] }, prices, { data: [rateEvt] = [] }] = await Promise.all([
    constants.metalForge
      ? cirrus.get(accessToken, "/mapping", {
          params: { select: "collection_name,key,value::text", collection_name: "in.(metalConfigs,isSupportedPayToken)", address: `eq.${constants.metalForge}` }
        })
      : Promise.resolve({ data: [] }),
    cirrus.get(accessToken, `/${LendingRegistry}`, {
      params: { address: `eq.${constants.lendingRegistry}`, select: "lendingPool:lendingPool_fkey(borrowableAsset,mToken)" }
    }),
    getOraclePrices(accessToken),
    cirrus.get(accessToken, `/${LendingPool}-ExchangeRateUpdated`, {
      params: { select: "newRate::text", order: "block_timestamp.desc", limit: "1" }
    }),
  ]);

  const metals = mappings.filter((r: any) => r.collection_name === "metalConfigs").map((r: any) => ({ addr: key(r), ...val(r) })).filter((m: any) => m.isEnabled === true);
  const payTokens = mappings.filter((r: any) => r.collection_name === "isSupportedPayToken").filter((r: any) => r.value === true || r.value === "true").map((r: any) => ({ addr: key(r) }));
  const { borrowableAsset, mToken } = pool?.lendingPool || {};
  if (mToken) prices.set(mToken, rateEvt?.newRate || (10n ** 18n).toString());

  const allAddrs = [...metals.map((m: any) => m.addr), ...(mToken ? [mToken] : [])];
  const tokenMap = allAddrs.length ? await getTokenMetadata(accessToken, allAddrs) : new Map();

  const toAction = (id: string, action: number, addr: string, pay: string): DepositAction => {
    const m = tokenMap.get(addr);
    return { id, action, stratoToken: addr, stratoTokenName: m?.name ?? "", stratoTokenSymbol: m?.symbol ?? "", stratoTokenImage: m?.image, payToken: pay, oraclePrice: prices.get(addr) };
  };

  return [
    ...(borrowableAsset && mToken ? [toAction(`earn-${borrowableAsset}`, 1, mToken, borrowableAsset)] : []),
    ...payTokens.flatMap((p: any) => metals.map((m: any) => toAction(`forge-${p.addr}-${m.addr}`, 2, m.addr, p.addr))),
  ];
};
