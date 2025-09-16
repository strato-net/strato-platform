// Constants and Configuration
// Shared constants and default values used across CDP test scripts

// Default contract addresses (can be overridden by environment variables)
const DEFAULT_ADDRESSES = {
  USDST: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  ETHST: "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  ADMIN_REGISTRY: "000000000000000000000000000000000000100c",
  TOKEN_FACTORY: "000000000000000000000000000000000000100b",
  ACC1_ADDRESS: "1b7dc206ef2fe3aab27404b88c36470ccf16c0ce"
};

// Transaction timing constants
const TIMING = {
  TRANSACTION_DELAY: 5000,      // Default delay between transactions (ms)
  RETRY_DELAY_MULTIPLIER: 3,    // Multiplier for retry delays
  STATE_SYNC_DELAY: 2000,       // Delay for blockchain state sync
  DUST_CLEANUP_DELAY: 1000      // Delay for dust position cleanup
};

// CDP Engine configuration constants
const CDP_CONFIG = {
  // ETHST collateral configuration
  ETHST_LIQUIDATION_RATIO: "1500000000000000000",      // 150% (1.5 * 1e18)
  ETHST_LIQUIDATION_PENALTY_BPS: "500",               // 5% penalty (minimum allowed)
  ETHST_CLOSE_FACTOR_BPS: "10000",                    // 100% close factor
  ETHST_STABILITY_FEE_RATE: "1000000000315522921573372069", // ~1% APR
  ETHST_DEBT_FLOOR: "1000000000000000000",           // 1 USDST minimum
  ETHST_DEBT_CEILING: "1000000000000000000000000000000000", // Large ceiling
  ETHST_UNIT_SCALE: "1000000000000000000",           // 1e18 (ETHST has 18 decimals)
};

// Test amounts for setupCDPTest.js
const SETUP_AMOUNTS = {
  LARGE_APPROVAL: "1000000000000000000000000000", // 1 billion tokens (approval)
  ETHST_DEPOSIT: "10000000000000000000",          // 10 ETHST
  USDST_MINT: "15000000000000000000000",          // 15,000 USDST
  INITIAL_ETHST_PRICE: "3000000000000000000000",   // $3,000 (18 decimals)
  CRASH_ETHST_PRICE: "100000000000000000000",     // $100 (18 decimals)
  LIQUIDATION_AMOUNT: "50000000000000000000000",   // 50,000 USDST
};

// Test amounts for testJuniorNotes.js
const JUNIOR_TEST_AMOUNTS = {
  JUNIOR_PREMIUM: "1000",                        // 10% (1000 bps)
  ACC1_BURN: "2000000000000000000000",          // 2,000 USDST
  ACC2_BURN: "1500000000000000000000",          // 1,500 USDST
  ACC3_BURN: "500000000000000000000",           // 500 USDST
  ACC2_TOPUP: "1000000000000000000000",         // 1,000 USDST (for top-up)
  
  // Reserve inflows for testing
  INFLOW_1: "1000000000000000000000",           // 1,000 USDST
  INFLOW_2: "700000000000000000000",            // 700 USDST
  INFLOW_3: "2000000000000000000000",           // 2,000 USDST
  INFLOW_4: "300000000000000000000",            // 300 USDST
  
  // Transfer amounts
  TRANSFER_TO_ACC2: "5000000000000000000000",   // 5,000 USDST
  TRANSFER_TO_ACC3: "2000000000000000000000",   // 2,000 USDST
  APPROVAL_AMOUNT: "10000000000000000000000",   // 10,000 USDST approval
  
  // Required bad debt for testing
  REQUIRED_BAD_DEBT: "4400000000000000000000"   // 4,400 USDST (4400e18)
};

// Mathematical constants
const MATH_CONSTANTS = {
  WAD: "1000000000000000000",    // 1e18
  RAY: "1000000000000000000000000000", // 1e27
  WAD_NUMBER: 1e18,
  RAY_NUMBER: 1e27
};

