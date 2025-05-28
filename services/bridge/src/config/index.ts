import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

export interface BridgeConfig {
  readonly address: string | undefined;
  readonly ethereumRpcUrl: string | undefined;
  readonly mintAndTransfer: "mintETHST";
  readonly tokenAddress: string | undefined;
}

export const config = {
  auth: {
    baUsername: process.env.BA_USERNAME,
    baPassword: process.env.BA_PASSWORD,
    clientSecret: process.env.CLIENT_SECRET,
    clientId: process.env.CLIENT_ID,
    openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL,
  },
  alchemy: {
    apiKey: process.env.ALCHEMY_API_KEY,
    network: process.env.ALCHEMY_NETWORK || 'ETH_MAINNET',
  },
  bridge: {
    address: process.env.BRIDGE_ADDRESS,
    mintAndTransfer: "mintETHST",
    tokenAddress: process.env.BRIDGE_TOKEN_ADDRESS,
  },
  ethereum: {
    rpcUrl: process.env.ETHEREUM_RPC_URL,
  },
  safe: {
    address: process.env.SAFE_ADDRESS,
    safeOwnerAddress: process.env.SAFE_OWNER_ADDRESS,
    safeOwnerPrivateKey: process.env.SAFE_OWNER_PRIVATE_KEY,
  },
} as const;

// Validate required environment variables
const requiredEnvVars = [
  'BA_USERNAME',
  'BA_PASSWORD',
  'CLIENT_SECRET',
  'CLIENT_ID',
  'OPENID_DISCOVERY_URL',
  'ALCHEMY_API_KEY',
  'BRIDGE_ADDRESS',
];

const missingEnvVars = requiredEnvVars.filter(
  (envVar) => !process.env[envVar]
);

if (missingEnvVars.length > 0) {
  const error = `Missing required environment variables: ${missingEnvVars.join(
    ', '
  )}`;
  logger.error(error);
  throw new Error(error);
} 