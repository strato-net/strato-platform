import axios from "axios";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/appApiHelper";
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
  parseNativeLockedBalances,
  parseNativeTokenBridgeConfigs,
  QUERY_CONFIGS 
} from "../helpers/bridge.helper";
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, WithdrawalRequestParams, WithdrawalSummaryResponse, TransactionResponse, DepositAction } from "@strato/shared-types";
import { getCompletePriceMap } from "../helpers/oracle.helper";
import { getRebaseFactors } from "./oracle.service";
import { getPsmMintState, PsmMintState } from "./psm.service";
import { getSaveUsdstActionState, SaveUsdstActionState } from "./saveUsdst.service";
import { getConfigs as getMetalForgeConfigs, Config as MetalForgeConfig } from "./metalForge.service";
import { toUTCTime } from "../helpers/cirrusHelpers";

const {
  ExternalAssetBridge,
  StratoNativeBridge,
  StratoNativeCustodyVault,
  Token,
  externalAssetBridge,
  DECIMALS,
  USDST,
} = constants;

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

const toLegacyStatusFilter = (statusFilter?: string): string | undefined =>
  statusFilter === "eq.4"
    ? "eq.3"
    : statusFilter === "eq.7"
      ? "eq.4"
      : statusFilter === "eq.3" ||
          statusFilter === "eq.5" ||
          statusFilter === "eq.6"
        ? "eq.-1"
        : statusFilter;

const nativeTransactionParams = (
  rawParams: Record<string, string | undefined>,
  userAddress: string | undefined,
  type: "withdrawal" | "deposit"
): Record<string, string> => {
  const params = stripPagingParams(rawParams);
  const chainFilter = type === "deposit" ? params.key : undefined;
  const statusFilter = params["value->>bridgeStatus"];
  delete params.key;
  delete params["value->>bridgeStatus"];
  const nativeStatusFilter = toLegacyStatusFilter(statusFilter);

  return {
    ...params,
    ...(chainFilter ? { "value->>externalChainId": chainFilter } : {}),
    ...(nativeStatusFilter
      ? { "value->>bridgeStatus": nativeStatusFilter }
      : {}),
    address: `eq.${constants.stratoNativeBridge}`,
    ...(userAddress && {
      [`value->>${type === "deposit" ? "stratoRecipient" : "stratoSender"}`]: `eq.${userAddress}`,
    }),
  };
};

const legacyTransactionParams = (
  rawParams: Record<string, string | undefined>,
  userAddress: string | undefined,
  type: "withdrawal" | "deposit"
): Record<string, string> => {
  const params = stripPagingParams(rawParams);
  const statusFilter = params["value->>bridgeStatus"];
  delete params["value->>bridgeStatus"];
  return {
    ...params,
    ...(toLegacyStatusFilter(statusFilter)
      ? { "value->>bridgeStatus": toLegacyStatusFilter(statusFilter)! }
      : {}),
    address: `eq.${constants.mercataBridge}`,
    ...(userAddress && {
      [`value->>${type === "deposit" ? "stratoRecipient" : "stratoSender"}`]:
        `eq.${userAddress}`,
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
        bridgeStatus:
          String(value.bridgeStatus) === "3"
            ? "4"
            : String(value.bridgeStatus) === "4"
              ? "7"
              : String(value.bridgeStatus ?? "0"),
        externalToken: value.representationToken,
      },
      block_timestamp: row.block_timestamp,
      routeType: "native",
      bridgeSource: "native",
    };
  }

  return {
    depositId: row.key,
    externalChainId: value.externalChainId,
    externalTxHash: value.externalTxHash,
    DepositInfo: {
      ...value,
      bridgeStatus:
        String(value.bridgeStatus) === "3"
          ? "4"
          : String(value.bridgeStatus) === "4"
            ? "7"
            : String(value.bridgeStatus ?? "0"),
      externalToken: value.representationToken,
    },
    block_timestamp: row.block_timestamp,
    routeType: "native",
    bridgeSource: "native",
  };
});

