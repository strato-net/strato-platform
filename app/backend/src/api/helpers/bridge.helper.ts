import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import { ensureHexPrefix } from "../../utils/utils";
import JSONBig from "json-bigint";
import { normalizeLegacyEscapes } from "./jsonStringParsing.helper";
import { BridgePolicyField, BridgePolicyRecords, BridgePolicyRow, BridgeReviewGovernanceAction, BridgeReviewItem, BridgeToken } from "@strato/shared-types";
import type { BridgeHistorySource } from "../../types/types";
import { keccak256 } from "../../utils/keccak256";

export const buildBridgeDigestCall = (signature: string, args: string[]): string => {
  const types = signature === "getReviewedDepositDigest(uint256,address,uint256)" ? ["uint", "address", "uint"]
    : signature === "getWithdrawalRefundDigest(uint256)" ? ["uint"] : [];
  if (!types.length || args.length !== types.length) throw new Error("Invalid bridge digest call");
  const words = args.map((arg, index) => {
    if (types[index] === "address") {
      if (!/^0x[0-9a-f]{40}$/i.test(arg)) throw new Error("Invalid deposit router address");
      return arg.slice(2).toLowerCase().padStart(64, "0");
    }
    if (!/^\d+$/.test(arg) || BigInt(arg) >= (1n << 256n)) throw new Error("Invalid bridge identifier");
    return BigInt(arg).toString(16).padStart(64, "0");
  });
  return `0x${keccak256(Buffer.from(signature)).toString("hex").slice(0, 8)}${words.join("")}`;
};

export const parseBridgeDigest = (response: any): string => {
  if (response?.error || !/^0x[0-9a-f]{64}$/i.test(response?.result || "")) throw new Error("Unable to read current bridge review digest from STRATO");
  return response.result.toLowerCase();
};

const bridgeIssueJson = JSONBig({ storeAsString: true });

export const parseBridgePolicyJson = (raw: string): unknown => bridgeIssueJson.parse(raw);

export const bridgeReviewFunction = (item: BridgeReviewItem, action: BridgeReviewGovernanceAction): string =>
  action === "cancel_withdrawal" ? "requestWithdrawalCancellation" : action === "confirm_cancellation" ? "refundCanceledWithdrawal" : action === "confirm_refund" ? "finalizeDepositRefund" : action === "refund" ? item.kind === "withdrawal_refund" ? "refundWithdrawal" : "requestDepositRefund"
    : action === "reject" ? "rejectDepositNoFunds" : item.kind === "deposit_recovery"
      ? item.source === "native" ? "reopenDeposit" : "authorizeDepositDelivery" : "approveReviewedDeposit";

export const parseBridgeReviewIssue = (func: string, rawArgs: unknown): { id: string; action: BridgeReviewGovernanceAction; digest?: string; vault?: string; refundEvidenceHash?: string } | undefined => {
  const uint = (value: unknown) => {
    if ((typeof value === "number" && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value))) throw new Error("Invalid bridge governance identifier");
    return BigInt(String(value)).toString();
  };
  if (func === "finalizeDepositRefund") {
    const args = typeof rawArgs === "string" ? bridgeIssueJson.parse(normalizeLegacyEscapes(rawArgs)) : rawArgs;
    if (!Array.isArray(args) || args.length !== 2 || args.some(arg => typeof arg !== "string" || !/^(0x)?[a-f0-9]{64}$/i.test(arg) || /^(0x)?0+$/i.test(arg))) throw new Error("Invalid native refund confirmation arguments");
    return { id: `native:deposit:${args[0]}:`, action: "confirm_refund", refundEvidenceHash: args[1].replace(/^0x/i, "").toLowerCase() };
  }
  if (func === "requestWithdrawalCancellation" || func === "refundCanceledWithdrawal") {
    const args = typeof rawArgs === "string" ? bridgeIssueJson.parse(normalizeLegacyEscapes(rawArgs)) : rawArgs;
    if (!Array.isArray(args) || args.length !== (func === "requestWithdrawalCancellation" ? 1 : 2) || !/^[1-9][0-9]*$/.test(String(args[0])) ||
        (args.length === 2 && !/^(0x)?[a-f0-9]{64}$/i.test(String(args[1])))) throw new Error("Invalid withdrawal cancellation arguments");
    return { id: `native:withdrawal:${args[0]}`, action: func === "requestWithdrawalCancellation" ? "cancel_withdrawal" : "confirm_cancellation",
      ...(args.length === 2 ? { refundEvidenceHash: String(args[1]).replace(/^0x/i, "").toLowerCase() } : {}) };
  }
  if (["reopenDeposit", "authorizeDepositDelivery", "requestDepositRefund", "rejectDepositNoFunds"].includes(func)) {
    const args = typeof rawArgs === "string" ? bridgeIssueJson.parse(normalizeLegacyEscapes(rawArgs)) : rawArgs;
    if (!Array.isArray(args)) throw new Error("Invalid recovery arguments");
    const action = func === "requestDepositRefund" ? "refund" as const : func === "rejectDepositNoFunds" ? "reject" as const : "approve" as const;
    if (func !== "authorizeDepositDelivery" && args.length === 1 && /^(0x)?[0-9a-f]{64}$/i.test(String(args[0]))) return { id: `native:deposit:${args[0]}:`, action };
    if (func === "reopenDeposit" || args.length !== (action === "refund" ? 4 : 3) || !/^\d+$/.test(String(args[0])) || !/^\d+$/.test(String(args[2])) ||
        !/^(0x)?[0-9a-f]{40}$/i.test(String(args[1])) || (action === "refund" && !/^(0x)?[0-9a-f]{40}$/i.test(String(args[3])))) throw new Error("Invalid recovery arguments");
    return { id: `eab:deposit:${uint(args[0])}:${String(args[1]).toLowerCase().replace(/^0x/, "")}:${uint(args[2])}`, action,
      ...(action === "refund" ? { vault: String(args[3]).toLowerCase().replace(/^0x/, "") } : {}) };
  }
  const action: BridgeReviewGovernanceAction | undefined = func === "approveReviewedDeposit" ? "approve"
    : func === "abortDeposit" ? "reject" : func === "refundWithdrawal" ? "refund" : undefined;
  if (!action) return undefined;
  const args = typeof rawArgs === "string" ? bridgeIssueJson.parse(normalizeLegacyEscapes(rawArgs)) : rawArgs;
  if (!Array.isArray(args) || args.length !== (action === "refund" ? 1 : action === "approve" ? 4 : 3)) throw new Error("Invalid bridge governance arguments");

  if (action === "refund") return { id: `eab:withdrawal:${uint(args[0])}`, action };
  if (!/^(0x)?[0-9a-f]{40}$/i.test(String(args[1]))) throw new Error("Invalid bridge governance router");
  if (action === "approve" && !/^(0x)?[0-9a-f]{64}$/i.test(String(args[3]))) throw new Error("Invalid bridge governance digest");
  return { id: `eab:deposit:${uint(args[0])}:${String(args[1]).toLowerCase().replace(/^0x/, "")}:${uint(args[2])}`, action,
    ...(action === "approve" ? { digest: `0x${String(args[3]).toLowerCase().replace(/^0x/, "")}` } : {}) };
};

