import axios from "axios";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { getRpcUpstream } from "../../config/rpc.config";
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
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, WithdrawalRequestParams, WithdrawalSummaryResponse, TransactionResponse, DepositAction } from "@mercata/shared-types";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getRebaseFactors } from "./oracle.service";
import { getPsmMintState, PsmMintState } from "./psm.service";
import { getSaveUsdstActionState, SaveUsdstActionState } from "./saveUsdst.service";
import { getConfigs as getMetalForgeConfigs, Config as MetalForgeConfig } from "./metalForge.service";
import { toUTCTime } from "../helpers/cirrusHelpers";

const { MercataBridge, StratoNativeBridge, Token, mercataBridge, DECIMALS, USDST } = constants;

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

const DEPOSIT_ROUTER_VERSION_SELECTOR = "0x54fd4d50";
const MIN_ACTION_ROUTER_MAJOR = 3;
const normalizeCatalogAddress = (value: string | undefined): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

const decodeAbiString = (value: unknown): string => {
  if (typeof value !== "string" || !value.startsWith("0x")) return "";
  const data = value.slice(2);
  if (data.length < 128) return "";

  try {
    const offset = Number(BigInt(`0x${data.slice(0, 64)}`)) * 2;
    const length = Number(BigInt(`0x${data.slice(offset, offset + 64)}`)) * 2;
    return Buffer.from(data.slice(offset + 64, offset + 64 + length), "hex").toString("utf8");
  } catch {
    return "";
  }
};

const getDepositRouterMajor = async (
  chainId: string,
  depositRouter: string
): Promise<number | null> => {
  const { upstream, fallback } = getRpcUpstream(chainId);
  for (const rpcUrl of [...new Set([upstream, fallback].filter(Boolean))] as string[]) {
    try {
      const { data } = await axios.post(
        rpcUrl,
        {
          jsonrpc: "2.0",
          method: "eth_call",
          params: [{
            to: ensureHexPrefix(depositRouter),
            data: DEPOSIT_ROUTER_VERSION_SELECTOR,
          }, "latest"],
          id: 1,
        },
        { timeout: 10_000 }
      );
      const major = Number(decodeAbiString(data?.result).split(".")[0]);
      if (Number.isInteger(major)) return major;
    } catch {
      continue;
    }
  }
  return null;
};

export const buildDepositActionCatalog = ({
  routes,
  actionChainIds,
  psmState,
  saveState,
  forgeConfigs,
  bridgeActionConfig,
}: {
  routes: BridgeToken[];
  actionChainIds: Set<string>;
  psmState: PsmMintState | null;
  saveState: SaveUsdstActionState | null;
  forgeConfigs: MetalForgeConfig;
  bridgeActionConfig: { directMintPsm?: string; saveUsdstVault?: string };
}): DepositAction[] => {
  if (!actionChainIds.size) return [];

  const usdst = normalizeCatalogAddress(USDST);
  const psmReady = Boolean(
    psmState &&
    !psmState.mintPaused &&
    psmState.mintableToken === usdst &&
    normalizeCatalogAddress(bridgeActionConfig.directMintPsm) === normalizeCatalogAddress(constants.directMintPsm)
  );
  const sources = new Map<string, {
    address: string;
    chainIds: Set<string>;
    psmFeeBps: string;
  }>();

  for (const route of routes) {
    const chainId = String(route.externalChainId);
    if (route.routeType !== "standard" || !route.enabled || !actionChainIds.has(chainId)) continue;

    const address = normalizeCatalogAddress(route.stratoToken);
    const mintConfig = psmState?.mintConfigs.get(address);
    if (address !== usdst && (!psmReady || !mintConfig?.isEnabled)) continue;

    const source = sources.get(address) || {
      address: route.stratoToken,
      chainIds: new Set<string>(),
      psmFeeBps: address === usdst ? "0" : mintConfig!.feeBps,
    };
    source.chainIds.add(chainId);
    sources.set(address, source);
  }

  const actions: DepositAction[] = [];
  const saveEnabled = Boolean(
    saveState &&
    !saveState.paused &&
    normalizeCatalogAddress(saveState.assetAddress) === usdst &&
    normalizeCatalogAddress(bridgeActionConfig.saveUsdstVault) === normalizeCatalogAddress(saveState.vaultAddress)
  );
  const forgeEnabled = forgeConfigs.payTokens.some(
    ({ address }) => normalizeCatalogAddress(address) === usdst
  );
  const enabledMetals = forgeEnabled
    ? forgeConfigs.metals.filter(
        (metal) =>
          metal.isEnabled &&
          BigInt(metal.price || "0") > 0n &&
          BigInt(metal.totalMinted || "0") < BigInt(metal.mintCap || "0")
      )
    : [];

  for (const source of sources.values()) {
    const common = {
      payToken: source.address,
      externalChainIds: [...source.chainIds],
      minimumRouterMajorVersion: MIN_ACTION_ROUTER_MAJOR,
      psmFeeBps: source.psmFeeBps,
    };

    if (saveEnabled && saveState) {
      actions.push({
        id: `save-${source.address}`,
        action: 3,
        stratoToken: saveState.vaultAddress,
        stratoTokenName: "Save USDST",
        stratoTokenSymbol: saveState.shareSymbol,
        oraclePrice: saveState.projectedExchangeRate,
        ...common,
      });
    }

    for (const metal of enabledMetals) {
      actions.push({
        id: `forge-${source.address}-${metal.address}`,
        action: 2,
        stratoToken: metal.address,
        stratoTokenName: metal.name,
        stratoTokenSymbol: metal.symbol,
        stratoTokenImage: metal.imageUrl,
        oraclePrice: metal.price,
        feeBps: metal.feeBps,
        ...common,
      });
    }
  }

  return actions;
};

export const getDepositActions = async (accessToken: string): Promise<DepositAction[]> => {
  const [routes, networks, psmState, saveState, forgeConfigs, bridgeActionConfig] = await Promise.all([
    getBridgeableTokens(accessToken),
    getNetworkConfigs(accessToken),
    constants.directMintPsm ? getPsmMintState(accessToken) : Promise.resolve(null),
    constants.saveUsdstVault ? getSaveUsdstActionState(accessToken) : Promise.resolve(null),
    constants.metalForge ? getMetalForgeConfigs(accessToken) : Promise.resolve({ metals: [], payTokens: [] }),
    cirrus.get(accessToken, `/${MercataBridge}`, {
      params: {
        address: `eq.${mercataBridge}`,
        select: "directMintPsm,saveUsdstVault",
        limit: "1",
      },
    }).then(({ data }) => data?.[0] || {}),
  ]);

  const routerMajors = await Promise.all(
    networks.map(async ({ externalChainId, chainInfo }) => ({
      chainId: String(externalChainId),
      major: chainInfo.depositRouter
        ? await getDepositRouterMajor(String(externalChainId), chainInfo.depositRouter)
        : null,
    }))
  );
  const actionChainIds = new Set(
    routerMajors
      .filter(({ major }) => major != null && major >= MIN_ACTION_ROUTER_MAJOR)
      .map(({ chainId }) => chainId)
  );
  return buildDepositActionCatalog({
    routes,
    actionChainIds,
    psmState,
    saveState,
    forgeConfigs,
    bridgeActionConfig,
  });
};
