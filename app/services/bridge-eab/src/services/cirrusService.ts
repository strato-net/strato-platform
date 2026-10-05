import { ExternalBridgeStatus } from "@strato/shared-types";
import { cirrus } from "../utils/api";
import { ensureHexPrefix, normalizeOptionalHash } from "../utils/utils";
import { config, CIRRUS_PAGE_SIZE, CIRRUS_FILTER_BATCH_SIZE, EMAIL_METADATA_TIMEOUT_MS } from "../config";
import { logInfo } from "../utils/logger";
import type { BridgeReviewItem } from "@strato/shared-types";
import {
  ChainInfo,
  ProcessingContext,
  DepositArgs,
  RecordedDepositReview,
  WithdrawalInfo,
  NativeWithdrawalInfo,
  NonEmptyArray,
  DepositInfo,
  NativeDepositInfo,
  AssetInfo,
  BridgeInfo,
  BridgeEmailToken,
} from "../types";

const { externalAssetBridge, nativeBridge, oracle } = config;
const toCirrusAddress = (address?: string) =>
  address ? address.toLowerCase().replace(/^0x/, "") : undefined;
const externalAssetBridgeAddress = toCirrusAddress(externalAssetBridge.address);
const nativeBridgeAddress = toCirrusAddress(nativeBridge.address);
const oracleAddress = toCirrusAddress(oracle.address);
const EXTERNAL_ASSET_BRIDGE_URL = "BlockApps-ExternalAssetBridge";
const NATIVE_BRIDGE_URL = "BlockApps-StratoNativeBridge";
const ORACLE_URL = "BlockApps-PriceOracle";

async function getPaginatedRows(
  url: string,
  options: { params: Record<string, string | number>; timeout?: number },
): Promise<any[]> {
  const result: any[] = [];
  for (let offset = 0; ; ) {
    const rows = await cirrus.get(url, {
      ...options,
      params: { ...options.params, limit: CIRRUS_PAGE_SIZE, offset },
    });
    if (!Array.isArray(rows)) throw new Error(`Invalid Cirrus response for ${url}`);
    if (!rows.length) return result;
    result.push(...rows);
    // A server row cap may return fewer rows than the requested limit.
    offset += rows.length;
  }
}

async function getRowsByIds(
  url: string,
  ids: string[],
  options: { params: Record<string, string | number>; timeout?: number },
  column = "key",
): Promise<any[]> {
  const unique = [...new Set(ids)];
  const result: any[] = [];
  for (let offset = 0; offset < unique.length; offset += CIRRUS_FILTER_BATCH_SIZE) {
    const batch = unique.slice(offset, offset + CIRRUS_FILTER_BATCH_SIZE);
    result.push(...await getPaginatedRows(url, {
      ...options,
      params: { ...options.params, [column]: `in.(${batch.join(",")})` },
    }));
  }
  return result;
}

export const getBridgeEmailTokens = async (addresses: string[]): Promise<Map<string, BridgeEmailToken>> => {
  const ids = addresses.map(address => toCirrusAddress(address)!).filter(address => /^[a-f0-9]{40}$/.test(address));
  const rows = await getRowsByIds("/BlockApps-Token", ids, { timeout: EMAIL_METADATA_TIMEOUT_MS,
    params: { select: "address,_symbol,customDecimals", order: "address.asc" } }, "address");
  const tokens = new Map<string, BridgeEmailToken>();
  for (const row of rows) {
    if (typeof row.address !== "string" || !/^(0x)?[a-f0-9]{40}$/i.test(row.address) ||
        typeof row._symbol !== "string" || !/^[\w .-]{1,40}$/.test(row._symbol)) continue;
    const decimals = typeof row.customDecimals === "number" || (typeof row.customDecimals === "string" && /^\d+$/.test(row.customDecimals))
      ? Number(row.customDecimals) : NaN;
    tokens.set(toCirrusAddress(row.address)!, { symbol: row._symbol,
      ...(Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? { decimals } : {}) });
  }
  return tokens;
};

// Get all enabled chains from the bridge contract
export const getEnabledChains = async (): Promise<Map<number, ChainInfo>> => {
  const [data, routerData] = await Promise.all([
    cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-chains`, {
      params: {
        "value->>enabled": "eq.true",
        address: `eq.${externalAssetBridgeAddress}`,
        select: "key,value",
      },
    }),
    cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-depositRouters`, {
      params: {
        address: `eq.${externalAssetBridgeAddress}`,
        value: "eq.true",
        select: "key,key2,value",
      },
    }),
  ]);

  if (!Array.isArray(data) || !data.length) return new Map();

  const routersByChain = new Map<number, string[]>();
  for (const row of Array.isArray(routerData) ? routerData : []) {
    const chainId = Number(row.key);
    routersByChain.set(chainId, [
      ...(routersByChain.get(chainId) || []),
      row.key2,
    ]);
  }

  // Cirrus returns contract addresses as bare lowercase hex (no 0x); ethers treats such strings as
  // ENS names. Normalise once here so every consumer (config validation, Contract/getLogs, comparisons)
  // receives 0x-prefixed addresses. Values that are not 40-hex addresses pass through unchanged.
  const prefixed = (address: unknown): string | undefined =>
    typeof address === "string" && /^[0-9a-fA-F]{40}$/.test(address)
      ? ensureHexPrefix(address)
      : (address as string | undefined);
  const normalize = (v: any, key: string): ChainInfo => ({
    externalChainId: Number(key),
    depositRouter: prefixed(v.depositRouter) as string,
    depositRouters: [
      ...new Set(
        [v.depositRouter, ...(routersByChain.get(Number(key)) || [])]
          .map(prefixed)
          .filter((router): router is string => Boolean(router)),
      ),
    ],
    lastProcessedBlock: Number(v.lastProcessedBlock),
    enabled: !!v.enabled,
    custody: prefixed(v.custody),
    vault: prefixed(v.vault),
    chainName: v.chainName,
  });

  return new Map(
    data.map(({ key, value }) => [Number(key), normalize(value, key)])
  );
};