// ============================================================================
// TYPES
// ============================================================================

interface QueryConfig {
  tableName: string;
  selectFields: string;
  countField: string;
}

export type BridgeMappingRow = {
  collection_name?: string;
  externalToken?: string;
  externalChainId?: string | number;
  targetStratoToken?: string;
  mappingValue?: unknown;
};

export type BridgeAssetInfo = {
  routeType: "standard" | "native";
  externalChainId: string;
  externalBridge?: string;
  externalToken: string;
  externalName: string;
  externalSymbol: string;
  externalDecimals: string;
  maxPerWithdrawal: string;
  manualReviewThreshold?: string;
  depositsEnabled?: boolean;
  withdrawalsEnabled?: boolean;
  instantWithdrawalThreshold?: string;
  stratoToken: string;
  enabled: boolean;
  depositsPaused?: boolean;
  withdrawalsPaused?: boolean;
  depositsDisabled?: boolean;
  withdrawalsDisabled?: boolean;
  maxOutstandingWithdrawal?: string;
  outstandingWithdrawal?: string;
  remainingOutstandingWithdrawal?: string;
};

export type BridgeableAssetRoute = {
  isDefaultRoute?: boolean;
  id: string;
  externalToken: string;
  externalChainId: string;
  AssetInfo: BridgeAssetInfo;
};

export type NativeBridgeAssetRow = {
  key?: string;
  key2?: string | number;
  value?: unknown;
  lockedBalance?: unknown;
};

export type NativeTokenBridgeConfig = {
  depositsDisabled: boolean;
  withdrawalsDisabled: boolean;
  maxOutstandingWithdrawal: string;
};

// ============================================================================
// UTILS
// ============================================================================

export const normalizeBridgeAddress = (value: string): string => ensureHexPrefix(value).toLowerCase();
export const toBridgeChainId = (value: unknown): string => String(value ?? "");
export const isMappingTrue = (value: unknown): boolean => value === true || value === "true";

export const getBridgePairKey = (externalToken: string, externalChainId: string): string =>
  `${normalizeBridgeAddress(externalToken)}-${externalChainId}`;

const stripHex = (addr: string): string => {
  const l = addr.toLowerCase();
  return l.startsWith("0x") ? l.slice(2) : l;
};

const normalizeAddr = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? stripHex(normalizeBridgeAddress(value)) : "";

// ============================================================================
// QUERY CONFIGS & EXECUTION
// ============================================================================

const QUERY_CONFIGS: Record<string, QueryConfig> = {
  withdrawal: {
    tableName: `${constants.ExternalAssetBridge}-withdrawals`,
    selectFields: "withdrawalId:key,WithdrawalInfo:value,block_timestamp",
    countField: "count()",
  },
  deposit: {
    tableName: `${constants.ExternalAssetBridge}-deposits`,
    selectFields: "externalChainId:key,depositRouter:key2,depositId:key3,externalTxHash:value->>externalTxHash,DepositInfo:value,block_timestamp",
    countField: "count()",
  }
};

const LEGACY_QUERY_CONFIGS: Record<string, QueryConfig> = {
  withdrawal: {
    tableName: `${constants.MercataBridge}-withdrawals`,
    selectFields: "withdrawalId:key,WithdrawalInfo:value,block_timestamp",
    countField: "count()",
  },
  deposit: {
    tableName: `${constants.MercataBridge}-deposits`,
    selectFields:
      "externalChainId:key,externalTxHash:key2,DepositInfo:value,block_timestamp",
    countField: "count()",
  },
};

