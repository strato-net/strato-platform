import { logError } from "../utils/logger";

// Constants
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
];

export const DEPOSIT_EVENT_SIGNATURE = '0x8f678ca000000000000000000000000000000000000000000000000000000000';

const config = {
  auth: {
    baUsername: process.env.BA_USERNAME,
    baPassword: process.env.BA_PASSWORD,
    clientSecret: process.env.CLIENT_SECRET,
    clientId: process.env.CLIENT_ID,
    openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL,
  },
  bridge: {
    address: process.env.BRIDGE_ADDRESS,
  },
  safe: {
    address: process.env.SAFE_ADDRESS,
    safeOwnerAddress: process.env.SAFE_OWNER_ADDRESS,
    safeOwnerPrivateKey: process.env.SAFE_OWNER_PRIVATE_KEY,
  },
  voucher: {
    contractAddress: process.env.VOUCHER_CONTRACT_ADDRESS || "000000000000000000000000000000000000100e",
  },
  polling: {
    bridgeInInterval: 5 * 60 * 1000,    // 5 minutes (was 100 seconds)
    bridgeOutInterval: 5 * 60 * 1000,   // 5 minutes (was 3 minutes)
    withdrawalInterval: 2 * 60 * 1000,  // 2 minutes (was 10 seconds)
    ethereumDepositInterval: 5 * 60 * 1000, // 5 minutes (was 2 minutes)
  },
  strato: {
    gas: {
      limit: 32_100_000_000,
      price: 1,
    },
    polling: {
      defaultTimeout: 60_000,
      defaultInterval: 5_000,
    },
    tx: {
      type: "FUNCTION" as const,
    },
  },
  api: {
    nodeUrl: process.env.NODE_URL,
    errorCodes: {
      ECONNREFUSED: 'Connection refused',
      ENOTFOUND: 'DNS lookup failed',
      ETIMEDOUT: 'Request timeout',
    },
    defaults: {
      timeout: 60_000,
      maxAttempts: 2,
    },
  },
};

export { config };

export const getChainRpcUrl = (chainId: number | bigint): string => {
  const chainIdStr = chainId.toString();
  const rpcUrl = process.env[`CHAIN_${chainIdStr}_RPC_URL`];
  
  if (!rpcUrl) {
    throw new Error(`CHAIN_${chainIdStr}_RPC_URL environment variable is not configured`);
  }
  
  return rpcUrl;
};

// Validate required environment variables
const requiredEnvVars = [
  'BA_USERNAME', 'BA_PASSWORD', 'CLIENT_SECRET', 'CLIENT_ID', 'OPENID_DISCOVERY_URL',
  'BRIDGE_ADDRESS', 'SAFE_ADDRESS', 'SAFE_OWNER_ADDRESS', 'SAFE_OWNER_PRIVATE_KEY'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  const error = `Missing required environment variables: ${missingEnvVars.join(', ')}`;
  logError('Config', error, { missingEnvVars });
  throw new Error(error);
}