// Get asset info by external token addresses
export const getAssetInfo = async (
  externalTokenAddress: NonEmptyArray<string>,
  externalChainId?: number
): Promise<Map<string, AssetInfo>> => {
  const data = await getRowsByIds(`/${EXTERNAL_ASSET_BRIDGE_URL}-routes`, externalTokenAddress.map((address) => toCirrusAddress(address)!), {
    params: {
      ...(externalChainId ? { key2: `eq.${externalChainId}` } : {}),
      "value->>depositsEnabled": "eq.true",
      address: `eq.${externalAssetBridgeAddress}`,
      select: "key,key2,key3,value",
      order: "key.asc,key2.asc,key3.asc",
    },
  });

  if (!Array.isArray(data) || !data.length) return new Map();

  const normalize = (v: any): AssetInfo => ({
    enabled: !!v.depositsEnabled || !!v.withdrawalsEnabled,
    stratoToken: v.stratoToken,
    externalName: v.externalName,
    externalToken: v.externalToken,
    externalSymbol: v.externalSymbol,
    externalChainId: Number(v.externalChainId),
    externalDecimals: Number(v.externalDecimals),
    maxPerWithdrawal: Number(v.maxPerWithdrawal),
  });

  return new Map(
    data.map(({ key, key2, key3, value }) => [
      `${key}:${key2}:${key3}`,
      normalize(value),
    ])
  );
};

export const getNativeRepresentationTokens = async (chainId: number): Promise<string[]> => {
  const rows = await getPaginatedRows(`/${NATIVE_BRIDGE_URL}-assets`, {
    params: { address: `eq.${nativeBridgeAddress}`, key2: `eq.${chainId}`, select: "value", order: "key.asc,key2.asc" },
  });
  return [...new Set(rows.map((row: any) => String(row.value?.representationToken || "")))];
};

export const getEnabledNativeChainIds = async (): Promise<number[]> => {
  if (!nativeBridgeAddress) return [];

  const data = await cirrus.get(`/${NATIVE_BRIDGE_URL}-assets`, {
    params: {
      "value->>enabled": "eq.true",
      address: `eq.${nativeBridgeAddress}`,
      select: "key2",
    },
  });

  if (!Array.isArray(data) || !data.length) return [];

  return Array.from(
    new Set(
      data
        .map((item) => Number(item.key2))
        .filter((chainId) => Number.isSafeInteger(chainId) && chainId > 0),
    ),
  );
};

export const getExternalWithdrawalsByStatus = async (
  status: string,
): Promise<WithdrawalInfo[]> => {
  const [data, enabledChains] = await Promise.all([
    getPaginatedRows(
      `/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawals?select=*,bridge:${EXTERNAL_ASSET_BRIDGE_URL}!inner(withdrawalsPaused)`,
      {
        params: {
          "value->>status": `eq.${status}`,
          address: `eq.${externalAssetBridgeAddress}`,
          order: "value->>requestedAt.asc,key.asc",
          ...(status === "3" ? {} : { "bridge.withdrawalsPaused": "eq.false" }),
        },
      },
    ),
    getEnabledChains(),
  ]);

  if (!Array.isArray(data) || data.length === 0) return [];
  const eligible = data.filter((item) => {
    const chainId = Number(item.value.externalChainId);
    if (status === "3" || enabledChains.get(chainId)?.vault) return true;
    logInfo("ExternalWithdrawal", `Skipping withdrawal ${item.key}: chain ${chainId} is disabled or has no vault`);
    return false;
  });
  if (!eligible.length) return [];
  const withdrawalIds = eligible.map((item) => item.key);
  const [authorizationData, reviewData] = await Promise.all([
    getRowsByIds(
      `/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawalAuthorizations`,
      withdrawalIds,
      {
        params: {
          address: `eq.${externalAssetBridgeAddress}`,
          select: "key,value",
          order: "key.asc",
        },
      },
    ),
    getRowsByIds(
      `/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawalManualReviews`,
      withdrawalIds,
      {
        params: {
          address: `eq.${externalAssetBridgeAddress}`,
          select: "key,value",
          order: "key.asc",
        },
      },
    ),
  ]);
  const authorizations = new Map(
    (Array.isArray(authorizationData) ? authorizationData : []).map((item) => [
      String(item.key),
      item.value,
    ]),
  );
  const reviews = new Map(
    (Array.isArray(reviewData) ? reviewData : []).map((item) => [
      String(item.key),
      item.value,
    ]),
  );

  return eligible.map((item) => {
    const externalChainId = Number(item.value.externalChainId);
    const vault = authorizations.get(String(item.key))?.destinationVault ||
      (status !== "3" ? enabledChains.get(externalChainId)?.vault : undefined);
    return {
      ...item.value,
      bridgeStatus: item.value.status,
      withdrawalId: String(item.key),
      vault,
      recoveryOnly: status === "3" && (item.bridge?.withdrawalsPaused !== false || !enabledChains.has(externalChainId)),
      reservationId: normalizeOptionalHash(item.value.reservationId) ?? undefined,
      reservationTxHash: normalizeOptionalHash(item.value.reservationTxHash) ?? undefined,
      cancellationTxHash: normalizeOptionalHash(item.value.cancellationTxHash) ?? undefined,
      externalTxHash: normalizeOptionalHash(item.value.externalTxHash) ?? undefined,
      authorizationNotBefore: authorizations.get(String(item.key))?.notBefore,
      signerSetVersion: authorizations.get(String(item.key))?.signerSetVersion,
      reviewApprovalDeadline: reviews.get(String(item.key))?.approvalDeadline,
      reviewDigest: reviews.get(String(item.key))?.reviewDigest,
      reviewProposalHash: reviews.get(String(item.key))?.proposalHash,
    };
  });
};

