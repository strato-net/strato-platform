import bonusTokenConfigsRaw from "./bonusTokenConfig.json";
import { parseBonusTokenConfigs } from "../utils/bonusValidation";

export const ERROR_FILE_NAME = "rewards-poller-error.flag";
export const BLOCK_TRACKING_FILE = "lastProcessedBlock.json";
export const BONUS_TRACKING_FILE = "lastBonusRun.json";

const bonusTokenConfigs = parseBonusTokenConfigs(bonusTokenConfigsRaw);

const config = {
  auth: {
    baUsername: process.env.BA_USERNAME,
    baPassword: process.env.BA_PASSWORD,
    clientSecret: process.env.CLIENT_SECRET,
    clientId: process.env.CLIENT_ID,
    openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL,
  },
  rewards: {
    address: process.env.REWARDS_CONTRACT_ADDRESS,
  },
  priceOracle: {
    address: process.env.PRICE_ORACLE_ADDRESS,
  },
  usdst: {
    address: process.env.USDST_ADDRESS || '937efa7e3a77e20bbdbd7c0d32b6514f368c1010',
  },
  voucher: {
    address: process.env.VOUCHER_ADDRESS || '000000000000000000000000000000000000100e',
  },
  polling: {
    interval: Number(process.env.POLLING_INTERVAL) || 10 * 60 * 1000,
    maxBatchSize: Number(process.env.MAX_BATCH_SIZE) || 50,
  },
  bonus: {
    cron: process.env.BONUS_CRON_SCHEDULE || "0 3,9,15,21 * * *",
    tokenConfigs: bonusTokenConfigs,
  },
  balance: {
    gasFeeUSDST: BigInt(process.env.GAS_FEE_USDST || '1') * BigInt(1e16),
    gasFeeVoucher: BigInt(process.env.GAS_FEE_VOUCHER || '100') * BigInt(1e16),
    minTransactionsThreshold: BigInt(process.env.MIN_TRANSACTIONS_THRESHOLD || '1'),
    warningTransactionsThreshold: BigInt(process.env.WARNING_TRANSACTIONS_THRESHOLD || '100'),
  },
  retry: {
    maxAttempts: Number(process.env.RETRY_MAX_ATTEMPTS) || 2,
    initialDelay: Number(process.env.RETRY_INITIAL_DELAY) || 1000,
    maxDelay: Number(process.env.RETRY_MAX_DELAY) || 10000,
  },
  strato: {
    gas: {
      limit: 32_100_000_000,
      price: 1,
    },
    polling: {
      defaultTimeout: 600_000,
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

const requiredEnvVars = [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "REWARDS_CONTRACT_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "NODE_URL",
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  const error = `Missing required environment variables when initializing the config: ${missingEnvVars.join(", ")}`;
  console.error(error);
  process.exit(2);
}
