import dotenv from 'dotenv';
import logger from '../utils/logger';
import fetch from "node-fetch";
import jwksRsa from "jwks-rsa";
// import jwkToPem from "jwk-to-pem";

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
    openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL ,
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
  polling: {
    bridgeInInterval: 5 * 60 * 1000, // 5 minutes for bridge-in
    bridgeOutInterval: 3 * 60 * 1000, // 3 minutes for bridge-out
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

export const TESTNET_ETH_TOKENS = [
  {
    name: "Sepolia Ether",
    symbol: "SepoliaETH",
    tokenAddress: "0x0000000000000000000000000000000000000000", // Native token address
    decimals: 18,
    chainId: 11155111,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png"
  },
  {
    name: "USD Coin",
    symbol: "USDC",
    tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    chainId: 11155111,
    decimals: 6,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/USDC/logo.png"
  }
];

export const MAINNET_ETH_TOKENS = [
  {
    name: "Ethereum",
    symbol: "ETH",
    tokenAddress: "0x0000000000000000000000000000000000000000", // Native token address
    decimals: 18,
    chainId: 1,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png"
  },
  {
    name: "USD Coin",
    symbol: "USDC",
    tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
    chainId: 1,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/USDC/logo.png"
  }
];

export const TESTNET_STRATO_TOKENS = [
  {
    name: "STRATO Ether",
    symbol: "ETHST",
    tokenAddress: "0x581ee622fb866f3c2076d4260824ce681b15b715" , // Native token address
    decimals: 18,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png"
  },
  {
    name: "STRATO USDC",
    symbol: "USDCST",
    tokenAddress: "0x500fb797b0be4ce0edf070a9b17bae56d22a2131",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/USDC/logo.png"
  }
];

export const MAINNET_STRATO_TOKENS = [
  {
    name: "STRATO Ether",
    symbol: "STRATO_ETH",
    tokenAddress: "0x0000000000000000000000000000000000000000", // Native token address
    decimals: 18,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png"
  },
  {
    name: "STRATO USD Coin",
    symbol: "USDCST",
    tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/USDC/logo.png"
  }
];

export const TESTNET_ETH_STRATO_TOKEN_MAPPING = {
  '0x0000000000000000000000000000000000000000': '0x581ee622fb866f3c2076d4260824ce681b15b715', // ETH        
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238': '0x500fb797b0be4ce0edf070a9b17bae56d22a2131' // USDC
}
  
export const MAINNET_ETH_STRATO_TOKEN_MAPPING = {
  '0x0000000000000000000000000000000000000000': '0x0000000000000000000000000000000000000000',
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
} 

export const TESTNET_ERC20_TOKEN_CONTRACTS = [
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
];

export const MAINNET_ERC20_TOKEN_CONTRACTS = [
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
];

export const getExchangeTokenInfoBridgeIn = (
  tokenAddress: string,
  showTestnet: boolean
) => {
  const map = Object.fromEntries(
    Object.entries(
      showTestnet ? TESTNET_ETH_STRATO_TOKEN_MAPPING : MAINNET_ETH_STRATO_TOKEN_MAPPING
    ).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])
  );
  console.log("map in getExchangeTokenInfoBridgeIn", map);
  const stratoTokenAddress = map[tokenAddress.toLowerCase()];
  console.log("stratoTokenAddress in getExchangeTokenInfoBridgeIn", stratoTokenAddress);
  const tokens = showTestnet ? TESTNET_STRATO_TOKENS : MAINNET_STRATO_TOKENS;
  console.log("tokens in getExchangeTokenInfoBridgeIn", tokens);
  const token = tokens.find(t => t.tokenAddress.toLowerCase() === stratoTokenAddress);
  // console.log("token in getExchangeTokenInfoBridgeIn", token);
  return {
    exchangeTokenName: token?.name || '',
    exchangeTokenSymbol: token?.symbol || ''
  };
};


export const getExchangeTokenInfoBridgeOut = (
  tokenAddress: string,
  showTestnet: boolean
) => {
  const map = Object.fromEntries(
    Object.entries(
      showTestnet ? TESTNET_ETH_STRATO_TOKEN_MAPPING : MAINNET_ETH_STRATO_TOKEN_MAPPING
    ).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])
  );

  const reverseMap = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  const ethTokenAddress = reverseMap[tokenAddress.toLowerCase()];
  const tokens = showTestnet ? TESTNET_ETH_TOKENS : MAINNET_ETH_TOKENS;

  const token = tokens.find(t => t.tokenAddress.toLowerCase() === ethTokenAddress);
  return {
    exchangeTokenName: token?.name || '',
    exchangeTokenSymbol: token?.symbol || '',
    exchangeTokenAddress: token?.tokenAddress || ''
  };
};



let issuer: string;
let jwksClient: jwksRsa.JwksClient;
let keyCache: Map<string, string> = new Map(); // Cache for all JWKS keys
let isInitialized = false;

export const initializeOAuth = async () => {
  if (isInitialized) {
    console.log("✅ OAuth config already initialized");
    return;
  }

  if (!config.auth.openIdDiscoveryUrl) {
    throw new Error("OpenID discovery URL not configured");
  }

  try {
    console.log("🔍 Fetching OpenID configuration from:", config.auth.openIdDiscoveryUrl);
    const response = await fetch(config.auth.openIdDiscoveryUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenID configuration: ${response.status} ${response.statusText}`);
    }
    
    const discovery = await response.json();

    if (!discovery.jwks_uri || !discovery.issuer) {
      throw new Error("Invalid OpenID configuration - missing jwks_uri or issuer");
    }

    issuer = discovery.issuer;
    console.log("✅ Issuer configured:", issuer);

    // Pre-fetch and cache all JWKS keys
    console.log("🔑 Fetching and caching all JWKS keys...");
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
          console.log(`✅ Cached key: ${key.kid}`);
        } catch (error) {
          console.warn(`⚠️ Failed to convert key ${key.kid} to PEM:`, error);
        }
      }
    }

    console.log(`✅ Cached ${keyCache.size} JWKS keys`);

    isInitialized = true;
    console.log("✅ OAuth config initialized successfully with pre-cached keys");
  } catch (error) {
    console.error("❌ Failed to initialize OAuth config:", error);
    throw error;
  }
};

export const getOAuthConfig = () => {
  if (!isInitialized) {
    throw new Error("OAuth not initialized. Call initializeOAuth() first");
  }

  return { issuer, keyCache };
};