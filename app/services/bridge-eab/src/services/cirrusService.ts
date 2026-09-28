import { cirrus } from "../utils/api";
import { ensureHexPrefix, normalizeOptionalHash } from "../utils/utils";
import { config, CIRRUS_PAGE_SIZE, CIRRUS_FILTER_BATCH_SIZE } from "../config";
import { logInfo } from "../utils/logger";
import {
  ChainInfo,
  DepositArgs,
  RecordedDepositReview,
  WithdrawalInfo,
  NativeWithdrawalInfo,
  NonEmptyArray,
  DepositInfo,
  NativeDepositInfo,
  AssetInfo,
  BridgeInfo,
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
  options: { params: Record<string, string | number> },
): Promise<any[]> {
  const result: any[] = [];
  for (let offset = 0; ; ) {
    const rows = await cirrus.get(url, {
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
  options: { params: Record<string, string | number> },
  column = "key",
): Promise<any[]> {
  const unique = [...new Set(ids)];
  const result: any[] = [];
  for (let offset = 0; offset < unique.length; offset += CIRRUS_FILTER_BATCH_SIZE) {
    const batch = unique.slice(offset, offset + CIRRUS_FILTER_BATCH_SIZE);
    result.push(...await getPaginatedRows(url, {
      params: { ...options.params, [column]: `in.(${batch.join(",")})` },
    }));
  }
  return result;
}

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
      withdrawalId: item.key,
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
    withdrawalId: item.key,
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
        depositId,
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
  return data?.[0]?.status == null ? undefined : String(data[0].status);
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
): Promise<RecordedDepositReview[]> => {
  const result: RecordedDepositReview[] = [];
  const deposits = await getPaginatedRows(`/${EXTERNAL_ASSET_BRIDGE_URL}-deposits`, {
    params: {
      address: `eq.${externalAssetBridgeAddress}`,
      key: `eq.${externalChainId}`,
      ...(identity ? { key2: `eq.${toCirrusAddress(identity.depositRouter)}`, key3: `eq.${identity.depositId}` } : {}),
      "value->>status": "eq.2",
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
  const rows = await getPaginatedRows(`/${EXTERNAL_ASSET_BRIDGE_URL}-depositReviewApprovals`, {
    params: { address: `eq.${externalAssetBridgeAddress}`, key: `eq.${externalChainId}`,
      select: "key2,key3,value", order: "key2.asc,key3.asc" },
  });
  return new Set(rows.filter(row => typeof row.value === "string" &&
    /^(0x)?[0-9a-f]{64}$/i.test(row.value) && !/^(0x)?0+$/i.test(row.value))
    .map(row => `${toCirrusAddress(row.key2)}:${row.key3}`));
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

export const getBridgeReviewRecords = async () => {
  const read = (contract: string, address: string | undefined, table: string, filters: Record<string, string>) =>
    address ? getPaginatedRows(`/${contract}-${table}`, { params: {
      address: `eq.${address}`, select: "key,value", order: "key.asc", ...filters,
    } }) : Promise.resolve([]);
  const [deposits, withdrawals, nativeDeposits, nativeWithdrawals] = await Promise.all([
    read(EXTERNAL_ASSET_BRIDGE_URL, externalAssetBridgeAddress, "deposits", { select: "key,key2,key3,value", order: "key.asc,key2.asc,key3.asc", "value->>status": "eq.2" }),
    read(EXTERNAL_ASSET_BRIDGE_URL, externalAssetBridgeAddress, "withdrawals", { "value->>status": "in.(2,3)" }),
    read(NATIVE_BRIDGE_URL, nativeBridgeAddress, "deposits", { "value->>bridgeStatus": "eq.2" }),
    read(NATIVE_BRIDGE_URL, nativeBridgeAddress, "withdrawals", { "value->>bridgeStatus": "eq.2", "value->>useInstantPath": "eq.false" }),
  ]);
  const [reviews, authorizations] = await Promise.all([getRowsByIds(`/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawalManualReviews`,
    withdrawals.filter(row => String(row.value.status) === "2").map(row => String(row.key)),
    { params: { address: `eq.${externalAssetBridgeAddress}`, select: "key,value", order: "key.asc" } }),
    getRowsByIds(`/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawalAuthorizations`,
      withdrawals.filter(row => String(row.value.status) === "3").map(row => String(row.key)),
      { params: { address: `eq.${externalAssetBridgeAddress}`, select: "key,value", order: "key.asc" } }),
  ]);
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