export function buildQueryParams(
  rawParams: Record<string, string | undefined>,
  userAddress: string | undefined,
  excludeFields: string[],
  queryType: 'withdrawal' | 'deposit'
): Record<string, string> {
  const requestedStatus = rawParams["value->>bridgeStatus"];
  return {
    address: `eq.${constants.externalAssetBridge}`,
    ...Object.fromEntries(
      Object.entries(rawParams).filter(
        ([key, v]) =>
          v !== undefined &&
          key !== "value->>bridgeStatus" &&
          !excludeFields.includes(key)
      )
    ),
    ...(requestedStatus && { "value->>status": requestedStatus }),
    ...(userAddress && {
      [`value->>${queryType === 'deposit' ? 'stratoRecipient' : 'stratoSender'}`]: `eq.${userAddress}`
    })
  };
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

// ============================================================================
// TRANSACTION ENRICHMENT
// ============================================================================

type TxParts = { externalToken: string; externalChainId: string; stratoToken: string };

function extractTxParts(result: any, type: 'withdrawal' | 'deposit'): TxParts {
  const info = type === "withdrawal" ? result?.WithdrawalInfo : result?.DepositInfo;
  return {
    externalToken: normalizeAddr(info?.externalToken),
    externalChainId: type === "withdrawal"
      ? toBridgeChainId(info?.externalChainId)
      : toBridgeChainId(result?.externalChainId ?? info?.externalChainId),
    stratoToken: normalizeAddr(info?.stratoToken),
  };
}

function collectUniqueAddresses(results: any[], type: 'withdrawal' | 'deposit') {
  const stratoTokens = new Set<string>();
  const externalTokens = new Set<string>();
  const txHashes: string[] = [];
  for (const r of results) {
    const { externalToken, stratoToken } = extractTxParts(r, type);
    if (stratoToken) stratoTokens.add(stratoToken);
    if (externalToken) externalTokens.add(externalToken);
    if (type === "deposit" && r.externalTxHash) txHashes.push(r.externalTxHash);
  }
  return { stratoTokens, externalTokens, txHashes };
}

async function fetchTokenSymbols(accessToken: string, addresses: Set<string>): Promise<Map<string, { name: string; symbol: string }>> {
  if (!addresses.size) return new Map();
  const { data } = await cirrus.get(accessToken, `/${constants.Token}`, {
    params: { select: "address,_symbol,_name", address: `in.(${[...addresses].join(",")})` }
  });
  const symbols = new Map<string, { name: string; symbol: string }>(
    (data || []).map((t: any) => [stripHex(t.address), { name: t._name || "-", symbol: t._symbol || "-" }])
  );
  const missingAddresses = new Set([...addresses].filter((address) => !symbols.has(stripHex(address))));
  if (missingAddresses.size) {
    const storageSymbols = await fetchStorageTokenSymbols(accessToken, missingAddresses);
    for (const [address, metadata] of storageSymbols) symbols.set(address, metadata);
  }
  return symbols;
}

async function fetchStorageTokenSymbols(accessToken: string, addresses: Set<string>): Promise<Map<string, { name: string; symbol: string }>> {
  if (!addresses.size) return new Map();
  const { data } = await cirrus.get(accessToken, "/storage", {
    params: {
      address: `in.(${[...addresses].join(",")})`,
      select: "address,data->>_symbol,data->>_name",
    }
  });
  return new Map((data || []).map((t: any) => [
    stripHex(t.address),
    { name: t._name || "-", symbol: t._symbol || "-" },
  ]));
}

async function fetchExternalMeta(accessToken: string, tokens: Set<string>, source: BridgeHistorySource): Promise<Map<string, { externalName: string; externalSymbol: string; externalDecimals?: number }>> {
  if (!tokens.size) return new Map();
  const [standardResponse, legacyResponse, nativeResponse] = await Promise.all([
    source !== "legacy" ? cirrus.get(accessToken, `/${constants.ExternalAssetBridge}-routes`, {
      params: {
        address: `eq.${constants.externalAssetBridge}`,
        key: `in.(${[...tokens].join(",")})`,
        select: "key,key2,value",
      }
    }) : Promise.resolve({ data: [] }),
    source !== "external" && constants.mercataBridge
      ? cirrus.get(accessToken, `/${constants.MercataBridge}-assets`, {
          params: {
            address: `eq.${constants.mercataBridge}`,
            key: `in.(${[...tokens].join(",")})`,
            select:
              "key,value->>externalName,value->>externalSymbol,value->>externalChainId",
          },
        })
      : Promise.resolve({ data: [] }),
    constants.stratoNativeBridge
      ? cirrus.get(accessToken, `/${constants.StratoNativeBridge}-assets`, {
          params: {
            address: `eq.${constants.stratoNativeBridge}`,
            select: "key,key2,value",
          }
        })
      : Promise.resolve({ data: [] }),
  ]);
  const map = new Map<string, { externalName: string; externalSymbol: string; externalDecimals?: number }>();
  for (const a of standardResponse.data || []) {
    const key = getBridgePairKey(
      normalizeBridgeAddress(a.key),
      toBridgeChainId(a.key2 ?? a.value?.externalChainId)
    );
    if (!map.has(key)) {
      map.set(key, {
        externalName: a.value?.externalName || "-",
        externalSymbol: a.value?.externalSymbol || "-",
        externalDecimals: /^\d+$/.test(String(a.value?.externalDecimals)) && Number(a.value.externalDecimals) <= 18
          ? Number(a.value.externalDecimals) : undefined,
      });
    }
  }
  for (const a of legacyResponse.data || []) {
    const key = getBridgePairKey(
      normalizeBridgeAddress(a.key),
      toBridgeChainId(a.externalChainId)
    );
    if (!map.has(key)) {
      map.set(key, {
        externalName: a.externalName || "-",
        externalSymbol: a.externalSymbol || "-",
      });
    }
  }
  for (const row of nativeResponse.data || []) {
    const raw = row?.value;
    if (!raw || typeof raw !== "object") continue;
    const representationToken = typeof raw.representationToken === "string" ? normalizeBridgeAddress(raw.representationToken) : "";
    const externalChainId = toBridgeChainId(row.key2);
    if (!representationToken || !externalChainId || !tokens.has(stripHex(representationToken))) continue;

    const key = getBridgePairKey(representationToken, externalChainId);
    if (!map.has(key)) {
      map.set(key, {
        externalName: typeof raw.externalName === "string" ? raw.externalName : "-",
        externalSymbol: typeof raw.externalSymbol === "string" ? raw.externalSymbol : "-",
        externalDecimals: 18,
      });
    }
  }
  return map;
}

export function getDepositOutcomeIdentity(
  externalChainId: unknown,
  depositRouter: unknown,
  depositId: unknown,
  externalTxHash: unknown,
): string {
  if (
    externalChainId != null &&
    typeof depositRouter === "string" &&
    depositRouter &&
    depositId != null
  ) {
    return [
      String(externalChainId),
      normalizeAddr(depositRouter),
      String(depositId),
    ].join(":");
  }
  return String(externalTxHash || "").toLowerCase();
}

async function fetchDepositEvents(accessToken: string, txHashes: string[], source: BridgeHistorySource): Promise<Map<string, any>> {
  if (!txHashes.length) return new Map();
  const { data } = await cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      select: "address,event_name,attributes",
      address: `in.(${[
        ...(source !== "external" ? [constants.mercataBridge] : []),
        ...(source !== "legacy" ? [constants.externalAssetBridge] : []),
        constants.stratoNativeBridge,
      ].filter(Boolean).join(",")})`,
      event_name:
        "in.(AutoForged,AutoSaved,AutoForgedViaPSM,AutoSavedUSDST,AutoRouted,DepositActionFallback)",
      "attributes->>externalTxHash": `in.(${txHashes.join(",")})`,
    }
  });
  const map = new Map<string, any>();
  for (const e of data || []) {
    const attributes = e.attributes || {};
    const isExternalAssetBridge =
      normalizeAddr(e.address) === normalizeAddr(constants.externalAssetBridge);
    const key = normalizeAddr(e.address) === normalizeAddr(constants.stratoNativeBridge || "")
      ? `native:${attributes.depositId}` : getDepositOutcomeIdentity(
      isExternalAssetBridge ? attributes.externalChainId : undefined,
      isExternalAssetBridge ? attributes.depositRouter : undefined,
      isExternalAssetBridge ? attributes.depositId : undefined,
      attributes.externalTxHash,
    );
    if (key) map.set(key, e);
  }
  return map;
}