// Error patterns for transaction parsing
const ERROR_PATTERNS = {
  SOLIDITY_REQUIRE: /solidity require failed: SString "([^"]+)"/,
  GENERAL_ERROR: /Error running the transaction: (.+)/,
  RETRYABLE_KEYWORDS: ['mempool', 'nonce', 'lucrative', 'pending']
};

// Role descriptions for logging
const ROLE_DESCRIPTIONS = {
  ADMIN: "admin operations only",
  ACC1: "user operations",
  ACC2: "user operations", 
  ACC3: "user operations",
  VAULT_OWNER: "vault owner",
  LIQUIDATOR: "liquidator",
  ORACLE_ADMIN: "price oracle only",
  PREMIUM_ADMIN: "premium setting only"
};

/**
 * Get environment configuration with defaults
 * @returns {Object} Configuration object
 */
function getEnvironmentConfig() {
  return {
    // Required environment variables
    ADMIN_TOKEN: process.env.ADMIN_TOKEN,
    ACC1_TOKEN: process.env.ACC1_TOKEN,
    ACC2_TOKEN: process.env.ACC2_TOKEN,
    ACC3_TOKEN: process.env.ACC3_TOKEN,
    
    // Addresses with defaults
    ADMIN_ADDRESS: process.env.ADMIN_ADDRESS,
    ACC1_ADDRESS: process.env.ACC1_ADDRESS || DEFAULT_ADDRESSES.ACC1_ADDRESS,
    ACC2_ADDRESS: process.env.ACC2_ADDRESS,
    ACC3_ADDRESS: process.env.ACC3_ADDRESS,
    
    // Contract addresses
    USDST: process.env.USDST || DEFAULT_ADDRESSES.USDST,
    ETHST: process.env.ETHST || DEFAULT_ADDRESSES.ETHST,
    CDP_ENGINE: process.env.CDP_ENGINE,
    CDP_VAULT: process.env.CDP_VAULT,
    CDP_REGISTRY: process.env.CDP_REGISTRY,
    CDP_RESERVE: process.env.CDP_RESERVE,
    PRICE_ORACLE: process.env.PRICE_ORACLE,
    ADMIN_REGISTRY: process.env.ADMIN_REGISTRY || DEFAULT_ADDRESSES.ADMIN_REGISTRY,
    TOKEN_FACTORY: process.env.TOKEN_FACTORY || DEFAULT_ADDRESSES.TOKEN_FACTORY
  };
}

/**
 * Get required environment variables for a specific script
 * @param {string} scriptType - Type of script (setup, junior, reset, etc.)
 * @returns {Object} Required environment variables
 */
function getRequiredEnvironment(scriptType) {
  const base = {
    ADMIN_TOKEN: "ADMIN_TOKEN JWT required",
    ACC1_TOKEN: "ACC1_TOKEN JWT required",
    CDP_ENGINE: "CDP_ENGINE address required in .env"
  };
  
  switch (scriptType) {
    case 'setup':
      return {
        ...base,
        ACC2_TOKEN: "ACC2_TOKEN (LIQUIDATOR_TOKEN) JWT required",
        CDP_VAULT: "CDP_VAULT address required in .env",
        PRICE_ORACLE: "PRICE_ORACLE address required in .env",
        TOKEN_FACTORY: "TOKEN_FACTORY address required in .env"
      };
      
    case 'junior':
      return {
        ...base,
        ACC2_TOKEN: "ACC2_TOKEN JWT required",
        ACC3_TOKEN: "ACC3_TOKEN JWT required",
        CDP_RESERVE: "CDP_RESERVE address required in .env"
      };
      
    case 'reset':
      return {
        ...base,
        ACC2_TOKEN: "ACC2_TOKEN JWT required",
        ACC3_TOKEN: "ACC3_TOKEN JWT required",
        CDP_RESERVE: "CDP_RESERVE address required in .env"
      };
      
    default:
      return base;
  }
}

module.exports = {
  DEFAULT_ADDRESSES,
  TIMING,
  CDP_CONFIG,
  SETUP_AMOUNTS,
  JUNIOR_TEST_AMOUNTS,
  MATH_CONSTANTS,
  ERROR_PATTERNS,
  ROLE_DESCRIPTIONS,
  getEnvironmentConfig,
  getRequiredEnvironment
};
