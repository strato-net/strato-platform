/**
 * Centralized constants for the oracle service
 */

// Balance thresholds
export const CONSTANTS = {
    GAS_FEE_USDST: BigInt(process.env.GAS_FEE_USDST || '1') * BigInt(1e16),
    GAS_FEE_VOUCHER: BigInt(process.env.GAS_FEE_VOUCHER || '100') * BigInt(1e16),
    MIN_TRANSACTIONS_THRESHOLD: BigInt(process.env.MIN_TRANSACTIONS_THRESHOLD || '100'),
    USDST_ADDRESS: process.env.USDST_ADDRESS || '937efa7e3a77e20bbdbd7c0d32b6514f368c1010',
};

// Gas parameters for transactions
export const GAS_PARAMS = { 
    gasLimit: 32_100_000_000, 
    gasPrice: 10 
};

// Timeout configurations
export const TIMEOUTS = { 
    SUBMIT: 20000, 
    WAIT: 180000,
    STATUS: 10000,
    FETCH: 30000,
};

// Oracle configuration
export const ORACLE_CONFIG = {
    MIN_VALID_SOURCES: 3,
    MAX_SOURCE_DIVERGENCE_PERCENT: 5,    // Alert if sources differ by >5%
    MAX_PRICE_CHANGE_PERCENT: 20,        // Alert if price changed >20% from last
};

// Retry delay configurations
export const RETRY_DELAYS = { 
    STATUS: 2000 
};

// Default retry configuration
export const DEFAULT_RETRY_CONFIG = {
    maxAttempts: 2,
    logPrefix: 'ApiClient'
};
