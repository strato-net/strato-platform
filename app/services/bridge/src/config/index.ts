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
// A deposit that offers a solver fee for immediate delivery on STRATO. A
// separate event rather than extra fields on DepositRouted, so that a relayer
// running the old code keeps working through the upgrade.
export const FEE_DEPOSIT_EVENT_SIGNATURE = id(
  "DepositRoutedWithFee(address,uint256,address,address,address,uint96,uint256,uint256,uint256)",
);
export const DEPOSIT_EVENT_SIGNATURES = [
  STANDARD_DEPOSIT_EVENT_SIGNATURE,
  ACTION_DEPOSIT_EVENT_SIGNATURE,
  FEE_DEPOSIT_EVENT_SIGNATURE,
];

// RedemptionRequested(address indexed representationToken, uint256 amount, address indexed sender, address indexed stratoRecipient, uint96 redemptionId)
export const NATIVE_REDEMPTION_EVENT_SIGNATURE =
  "0x8c3e37d44910f9975cca29b1cbb70b943d7107cf2091576b3291d4316c74129a";

// The fee-bearing redemption, and the solver claim on a STRATO withdrawal.
export const NATIVE_FEE_REDEMPTION_EVENT_SIGNATURE = id(
  "RedemptionRequestedWithFee(address,uint256,address,address,uint96,uint256,uint256,uint256)",
);
export const NATIVE_REDEMPTION_EVENT_SIGNATURES = [
  NATIVE_REDEMPTION_EVENT_SIGNATURE,
  NATIVE_FEE_REDEMPTION_EVENT_SIGNATURE,
];

// WithdrawalFilled, emitted by both external-chain bridges when a solver takes
// over a withdrawal's claim. The relayer mirrors these back to STRATO.
export const WITHDRAWAL_FILLED_EVENT_SIGNATURE = id(
  "WithdrawalFilled(bytes32,address,address,uint32,address,uint256,uint256,uint256)",
);

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
    // Record each scanned block window with MercataBridge.recordDepositWindow, which stores the
    // deposits and advances the checkpoint in one transaction. Enable only once the bridge logic
    // with recordDepositWindow is live and the relayer is whitelisted for it.
    recordDepositWindow: process.env.BRIDGE_RECORD_DEPOSIT_WINDOW === "true",
    // How long to wait for Cirrus to show just-recorded deposits before leaving the checkpoint alone
    readBackTimeoutMs: Number(process.env.BRIDGE_READ_BACK_TIMEOUT_MS) || 30_000,
    readBackIntervalMs: 3_000,
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

// Blocks a deposit must be buried under before it is scanned, so a reorg or an RPC node lagging
// behind the one that answered eth_blockNumber cannot hide it from an already-scanned range
const DEFAULT_CHAIN_CONFIRMATIONS: Record<string, number> = {
  "1": 3,
  "11155111": 3,
  "8453": 10,
  "84532": 10,
};
const FALLBACK_CHAIN_CONFIRMATIONS = 5;

export const getChainConfirmations = (chainId: number | bigint): number => {
  const chainIdStr = chainId.toString();
  const configured = process.env[`CHAIN_${chainIdStr}_CONFIRMATIONS`]?.trim();
  if (configured) {
    const confirmations = Number(configured);
    if (!Number.isInteger(confirmations) || confirmations < 0) {
      throw new Error(
        `CHAIN_${chainIdStr}_CONFIRMATIONS must be a non-negative integer, got "${configured}"`,
      );
    }
    return confirmations;
  }
  return DEFAULT_CHAIN_CONFIRMATIONS[chainIdStr] ?? FALLBACK_CHAIN_CONFIRMATIONS;
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