async function fetchWithdrawalReviews(
  accessToken: string,
  results: any[]
): Promise<Map<string, any>> {
  const ids = results
    .filter((row) => row.bridgeSource === "external" && row.withdrawalId != null)
    .map((row) => String(row.withdrawalId));
  if (!ids.length) return new Map();
  const { data } = await cirrus.get(
    accessToken,
    `/${constants.ExternalAssetBridge}-withdrawalManualReviews`,
    {
      params: {
        address: `eq.${constants.externalAssetBridge}`,
        key: `in.(${ids.join(",")})`,
        select: "key,value",
      },
    }
  );
  return new Map((data || []).map((row: any) => [String(row.key), row.value]));
}

function applyDepositOutcome(enriched: any, eventMap: Map<string, any>, stratoMap: Map<string, { name: string; symbol: string }>) {
  const evt = eventMap.get(
    enriched.bridgeSource === "native" ? `native:${enriched.depositId}` : getDepositOutcomeIdentity(
      enriched.bridgeSource === "external" ? enriched.externalChainId : undefined,
      enriched.bridgeSource === "external" ? enriched.depositRouter : undefined,
      enriched.bridgeSource === "external" ? enriched.depositId : undefined,
      enriched.externalTxHash,
    ),
  );
  if (evt?.event_name === "AutoForged" || evt?.event_name === "AutoForgedViaPSM") {
    const addr = stripHex(evt.attributes.metalToken || "");
    enriched.depositOutcome = "forge";
    enriched.finalToken = addr;
    enriched.finalTokenSymbol = stratoMap.get(addr)?.symbol || "-";
    enriched.finalAmount = evt.attributes.metalAmount || "0";
  } else if (evt?.event_name === "AutoSavedUSDST") {
    const addr = stripHex(evt.attributes.saveToken || "");
    enriched.depositOutcome = "save";
    enriched.finalToken = addr;
    enriched.finalTokenSymbol = stratoMap.get(addr)?.symbol || "-";
    enriched.finalAmount = evt.attributes.shares || "0";
  } else if (evt?.event_name === "AutoSaved") {
    enriched.depositOutcome = "save";
    enriched.finalAmount = evt.attributes.mTokenAmount || "0";
  } else if (evt?.event_name === "AutoRouted") {
    const addr = stripHex(evt.attributes.finalToken || "");
    enriched.depositOutcome = "route";
    enriched.finalToken = addr;
    enriched.finalTokenSymbol = stratoMap.get(addr)?.symbol || "-";
    enriched.finalAmount = evt.attributes.finalAmount || "0";
  } else if (evt?.event_name === "DepositActionFallback") {
    const addr = stripHex(evt.attributes.fallbackToken || "");
    enriched.depositOutcome = "fallback";
    enriched.finalToken = addr;
    enriched.finalTokenSymbol = stratoMap.get(addr)?.symbol || "-";
    enriched.finalAmount = evt.attributes.fallbackAmount || "0";
  } else {
    enriched.depositOutcome = "bridge";
  }
}

