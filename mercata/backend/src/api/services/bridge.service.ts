import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus, bridge } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName, ensureHexPrefix } from "../../utils/utils";
import { getTokenMetadata } from "../helpers/cirrusHelpers";
import { 
  buildQueryParams, 
  BridgeMappingRow,
  NativeBridgeAssetRow,
  enrichTransactionData, 
  enrichAssetsWithTokenData,
  executeParallelQueries,
  parseBridgeRouteMappings,
  parseNativeBridgeAssets,
  QUERY_CONFIGS 
} from "../helpers/bridge.helper";
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, WithdrawalRequestParams, DepositActionRequestParams, WithdrawalSummaryResponse, TransactionResponse, DepositAction } from "@mercata/shared-types";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getOraclePrices, getRebaseFactors } from "./oracle.service";
import { toUTCTime } from "../helpers/cirrusHelpers";
import { parseMintConfig } from "./psm.service";
import * as config from "../../config/config";

const { MercataBridge, StratoNativeBridge, Token, LendingPool, LendingRegistry, DirectMintPSM, SaveUSDSTVault, mercataBridge, DECIMALS } = constants;

const stripPagingParams = (
  params: Record<string, string | undefined>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([key, value]) => value !== undefined && !["limit", "offset", "order", "select"].includes(key)
    )
  ) as Record<string, string>;

const applyPagination = (
  rows: any[],
  rawParams: Record<string, string | undefined>
) => {
  const order = rawParams.order || "block_timestamp.desc";
  const desc = order.endsWith(".desc");
  const sorted = [...rows].sort((a, b) => {
    const aTime = new Date(a.block_timestamp || 0).getTime();
    const bTime = new Date(b.block_timestamp || 0).getTime();
    return desc ? bTime - aTime : aTime - bTime;
  });
  const offset = Math.max(Number(rawParams.offset || 0), 0);
  const limit = rawParams.limit == null ? sorted.length : Math.max(Number(rawParams.limit), 0);
  return sorted.slice(offset, offset + limit);
};

const nativeTransactionParams = (
  rawParams: Record<string, string | undefined>,
  userAddress: string | undefined,
  type: "withdrawal" | "deposit"
): Record<string, string> => {
  const params = stripPagingParams(rawParams);
  const chainFilter = type === "deposit" ? params.key : undefined;
  delete params.key;

  return {
    ...params,
    ...(chainFilter ? { "value->>externalChainId": chainFilter } : {}),
    address: `eq.${constants.stratoNativeBridge}`,
    ...(userAddress && {
      [`value->>${type === "deposit" ? "stratoRecipient" : "stratoSender"}`]: `eq.${userAddress}`,
    }),
  };
};

const normalizeNativeTransactions = (
  rows: any[],
  type: "withdrawal" | "deposit"
) => rows.map((row) => {
  const value = row?.value || {};
  if (type === "withdrawal") {
    return {
      withdrawalId: row.key,
      WithdrawalInfo: {
        ...value,
        externalToken: value.representationToken,
      },
      block_timestamp: row.block_timestamp,
      routeType: "native",
    };
  }

  return {
    depositId: row.key,
    externalChainId: value.externalChainId,
    externalTxHash: value.externalTxHash,
    DepositInfo: {
      ...value,
      externalToken: value.representationToken,
    },
    block_timestamp: row.block_timestamp,
    routeType: "native",
  };
});

