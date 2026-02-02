import { cirrus } from "../utils/api";
import { config } from "../config";
import {
  ChainInfo,
  WithdrawalInfo,
  NonEmptyArray,
  DepositInfo,
  AssetInfo,
  BridgeInfo,
} from "../types";

const { bridge } = config;
const { address: bridgeAddress } = bridge;
const MERCATA_URL = "BlockApps-MercataBridge";

// Get all enabled chains from the bridge contract
export const getEnabledChains = async (): Promise<Map<number, ChainInfo>> => {
  const data = await cirrus.get(`/${MERCATA_URL}-chains`, {
    params: {
      "value->>enabled": "eq.true",
      address: `eq.${bridgeAddress}`,
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
  const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
    params: {
      key: `in.(${externalTokenAddress.join(",")})`,
      ...(externalChainId ? { key2: `eq.${externalChainId}` } : {}),
      "value->>enabled": "eq.true",
      address: `eq.${bridgeAddress}`,
      select: "key,key2,value",
    },
  });

  if (!Array.isArray(data) || !data.length) return new Map();

  const normalize = (v: any): AssetInfo => ({
    enabled: !!v.enabled,
    stratoToken: v.stratoToken,
    externalName: v.externalName,
    externalToken: v.externalToken,
    externalSymbol: v.externalSymbol,
    externalChainId: Number(v.externalChainId),
    externalDecimals: Number(v.externalDecimals),
    maxPerWithdrawal: Number(v.maxPerWithdrawal),
  });

  return new Map(
    data.map(({ key, key2, value }) => [`${key}:${key2}`, normalize(value)])
  );
};

// Get withdrawals by status (reusable function)
export const getWithdrawalsByStatus = async (
  status: string
): Promise<WithdrawalInfo[]> => {
  const data = await cirrus.get(
    `/${MERCATA_URL}-withdrawals?select=*,bridge:${MERCATA_URL}!inner(withdrawalsPaused)`,
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

// Get deposits by status (reusable function)
export const getDepositsByStatus = async (
  status: string
): Promise<DepositInfo[]> => {
  const data = await cirrus.get(
    `/${MERCATA_URL}-deposits?select=*,bridge:${MERCATA_URL}!inner(depositsPaused)`,
    {
      params: {
        "value->>bridgeStatus": `eq.${status}`,
        address: `eq.${bridgeAddress}`,
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
      const asset = assetMapping.get(`${externalToken}:${externalChainId}`);

      if (!asset || !asset?.externalDecimals)
        throw new Error(
          `Asset info not found for external token ${externalToken} on chain ${externalChainId}`
        );

      const chainInfo = enabledChains.get(Number(externalChainId));
      if (!chainInfo || !chainInfo?.depositRouter)
        throw new Error(`Chain info not found for chain ${externalChainId}`);

      return {
        ...v,
        externalChainId,
        externalTxHash,
        externalDecimals: asset.externalDecimals,
        depositRouter: chainInfo.depositRouter,
      };
    }
  );
};

export const getBridgeInfo = async (): Promise<BridgeInfo | null> => {
  const data = await cirrus.get(`/${MERCATA_URL}`, {
    params: {
      address: `eq.${bridgeAddress}`,
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

// Get safeTxHash from WithdrawalPending events for multiple withdrawal IDs
export const getSafeTxHashFromEvents = async (
  withdrawalIds: string[]
): Promise<Record<string, string | null>> => {
  const ids = [...new Set(withdrawalIds)];
  const result = Object.fromEntries(ids.map((id) => [id, null])) as Record<
    string,
    string | null
  >;

  const data = await cirrus.get(`/${MERCATA_URL}-WithdrawalPending`, {
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
