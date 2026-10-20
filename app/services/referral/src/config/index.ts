// Constants
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const STRATO_DECIMALS = 18;

// Error file configuration
export const ERROR_FILE_NAME = "referral-error.flag";

const config = {
  signer: {
    // Optional: without it the service keeps its own key in data/signer.key (utils/signer.ts).
    privateKey: process.env.SIGNER_PRIVATE_KEY,
  },
  strato_chain: {
    // Optional: the STRATO chain the Escrow lives on, when it is not the node's main chain.
    chainId: process.env.CHAIN_ID,
  },
  escrow: {
    address: process.env.ESCROW_ADDRESS,
  },
  usdst: {
    address: process.env.USDST_ADDRESS || '937efa7e3a77e20bbdbd7c0d32b6514f368c1010',
  },
  voucher: {
    contractAddress:
      process.env.VOUCHER_CONTRACT_ADDRESS ||
      "000000000000000000000000000000000000100e",
    mintCount: 10,
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

// Validate required environment variables
const requiredEnvVars = ["NODE_URL", "ESCROW_ADDRESS"];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  const error = `Missing required environment variables when initializing the config: ${missingEnvVars.join(", ")}`;
  console.error(error);
  process.exit(2);
}