const normalizeLegacyTransactions = (rows: any[]) =>
  rows.map((row) => {
    const infoKey = row.WithdrawalInfo ? "WithdrawalInfo" : "DepositInfo";
    const info = row[infoKey] || {};
    return {
      ...row,
      [infoKey]: {
        ...info,
        bridgeStatus:
          String(info.bridgeStatus) === "3"
            ? "4"
            : String(info.bridgeStatus) === "4"
              ? "7"
              : String(info.bridgeStatus ?? "0"),
      },
      routeType: "standard",
      bridgeSource: "legacy",
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
        args: { spender: constants.externalAssetBridge, value: stratoTokenAmount },
      },
      {
        contractName: extractContractName(ExternalAssetBridge),
        contractAddress: constants.externalAssetBridge,
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

export const validateNativeWithdrawalRoute = (
  nativeRoute: BridgeToken | undefined,
  stratoTokenAmount: string
): void => {
  if (!nativeRoute || !nativeRoute.enabled) {
    throw new Error("Native bridge route is unavailable");
  }
  if (nativeRoute.withdrawalsPaused) {
    throw new Error("Native bridge withdrawals are paused");
  }
  if (nativeRoute.withdrawalsDisabled) {
    throw new Error("Native token withdrawals are disabled");
  }

  const requestedAmount = BigInt(stratoTokenAmount);
  const maxPerWithdrawal = BigInt(nativeRoute.maxPerWithdrawal || "0");
  if (maxPerWithdrawal > 0n && requestedAmount > maxPerWithdrawal) {
    throw new Error("Native withdrawal exceeds the per-withdrawal cap");
  }

  const maxOutstandingWithdrawal = BigInt(nativeRoute.maxOutstandingWithdrawal || "0");
  const remainingOutstandingWithdrawal = BigInt(
    nativeRoute.remainingOutstandingWithdrawal || "0"
  );
  if (
    maxOutstandingWithdrawal > 0n
    && requestedAmount > remainingOutstandingWithdrawal
  ) {
    throw new Error("Native withdrawal exceeds the remaining aggregate capacity");
  }
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

  const nativeRoute = (await getBridgeableTokens(accessToken, externalChainId)).find(
    (token) =>
      token.routeType === "native"
      && token.stratoToken.toLowerCase().replace(/^0x/, "")
        === stratoToken.toLowerCase().replace(/^0x/, "")
  );
  validateNativeWithdrawalRoute(nativeRoute, stratoTokenAmount);

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
  const legacyParams = legacyTransactionParams(rawParams, userAddress, type);
  const legacyConfig = {
    ...config,
    tableName: `${constants.MercataBridge}-${
      type === "withdrawal" ? "withdrawals" : "deposits"
    }`,
  };

  const [standardResponse, legacyResponse, nativeResponse, nativeCountResponse] = await Promise.all([
    executeParallelQueries(
      accessToken,
      config,
      dataParams,
      { ...queryParams, select: config.countField }
    ),
    constants.mercataBridge
      ? executeParallelQueries(
          accessToken,
          legacyConfig,
          {
            select: legacyConfig.selectFields,
            ...legacyParams,
            ...sourcePageParams,
          },
          { ...legacyParams, select: legacyConfig.countField }
        )
      : Promise.resolve({ results: [], totalCount: 0 }),
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
  const standardRows = standardResponse.results.map((row: any) => ({
    ...row,
    routeType: "standard",
    bridgeSource: "external",
  }));
  const legacyRows = normalizeLegacyTransactions(legacyResponse.results);
  const mergedResults = [...standardRows, ...legacyRows, ...nativeRows];
  const allResults = isDeposit ? applyPagination(mergedResults, rawParams) : mergedResults;
  const nativeCount = Number(nativeCountResponse.data?.[0]?.count || 0);
  const totalCount = isDeposit
    ? Number(standardResponse.totalCount || 0) +
      Number(legacyResponse.totalCount || 0) +
      nativeCount
    : allResults.length;

  if (!allResults.length) {
    return { data: [], totalCount };
  }

  const enrichedData = await enrichTransactionData(accessToken, allResults, type);
  return { data: isDeposit ? enrichedData : applyPagination(enrichedData, rawParams), totalCount };
};

export const getBridgeableTokens = async (accessToken: string, chainId?: string): Promise<BridgeToken[]> => {
  const standardParams: Record<string, string> = {
    select: "externalToken:key,externalChainId:key2,targetStratoToken:key3,mappingValue:value",
    address: `eq.${externalAssetBridge}`
  };
  if (chainId) standardParams.key2 = `eq.${chainId}`;

  const nativeParams: Record<string, string> = {
    address: `eq.${constants.stratoNativeBridge}`,
    select: "key,key2,value",
  };
  if (chainId) nativeParams["key2"] = `eq.${chainId}`;

  const [
    standardResponse,
    nativeResponse,
    nativeBridgeResponse,
    nativeTokenConfigResponse,
    nativeLockedBalanceResponse,
  ] = await Promise.all([
    cirrus.get(accessToken, `/${ExternalAssetBridge}-routes`, { params: standardParams }),
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
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${StratoNativeBridge}-tokenBridgeConfigs`, {
          params: {
            address: `eq.${constants.stratoNativeBridge}`,
            select: "key,value",
          }
        })
      : Promise.resolve({ data: [] }),
    constants.stratoNativeCustodyVault
      ? cirrus.get(accessToken, `/${StratoNativeCustodyVault}-lockedBalance`, {
          params: {
            address: `eq.${constants.stratoNativeCustodyVault}`,
            select: "key,lockedBalance:value::text",
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
  const nativeTokenConfigs = Array.isArray(nativeTokenConfigResponse.data)
    ? parseNativeTokenBridgeConfigs(nativeTokenConfigResponse.data as NativeBridgeAssetRow[])
    : new Map();
  const nativeLockedBalances = Array.isArray(nativeLockedBalanceResponse.data)
    ? parseNativeLockedBalances(nativeLockedBalanceResponse.data as NativeBridgeAssetRow[])
    : new Map();
  const nativeRoutes = Array.isArray(nativeResponse.data)
    ? parseNativeBridgeAssets(nativeResponse.data as NativeBridgeAssetRow[], {
        depositsPaused: nativeBridgeState?.depositsPaused === true,
        withdrawalsPaused: nativeBridgeState?.withdrawalsPaused === true,
      }, nativeTokenConfigs, nativeLockedBalances)
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

  const activeRoutes = routes.filter(({ AssetInfo }) =>
    tokenMap.get(AssetInfo.stratoToken.toLowerCase().replace(/^0x/, ""))?.status === "2"
  );
  const tokens = enrichAssetsWithTokenData(activeRoutes, tokenMap);
  for (const token of tokens) {
    const factor = rebaseFactorMap.get(token.stratoToken.toLowerCase().replace(/^0x/, ''));
    if (factor) token.rebaseFactor = factor;
  }
  return tokens;
};

export const getNetworkConfigs = async (accessToken: string): Promise<NetworkConfig[]> => { 
  const { data } = await cirrus.get(accessToken, `/${ExternalAssetBridge}-chains`, {
    params: {
      select: "externalChainId:key,ChainInfo:value",
      "value->>enabled": "eq.true",
      address: `eq.${externalAssetBridge}`
    }
  });
  return data.map((c: any) => {
    if (c.ChainInfo.depositRouter) c.ChainInfo.depositRouter = ensureHexPrefix(c.ChainInfo.depositRouter);
    if (c.ChainInfo.vault) c.ChainInfo.vault = ensureHexPrefix(c.ChainInfo.vault);
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
  const [
    balances,
    prices,
    pending,
    completed,
    legacyPending,
    legacyCompleted,
    nativePending,
    nativeCompleted,
  ] = await Promise.all([
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
    cirrus.get(accessToken, `/${ExternalAssetBridge}-withdrawals`, {
      params: {
        select: "value->>stratoToken,value->>stratoTokenAmount",
        address: `eq.${externalAssetBridge}`,
        "value->>stratoSender": `eq.${userAddress}`,
        "value->>status": "in.(1,2,3)"
      }
    }),
    cirrus.get(accessToken, `/${constants.MercataBridge}-withdrawals`, {
      params: {
        select: "value->>stratoToken,value->>stratoTokenAmount",
        address: `eq.${constants.mercataBridge}`,
        "value->>stratoSender": `eq.${userAddress}`,
        "value->>bridgeStatus": "in.(1,2)"
      }
    }),
    cirrus.get(accessToken, `/${constants.MercataBridge}-withdrawals`, {
      params: {
        select: "value->>stratoToken,value->>stratoTokenAmount",
        address: `eq.${constants.mercataBridge}`,
        "value->>stratoSender": `eq.${userAddress}`,
        "value->>bridgeStatus": "eq.3",
        block_timestamp: `gte.${thirtyDaysAgoUTC}`
      }
    }),
    cirrus.get(accessToken, `/${ExternalAssetBridge}-withdrawals`, {
      params: {
        select: "value->>stratoToken,value->>stratoTokenAmount",
        address: `eq.${externalAssetBridge}`,
        "value->>stratoSender": `eq.${userAddress}`,
        "value->>status": "eq.4",
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
  for (const p of [
    ...(pending.data || []),
    ...(legacyPending.data || []),
    ...(nativePending.data || []),
  ]) {
    if (!p.stratoToken || !p.stratoTokenAmount) continue;
    const amount = BigInt(p.stratoTokenAmount || "0");
    const price = BigInt(prices.get(p.stratoToken) || "0");
    if (amount > 0n && price > 0n) {
      pendingUSD += (amount * price) / DECIMALS;
    }
  }

  let withdrawnUSD = 0n;
  for (const w of [
    ...(completed.data || []),
    ...(legacyCompleted.data || []),
    ...(nativeCompleted.data || []),
  ]) {
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
const depositActionRouteKey = (
  externalToken: string | undefined,
  externalChainId: string,
  targetStratoToken: string | undefined
): string => [
  normalizeCatalogAddress(externalToken),
  externalChainId,
  normalizeCatalogAddress(targetStratoToken),
].join(":");
const parseDepositActionFlags = (
  value: unknown
): { autoForge: boolean; autoSave: boolean } => {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }
  const flags = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  return {
    autoForge: flags.autoForge === true || String(flags.autoForge).toLowerCase() === "true",
    autoSave: flags.autoSave === true || String(flags.autoSave).toLowerCase() === "true",
  };
};

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

export const getDepositRouterMajor = async (
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
      if (data?.error) continue;
      const version = decodeAbiString(data?.result);
      if (!version) continue;
      const major = Number(version.split(".")[0]);
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
  bridgeActionRoutes,
}: {
  routes: BridgeToken[];
  actionChainIds: Set<string>;
  psmState: PsmMintState | null;
  saveState: SaveUsdstActionState | null;
  forgeConfigs: MetalForgeConfig;
  bridgeActionConfig: { directMintPsm?: string; saveUsdstVault?: string };
  bridgeActionRoutes: Map<string, { autoForge: boolean; autoSave: boolean }>;
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
    forgeChainIds: Set<string>;
    saveChainIds: Set<string>;
    psmFeeBps: string;
  }>();

  for (const route of routes) {
    const chainId = String(route.externalChainId);
    if (
      route.routeType !== "standard" ||
      !route.enabled ||
      route.depositsEnabled === false ||
      !actionChainIds.has(chainId)
    ) continue;

    const address = normalizeCatalogAddress(route.stratoToken);
    const mintConfig = psmState?.mintConfigs.get(address);
    if (address !== usdst && (!psmReady || !mintConfig?.isEnabled)) continue;
    const actionConfig = bridgeActionRoutes.get(
      depositActionRouteKey(route.externalToken, chainId, route.stratoToken)
    );
    if (!actionConfig?.autoForge && !actionConfig?.autoSave) continue;

    const source = sources.get(address) || {
      address: route.stratoToken,
      forgeChainIds: new Set<string>(),
      saveChainIds: new Set<string>(),
      psmFeeBps: address === usdst ? "0" : mintConfig!.feeBps,
    };
    if (actionConfig.autoForge) source.forgeChainIds.add(chainId);
    if (actionConfig.autoSave) source.saveChainIds.add(chainId);
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
      minimumRouterMajorVersion: MIN_ACTION_ROUTER_MAJOR,
      psmFeeBps: source.psmFeeBps,
    };

    if (saveEnabled && saveState && source.saveChainIds.size) {
      actions.push({
        id: `save-${source.address}`,
        action: 3,
        stratoToken: saveState.vaultAddress,
        stratoTokenName: "Save USDST",
        stratoTokenSymbol: saveState.shareSymbol,
        oraclePrice: saveState.projectedExchangeRate,
        externalChainIds: [...source.saveChainIds],
        ...common,
      });
    }

    for (const metal of source.forgeChainIds.size ? enabledMetals : []) {
      actions.push({
        id: `forge-${source.address}-${metal.address}`,
        action: 2,
        stratoToken: metal.address,
        stratoTokenName: metal.name,
        stratoTokenSymbol: metal.symbol,
        stratoTokenImage: metal.imageUrl,
        oraclePrice: metal.price,
        feeBps: metal.feeBps,
        externalChainIds: [...source.forgeChainIds],
        ...common,
      });
    }
  }

  return actions;
};

export const getDepositActions = async (accessToken: string): Promise<DepositAction[]> => {
  const [
    routes,
    networks,
    psmState,
    saveState,
    forgeConfigs,
    bridgeActionConfig,
    bridgeActionRouteRows,
  ] = await Promise.all([
    getBridgeableTokens(accessToken),
    getNetworkConfigs(accessToken),
    constants.directMintPsm ? getPsmMintState(accessToken) : Promise.resolve(null),
    constants.saveUsdstVault ? getSaveUsdstActionState(accessToken) : Promise.resolve(null),
    constants.metalForge ? getMetalForgeConfigs(accessToken) : Promise.resolve({ metals: [], payTokens: [] }),
    cirrus.get(accessToken, "/storage", {
      params: {
        address: `eq.${externalAssetBridge}`,
        select: "data->>directMintPsm,data->>saveUsdstVault",
        limit: "1",
      },
    }).then(({ data }) => data?.[0] || {}),
    cirrus.get(accessToken, `/${ExternalAssetBridge}-depositActionConfigs`, {
      params: {
        address: `eq.${externalAssetBridge}`,
        select: "externalToken:key,externalChainId:key2,targetStratoToken:key3,value",
      },
    }).then(({ data }) => data || []),
  ]);

  const bridgeActionRoutes = new Map<string, { autoForge: boolean; autoSave: boolean }>(
    bridgeActionRouteRows.map((row: any) => [
      depositActionRouteKey(row.externalToken, String(row.externalChainId), row.targetStratoToken),
      parseDepositActionFlags(row.value),
    ])
  );
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
    bridgeActionRoutes,
  });
};
