import { id } from "ethers";

// Constants
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const STRATO_DECIMALS = 18;
export const WAD = 10n ** 18n;

export const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
];

export const STANDARD_DEPOSIT_EVENT_SIGNATURE = id(
  "DepositRouted(address,uint256,address,address,address,uint96)",
);
export const ACTION_DEPOSIT_EVENT_SIGNATURE = id(
  "DepositRoutedWithAction(address,uint256,address,address,address,uint96,uint8,address,uint256)",
);
export const DEPOSIT_EVENT_SIGNATURES = [
  STANDARD_DEPOSIT_EVENT_SIGNATURE,
  ACTION_DEPOSIT_EVENT_SIGNATURE,
];

// RedemptionRequested(address indexed representationToken, uint256 amount, address indexed sender, address indexed stratoRecipient, uint96 redemptionId)
export const NATIVE_REDEMPTION_EVENT_SIGNATURE =
  "0x8c3e37d44910f9975cca29b1cbb70b943d7107cf2091576b3291d4316c74129a";

// Transfer(address,address,uint256)
export const TRANSFER_EVENT_SIGNATURE =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Error file configuration
export const ERROR_FILE_NAME = "bridge-error.flag";

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
  nativeBridge: {
    address: process.env.STRATO_NATIVE_BRIDGE_ADDRESS,
  },
  oracle: {
    address: process.env.PRICE_ORACLE_ADDRESS,
  },
  usdst: {
    address: process.env.USDST_ADDRESS || '937efa7e3a77e20bbdbd7c0d32b6514f368c1010',
  },
  safe: {
    address: process.env.SAFE_ADDRESS,
    hotWalletAddress: process.env.SAFE_HOT_WALLET_ADDRESS,
    safeProposerAddress: process.env.SAFE_PROPOSER_ADDRESS,
    safeProposerPrivateKey: process.env.SAFE_PROPOSER_PRIVATE_KEY,
    apiKey: process.env.SAFE_API_KEY,
  },
  voucher: {
    contractAddress:
      process.env.VOUCHER_CONTRACT_ADDRESS ||
      "000000000000000000000000000000000000100e",
    mintCount: 25,
  },
  polling: {
    bridgeInInterval: 1 * 60 * 1000, // 5 minutes (was 100 seconds)
    bridgeOutInterval: 1 * 60 * 1000, // 1 minute (was 3 minutes)
    withdrawalInterval: 1 * 60 * 1000, // 1 minute (was 10 seconds)
    ethereumDepositInterval: 1 * 60 * 1000, // 1 minute (was 2 minutes)
  },
  balance: {
    gasFeeUSDST: BigInt(process.env.GAS_FEE_USDST || '1') * BigInt(1e16),
    gasFeeVoucher: BigInt(process.env.GAS_FEE_VOUCHER || '100') * BigInt(1e16),
    minTransactionsThreshold: BigInt(process.env.MIN_TRANSACTIONS_THRESHOLD || '200'),
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
    appUrl: process.env.STRATO_APP_API_URL,
    routeQuoteSlippageBps: Number(process.env.ROUTE_QUOTE_SLIPPAGE_BPS || "50"),
    errorCodes: {
      ECONNREFUSED: "Connection refused",
      ENOTFOUND: "DNS lookup failed",
      ETIMEDOUT: "Request timeout",
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
    throw new Error(
      `CHAIN_${chainIdStr}_RPC_URL environment variable is not configured`,
    );
  }

  return rpcUrl;
};

export const getNativeRepresentationBridgeAddress = (
  chainId: number | bigint,
): string | undefined => {
  const chainIdStr = chainId.toString();
  return process.env[`CHAIN_${chainIdStr}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS`];
};

export const getNativeBridgePrivateKey = (
  chainId: number | bigint,
): string | undefined => {
  const chainIdStr = chainId.toString();
  return process.env[`CHAIN_${chainIdStr}_NATIVE_BRIDGE_PRIVATE_KEY`];
};

export interface NativeBridgePrivateKeyConfig {
  envVar: string;
  privateKey: string;
}

export const getNativeBridgePrivateKeys = (
  chainId: number | bigint,
): NativeBridgePrivateKeyConfig[] => {
  const chainIdStr = chainId.toString();
  const baseEnv = `CHAIN_${chainIdStr}_NATIVE_BRIDGE_PRIVATE_KEY`;
  const keys: NativeBridgePrivateKeyConfig[] = [];
  const seen = new Set<string>();

  const addKey = (envVar: string) => {
    const privateKey = process.env[envVar]?.trim();
    if (!privateKey || seen.has(privateKey)) {
      return;
    }
    seen.add(privateKey);
    keys.push({ envVar, privateKey });
  };

  addKey(baseEnv);
  for (let index = 1; ; index += 1) {
    const envVar = `${baseEnv}_${index}`;
    if (!process.env[envVar]) {
      break;
    }
    addKey(envVar);
  }

  return keys;
};

// Validate required environment variables
const requiredEnvVars = [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_PRIVATE_KEY",
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  const error = `Missing required environment variables when initializing the config: ${missingEnvVars.join(", ")}`;
  console.error(error);
  process.exit(2);
}