export const requestWithdrawal = async (
  accessToken: string,
  {
    routeType,
    externalChainId,
    externalRecipient,
    externalToken,
    stratoToken,
    stratoTokenAmount,
  }: WithdrawalRequestParams,
  userAddress: string
): Promise<TransactionResponse> => {
  if (routeType === "native") {
    throw new Error("Use the native bridge withdrawal route for native requests");
  }

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

export const requestNativeWithdrawal = async (
  accessToken: string,
  {
    externalChainId,
    externalRecipient,
    stratoToken,
    stratoTokenAmount,
  }: WithdrawalRequestParams,
  userAddress: string
): Promise<TransactionResponse> => {
  if (!constants.stratoNativeBridge) {
    throw new Error("STRATO_NATIVE_BRIDGE is not configured");
  }
  if (!constants.stratoNativeCustodyVault) {
    throw new Error("STRATO_NATIVE_CUSTODY_VAULT is not configured");
  }

  const tx = await buildFunctionTx(
    [
      {
        contractName: extractContractName(Token),
        contractAddress: stratoToken,
        method: "approve",
        args: {
          spender: constants.stratoNativeCustodyVault,
          value: stratoTokenAmount,
        },
      },
      {
        contractName: extractContractName(StratoNativeBridge),
        contractAddress: constants.stratoNativeBridge,
        method: "requestWithdrawal",
        args: {
          externalChainId,
          externalRecipient,
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
    signature,
    deadline,
  }: DepositActionRequestParams,
  userAddress: string
) : Promise<TransactionResponse> => {
  const response = await bridge.post<TransactionResponse>(accessToken, `/request-deposit-action`, {
    externalChainId,
    externalTxHash,
    action,
    targetToken,
    ...(signature && deadline ? { userAddress, signature, deadline } : {}),
  });
  return response.data;
};

export const getBridgeTransactions = async (
  accessToken: string,
  type: 'withdrawal' | 'deposit',
  userAddress: string | undefined,
  rawParams: Record<string, string | undefined> = {}
): Promise<BridgeTransactionResponse> => {
  const config = QUERY_CONFIGS[type];
  const isDeposit = type === "deposit";
  const offset = Math.max(Number(rawParams.offset || 0), 0);
  const limit = rawParams.limit == null ? undefined : Math.max(Number(rawParams.limit), 0);
  const sourceLimit = isDeposit && limit != null ? String(offset + limit) : undefined;
  const sourcePageParams = isDeposit
    ? {
        order: rawParams.order || "block_timestamp.desc",
        ...(sourceLimit ? { limit: sourceLimit } : {}),
      }
    : {};
  const queryParams = buildQueryParams(stripPagingParams(rawParams), userAddress, [], type);

  const dataParams = {
    select: config.selectFields,
    ...queryParams,
    ...sourcePageParams
  };
  const nativeParams = nativeTransactionParams(rawParams, userAddress, type);

  const [standardResponse, nativeResponse, nativeCountResponse] = await Promise.all([
    executeParallelQueries(
      accessToken,
      config,
      dataParams,
      { ...queryParams, select: config.countField }
    ),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${StratoNativeBridge}-${type === "withdrawal" ? "withdrawals" : "deposits"}`, {
          params: {
            select: "key,value,block_timestamp",
            ...nativeParams,
            ...sourcePageParams,
          }
        })
      : Promise.resolve({ data: [] }),
    isDeposit && constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${StratoNativeBridge}-deposits`, {
          params: {
            select: "count()",
            ...nativeParams,
          }
        })
      : Promise.resolve({ data: [] }),
  ]);

  const nativeRows = Array.isArray(nativeResponse.data)
    ? normalizeNativeTransactions(nativeResponse.data, type)
    : [];
  const mergedResults = [...standardResponse.results, ...nativeRows];
  const allResults = isDeposit ? applyPagination(mergedResults, rawParams) : mergedResults;
  const nativeCount = Number(nativeCountResponse.data?.[0]?.count || 0);
  const totalCount = isDeposit
    ? Number(standardResponse.totalCount || 0) + nativeCount
    : allResults.length;

  if (!allResults.length) {
    return { data: [], totalCount };
  }

  const enrichedData = await enrichTransactionData(accessToken, allResults, type);
  return { data: isDeposit ? enrichedData : applyPagination(enrichedData, rawParams), totalCount };
};

export const getBridgeableTokens = async (accessToken: string, chainId?: string): Promise<BridgeToken[]> => {
  const standardParams: Record<string, string> = {
    select: "collection_name,externalToken:key->>key,externalChainId:key->>key2,targetStratoToken:key->>key3,mappingValue:value",
    collection_name: "in.(assets,assetRouteEnabled)",
    address: `eq.${mercataBridge}`
  };
  if (chainId) standardParams["key->>key2"] = `eq.${chainId}`;

  const nativeParams: Record<string, string> = {
    address: `eq.${constants.stratoNativeBridge}`,
    select: "key,key2,value",
  };
  if (chainId) nativeParams["key2"] = `eq.${chainId}`;

  const [standardResponse, nativeResponse, nativeBridgeResponse] = await Promise.all([
    cirrus.get(accessToken, "/mapping", { params: standardParams }),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${StratoNativeBridge}-assets`, { params: nativeParams })
      : Promise.resolve({ data: [] }),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${StratoNativeBridge}`, {
          params: {
            address: `eq.${constants.stratoNativeBridge}`,
            select: "depositsPaused,withdrawalsPaused",
            limit: "1",
          }
        })
      : Promise.resolve({ data: [] }),
  ]);

  const standardRoutes = Array.isArray(standardResponse.data)
    ? parseBridgeRouteMappings(standardResponse.data as BridgeMappingRow[])
    : [];
  const nativeBridgeState = Array.isArray(nativeBridgeResponse.data)
    ? nativeBridgeResponse.data[0]
    : undefined;
  const nativeRoutes = Array.isArray(nativeResponse.data)
    ? parseNativeBridgeAssets(nativeResponse.data as NativeBridgeAssetRow[], {
        depositsPaused: nativeBridgeState?.depositsPaused === true,
        withdrawalsPaused: nativeBridgeState?.withdrawalsPaused === true,
      })
    : [];
  const routes = [...standardRoutes, ...nativeRoutes];
  if (!routes.length) return [];

  const tokenAddressSet = new Set<string>();
  for (const { AssetInfo } of routes) {
    const token = AssetInfo?.stratoToken;
    if (!token) continue;
    const lower = token.toLowerCase();
    tokenAddressSet.add(lower.startsWith("0x") ? lower.slice(2) : lower);
  }
  const [tokenMap, rebaseFactorMap] = await Promise.all([
    getTokenMetadata(accessToken, [...tokenAddressSet]),
    getRebaseFactors(accessToken),
  ]);

  const tokens = enrichAssetsWithTokenData(routes, tokenMap);
  for (const token of tokens) {
    const factor = rebaseFactorMap.get(token.stratoToken.toLowerCase().replace(/^0x/, ''));
    if (factor) token.rebaseFactor = factor;
  }
  return tokens;
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

  const nativeWithdrawalsTable = `/${StratoNativeBridge}-withdrawals`;
  const [balances, prices, pending, completed, nativePending, nativeCompleted] = await Promise.all([
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
    }),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, nativeWithdrawalsTable, {
          params: {
            select: "value->>stratoToken,value->>stratoTokenAmount",
            address: `eq.${constants.stratoNativeBridge}`,
            "value->>stratoSender": `eq.${userAddress}`,
            "value->>bridgeStatus": "in.(1,2)"
          }
        })
      : Promise.resolve({ data: [] }),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, nativeWithdrawalsTable, {
          params: {
            select: "value->>stratoToken,value->>stratoTokenAmount",
            address: `eq.${constants.stratoNativeBridge}`,
            "value->>stratoSender": `eq.${userAddress}`,
            "value->>bridgeStatus": "eq.3",
            block_timestamp: `gte.${thirtyDaysAgoUTC}`
          }
        })
      : Promise.resolve({ data: [] })
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
  for (const p of [...(pending.data || []), ...(nativePending.data || [])]) {
    if (!p.stratoToken || !p.stratoTokenAmount) continue;
    const amount = BigInt(p.stratoTokenAmount || "0");
    const price = BigInt(prices.get(p.stratoToken) || "0");
    if (amount > 0n && price > 0n) {
      pendingUSD += (amount * price) / DECIMALS;
    }
  }

  let withdrawnUSD = 0n;
  for (const w of [...(completed.data || []), ...(nativeCompleted.data || [])]) {
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
  const asBool = (v: unknown) => v === true || ["true", "t"].includes(String(v).toLowerCase());
  const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/^0x/, "");

  const [
    { data: mappings = [] },
    { data: [pool] = [] },
    prices,
    { data: [rateEvt] = [] },
    { data: [psm] = [] },
    { data: psmMintConfigs = [] },
    { data: [saveVault] = [] },
    { data: [bridgeState] = [] },
  ] = await Promise.all([
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
    constants.directMintPsm
      ? cirrus.get(accessToken, `/${DirectMintPSM}`, {
          params: { address: `eq.${constants.directMintPsm}`, select: "mintableToken,mintPaused" }
        }).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    constants.directMintPsm
      ? cirrus.get(accessToken, `/${DirectMintPSM}-mintConfigs`, {
          params: { address: `eq.${constants.directMintPsm}`, select: "key,value::text" }
        }).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    config.saveUsdstVault
      ? cirrus.get(accessToken, `/${SaveUSDSTVault}`, {
          params: { address: `eq.${config.saveUsdstVault}`, select: "address,assetToken,_paused,_symbol" }
        }).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    cirrus.get(accessToken, `/${MercataBridge}`, {
      params: { address: `eq.${mercataBridge}`, select: "directMintPSM,saveUSDSTVault,psmSaveEnabled" }
    }).catch(() => ({ data: [] })),
  ]);

  const metals = mappings.filter((r: any) => r.collection_name === "metalConfigs").map((r: any) => ({ addr: key(r), ...val(r) })).filter((m: any) => m.isEnabled === true);
  const payTokens = mappings.filter((r: any) => r.collection_name === "isSupportedPayToken").filter((r: any) => r.value === true || r.value === "true").map((r: any) => ({ addr: key(r) }));
  const { borrowableAsset, mToken } = pool?.lendingPool || {};
  if (mToken) prices.set(mToken, rateEvt?.newRate || (10n ** 18n).toString());
  const psmSaveEnabled =
    Boolean(constants.directMintPsm && config.saveUsdstVault && psm && saveVault) &&
    asBool(bridgeState?.psmSaveEnabled) &&
    norm(bridgeState?.directMintPSM) === norm(constants.directMintPsm) &&
    norm(bridgeState?.saveUSDSTVault) === norm(config.saveUsdstVault) &&
    !asBool(psm?.mintPaused) &&
    !asBool(saveVault?._paused) &&
    norm(psm?.mintableToken) === norm(saveVault?.assetToken);
  const psmSaveActions: DepositAction[] = psmSaveEnabled
    ? psmMintConfigs.flatMap((row: any) => {
        const mintConfig = parseMintConfig(row.value);
        if (!mintConfig.isEnabled) return [];
        const payToken = key(row);
        return [{
          id: `save-usdst-${payToken}`,
          action: 3,
          stratoToken: saveVault.address || config.saveUsdstVault,
          stratoTokenName: "Save USDST",
          stratoTokenSymbol: saveVault._symbol || "saveUSDST",
          payToken,
          feeBps: mintConfig.feeBps,
        }];
      })
    : [];

  const allAddrs = [...metals.map((m: any) => m.addr), ...(mToken ? [mToken] : [])];
  const tokenMap = allAddrs.length ? await getTokenMetadata(accessToken, allAddrs) : new Map();

  const toAction = (id: string, action: number, addr: string, pay: string, feeBps?: string): DepositAction => {
    const m = tokenMap.get(addr);
    return {
      id,
      action,
      stratoToken: addr,
      stratoTokenName: m?.name ?? "",
      stratoTokenSymbol: m?.symbol ?? "",
      stratoTokenImage: m?.image,
      payToken: pay,
      oraclePrice: prices.get(addr),
      ...(feeBps != null && feeBps !== "" ? { feeBps: String(feeBps) } : {}),
    };
  };

  return [
    ...(borrowableAsset && mToken ? [toAction(`earn-${borrowableAsset}`, 1, mToken, borrowableAsset)] : []),
    ...psmSaveActions,
    ...payTokens.flatMap((p: any) =>
      metals.map((m: any) => toAction(`forge-${p.addr}-${m.addr}`, 2, m.addr, p.addr, m.feeBps)),
    ),
  ];
};
