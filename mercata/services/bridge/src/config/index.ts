import dotenv from 'dotenv';
import logger from '../utils/logger';
import fetch from "node-fetch";
import { getEnabledChains } from '../services/cirrusService';

dotenv.config();

/**
 * Bridge Service Configuration
 * 
 * This service provides dynamic configuration for the Mercata Bridge, reading
 * chain and asset information from the Cirrus bridge contract.
 * 
 * Environment Variables Required:
 * 
 * Authentication:
 * - BA_USERNAME: BlockApps username
 * - BA_PASSWORD: BlockApps password  
 * - CLIENT_SECRET: OAuth client secret
 * - CLIENT_ID: OAuth client ID
 * - OPENID_DISCOVERY_URL: OpenID discovery endpoint
 * 
 * Blockchain:
 * - ALCHEMY_API_KEY: Alchemy API key (used for all chains)
 * - BRIDGE_ADDRESS: MercataBridge contract address
 * 
 * Chain RPC URLs (dynamically validated based on enabled chains from Cirrus):
 * - CHAIN_${chainId}_RPC_URL: RPC URL for each enabled chain (required)
 * - Example: CHAIN_11155111_RPC_URL for Sepolia, CHAIN_1_RPC_URL for mainnet
 * - All enabled chains from the bridge contract must have corresponding RPC URLs
 * 
 * Safe Wallet:
 * - SAFE_ADDRESS: Gnosis Safe wallet address
 * - SAFE_OWNER_ADDRESS: Safe owner address
 * - SAFE_OWNER_PRIVATE_KEY: Safe owner private key
 * 
 * Voucher:
 * - VOUCHER_CONTRACT_ADDRESS: Voucher contract address (optional, has default)
 * 
 * Usage:
 * - Chain information is fetched dynamically from Cirrus
 * - RPC URLs are constructed using CHAIN_${chainId}_RPC_URL + ALCHEMY_API_KEY
 * - All bridge operations filter by the specific bridge contract address
 * - Chain RPC URLs are validated at startup based on enabled chains from Cirrus
 */

const createConfig = () => ({
  auth: {
    baUsername: process.env.BA_USERNAME,
    baPassword: process.env.BA_PASSWORD,
    clientSecret: process.env.CLIENT_SECRET,
    clientId: process.env.CLIENT_ID,
    openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL,
  },
  alchemy: {
    apiKey: process.env.ALCHEMY_API_KEY,
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
    bridgeInInterval: 100 * 1000,
    bridgeOutInterval: 3 * 60 * 1000,
    withdrawalInterval: 10 * 1000,
    ethereumDepositInterval: 2 * 60 * 1000,
  },
});

export const config = createConfig();

/**
 * Get RPC URL for a specific chain ID
 * 
 * Constructs the full RPC URL by combining the base URL from environment
 * variables with the Alchemy API key.
 * 
 * @param chainId - The chain ID (number or bigint)
 * @returns The complete RPC URL with API key
 * @throws Error if CHAIN_${chainId}_RPC_URL is not configured
 * 
 * @example
 * // For Sepolia (chain ID 11155111)
 * getChainRpcUrl(11155111) // Returns: "https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY"
 * 
 * @example
 * // For Ethereum mainnet (chain ID 1)  
 * getChainRpcUrl(1) // Returns: "https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
 */
export const getChainRpcUrl = (chainId: number | bigint): string => {
  const chainIdStr = chainId.toString();
  const rpcUrl = process.env[`CHAIN_${chainIdStr}_RPC_URL`];
  
  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for chain ${chainIdStr}. Please set CHAIN_${chainIdStr}_RPC_URL environment variable.`);
  }
  
  return config.alchemy.apiKey ? `${rpcUrl}/${config.alchemy.apiKey}` : rpcUrl;
};

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

/**
 * Validate chain RPC URLs based on enabled chains from Cirrus
 * 
 * Fetches the list of enabled chains from the bridge contract via Cirrus
 * and validates that all required RPC URL environment variables are configured.
 * This ensures the application has all necessary RPC endpoints for the
 * chains that are actually enabled in the bridge.
 * 
 * @throws Error if any enabled chain is missing its RPC URL configuration
 * @throws Error if Cirrus is unavailable or returns invalid data
 * 
 * @example
 * // If Cirrus returns chains [11155111, 1], validates:
 * // - CHAIN_11155111_RPC_URL is set
 * // - CHAIN_1_RPC_URL is set
 */
export const validateChainRpcUrls = async (): Promise<void> => {
  try {
    const enabledChains = await getEnabledChains();
    const missingChainRpcUrls: string[] = [];
    
    for (const chain of enabledChains) {
      const chainId = chain?.chainId;
      if (!chainId) {
        continue;
      }
      
      const envVarName = `CHAIN_${chainId}_RPC_URL`;
      
      if (!process.env[envVarName]) {
        missingChainRpcUrls.push(envVarName);
      }
    }
    
    if (missingChainRpcUrls.length > 0) {
      const error = `Missing RPC URL environment variables for enabled chains: ${missingChainRpcUrls.join(', ')}`;
      logger.error(error);
      throw new Error(error);
    }
    
    logger.info(`✅ All RPC URLs configured for ${enabledChains.length} enabled chains`);
  } catch (error) {
    logger.error('❌ Failed to validate chain RPC URLs:', error);
    throw error;
  }
};

let keyCache: Map<string, string> = new Map(); // Cache for all JWKS keys
let isInitialized = false;

/**
 * Initialize OAuth configuration
 * 
 * Fetches OpenID discovery configuration and pre-caches all JWKS keys
 * for efficient JWT validation. This function should be called once
 * at application startup.
 * 
 * @throws Error if OpenID discovery URL is not configured
 * @throws Error if OpenID configuration is invalid
 * @throws Error if JWKS cannot be fetched or parsed
 */
export const initializeOAuth = async () => {
  if (isInitialized) {
    return;
  }

  if (!config.auth.openIdDiscoveryUrl) {
    throw new Error("OpenID discovery URL not configured");
  }

  try {
    const response = await fetch(config.auth.openIdDiscoveryUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenID configuration: ${response.status} ${response.statusText}`);
    }
    
    const discovery = await response.json();

    if (!discovery.jwks_uri || !discovery.issuer) {
      throw new Error("Invalid OpenID configuration - missing jwks_uri or issuer");
    }

    // Pre-fetch and cache all JWKS keys
    const jwksResponse = await fetch(discovery.jwks_uri);
    if (!jwksResponse.ok) {
      throw new Error(`Failed to fetch JWKS: ${jwksResponse.status} ${jwksResponse.statusText}`);
    }
    
    const jwks = await jwksResponse.json();
    if (!jwks.keys || !Array.isArray(jwks.keys)) {
      throw new Error("Invalid JWKS response - missing keys array");
    }

    // Cache all keys by their key ID
    for (const key of jwks.keys) {
      if (key.kid && key.n && key.e) {
        // Convert JWK to PEM format
        const jwkToPem = require('jwk-to-pem');
        try {
          const pem = jwkToPem(key);
          keyCache.set(key.kid, pem);
        } catch (error) {
          console.warn(`⚠️ Failed to convert key ${key.kid} to PEM:`, error);
        }
      }
    }

    isInitialized = true;
  } catch (error) {
    console.error("❌ Failed to initialize OAuth config:", error);
    throw error;
  }
};