export const getNativeWithdrawalById = async (withdrawalId: string): Promise<NativeWithdrawalInfo | undefined> => {
  if (!/^\d+$/.test(withdrawalId)) throw new Error("Invalid native withdrawal identifier");
  const rows = await cirrus.get(`/${NATIVE_BRIDGE_URL}-withdrawals`, { params: {
    address: `eq.${nativeBridgeAddress}`, key: `eq.${withdrawalId}`, select: "value", limit: 1,
  } });
  return rows?.[0]?.value;
};

export const getNativeWithdrawalsByStatus = async (
  status: string
): Promise<NativeWithdrawalInfo[]> => {
  if (!nativeBridgeAddress) return [];

  const data = await getPaginatedRows(
    `/${NATIVE_BRIDGE_URL}-withdrawals?select=*`,
    {
      params: {
        "value->>bridgeStatus": `eq.${status}`,
        address: `eq.${nativeBridgeAddress}`,
        order: "value->>requestedAt.asc,key.asc",
      },
    }
  );

  if (!Array.isArray(data) || data.length === 0) return [];

  return data.map((item) => ({
    ...item.value,
    withdrawalId: String(item.key),
  }));
};

// Get deposits by status (reusable function)
export const getDepositsByStatus = async (
  status: string
): Promise<DepositInfo[]> => {
  const data = await getPaginatedRows(
    `/${EXTERNAL_ASSET_BRIDGE_URL}-deposits?select=*,bridge:${EXTERNAL_ASSET_BRIDGE_URL}!inner(depositsPaused)`,
    {
      params: {
        "value->>status": `eq.${status}`,
        address: `eq.${externalAssetBridgeAddress}`,
        order: "value->>timestamp.asc,key.asc,key2.asc,key3.asc",
        "bridge.depositsPaused": "eq.false",
      },
    }
  );

  if (!Array.isArray(data) || data.length === 0) return [];

  const externalTokenAddresses = [
    ...new Set(data.map((item) => item.value?.externalToken).filter(Boolean)),
  ];
  if (externalTokenAddresses.length === 0) {
    return [];
  }
  const [assetMapping, enabledChains] = await Promise.all([
    getAssetInfo(externalTokenAddresses as NonEmptyArray<string>),
    getEnabledChains(),
  ]);

  return data.map(
    ({
      value: v,
      key: externalChainId,
      key2: depositRouter,
      key3: depositId,
    }) => {
      const externalToken = v?.externalToken;
      const asset = assetMapping.get(
        getRouteRebaseKey(externalToken, externalChainId, v?.stratoToken),
      );

      if (!asset || !Number.isInteger(asset.externalDecimals) || asset.externalDecimals < 0)
        throw new Error(
          `Asset info not found for external token ${externalToken} on chain ${externalChainId}`
        );

      const chainInfo = enabledChains.get(Number(externalChainId));
      if (!chainInfo || !chainInfo?.depositRouter)
        throw new Error(`Chain info not found for chain ${externalChainId}`);
      const custodyAddress = chainInfo.vault || chainInfo.custody;
      if (!custodyAddress)
        throw new Error(`Custody address not found for chain ${externalChainId}`);

      return {
        ...v,
        bridgeStatus: v.status,
        externalChainId,
        externalTxHash: v.externalTxHash,
        depositId: String(depositId),
        externalDecimals: asset.externalDecimals,
        depositRouter,
        custodyAddress,
      };
    }
  );
};

export const getDepositStatusByIdentity = async (
  externalChainId: number | string,
  depositRouter: string,
  depositId: string,
): Promise<string | undefined> => {
  const data = await cirrus.get(
    `/${EXTERNAL_ASSET_BRIDGE_URL}-deposits`,
    {
      params: {
        address: `eq.${externalAssetBridgeAddress}`,
        key: `eq.${externalChainId}`,
        key2: `eq.${toCirrusAddress(depositRouter)}`,
        key3: `eq.${depositId}`,
        select: "value->>status",
        limit: 1,
      },
    },
  );
  if (data?.[0]?.status == null) return undefined;
  const status = String(data[0].status);
  return /^(?:0x)?0+$/.test(status) ? "0" : status;
};