export async function enrichTransactionData(
  accessToken: string,
  results: any[],
  type: 'withdrawal' | 'deposit',
  source: BridgeHistorySource = "all"
) {
  if (!results.length) return results;

  const { stratoTokens, externalTokens, txHashes } = collectUniqueAddresses(results, type);

  const [stratoMap, externalMap, eventMap, reviewMap] = await Promise.all([
    fetchTokenSymbols(accessToken, stratoTokens),
    fetchExternalMeta(accessToken, externalTokens, source),
    type === "deposit" ? fetchDepositEvents(accessToken, txHashes, source) : Promise.resolve(new Map<string, any>()),
    type === "withdrawal"
      ? fetchWithdrawalReviews(accessToken, results)
      : Promise.resolve(new Map<string, any>()),
  ]);

  const outcomeTokenAddrs = new Set<string>();
  for (const [, evt] of eventMap) {
    const token = evt.event_name === "AutoForged" || evt.event_name === "AutoForgedViaPSM"
      ? evt.attributes?.metalToken
      : evt.event_name === "AutoSavedUSDST"
        ? evt.attributes?.saveToken
        : evt.event_name === "AutoRouted"
          ? evt.attributes?.finalToken
        : evt.event_name === "DepositActionFallback"
          ? evt.attributes?.fallbackToken
          : undefined;
    if (!token) continue;
    const addr = stripHex(token);
    if (!stratoMap.has(addr)) outcomeTokenAddrs.add(addr);
  }
  if (outcomeTokenAddrs.size) {
    const outcomeTokenMap = await fetchStorageTokenSymbols(accessToken, outcomeTokenAddrs);
    for (const [k, v] of outcomeTokenMap) stratoMap.set(k, v);
  }

  return results.map((r: any) => {
    const { externalToken, externalChainId, stratoToken } = extractTxParts(r, type);
    const pairKey = externalToken && externalChainId ? getBridgePairKey(normalizeBridgeAddress(externalToken), externalChainId) : "";
    const extMeta = pairKey ? externalMap.get(pairKey) : undefined;
    const strMeta = stratoToken ? stratoMap.get(stratoToken) : undefined;

    const infoKey = type === "withdrawal" ? "WithdrawalInfo" : "DepositInfo";
    const info = r?.[infoKey] || {};
    const review = type === "withdrawal"
      ? reviewMap.get(String(r.withdrawalId))
      : undefined;
    const enriched: any = {
      ...r,
      [infoKey]: {
        ...info,
        bridgeStatus: String(info.status ?? info.bridgeStatus ?? "0"),
        ...(review && {
          reviewApprovalDeadline: String(review.approvalDeadline ?? "0"),
          reviewDigest: review.reviewDigest,
          reviewProposalHash: review.proposalHash,
        }),
      },
      stratoTokenName: strMeta?.name || "-",
      stratoTokenSymbol: strMeta?.symbol || "-",
      externalName: extMeta?.externalName || "-",
      externalDecimals: extMeta?.externalDecimals,
      externalSymbol: extMeta?.externalSymbol || "-",
    };

    if (type === "deposit" && r.externalTxHash) applyDepositOutcome(enriched, eventMap, stratoMap);

    return enriched;
  });
}

// ============================================================================
// BRIDGEABLE TOKEN ROUTES (used by /bridgeableTokens/:chainId endpoint)
// ============================================================================

export function enrichAssetsWithTokenData(
  assets: BridgeableAssetRoute[],
  tokenMap: Map<string, { name?: string; symbol?: string; image?: string; decimals?: number }>
): BridgeToken[] {
  return assets.map((route) => {
    const tokenKey = stripHex(route.AssetInfo.stratoToken);
    const meta = tokenMap.get(tokenKey);
    return {
      ...route.AssetInfo,
      stratoTokenName: meta?.name ?? "",
      stratoTokenSymbol: meta?.symbol ?? "",
      stratoTokenDecimals: meta?.decimals ?? 18,
      stratoTokenImage: meta?.image,
      ...(route.isDefaultRoute !== undefined ? { isDefaultRoute: route.isDefaultRoute } : {}),
      id: route.id,
    };
  });
}

