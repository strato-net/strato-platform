import { cirrus } from "../utils/api";
import { config } from "../config";

const MERCATA_URL = "BlockApps-Mercata-MercataBridge";

// Get the last processed block number for a specific chain
export const getLastProcessedBlock = async (chainId: number): Promise<number> => {
  const data = await cirrus.get(`/${MERCATA_URL}-chains`, {
    params: {
      key: `eq.${chainId}`,
      address: `eq.${config.bridge.address}`
    }
  });
  
  if (Array.isArray(data) && data.length > 0) {
    return parseInt(data[0].value?.lastProcessedBlock) || 0;
  }
  return 0;
};

// Get all enabled chains from the bridge contract
export const getEnabledChains = async (): Promise<any[]> => {
  const data = await cirrus.get(`/${MERCATA_URL}-chains`, {
    params: {
      "value->>enabled": "eq.true",
      address: `eq.${config.bridge.address}`
    }
  });
  
  if (Array.isArray(data) && data.length > 0) {
    const chains = data.map(item => ({
      ...item.value,
      chainId: item.key
    }));
    return chains;
  }
  return [];
};

// Get all enabled assets from the bridge contract
export const getEnabledAssets = async (): Promise<any[]> => {
  const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
    params: {
      "value->>enabled": "eq.true",
      address: `eq.${config.bridge.address}`
    }
  });
  
  if (Array.isArray(data) && data.length > 0) {
    return data.map(item => ({
      ...item.value,
      stratoToken: item.key
    }));
  }
  return [];
};

// Get asset info by STRATO token address
export const getAssetInfo = async (stratoTokenAddress: string): Promise<any | null> => {
  const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
    params: {
      "key": `eq.${stratoTokenAddress}`,
      "value->>enabled": "eq.true",
      address: `eq.${config.bridge.address}`
    }
  });
  
  if (Array.isArray(data) && data.length > 0) {
    return data[0].value || null;
  }
  return null;
};

// Get withdrawals by status (reusable function)
export const getWithdrawalsByStatus = async (status: string): Promise<any[]> => {
  const data = await cirrus.get(`/${MERCATA_URL}-withdrawals`, {
    params: {
      "value->>bridgeStatus": `eq.${status}`,
      address: `eq.${config.bridge.address}`,
      order: "value->>requestedAt.asc"
    }
  });
  
  if (Array.isArray(data) && data.length > 0) {
    return data.map(item => ({
      ...item.value,
      id: item.key,
      withdrawalId: item.key
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
      order: "value->>requestedAt.asc"
    }
  });
  
  if (Array.isArray(data) && data.length > 0) {
    return data.map(item => ({
      ...item.value,
      id: item.key,
      depositId: item.key
    }));
  }
  return [];
};

// Validate if a token is enabled in the bridge
export const isTokenEnabled = async (tokenAddress: string): Promise<boolean> => {
  const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
    params: {
      "value->>stratoToken": `eq.${tokenAddress}`,
      "value->>enabled": "eq.true",
      address: `eq.${config.bridge.address}`
    }
  });
  
  return Array.isArray(data) && data.length > 0;
};

// Get safeTxHash from WithdrawalPending events for multiple withdrawal IDs
export const getSafeTxHashFromEvents = async (
  withdrawalIds: string[]
): Promise<Record<string, string | null>> => {
  // normalize & de-duplicate ids
  const ids = [...new Set(withdrawalIds)];

  // prefill result with nulls
  const result = Object.fromEntries(ids.map((id) => [id, null])) as Record<string, string | null>;

  const params: Record<string, string> = {
    event_name: "eq.WithdrawalPending",
    address: `eq.${config.bridge.address}`,
    select: "attributes",
    "attributes->>id": `in.(${ids.join(",")})`,
  };

  const data = await cirrus.get("/event", { params });

  for (const event of (Array.isArray(data) ? data : [])) {
    const id = event?.attributes?.id;
    const custodyTxHash = event?.attributes?.custodyTxHash;
    if (id && custodyTxHash && id in result) result[id] = custodyTxHash;
  }

  return result;
};