export const getDepositReviewApproval = async (
  externalChainId: number | string,
  depositRouter: string,
  depositId: string,
): Promise<string | undefined> => {
  const data = await cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-depositReviewApprovals`, {
    params: { address: `eq.${externalAssetBridgeAddress}`, key: `eq.${externalChainId}`,
      key2: `eq.${toCirrusAddress(depositRouter)}`, key3: `eq.${depositId}`, select: "value", limit: 1 },
  });
  const approval = data?.[0]?.value;
  return typeof approval === "string" && /^(0x)?[0-9a-f]{64}$/i.test(approval)
    ? `0x${approval.replace(/^0x/i, "").toLowerCase()}` : undefined;
};

export const getDepositSettlementInfoByIdentity = async (
  externalChainId: number | string,
  depositRouter: string,
  depositId: string,
): Promise<
  | {
      status: string;
      stratoToken: string;
      stratoTokenAmount: string;
    }
  | undefined
> => {
  const data = await cirrus.get(
    `/${EXTERNAL_ASSET_BRIDGE_URL}-deposits`,
    {
      params: {
        address: `eq.${externalAssetBridgeAddress}`,
        key: `eq.${externalChainId}`,
        key2: `eq.${toCirrusAddress(depositRouter)}`,
        key3: `eq.${depositId}`,
        select:
          "value->>status,value->>stratoToken,value->>stratoTokenAmount",
        limit: 1,
      },
    },
  );
  const row = data?.[0];
  if (
    row?.status == null ||
    !row.stratoToken ||
    row.stratoTokenAmount == null
  ) {
    return undefined;
  }
  return {
    status: String(row.status),
    stratoToken: String(row.stratoToken),
    stratoTokenAmount: String(row.stratoTokenAmount),
  };
};

export const getNativeDepositsByStatus = async (
  status: string
): Promise<NativeDepositInfo[]> => {
  if (!nativeBridgeAddress) return [];

  const data = await getPaginatedRows(
    `/${NATIVE_BRIDGE_URL}-deposits?select=*`,
    {
      params: {
        "value->>bridgeStatus": `eq.${status}`,
        address: `eq.${nativeBridgeAddress}`,
        order: "value->>timestamp.asc,key.asc",
      },
    }
  );

  if (!Array.isArray(data) || data.length === 0) return [];

  return data.map(({ value, key: depositId }) => ({
    ...value,
    depositId,
  }));
};

export const getBridgeInfo = async (): Promise<BridgeInfo | null> => {
  const data = await cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}`, {
    params: {
      address: `eq.${externalAssetBridgeAddress}`,
      select:
        "DECIMAL_PLACES,USDST_ADDRESS,WITHDRAWAL_ABORT_DELAY,_owner,depositsPaused,tokenFactory,withdrawalCounter,withdrawalsPaused",
    },
  });

  if (!Array.isArray(data) || !data.length) return null;

  const normalize = (v: any): BridgeInfo => ({
    DECIMAL_PLACES: Number(v.DECIMAL_PLACES),
    USDST_ADDRESS: v.USDST_ADDRESS,
    WITHDRAWAL_ABORT_DELAY: Number(v.WITHDRAWAL_ABORT_DELAY),
    _owner: v._owner,
    depositsPaused: !!v.depositsPaused,
    tokenFactory: v.tokenFactory,
    withdrawalCounter: Number(v.withdrawalCounter),
    withdrawalsPaused: !!v.withdrawalsPaused,
  });

  return normalize(data[0]);
};

// Get rebase factors from PriceOracle for given STRATO token addresses.
// Keys are returned in STRATO convention (lowercase, no 0x prefix).
export const getRebaseFactors = async (
  stratoTokenAddresses: string[]
): Promise<Map<string, bigint>> => {
  const normalized = stratoTokenAddresses.map(a => a.toLowerCase().replace(/^0x/, ""));
  if (!normalized.length || !oracleAddress) return new Map();

  const data = await getRowsByIds(`/${ORACLE_URL}-rebaseFactors`, normalized, {
    params: {
      address: `eq.${oracleAddress}`,
      select: "key,value::text",
      order: "key.asc",
    },
  }).catch(() => []);

  if (!Array.isArray(data) || !data.length) return new Map();

  const result = new Map<string, bigint>();
  for (const { key, value } of data) {
    const factor = BigInt(value || "0");
    if (factor > 0n) result.set(key, factor);
  }
  return result;
};

export const getRouteRebaseKey = (
  externalToken: string,
  externalChainId: string | number,
  stratoToken: string,
): string =>
  [
    externalToken.toLowerCase().replace(/^0x/, ""),
    String(externalChainId),
    stratoToken.toLowerCase().replace(/^0x/, ""),
  ].join(":");