const toBridgeAssetInfo = (value: unknown, externalToken: string, externalChainId: string): BridgeAssetInfo | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.stratoToken !== "string" || raw.stratoToken.length === 0) return null;
  return {
    routeType: "standard",
    externalChainId,
    externalToken,
    externalName: typeof raw.externalName === "string" ? raw.externalName : "",
    externalSymbol: typeof raw.externalSymbol === "string" ? raw.externalSymbol : "",
    externalDecimals: raw.externalDecimals != null ? String(raw.externalDecimals) : "",
    maxPerWithdrawal: raw.maxPerWithdrawal != null ? String(raw.maxPerWithdrawal) : "0",
    stratoToken: normalizeBridgeAddress(raw.stratoToken),
    enabled: raw.enabled === true,
  };
};

export function parseBridgeRouteMappings(mappings: BridgeMappingRow[]): BridgeableAssetRoute[] {
  const externalRoutes = mappings.flatMap((row): BridgeableAssetRoute[] => {
    if (!row.mappingValue || typeof row.mappingValue !== "object") return [];
    const raw = row.mappingValue as Record<string, unknown>;
    if (
      raw.depositsEnabled == null &&
      raw.withdrawalsEnabled == null
    ) {
      return [];
    }
    const externalToken =
      typeof row.externalToken === "string"
        ? normalizeBridgeAddress(row.externalToken)
        : "";
    const externalChainId = toBridgeChainId(
      row.externalChainId ?? raw.externalChainId
    );
    const stratoToken =
      typeof row.targetStratoToken === "string"
        ? normalizeBridgeAddress(row.targetStratoToken)
        : typeof raw.stratoToken === "string"
          ? normalizeBridgeAddress(raw.stratoToken)
          : "";
    if (!externalToken || !externalChainId || !stratoToken) return [];
    const depositsEnabled = isMappingTrue(raw.depositsEnabled);
    const withdrawalsEnabled = isMappingTrue(raw.withdrawalsEnabled);
    return [{
      id: `${externalToken}-${externalChainId}-${stratoToken}`,
      externalToken,
      externalChainId,
      AssetInfo: {
        routeType: "standard",
        externalChainId,
        externalToken,
        externalName:
          typeof raw.externalName === "string" ? raw.externalName : "",
        externalSymbol:
          typeof raw.externalSymbol === "string" ? raw.externalSymbol : "",
        externalDecimals:
          raw.externalDecimals != null ? String(raw.externalDecimals) : "",
        maxPerWithdrawal:
          raw.maxPerWithdrawal != null ? String(raw.maxPerWithdrawal) : "0",
        manualReviewThreshold:
          raw.manualReviewThreshold != null
            ? String(raw.manualReviewThreshold)
            : "0",
        stratoToken,
        enabled: depositsEnabled || withdrawalsEnabled,
        depositsEnabled,
        withdrawalsEnabled,
      },
    }];
  });
  if (externalRoutes.length > 0) return externalRoutes;

  const assetByPair = new Map<string, BridgeAssetInfo>();
  const routeTokensByPair = new Map<string, Set<string>>();

  for (const row of mappings) {
    const externalToken = row?.externalToken;
    const externalChainId = toBridgeChainId(row?.externalChainId);
    if (!externalToken || !externalChainId) continue;
    const normalized = normalizeBridgeAddress(externalToken);
    const pairKey = getBridgePairKey(normalized, externalChainId);

    if (row.collection_name === "assets") {
      const info = toBridgeAssetInfo(row.mappingValue, normalized, externalChainId);
      if (info) assetByPair.set(pairKey, info);
    } else if (row.collection_name === "assetRouteEnabled" && isMappingTrue(row.mappingValue) && row.targetStratoToken) {
      const tokens = routeTokensByPair.get(pairKey) || new Set<string>();
      tokens.add(normalizeBridgeAddress(row.targetStratoToken));
      routeTokensByPair.set(pairKey, tokens);
    }
  }

  const routes: BridgeableAssetRoute[] = [];
  for (const [pairKey, asset] of assetByPair) {
    const explicitTokens = routeTokensByPair.get(pairKey) || new Set<string>();
    const { externalToken, externalChainId, stratoToken: defaultToken } = asset;

    routes.push({
      id: `${externalToken}-${externalChainId}-${defaultToken}`,
      externalToken, externalChainId, isDefaultRoute: true,
      AssetInfo: { ...asset, enabled: asset.enabled || explicitTokens.has(defaultToken) },
    });

    for (const stratoToken of explicitTokens) {
      if (stratoToken === defaultToken) continue;
      routes.push({
        id: `${externalToken}-${externalChainId}-${stratoToken}`,
        externalToken, externalChainId, isDefaultRoute: false,
        AssetInfo: { ...asset, stratoToken, enabled: true },
      });
    }
  }

  return routes;
}

