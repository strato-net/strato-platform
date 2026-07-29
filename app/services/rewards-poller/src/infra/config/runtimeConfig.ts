import bonusTokenConfigsRaw from "./bonusTokenConfig.json";
import { parseBonusTokenConfigs } from "../../features/bonus-cycle/bonusConfig.validator";
import {
  API_ERROR_CODES,
  BLOCK_TRACKING_FILE,
  BONUS_TRACKING_FILE,
  DEFAULTS,
  ERROR_FILE_NAME,
  REQUIRED_ENV_VARS,
} from "./constants";
import { getBigIntEnvOrDefault, getEnv, getNumberEnvOrDefault, validateRequiredEnvVars } from "./env";

const bonusTokenConfigs = parseBonusTokenConfigs(bonusTokenConfigsRaw);

const config = {
  auth: {
    baUsername: getEnv("BA_USERNAME"),
    baPassword: getEnv("BA_PASSWORD"),
    clientSecret: getEnv("CLIENT_SECRET"),
    clientId: getEnv("CLIENT_ID"),
    openIdDiscoveryUrl: getEnv("OPENID_DISCOVERY_URL"),
  },
  rewards: {
    address: getEnv("REWARDS_CONTRACT_ADDRESS"),
  },
  priceOracle: {
    address: getEnv("PRICE_ORACLE_ADDRESS"),
  },
  usdst: {
    address: getEnv("USDST_ADDRESS") || DEFAULTS.usdstAddress,
  },
  voucher: {
    address: getEnv("VOUCHER_ADDRESS") || DEFAULTS.voucherAddress,
  },
  polling: {
    interval: getNumberEnvOrDefault("POLLING_INTERVAL", DEFAULTS.pollingIntervalMs),
    maxBatchSize: getNumberEnvOrDefault("MAX_BATCH_SIZE", DEFAULTS.maxBatchSize),
  },
  bonus: {
    cron: getEnv("BONUS_CRON_SCHEDULE") || DEFAULTS.bonusCronSchedule,
    tokenConfigs: bonusTokenConfigs,
  },
  balance: {
    gasFeeUSDST: getBigIntEnvOrDefault("GAS_FEE_USDST", DEFAULTS.gasFeeUsdstUnits) * DEFAULTS.gasUnitScale,
    gasFeeVoucher: getBigIntEnvOrDefault("GAS_FEE_VOUCHER", DEFAULTS.gasFeeVoucherUnits) * DEFAULTS.gasUnitScale,
    minTransactionsThreshold: getBigIntEnvOrDefault(
      "MIN_TRANSACTIONS_THRESHOLD",
      DEFAULTS.minTransactionsThreshold,
    ),
    warningTransactionsThreshold: getBigIntEnvOrDefault(
      "WARNING_TRANSACTIONS_THRESHOLD",
      DEFAULTS.warningTransactionsThreshold,
    ),
  },
  retry: {
    maxAttempts: getNumberEnvOrDefault("RETRY_MAX_ATTEMPTS", DEFAULTS.retryMaxAttempts),
    initialDelay: getNumberEnvOrDefault("RETRY_INITIAL_DELAY", DEFAULTS.retryInitialDelayMs),
    maxDelay: getNumberEnvOrDefault("RETRY_MAX_DELAY", DEFAULTS.retryMaxDelayMs),
  },
  strato: {
    gas: {
      limit: DEFAULTS.stratoGasLimit,
      price: DEFAULTS.stratoGasPrice,
    },
    polling: {
      defaultTimeout: DEFAULTS.stratoPollingTimeoutMs,
      defaultInterval: DEFAULTS.stratoPollingIntervalMs,
    },
    tx: {
      type: DEFAULTS.txType,
    },
  },
  api: {
    nodeUrl: getEnv("NODE_URL"),
    errorCodes: {
      ECONNREFUSED: API_ERROR_CODES.ECONNREFUSED,
      ENOTFOUND: API_ERROR_CODES.ENOTFOUND,
      ETIMEDOUT: API_ERROR_CODES.ETIMEDOUT,
    },
    defaults: {
      timeout: DEFAULTS.apiTimeoutMs,
      maxAttempts: DEFAULTS.apiMaxAttempts,
    },
  },
};

export { config, ERROR_FILE_NAME, BLOCK_TRACKING_FILE, BONUS_TRACKING_FILE };

validateRequiredEnvVars(REQUIRED_ENV_VARS);