export const getRebaseRequiredRoutes = async (): Promise<Set<string>> => {
  const data = await cirrus.get(
    `/${EXTERNAL_ASSET_BRIDGE_URL}-routeRebaseRequired`,
    {
      params: {
        address: `eq.${externalAssetBridgeAddress}`,
        value: "eq.true",
        select: "key,key2,key3",
      },
    },
  );
  return new Set(
    (Array.isArray(data) ? data : []).map((row) =>
      getRouteRebaseKey(row.key, row.key2, row.key3),
    ),
  );
};

export const getTokenRouterWiring = async (): Promise<{
  bridgeTokenRouter?: string;
  initialized: boolean;
}> => {
  const bridgeRows = await cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}`, {
    params: {
      address: `eq.${externalAssetBridgeAddress}`,
      select: "tokenRouter",
      limit: 1,
    },
  });
  const bridgeTokenRouter = bridgeRows?.[0]?.tokenRouter;
  if (!bridgeTokenRouter) {
    return { initialized: false };
  }
  const routerRows = await cirrus.get("/BlockApps-TokenRouter", {
    params: {
      address: `eq.${bridgeTokenRouter}`,
      select: "initialized",
      limit: 1,
    },
  });
  return {
    bridgeTokenRouter,
    initialized:
      routerRows?.[0]?.initialized === true ||
      String(routerRows?.[0]?.initialized) === "true",
  };
};

export const getSettlementVerifierConfig = async (): Promise<{
  threshold: number;
  count: number;
  verifiers: string[];
}> => {
  const [rows, verifierRows] = await Promise.all([
    cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}`, {
      params: {
        address: `eq.${externalAssetBridgeAddress}`,
        select: "settlementVerifierThreshold,settlementVerifierCount",
        limit: 1,
      },
    }),
    cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-settlementVerifiers`, {
      params: {
        address: `eq.${externalAssetBridgeAddress}`,
        value: "eq.true",
        select: "key",
      },
    }),
  ]);
  return {
    threshold: Number(rows?.[0]?.settlementVerifierThreshold || 0),
    count: Number(rows?.[0]?.settlementVerifierCount || 0),
    verifiers: (verifierRows || []).map((row: any) =>
      String(row.key).toLowerCase().replace(/^0x/, ""),
    ),
  };
};

export const getNativeSettlementVerifierConfig = async (): Promise<{
  threshold: number;
  count: number;
  verifiers: string[];
}> => {
  const [rows, verifierRows] = await Promise.all([
    cirrus.get(`/${NATIVE_BRIDGE_URL}`, {
      params: {
        address: `eq.${nativeBridgeAddress}`,
        select: "settlementVerifierThreshold,settlementVerifierCount",
        limit: 1,
      },
    }),
    cirrus.get(`/${NATIVE_BRIDGE_URL}-settlementVerifiers`, {
      params: {
        address: `eq.${nativeBridgeAddress}`,
        value: "eq.true",
        select: "key",
      },
    }),
  ]);
  return {
    threshold: Number(rows?.[0]?.settlementVerifierThreshold || 0),
    count: Number(rows?.[0]?.settlementVerifierCount || 0),
    verifiers: (verifierRows || []).map((row: any) =>
      String(row.key).toLowerCase().replace(/^0x/, ""),
    ),
  };
};

export const getExternalBridgeRebaseFactors = async (
  stratoTokenAddresses: string[],
): Promise<Map<string, bigint>> => {
  const normalized = stratoTokenAddresses.map((address) =>
    address.toLowerCase().replace(/^0x/, ""),
  );
  if (!normalized.length) return new Map();
  const bridgeRows = await cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}`, {
    params: {
      address: `eq.${externalAssetBridgeAddress}`,
      select: "priceOracle",
      limit: 1,
    },
  });
  const bridgeOracle = bridgeRows?.[0]?.priceOracle
    ?.toLowerCase()
    .replace(/^0x/, "");
  if (!bridgeOracle || /^0+$/.test(bridgeOracle)) {
    throw new Error("ExternalAssetBridge price oracle is not configured");
  }
  const data = await getRowsByIds(`/${ORACLE_URL}-rebaseFactors`, normalized, {
    params: {
      address: `eq.${bridgeOracle}`,
      select: "key,value::text",
      order: "key.asc",
    },
  });
  const result = new Map<string, bigint>();
  for (const { key, value } of Array.isArray(data) ? data : []) {
    const factor = BigInt(value || "0");
    if (factor > 0n) result.set(key, factor);
  }
  return result;
};

