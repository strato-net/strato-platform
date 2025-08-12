import { cirrus } from "../utils/mercataApiHelper";
import { config } from "../config";

const MERCATA_URL = "BlockApps-Mercata-MercataBridge";

// Get the last processed block number for a specific chain
export const getLastProcessedBlock = async (chainId: number): Promise<number> => {
  try {
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
  } catch (error) {
    console.error('❌ Failed to get last processed block:', error);
    return 0;
  }
};

// Get all enabled chains from the bridge contract
export const getEnabledChains = async (): Promise<any[]> => {
  try {
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
  } catch (error) {
    console.error('❌ Failed to get enabled chains:', error);
    return [];
  }
};

// Get all enabled assets from the bridge contract
export const getEnabledAssets = async (): Promise<any[]> => {
  try {
    const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
      params: {
        "value->>enabled": "eq.true",
        address: `eq.${config.bridge.address}`
      }
    });
    
    if (Array.isArray(data) && data.length > 0) {
      return data.map(item => item.value);
    }
    return [];
  } catch (error) {
    console.error('❌ Failed to get enabled assets:', error);
    return [];
  }
};

// Get asset info by STRATO token address
export const getAssetInfo = async (stratoTokenAddress: string): Promise<any | null> => {
  try {
    const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
      params: {
        "value->>stratoToken": `eq.${stratoTokenAddress}`,
        "value->>enabled": "eq.true",
        address: `eq.${config.bridge.address}`
      }
    });
    
    if (Array.isArray(data) && data.length > 0) {
      return data[0].value || null;
    }
    return null;
  } catch (error) {
    console.error('❌ Failed to get asset info:', error);
    return null;
  }
};

// Get withdrawals by status (reusable function)
export const getWithdrawalsByStatus = async (status: string): Promise<any[]> => {
  try {
    const data = await cirrus.get(`/${MERCATA_URL}-withdrawals`, {
      params: {
        "value->>bridgeStatus": `eq.${status}`,
        address: `eq.${config.bridge.address}`,
        order: "value->>requestedAt.asc"
      }
    });
    
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('❌ Failed to get withdrawals by status:', error);
    return [];
  }
};

// Validate if a token is enabled in the bridge
export const isTokenEnabled = async (tokenAddress: string): Promise<boolean> => {
  try {
    const data = await cirrus.get(`/${MERCATA_URL}-assets`, {
      params: {
        "value->>stratoToken": `eq.${tokenAddress}`,
        "value->>enabled": "eq.true",
        address: `eq.${config.bridge.address}`
      }
    });
    
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.error('❌ Failed to validate token:', error);
    return false;
  }
};
