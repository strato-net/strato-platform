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
    name: "Strato Ether",
    symbol: "ETHST",
    tokenAddress: "0xb7ee7c1169e8f3bea76825e9d3e70cadc9e18226" , // Native token address
    decimals: 18,
    icon: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/ETH/logo.png"
  },
  {
    name: "Strato USDC",
    symbol: "USDCST",
    tokenAddress: "0x78ee9906568e1663298159b59fa92faa632a2a6d",
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
  '0x0000000000000000000000000000000000000000': '0xb7ee7c1169e8f3bea76825e9d3e70cadc9e18226',
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238': '0x78ee9906568e1663298159b59fa92faa632a2a6d'
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