export const getRecordedDepositReviews = async (
  externalChainId: number,
  identity?: { depositRouter: string; depositId: string },
  status: "2" | "0" | "8" = "2",
): Promise<RecordedDepositReview[]> => {
  const result: RecordedDepositReview[] = [];
  const deposits = await getPaginatedRows(`/${EXTERNAL_ASSET_BRIDGE_URL}-deposits`, {
    params: {
      address: `eq.${externalAssetBridgeAddress}`,
      key: `eq.${externalChainId}`,
      ...(identity ? { key2: `eq.${toCirrusAddress(identity.depositRouter)}`, key3: `eq.${identity.depositId}` } : {}),
      "value->>status": status === "0" ? `in.(0,${"0".repeat(40)})` : `eq.${status}`,
      ...(status === "0" ? { "value->>requestedAt": "gt.0" } : {}),
      select: "key2,key3,value",
      order: "key2.asc,key3.asc",
    },
  });
  for (let offset = 0; offset < deposits.length; offset += CIRRUS_FILTER_BATCH_SIZE) {
    const rows = deposits.slice(offset, offset + CIRRUS_FILTER_BATCH_SIZE);
    const intents = await getPaginatedRows(`/${EXTERNAL_ASSET_BRIDGE_URL}-depositActions`, {
      params: {
        address: `eq.${externalAssetBridgeAddress}`, key: `eq.${externalChainId}`,
        or: `(${rows.map((row) => `and(key2.eq.${row.key2},key3.eq.${row.key3})`).join(",")})`,
        select: "key2,key3,value", order: "key2.asc,key3.asc",
      },
    });
    const actions = new Map(intents.map((row) => [`${row.key2}:${row.key3}`, row.value]));
    for (const row of rows) {
      const action = actions.get(`${row.key2}:${row.key3}`);
      result.push({
        externalChainId, depositRouter: row.key2, depositId: String(row.key3),
        externalTxHash: row.value.externalTxHash, externalSender: row.value.externalSender,
        externalToken: row.value.externalToken, externalTokenAmount: String(row.value.externalTokenAmount),
        stratoRecipient: row.value.stratoRecipient, targetStratoToken: row.value.stratoToken,
        action: String(action?.action || "0"),
        actionToken: action?.actionToken || "0000000000000000000000000000000000000000",
        minFinalOut: String(action?.minFinalOut || "0"),
      });
    }
  }
  return result;
};

export const getDepositReviewApprovals = async (externalChainId: number): Promise<Set<string>> => {
  const [rows, pending] = await Promise.all([
    getPaginatedRows(`/${EXTERNAL_ASSET_BRIDGE_URL}-depositReviewApprovals`, {
      params: { address: `eq.${externalAssetBridgeAddress}`, key: `eq.${externalChainId}`,
        select: "key2,key3,value", order: "key2.asc,key3.asc" },
    }),
    getPaginatedRows(`/${EXTERNAL_ASSET_BRIDGE_URL}-deposits`, {
      params: { address: `eq.${externalAssetBridgeAddress}`, key: `eq.${externalChainId}`,
        "value->>status": "eq.2", select: "key2,key3", order: "key2.asc,key3.asc" },
    }),
  ]);
  const identity = (row: any) => `${toCirrusAddress(row.key2)}:${row.key3}`;
  const pendingIds = new Set(pending.map(identity));
  return new Set(rows.filter(row => pendingIds.has(identity(row)) && typeof row.value === "string" &&
    /^(0x)?[0-9a-f]{64}$/i.test(row.value) && !/^(0x)?0+$/i.test(row.value))
    .map(identity));
};

export const getIndexedDepositSettlements = async (
  externalChainId: number,
  deposits: Pick<DepositArgs, "depositRouter" | "depositId">[],
): Promise<Pick<DepositArgs, "depositRouter" | "depositId">[]> => {
  const result: Pick<DepositArgs, "depositRouter" | "depositId">[] = [];
  for (let offset = 0; offset < deposits.length; offset += CIRRUS_FILTER_BATCH_SIZE) {
    const batch = deposits.slice(offset, offset + CIRRUS_FILTER_BATCH_SIZE);
    const rows = await getPaginatedRows(`/${EXTERNAL_ASSET_BRIDGE_URL}-deposits`, { params: {
      address: `eq.${externalAssetBridgeAddress}`, key: `eq.${externalChainId}`,
      "value->>status": "eq.4", select: "key2,key3", order: "key2.asc,key3.asc",
      or: `(${batch.map(({ depositRouter, depositId }) => `and(key2.eq.${toCirrusAddress(depositRouter)},key3.eq.${depositId})`).join(",")})`,
    } });
    result.push(...rows.map((row: any) => ({ depositRouter: row.key2, depositId: String(row.key3) })));
  }
  return result;
};