export function parseNativeBridgeAssets(
  rows: NativeBridgeAssetRow[],
  pauseState: { depositsPaused?: boolean; withdrawalsPaused?: boolean } = {},
  tokenConfigs: Map<string, NativeTokenBridgeConfig> = new Map(),
  lockedBalances: Map<string, string> = new Map()
): BridgeableAssetRoute[] {
  const routes: BridgeableAssetRoute[] = [];

  for (const row of rows) {
    const stratoToken = typeof row.key === "string" ? normalizeBridgeAddress(row.key) : "";
    const externalChainId = toBridgeChainId(row.key2);
    if (!stratoToken || !externalChainId || !row.value || typeof row.value !== "object") continue;

    const raw = row.value as Record<string, unknown>;
    const representationToken = typeof raw.representationToken === "string"
      ? normalizeBridgeAddress(raw.representationToken)
      : "";
    if (!representationToken) continue;
    const tokenKey = stratoToken.toLowerCase().replace(/^0x/, "");
    const tokenConfig = tokenConfigs.get(tokenKey);
    const maxOutstandingWithdrawal = tokenConfig?.maxOutstandingWithdrawal ?? "0";
    const outstandingWithdrawal = lockedBalances.get(tokenKey) ?? "0";
    const maxOutstanding = BigInt(maxOutstandingWithdrawal);
    const outstanding = BigInt(outstandingWithdrawal);
    const remainingOutstandingWithdrawal =
      maxOutstanding > outstanding ? String(maxOutstanding - outstanding) : "0";

    const asset: BridgeAssetInfo = {
      routeType: "native",
      externalChainId,
      externalBridge: typeof raw.externalBridge === "string" ? normalizeBridgeAddress(raw.externalBridge) : "",
      externalToken: representationToken,
      externalName: typeof raw.externalName === "string" ? raw.externalName : "",
      externalSymbol: typeof raw.externalSymbol === "string" ? raw.externalSymbol : "",
      externalDecimals: "18",
      maxPerWithdrawal: raw.maxPerWithdrawal != null ? String(raw.maxPerWithdrawal) : "0",
      instantWithdrawalThreshold:
        raw.instantWithdrawalThreshold != null
          ? String(raw.instantWithdrawalThreshold)
          : "0",
      stratoToken,
      enabled: isMappingTrue(raw.enabled),
      depositsPaused: pauseState.depositsPaused,
      withdrawalsPaused: pauseState.withdrawalsPaused,
      depositsDisabled: tokenConfig?.depositsDisabled ?? false,
      withdrawalsDisabled: tokenConfig?.withdrawalsDisabled ?? false,
      maxOutstandingWithdrawal,
      outstandingWithdrawal,
      remainingOutstandingWithdrawal,
    };

    routes.push({
      id: `${representationToken}-${externalChainId}-${stratoToken}-native`,
      externalToken: representationToken,
      externalChainId,
      AssetInfo: asset,
    });
  }

  return routes;
}

export function parseNativeTokenBridgeConfigs(
  rows: NativeBridgeAssetRow[]
): Map<string, NativeTokenBridgeConfig> {
  const configs = new Map<string, NativeTokenBridgeConfig>();

  for (const row of rows) {
    if (typeof row.key !== "string" || !row.value || typeof row.value !== "object") continue;
    const raw = row.value as Record<string, unknown>;
    configs.set(row.key.toLowerCase().replace(/^0x/, ""), {
      depositsDisabled: isMappingTrue(raw.depositsDisabled),
      withdrawalsDisabled: isMappingTrue(raw.withdrawalsDisabled),
      maxOutstandingWithdrawal:
        raw.maxOutstandingWithdrawal != null ? String(raw.maxOutstandingWithdrawal) : "0",
    });
  }

  return configs;
}

export function parseNativeLockedBalances(
  rows: NativeBridgeAssetRow[]
): Map<string, string> {
  const balances = new Map<string, string>();

  for (const row of rows) {
    if (typeof row.key !== "string") continue;
    balances.set(
      row.key.toLowerCase().replace(/^0x/, ""),
      row.lockedBalance != null ? String(row.lockedBalance) : "0"
    );
  }

  return balances;
}

export { LEGACY_QUERY_CONFIGS, QUERY_CONFIGS };

