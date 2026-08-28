import { cirrus } from "../utils/api";
import { config } from "../config";
import {
  ChainInfo,
  WithdrawalInfo,
  NativeWithdrawalInfo,
  NonEmptyArray,
  DepositInfo,
  NativeDepositInfo,
  AssetInfo,
  BridgeInfo,
} from "../types";

const { bridge, externalAssetBridge, nativeBridge, oracle } = config;
const toCirrusAddress = (address?: string) =>
  address ? address.toLowerCase().replace(/^0x/, "") : undefined;

const bridgeAddress = toCirrusAddress(bridge.address);
const externalAssetBridgeAddress = toCirrusAddress(externalAssetBridge.address);
const nativeBridgeAddress = toCirrusAddress(nativeBridge.address);
const oracleAddress = toCirrusAddress(oracle.address);
const MERCATA_BRIDGE_URL = "BlockApps-MercataBridge";
const EXTERNAL_ASSET_BRIDGE_URL = "BlockApps-ExternalAssetBridge";
const NATIVE_BRIDGE_URL = "BlockApps-StratoNativeBridge";
const ORACLE_URL = "BlockApps-PriceOracle";

// Get all enabled chains from the bridge contract
export const getEnabledChains = async (): Promise<Map<number, ChainInfo>> => {
  const data = await cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-chains`, {
    params: {
      "value->>enabled": "eq.true",
      address: `eq.${externalAssetBridgeAddress}`,
      select: "key,value",
    },
  });

  if (!Array.isArray(data) || !data.length) return new Map();

  const normalize = (v: any, key: string): ChainInfo => ({
    externalChainId: Number(key),
    depositRouter: v.depositRouter,
    lastProcessedBlock: Number(v.lastProcessedBlock),
    enabled: !!v.enabled,
    custody: v.custody,
    vault: v.vault,
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
  const data = await cirrus.get(`/${EXTERNAL_ASSET_BRIDGE_URL}-routes`, {
    params: {
      key: `in.(${externalTokenAddress.join(",")})`,
      ...(externalChainId ? { key2: `eq.${externalChainId}` } : {}),
      "value->>depositsEnabled": "eq.true",
      address: `eq.${externalAssetBridgeAddress}`,
      select: "key,key2,key3,value",
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

// Get withdrawals by status (reusable function)
export const getWithdrawalsByStatus = async (
  status: string
): Promise<WithdrawalInfo[]> => {
  const data = await cirrus.get(
    `/${MERCATA_BRIDGE_URL}-withdrawals?select=*,bridge:${MERCATA_BRIDGE_URL}!inner(withdrawalsPaused)`,
    {
      params: {
        "value->>bridgeStatus": `eq.${status}`,
        address: `eq.${bridgeAddress}`,
        order: "value->>requestedAt.asc",
        "bridge.withdrawalsPaused": "eq.false",
      },
    }
  );

  if (!Array.isArray(data) || data.length === 0) return [];

  return data.map((item) => ({
    ...item.value,
    withdrawalId: item.key,
  }));
};

export const getExternalWithdrawalsByStatus = async (
  status: string,
): Promise<WithdrawalInfo[]> => {
  const [data, enabledChains] = await Promise.all([
    cirrus.get(
      `/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawals?select=*,bridge:${EXTERNAL_ASSET_BRIDGE_URL}!inner(withdrawalsPaused)`,
      {
        params: {
          "value->>status": `eq.${status}`,
          address: `eq.${externalAssetBridgeAddress}`,
          order: "value->>requestedAt.asc",
          "bridge.withdrawalsPaused": "eq.false",
        },
      },
    ),
    getEnabledChains(),
  ]);

  if (!Array.isArray(data) || data.length === 0) return [];
  const withdrawalIds = data.map((item) => item.key);
  const [authorizationData, reviewData] = await Promise.all([
    cirrus.get(
      `/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawalAuthorizations`,
      {
        params: {
          key: `in.(${withdrawalIds.join(",")})`,
          address: `eq.${externalAssetBridgeAddress}`,
          select: "key,value",
        },
      },
    ),
    cirrus.get(
      `/${EXTERNAL_ASSET_BRIDGE_URL}-withdrawalManualReviews`,
      {
        params: {
          key: `in.(${withdrawalIds.join(",")})`,
          address: `eq.${externalAssetBridgeAddress}`,
          select: "key,value",
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

  return data.map((item) => {
    const externalChainId = Number(item.value.externalChainId);
    const vault = enabledChains.get(externalChainId)?.vault;
    if (!vault) {
      throw new Error(`Vault not found for chain ${externalChainId}`);
    }
    return {
      ...item.value,
      bridgeStatus: item.value.status,
      withdrawalId: item.key,
      vault,
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

  const data = await cirrus.get(
    `/${NATIVE_BRIDGE_URL}-withdrawals?select=*`,
    {
      params: {
        "value->>bridgeStatus": `eq.${status}`,
        address: `eq.${nativeBridgeAddress}`,
        order: "value->>requestedAt.asc",
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
  const data = await cirrus.get(
    `/${EXTERNAL_ASSET_BRIDGE_URL}-deposits?select=*,bridge:${EXTERNAL_ASSET_BRIDGE_URL}!inner(depositsPaused)`,
    {
      params: {
        "value->>status": `eq.${status}`,
        address: `eq.${externalAssetBridgeAddress}`,
        order: "value->>timestamp.asc",
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
    ({ value: v, key: externalChainId, key2: externalTxHash }) => {
      const externalToken = v?.externalToken;
      const asset = assetMapping.get(
        `${externalToken}:${externalChainId}:${v?.stratoToken}`,
      );

      if (!asset || !asset?.externalDecimals)
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
        externalTxHash,
        externalDecimals: asset.externalDecimals,
        depositRouter: chainInfo.depositRouter,
        custodyAddress,
      };
    }
  );
};

export const getNativeDepositsByStatus = async (
  status: string
): Promise<NativeDepositInfo[]> => {
  if (!nativeBridgeAddress) return [];

  const data = await cirrus.get(
    `/${NATIVE_BRIDGE_URL}-deposits?select=*`,
    {
      params: {
        "value->>bridgeStatus": `eq.${status}`,
        address: `eq.${nativeBridgeAddress}`,
        order: "value->>timestamp.asc",
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

  const data = await cirrus.get(`/${ORACLE_URL}-rebaseFactors`, {
    params: {
      key: `in.(${normalized.join(",")})`,
      address: `eq.${oracleAddress}`,
      select: "key,value::text",
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

// Get safeTxHash from WithdrawalPending events for multiple withdrawal IDs
export const getSafeTxHashFromEvents = async (
  withdrawalIds: string[]
): Promise<Record<string, string | null>> => {
  const ids = [...new Set(withdrawalIds)];
  const result = Object.fromEntries(ids.map((id) => [id, null])) as Record<
    string,
    string | null
  >;

  const data = await cirrus.get(`/${MERCATA_BRIDGE_URL}-WithdrawalPending`, {
    params: {
      address: `eq.${bridgeAddress}`,
      withdrawalId: `in.(${ids.join(",")})`,
      select: "withdrawalId,custodyTxHash",
    },
  });

  for (const item of Array.isArray(data) ? data : []) {
    const withdrawalId = item?.withdrawalId;
    const custodyTxHash = item?.custodyTxHash;
    if (withdrawalId && custodyTxHash && withdrawalId in result)
      result[withdrawalId] = custodyTxHash;
  }

  return result;
};