export const getDepositRefundVault = async (chainId: number, router: string, depositId: string): Promise<string> => {
  const rows = await cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-depositRefundVaults`, { params: {
    address: `eq.${externalAssetBridgeAddress}`, key: `eq.${chainId}`, key2: `eq.${toCirrusAddress(router)}`, key3: `eq.${depositId}`, select: "value", limit: 1,
  } });
  const vault = rows?.[0]?.value;
  if (typeof vault !== "string" || !/^(0x)?[a-f0-9]{40}$/i.test(vault) || /^(0x)?0+$/.test(vault)) throw new Error("Deposit refund vault is unavailable");
  return vault;
};

export const getNativeDepositRefundEvidence = async (depositId: string): Promise<string | undefined> => {
  const rows = await cirrus.get(`/${NATIVE_BRIDGE_URL}-depositRefundEvidence`, { params: {
    address: `eq.${nativeBridgeAddress}`, key: `eq.${depositId}`, select: "value", limit: 1,
  } });
  return rows[0]?.value;
};

export const getNativeDepositRefundProposal = async (depositId: string): Promise<string | undefined> => {
  const rows = await cirrus.get(`/${NATIVE_BRIDGE_URL}-depositRefundProposals`, { params: {
    address: `eq.${nativeBridgeAddress}`, key: `eq.${depositId}`, select: "value", limit: 1,
  } });
  return rows[0]?.value;
};

export const getBridgeReviewOutcome = async (item: BridgeReviewItem): Promise<BridgeReviewItem["outcome"]> => {
  if (item.source === "legacy") return undefined;
  const deposit = item.kind === "deposit_review" || item.kind === "deposit_recovery";
  const [, , chainId, router, depositId] = item.id.split(":");
  const external = item.source === "eab";
  const address = external ? externalAssetBridgeAddress : nativeBridgeAddress;
  if (!address) return undefined;
  const rows = await cirrus.get(`/${external ? EXTERNAL_ASSET_BRIDGE_URL : NATIVE_BRIDGE_URL}-${deposit ? "deposits" : "withdrawals"}`, { params: {
    address: `eq.${address}`, select: "value", limit: 1,
    ...(external && deposit ? { key: `eq.${chainId}`, key2: `eq.${toCirrusAddress(router)}`, key3: `eq.${depositId}` }
      : { key: `eq.${item.reference}` }),
  } });
  if (!Array.isArray(rows)) throw new Error("Invalid bridge outcome response");
  const value = rows[0]?.value;
  const status = String(external ? value?.status : value?.bridgeStatus);
  if (deposit && status === "9") return "rejected_no_funds";
  if (status === (external ? "4" : "3")) return "delivered";
  if (deposit && status === (external ? "6" : "8")) return "refunded";
  if (!deposit && (external ? ["6", "7"] : ["4"]).includes(status)) return "refunded";
  return undefined;
};

export const getBridgeReviewRecords = async () => {
  const read = (contract: string, address: string | undefined, table: string, filters: Record<string, string>) =>
    address ? getPaginatedRows(`/${contract}-${table}`, { params: {
      address: `eq.${address}`, select: "key,value", order: "key.asc", ...filters,
    } }) : Promise.resolve([]);
  const [deposits, withdrawals, nativeDeposits, nativeWithdrawals] = await Promise.all([
    read(EXTERNAL_ASSET_BRIDGE_URL, externalAssetBridgeAddress, "deposits", { select: "key,key2,key3,value", order: "key.asc,key2.asc,key3.asc", "value->>status": `in.(0,${"0".repeat(40)},2,7,8)` }),
    read(EXTERNAL_ASSET_BRIDGE_URL, externalAssetBridgeAddress, "withdrawals", { "value->>status": "in.(2,3)" }),
    read(NATIVE_BRIDGE_URL, nativeBridgeAddress, "deposits", { "value->>bridgeStatus": "in.(2,4,7)" }),
    read(NATIVE_BRIDGE_URL, nativeBridgeAddress, "withdrawals", { "value->>bridgeStatus": `in.(2,${ExternalBridgeStatus.CANCELLATION_PENDING})` }),
  ]);
  const [reviews, authorizations, refundProposals, refundEvidence] = await Promise.all([getRowsByIds(`/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawalManualReviews`,
    withdrawals.filter(row => String(row.value.status) === "2").map(row => String(row.key)),
    { params: { address: `eq.${externalAssetBridgeAddress}`, select: "key,value", order: "key.asc" } }),
    getRowsByIds(`/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawalAuthorizations`,
      withdrawals.filter(row => String(row.value.status) === "3").map(row => String(row.key)),
      { params: { address: `eq.${externalAssetBridgeAddress}`, select: "key,value", order: "key.asc" } }),
    getRowsByIds(`/${NATIVE_BRIDGE_URL}-depositRefundProposals`, nativeDeposits.filter(row => Number(row.value.bridgeStatus) === 7).map(row => String(row.key)),
      { params: { address: `eq.${nativeBridgeAddress}`, select: "key,value", order: "key.asc" } }),
    getRowsByIds(`/${NATIVE_BRIDGE_URL}-depositRefundEvidence`, nativeDeposits.filter(row => Number(row.value.bridgeStatus) === 7).map(row => String(row.key)),
      { params: { address: `eq.${nativeBridgeAddress}`, select: "key,value", order: "key.asc" } }),
  ]);
  const evidence = new Map(refundEvidence.map(row => [String(row.key), row.value]));
  for (const row of nativeDeposits) row.value.refundEvidenceHash = evidence.get(String(row.key));
  const proposals = new Map(refundProposals.map(row => [String(row.key), row.value]));
  for (const row of nativeDeposits) row.value.refundProposalHash = proposals.get(String(row.key));
  return { deposits, withdrawals, reviews, authorizations, nativeDeposits, nativeWithdrawals, legacyDeposits: [], legacyWithdrawals: [] };
};

export const getWithdrawalRefundEvidence = async (withdrawalId: string) => {
  const params = { address: `eq.${externalAssetBridgeAddress}`, key: `eq.${withdrawalId}`, select: "value", limit: 1 };
  const [withdrawals, authorizations, bridges] = await Promise.all([
    cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawals`, { params }),
    cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawalAuthorizations`, { params }),
    cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}`, { params: { address: params.address, select: "settlementVerifierSetVersion", limit: 1 } }),
  ]);
  return { withdrawal: withdrawals?.[0]?.value, authorization: authorizations?.[0]?.value, verifierVersion: bridges?.[0]?.settlementVerifierSetVersion };
};

