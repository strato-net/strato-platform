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
  PositionManagerV3: `${CONTRACT_PREFIX}PositionManagerV3`,
  PositionManagerV3Positions: `${CONTRACT_PREFIX}PositionManagerV3-positions`,
  PositionManagerV3Owners: `${CONTRACT_PREFIX}PositionManagerV3-_owners`,
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
// Collection tables store the mapping VALUE (the struct) as a single `value` JSONB column,
// not as top-level columns — only the mapping keys (key/key2/key3) are top-level. Struct
// fields are therefore read out of `value` via PostgREST JSON aliases (alias:value->>field),
// which return the field as text (BigInt-parseable, sign preserved).
export const POOL_V3_TICK_SELECT_FIELDS = [
  "key",
  // the ticks table can hold stale ghost rows per key (observed after a Cirrus
  // rebuild) — block_number lets readers keep only the newest row per tick
  "block_number",
  "liquidityNet:value->>liquidityNet",
  "liquidityGross:value->>liquidityGross",
  "initialized:value->>initialized",
  // signed Q128 outside-growth snapshots, needed for pending-fee computation
  "feeGrowthOutside0X128:value->>feeGrowthOutside0X128",
  "feeGrowthOutside1X128:value->>feeGrowthOutside1X128",
] as const;

/** Position rows for a user (positions mapping: owner => tickLower => tickUpper) */
export const POOL_V3_POSITION_SELECT_FIELDS = [
  "address",
  "key",
  "key2",
  "key3",
  // struct value fields live in the `value` JSONB (see tick fields above)
  "liquidity:value->>liquidity",
  "tokensOwed0:value->>tokensOwed0",
  "tokensOwed1:value->>tokensOwed1",
  // signed Q128 inside-growth snapshots as of the position's last touch
  "feeGrowthInside0LastX128:value->>feeGrowthInside0LastX128",
  "feeGrowthInside1LastX128:value->>feeGrowthInside1LastX128",
] as const;

/** Managed-position rows (PositionManagerV3.positions: tokenId => ManagedPosition struct) */
export const POSITION_MANAGER_POSITION_SELECT_FIELDS = [
  "key", // tokenId
  // struct value fields live in the `value` JSONB (see tick fields above)
  "pool:value->>pool",
  "tickLower:value->>tickLower",
  "tickUpper:value->>tickUpper",
  "liquidity:value->>liquidity",
  "tokensOwed0:value->>tokensOwed0",
  "tokensOwed1:value->>tokensOwed1",
  // the manager's per-token snapshots — same delta math against the pool's
  // feeGrowthInside as a direct position's own snapshots
  "feeGrowthInside0LastX128:value->>feeGrowthInside0LastX128",
  "feeGrowthInside1LastX128:value->>feeGrowthInside1LastX128",
] as const;

/** Swap event rows for the trade-history table (amount0/amount1 are the pool's signed deltas) */
export const POOL_V3_SWAP_HISTORY_SELECT_FIELDS = [
  "address",
  "id",
  "block_timestamp",
  "sender",
  "recipient",
  "amount0::text",
  "amount1::text",
] as const;

// ============================================================================
// PROTOCOL CONSTANTS (canonical Uniswap V3 values)
// ============================================================================

export const V3_DEADLINE_SECONDS = 300; // 5 minutes, matches V2 swap deadline
export const V3_MAX_UINT = 2n ** 250n; // effectively-unbounded approval / maxIn sentinel