// Indexed policy values only; no wall-clock refill or external-vault capacity inference.
export const buildBridgePolicyRows = (records: BridgePolicyRecords): BridgePolicyRow[] => {
  const normalize = (value: string | number) => {
    if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) throw new Error("Invalid indexed policy key");
    return String(value).toLowerCase().replace(/^0x/, "");
  };
  const key = (...parts: string[]) => parts.map(normalize).join(":");
  const uint = (value: unknown): string | null =>
    (typeof value === "string" && /^\d+$/.test(value)) || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ? BigInt(value).toString() : null;
  const decimals = (value: unknown): number | undefined => {
    const parsed = uint(value);
    return parsed !== null && BigInt(parsed) <= 255n ? Number(parsed) : undefined;
  };
  const flag = (label: string, value: unknown): BridgePolicyField => ({ label,
    value: value === true || value === "true" ? "Yes" : value === false || value === "false" ? "No" : null });
  const amount = (label: string, value: unknown, precision: number | undefined, unit: string | undefined, zero?: string): BridgePolicyField => {
    const parsed = uint(value);
    return parsed !== null && BigInt(parsed) === 0n && zero ? { label, value: zero }
      : { label, value: parsed, kind: "amount", decimals: precision, unit };
  };
  const tokens = new Map(records.tokens.map(token => [normalize(token.address), token]));
  const mint = new Map(records.mintPolicies.map(row => [normalize(row.key), row.value]));
  const chains = new Map(records.chains.map(row => [normalize(row.key), row.value]));
  const actions = new Map(records.actions.map(row => [key(row.key, row.key2!, row.key3!), row.value]));
  const ethRoutes = new Map(records.ethAutoRoute.map(row => [key(row.key, row.key2!), row.value]));
  const configs = new Map(records.nativeConfigs.map(row => [normalize(row.key), row.value]));
  const nativeRoutes = new Map(records.nativeAutoRoute.map(row => [key(row.key, row.key2!), row.value]));
  const locked = new Map(records.locked.map(row => [normalize(row.key), row.value]));
  const rows: BridgePolicyRow[] = [];
  const tokenInfo = (address: string) => {
    const token = tokens.get(normalize(address));
    return { symbol: token?._symbol, precision: token ? decimals(token.customDecimals ?? 18) : undefined };
  };
  for (const token of new Set([...mint.keys(), ...records.routes.map(row => normalize(row.key3!))])) {
    const { symbol, precision } = tokenInfo(token);
    const p = mint.get(token) ?? { capacity: "0", consumed: "0", refillRate: "0", lastRefillAt: "0" };
    const capacity = uint(p.capacity), consumed = uint(p.consumed);
    const remaining = capacity !== null && consumed !== null ? String(BigInt(capacity) > BigInt(consumed) ? BigInt(capacity) - BigInt(consumed) : 0n) : null;
    rows.push({ id: `eab:mint:${token}`, source: "eab", kind: "Mint policy", token, symbol, fields: [
      amount("Mint capacity (shared across routes)", p.capacity, precision, symbol, "Not configured — minting blocked"),
      amount("Remaining at last refill", remaining, precision, symbol),
      amount("Consumed at last refill", p.consumed, precision, symbol),
      amount("Refill per second", p.refillRate, precision, symbol),
      { label: "Last refill recorded", value: uint(p.lastRefillAt), kind: "timestamp" },
    ] });
  }
  for (const row of records.routes) {
    const token = normalize(row.key3!), chainId = normalize(row.key2!), externalToken = normalize(row.key), v = row.value;
    const { symbol } = tokenInfo(token);
    const action = actions.get(key(externalToken, chainId, token));
    const autoRoute = /^0+$/.test(externalToken) ? ethRoutes.get(key(chainId, token)) ?? false : action ? action.autoRoute : false;
    rows.push({ id: `eab:route:${key(externalToken, chainId, token)}`, source: "eab", kind: "Route", token, symbol, chainId, externalToken, externalSymbol: v.externalSymbol,
      fields: [flag("Chain enabled", chains.has(chainId) ? chains.get(chainId)!.enabled : false), flag("Route deposits enabled", v.depositsEnabled),
        flag("Route withdrawals enabled", v.withdrawalsEnabled), flag("Bridge deposits paused", records.eab?.depositsPaused),
        flag("Bridge withdrawals paused", records.eab?.withdrawalsPaused), flag("Auto-route configured", autoRoute),
        amount("Maximum per withdrawal", v.maxPerWithdrawal, decimals(v.externalDecimals), v.externalSymbol, "No route cap"),
        amount("Review required above", v.manualReviewThreshold, decimals(v.externalDecimals), v.externalSymbol, "No amount-based review threshold"),
      ] });
  }
  for (const row of records.nativeAssets) {
    const token = normalize(row.key), chainId = normalize(row.key2!), v = row.value;
    const { symbol, precision } = tokenInfo(token);
    const config = configs.get(token) ?? { depositsDisabled: false, withdrawalsDisabled: false, maxOutstandingWithdrawal: "0" };
    const cap = uint(config.maxOutstandingWithdrawal), used = uint(records.custody ? locked.get(token) ?? "0" : undefined);
    const remaining = cap !== null && used !== null ? String(BigInt(cap) > BigInt(used) ? BigInt(cap) - BigInt(used) : 0n) : null;
    rows.push({ id: `native:route:${key(token, chainId)}`, source: "native", kind: "Route", token, symbol, chainId,
      externalToken: v.representationToken, externalSymbol: v.externalSymbol,
      fields: [flag("Asset enabled", v.enabled), flag("Custody vault paused", records.custody?.paused), flag("Bridge deposits paused", records.native?.depositsPaused),
        flag("Bridge withdrawals paused", records.native?.withdrawalsPaused), flag("Token deposits disabled", config.depositsDisabled),
        flag("Token withdrawals disabled", config.withdrawalsDisabled), flag("Auto-route configured", nativeRoutes.get(key(token, chainId)) ?? false),
        amount("Maximum per withdrawal", v.maxPerWithdrawal, precision, symbol, "No route cap"),
        amount("Instant withdrawal threshold", v.instantWithdrawalThreshold, precision, symbol, "Instant withdrawals disabled"),
        { label: "Instant withdrawal delay (seconds)", value: uint(records.native?.INSTANT_WITHDRAWAL_DELAY_SECONDS) },
        amount("Outstanding limit (shared across networks)", cap, precision, symbol, "No aggregate cap"),
        amount("Locked balance (all networks)", used, precision, symbol),
        amount("Remaining aggregate allowance", cap === "0" ? "0" : remaining, precision, symbol, cap === "0" ? "No aggregate cap" : undefined),
      ] });
  }
  return rows;
};