export const getSettlementAttestationCount = async (digest: string): Promise<number> => {
  const rows = await cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-settlementAttestationCounts`, { params: {
    address: `eq.${externalAssetBridgeAddress}`, or: `(key.eq.${digest},key.eq.${digest.replace(/^0x/i, "")})`, select: "value", limit: 1,
  } });
  const count = Number(rows?.[0]?.value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid indexed settlement attestation count");
  return count;
};

// Diagnostics only: indexed values are not an authorization or a promise of capacity.
export const getMintPolicyDiagnostics = async (token: string): Promise<Record<string, string>> => {
  const rows = await cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-mintPolicies`, { params: {
    address: `eq.${externalAssetBridgeAddress}`, key: `eq.${toCirrusAddress(token)}`, select: "value", limit: 1,
  } });
  const p = rows?.[0]?.value;
  if (!p || ![p.capacity, p.consumed, p.refillRate, p.lastRefillAt].every(v => /^\d+$/.test(String(v)))) return {};
  const capacity = BigInt(p.capacity), consumed = BigInt(p.consumed);
  return { token, capacity: capacity.toString(), available: (capacity > consumed ? capacity - consumed : 0n).toString(),
    refillRate: String(p.refillRate), observedAt: String(p.lastRefillAt), units: "indexed-strato-token-base-units" };
};

export const getCompletedProcessingContexts = async (contexts: ProcessingContext[]) => {
  const completed: ProcessingContext[] = [];
  const groups = new Map<string, ProcessingContext[]>();
  for (const context of contexts) {
    if (!/^(0x)?[a-f0-9]{40}$/i.test(context.bridge) || !/^\d+$/.test(context.chainId)) continue;
    const key = `${context.source}:${context.bridge}:${context.chainId}:${context.stage.startsWith("deposit") ? "deposits" : "withdrawals"}`;
    groups.set(key, [...(groups.get(key) || []), context]);
  }
  for (const group of groups.values()) {
    const first = group[0], isDeposit = first.stage.startsWith("deposit");
    const contract = first.source === "eab" ? EXTERNAL_ASSET_BRIDGE_URL : NATIVE_BRIDGE_URL;
    const statusField = first.source === "eab" ? "status" : "bridgeStatus";
    const terminal = first.source === "eab" ? isDeposit ? ["4", "6", "9"] : ["4", "6", "7"] : isDeposit ? ["3", "8", "9"] : ["3", "4", "5"];
    for (let offset = 0; offset < group.length; offset += CIRRUS_FILTER_BATCH_SIZE) {
      const batch = group.slice(offset, offset + CIRRUS_FILTER_BATCH_SIZE);
      const filters = batch.flatMap(c => {
        if (isDeposit && c.source === "eab") {
          const [router, id] = (c.reference.startsWith(`${c.chainId}:`) ? c.reference.slice(c.chainId.length + 1) : c.reference).split(":");
          return /^[a-f0-9]{40}$/i.test(router) && /^\d+$/.test(id) ? [`and(key.eq.${c.chainId},key2.eq.${router},key3.eq.${id})`] : [];
        }
        return /^(0x)?[a-f0-9]+$/i.test(c.reference) ? [`key.eq.${c.reference}`] : [];
      });
      if (!filters.length) continue;
      const rows = await getPaginatedRows(`/${contract}-${isDeposit ? "deposits" : "withdrawals"}`, { params: {
        address: `eq.${toCirrusAddress(first.bridge)}`, select: isDeposit && first.source === "eab" ? "key,key2,key3,value" : "key,value",
        order: isDeposit && first.source === "eab" ? "key.asc,key2.asc,key3.asc" : "key.asc",
        [`value->>${statusField}`]: `in.(${terminal.join(",")})`, or: `(${filters.join(",")})`,
      } });
      for (const c of batch) {
        if (rows.some(row => terminal.includes(String(row.value?.[statusField])) &&
          (isDeposit && c.source === "eab" ? `${toCirrusAddress(row.key2)}:${row.key3}` === (c.reference.startsWith(`${c.chainId}:`) ? c.reference.slice(c.chainId.length + 1) : c.reference) && String(row.key) === c.chainId : String(row.key) === c.reference))) completed.push(c);
      }
    }
  }
  return completed;
};


export const getRecordedNativeRedemptions = async (chainId: number, bridge: string, ids: string[]): Promise<NativeDepositInfo[]> => {
  const rows: Array<{ value: NativeDepositInfo }> = [];
  for (let offset = 0; offset < ids.length; offset += CIRRUS_FILTER_BATCH_SIZE) {
    rows.push(...await getPaginatedRows(`/${NATIVE_BRIDGE_URL}-deposits`, { params: {
      address: `eq.${toCirrusAddress(nativeBridgeAddress)}`, select: "value", order: "key.asc",
      "value->>externalChainId": `eq.${chainId}`, "value->>externalBridge": `eq.${toCirrusAddress(bridge)}`,
      "value->>externalRedemptionId": `in.(${ids.slice(offset, offset + CIRRUS_FILTER_BATCH_SIZE).join(",")})`,
    } }));
  }
  return rows.map(row => row.value);
};
