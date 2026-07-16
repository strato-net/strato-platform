// ============================================================================
// POOL V3 (CONCENTRATED LIQUIDITY) CONSTANTS
// ============================================================================

/**
 * Cirrus table names for PoolV3 contracts.
 *
 * Record mappings index into `<Contract>-<field>` child tables, following the
 * existing StablePool convention (e.g. BlockApps-StablePool-coins). Verify the
 * exact names against dev Cirrus after the first deployment.
 */
const CONTRACT_PREFIX = "BlockApps-";

export const POOL_V3_CONTRACTS = {
  PoolV3: `${CONTRACT_PREFIX}PoolV3`,
  PoolV3Ticks: `${CONTRACT_PREFIX}PoolV3-ticks`,
  PoolV3TickBitmap: `${CONTRACT_PREFIX}PoolV3-tickBitmap`,
  PoolV3Positions: `${CONTRACT_PREFIX}PoolV3-positions`,
  PoolV3Observations: `${CONTRACT_PREFIX}PoolV3-observations`,
  PoolV3Factory: `${CONTRACT_PREFIX}PoolV3Factory`,
  PoolV3FactoryPools: `${CONTRACT_PREFIX}PoolV3Factory-pools`,
  PoolV3FactoryFeeTiers: `${CONTRACT_PREFIX}PoolV3Factory-feeTiers`,
  PoolV3SwapEvent: `${CONTRACT_PREFIX}PoolV3-Swap`,
} as const;

// ============================================================================
// DATABASE SELECT FIELDS
// ============================================================================

/** Token fields joined from pool rows (mirrors SWAP_TOKEN_SELECT_FIELDS shape) */
export const POOL_V3_TOKEN_SELECT_FIELDS = [
  "address",
  "_name",
  "_symbol",
  "customDecimals",
  "status",
  "images:BlockApps-Token-images(value)",
] as const;

/** Pool state needed for listings and quote simulation */
export const POOL_V3_SELECT_FIELDS = [
  "address",
  "fee",
  "tickSpacing",
  "sqrtPriceX96::text",
  "currentTick",
  "liquidity::text",
  "feeGrowthGlobal0X128::text",
  "feeGrowthGlobal1X128::text",
  "feeProtocol",
  "protocolFees0::text",
  "protocolFees1::text",
  "token0Balance::text",
  "token1Balance::text",
  `token0:token0_fkey(${POOL_V3_TOKEN_SELECT_FIELDS.join(",")})`,
  `token1:token1_fkey(${POOL_V3_TOKEN_SELECT_FIELDS.join(",")})`,
  "isPaused",
  "isDisabled",
] as const;

/** Tick rows needed by the quote simulator (initialized ticks only) */
export const POOL_V3_TICK_SELECT_FIELDS = [
  "key",
  "liquidityNet::text",
  "liquidityGross::text",
  "initialized",
] as const;

/** Position rows for a user (positions mapping: owner => tickLower => tickUpper) */
export const POOL_V3_POSITION_SELECT_FIELDS = [
  "address",
  "key",
  "key_2",
  "key_3",
  "liquidity::text",
  "tokensOwed0::text",
  "tokensOwed1::text",
] as const;

// ============================================================================
// PROTOCOL CONSTANTS (canonical Uniswap V3 values)
// ============================================================================

export const V3_DEADLINE_SECONDS = 300; // 5 minutes, matches V2 swap deadline
export const V3_MAX_UINT = 2n ** 250n; // effectively-unbounded approval / maxIn sentinel
