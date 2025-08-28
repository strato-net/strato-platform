import { cirrus } from "../utils/api";
import { config } from "../config";

const MERCATA_URL = "BlockApps-Mercata-MercataBridge";

// Get all enabled chains from the bridge contract
export const getEnabledChains = async (): Promise<any[]> => {
  const data = await cirrus.get(`/${MERCATA_URL}-chains`, {
    params: {
      "value->>enabled": "eq.true",
      address: `eq.${config.bridge.address}`,
    },
  });

  if (Array.isArray(data) && data.length > 0) {
    return data.map((item) => ({
      ...item.value,
      chainId: item.key,
    }));
  }
  return [];
};

// Get all enabled assets from the bridge contract
export const getEnabledAssets = async (): Promise<any[]> => {
  const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
    params: {
      "value->>enabled": "eq.true",
      address: `eq.${config.bridge.address}`,
    },
  });

  if (Array.isArray(data) && data.length > 0) {
    return data.map((item) => ({
      ...item.value,
      stratoToken: item.key,
    }));
  }
  return [];
};

// Get asset info by STRATO token address(es)
export const getAssetInfo = async (
  stratoTokenAddress: string | string[],
): Promise<any | null | any[]> => {
  const isArray = Array.isArray(stratoTokenAddress);
  const key = isArray ? `in.(${stratoTokenAddress.join(",")})` : `eq.${stratoTokenAddress}`;
  
  const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
    params: {
      key,
      "value->>enabled": "eq.true",
      address: `eq.${config.bridge.address}`,
    },
  });

  if (!Array.isArray(data) || data.length === 0) {
    return isArray ? [] : null;
  }

  return isArray 
    ? data.map(item => ({ ...item.value, stratoToken: item.key }))
    : data[0].value ? { ...data[0].value, stratoToken: data[0].key } : null;
};

// Get withdrawals by status (reusable function)
export const getWithdrawalsByStatus = async (
  status: string,
): Promise<any[]> => {
  const data = await cirrus.get(`/${MERCATA_URL}-withdrawals`, {
    params: {
      "value->>bridgeStatus": `eq.${status}`,
      address: `eq.${config.bridge.address}`,
      order: "value->>requestedAt.asc",
    },
  });

  if (Array.isArray(data) && data.length > 0) {
    return data.map((item) => ({
      ...item.value,
      id: item.key,
      withdrawalId: item.key,
    }));
  }
  return [];
};

// Get deposits by status (reusable function)
export const getDepositsByStatus = async (status: string): Promise<any[]> => {
  const data = await cirrus.get(`/${MERCATA_URL}-deposits`, {
    params: {
      "value->>bridgeStatus": `eq.${status}`,
      address: `eq.${config.bridge.address}`,
      order: "value->>requestedAt.asc",
    },
  });

  if (!Array.isArray(data) || data.length === 0) return [];

  const tokenAddresses = [...new Set(data.map(item => item.value?.token).filter(Boolean))];
  const [assetInfos, enabledChains] = await Promise.all([
    getAssetInfo(tokenAddresses) as Promise<any[]>,
    getEnabledChains(),
  ]);
  const assetMapping = new Map(assetInfos.map(asset => [asset.stratoToken, asset]));
  const chainMapping = new Map(enabledChains.map(chain => [chain.chainId, chain]));

  return data.map(({ value: v, key: srcChainId, key2: srcTxHash }) => {
    const token = v?.token;
    const asset = assetMapping.get(token);
    if (!asset) throw new Error(`Asset info not found for token ${token}`);
  
    const chainInfo = chainMapping.get(Number(asset.chainId));
    if (!chainInfo) throw new Error(`Chain info not found for chain ${asset.chainId}`);
  
    return {
      ...v,
      srcChainId,
      srcTxHash,
      id: srcChainId,
      depositId: srcChainId,
      extToken: asset.extToken,
      extDecimals: asset.extDecimals,
      chainId: asset.chainId,
      enabled: asset.enabled,
      depositRouter: chainInfo.depositRouter,
    };
  });
};

// Validate if a token is enabled in the bridge
export const isTokenEnabled = async (
  tokenAddress: string,
): Promise<boolean> => {
  const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
    params: {
      "value->>stratoToken": `eq.${tokenAddress}`,
      "value->>enabled": "eq.true",
      address: `eq.${config.bridge.address}`,
    },
  });

  return Array.isArray(data) && data.length > 0;
};

// Get safeTxHash from WithdrawalPending events for multiple withdrawal IDs
export const getSafeTxHashFromEvents = async (
  withdrawalIds: string[],
): Promise<Record<string, string | null>> => {
  const ids = [...new Set(withdrawalIds)];
  const result = Object.fromEntries(ids.map((id) => [id, null])) as Record<
    string,
    string | null
  >;

  const data = await cirrus.get(`/${MERCATA_URL}-WithdrawalPending`, {
    params: {
      address: `eq.${config.bridge.address}`,
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
