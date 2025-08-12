import { cirrus } from "../utils/mercataApiHelper";
import { config } from "../config";

const MERCATA_URL = "BlockApps-Mercata-MercataBridge";

// Get the last processed block number for a specific chain
export const getLastProcessedBlock = async (chainId: number): Promise<number> => {
  try {
    const data = await cirrus.get(`/${MERCATA_URL}`, {
      params: {
        select: `chains:${MERCATA_URL}-chains(chainId,lastProcessedBlock)`,
        "chains.chainId": `eq.${chainId}`,
        address: `eq.${config.bridge.address}`
      }
    });
    
    if (Array.isArray(data) && data.length > 0 && data[0].chains) {
      return parseInt(data[0].chains.lastProcessedBlock) || 0;
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
    const data = await cirrus.get(`/${MERCATA_URL}`, {
      params: {
        select: `chains:${MERCATA_URL}-chains(*)`,
        "chains.enabled": "eq.true",
        address: `eq.${config.bridge.address}`
      }
    });
    
    if (Array.isArray(data) && data.length > 0 && data[0].chains) {
      return Array.isArray(data[0].chains) ? data[0].chains : [data[0].chains];
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
    const data = await cirrus.get(`/${MERCATA_URL}`, {
      params: {
        select: `assets:${MERCATA_URL}-assets(*)`,
        "assets.enabled": "eq.true",
        address: `eq.${config.bridge.address}`
      }
    });
    
    if (Array.isArray(data) && data.length > 0 && data[0].assets) {
      return Array.isArray(data[0].assets) ? data[0].assets : [data[0].assets];
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
    const data = await cirrus.get(`/${MERCATA_URL}`, {
      params: {
        select: `assets:${MERCATA_URL}-assets(*)`,
        "assets.stratoToken": `eq.${stratoTokenAddress}`,
        "assets.enabled": "eq.true",
        address: `eq.${config.bridge.address}`
      }
    });
    
    if (Array.isArray(data) && data.length > 0 && data[0].assets) {
      const assets = Array.isArray(data[0].assets) ? data[0].assets : [data[0].assets];
      return assets.length > 0 ? assets[0] : null;
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
        bridgeStatus: `eq.${status}`,
        address: `eq.${config.bridge.address}`,
        order: "requestedAt.asc"
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
    const data = await cirrus.get(`/${MERCATA_URL}`, {
      params: {
        select: `assets:${MERCATA_URL}-assets(*)`,
        "assets.stratoToken": `eq.${tokenAddress}`,
        "assets.enabled": "eq.true",
        address: `eq.${config.bridge.address}`
      }
    });
    
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.error('❌ Failed to validate token:', error);
    return false;
  }
};
