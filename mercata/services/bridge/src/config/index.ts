// Constants
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const STRATO_DECIMALS = 18;

export const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
];

// DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, uint96 depositId)
export const DEPOSIT_EVENT_SIGNATURE =
  "0x97968ffb53b74828f5a31cffca247ee14443247de34e1220399e6f9f56b9d33e";

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
  usdst: {
    address: process.env.USDST_ADDRESS || '937efa7e3a77e20bbdbd7c0d32b6514f368c1010',
  },
  safe: {
    address: process.env.SAFE_ADDRESS,
    safeProposerAddress: process.env.SAFE_PROPOSER_ADDRESS,
    safeProposerPrivateKey: process.env.SAFE_PROPOSER_PRIVATE_KEY,
    apiKey: process.env.SAFE_API_KEY,
  },
  hotWallet: {
    privateKey: process.env.HOT_WALLET_PRIVATE_KEY || "",
    threshold: BigInt(process.env.HOT_WALLET_THRESHOLD || String(100n * 10n ** 18n)),
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

// Validate required environment variables
const requiredEnvVars = [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
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
