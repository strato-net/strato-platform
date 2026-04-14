export const ERROR_FILE_NAME = "rewards-poller-error.flag";
export const BLOCK_TRACKING_FILE = "lastProcessedBlock.json";
export const BONUS_TRACKING_FILE = "lastBonusRun.json";

export const REQUIRED_ENV_VARS = [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "REWARDS_CONTRACT_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "NODE_URL",
] as const;

export const DEFAULTS = {
  usdstAddress: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  voucherAddress: "000000000000000000000000000000000000100e",
  pollingIntervalMs: 10 * 60 * 1000,
  maxBatchSize: 50,
  bonusCronSchedule: "0 3,9,15,21 * * *",
  gasFeeUsdstUnits: "1",
  gasFeeVoucherUnits: "100",
  minTransactionsThreshold: "1",
  warningTransactionsThreshold: "100",
  retryMaxAttempts: 2,
  retryInitialDelayMs: 1000,
  retryMaxDelayMs: 10000,
  apiTimeoutMs: 60_000,
  apiMaxAttempts: 2,
  stratoGasLimit: 32_100_000_000,
  stratoGasPrice: 1,
  stratoPollingTimeoutMs: 600_000,
  stratoPollingIntervalMs: 5_000,
  txType: "FUNCTION" as const,
  gasUnitScale: 10_000_000_000_000_000n,
};

export const API_ERROR_CODES = {
  ECONNREFUSED: "Connection refused",
  ENOTFOUND: "DNS lookup failed",
  ETIMEDOUT: "Request timeout",
} as const;
