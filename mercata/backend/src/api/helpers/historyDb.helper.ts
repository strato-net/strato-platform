import { query } from "../../utils/dbService";
import {
  HistoryParams,
  HistorySnapshot,
  StorageHistoryElement,
  MappingHistoryElement,
} from "./history.helper";

/**
 * Deduplicate array by a key function. Keeps first occurrence.
 */
function dedupByKey<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Sort by broadest validity period first (infinity valid_to comes first).
 */
function sortByBroadFirst<T extends { valid_from: string; valid_to: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const aTo = a.valid_to === 'infinity' ? Number.MAX_SAFE_INTEGER : Date.parse(a.valid_to + 'Z');
    const bTo = b.valid_to === 'infinity' ? Number.MAX_SAFE_INTEGER : Date.parse(b.valid_to + 'Z');
    if (aTo !== bTo) return bTo - aTo;
    return Date.parse(a.valid_from + 'Z') - Date.parse(b.valid_from + 'Z');
  });
}

/**
 * Reconstruct time-series snapshots from raw history rows.
 * Rows should be sorted by valid_from for optimal early-termination in the inner loops.
 */
export function buildSnapshots(
  params: HistoryParams,
  storageHistory: StorageHistoryElement[],
  mappingHistory: MappingHistoryElement[],
  initialSnapshotData: any,
  storageReducer: (data: any, element: StorageHistoryElement) => any,
  mappingReducer: (data: any, element: MappingHistoryElement) => any,
  snapshotFn: (snapshot: HistorySnapshot, index: number) => HistorySnapshot,
): HistorySnapshot[] {
  const { endTimestamp, interval, numTicks } = params;
  const startTimestamp = endTimestamp - interval * numTicks;

  const snapshots: HistorySnapshot[] = new Array(numTicks + 1)
    .fill(null)
    .map((_, i) => ({
      timestamp: endTimestamp - interval * (numTicks - i),
      data: structuredClone(initialSnapshotData),
    }));

  const applyRows = <T extends { valid_from: string; valid_to: string }>(
    rows: T[],
    reducer: (data: any, element: T) => any,
  ) => {
    for (const h of rows) {
      const validFrom = Date.parse(h.valid_from + "Z");
      const validTo =
        h.valid_to === "infinity"
          ? Number.MAX_SAFE_INTEGER
          : Date.parse(h.valid_to + "Z");

      if (validFrom <= startTimestamp && validTo >= endTimestamp) {
        for (let i = 0; i < snapshots.length; i++) {
          snapshots[i].data = reducer(snapshots[i].data, h);
        }
      } else if (validFrom <= startTimestamp) {
        for (let i = 0; i < snapshots.length; i++) {
          if (snapshots[i].timestamp < validTo) {
            snapshots[i].data = reducer(snapshots[i].data, h);
          } else {
            break;
          }
        }
      } else if (validTo >= endTimestamp) {
        for (let i = snapshots.length - 1; i >= 0; i--) {
          if (snapshots[i].timestamp >= validFrom) {
            snapshots[i].data = reducer(snapshots[i].data, h);
          } else {
            break;
          }
        }
      } else {
        for (let i = 0; i < snapshots.length; i++) {
          if (
            snapshots[i].timestamp >= validFrom &&
            snapshots[i].timestamp < validTo
          ) {
            snapshots[i].data = reducer(snapshots[i].data, h);
          }
          if (snapshots[i].timestamp >= validTo) {
            break;
          }
        }
      }
    }
  };

  applyRows(storageHistory, storageReducer);
  applyRows(mappingHistory, mappingReducer);

  return snapshots.map((snapshot, i) => snapshotFn(snapshot, i));
}

// ── SQL query builders for net-balance-history ──────────────────────────

export interface NetBalanceStorageFilterParams {
  vaultShareToken?: string;
  carryVaultAddrs: string[];
}

export interface NetBalanceMappingFilterParams {
  userAddress: string;
  botExecutor?: string;
  carryVaultAddrs: string[];
  requestFilters: { address: string; path: string }[];
  priceOracle: string;
  stratoStakingAddress?: string;
  stratoTokenAddress?: string;
}

/**
 * Fetch storage history rows directly from Postgres.
 *
 * Optimizations vs PostgREST OR-filter approach:
 * - Vault share token + carry vault addresses consolidated into a single ANY() array
 *   instead of N separate `address = $X` OR clauses.
 */
export async function fetchStorageHistory(
  startTime: string,
  endTime: string,
  filters: NetBalanceStorageFilterParams,
): Promise<StorageHistoryElement[]> {
  // Collect all specific addresses into a single array for ANY()
  const addressList: string[] = [...filters.carryVaultAddrs];
  if (filters.vaultShareToken) addressList.push(filters.vaultShareToken);

  // $1 = endTime, $2 = startTime, $3 = address list
  const sql = `
    SELECT address, data, valid_from, valid_to
    FROM "history@storage"
    WHERE valid_from <= $1
      AND valid_to >= $2
      AND (
        data->>'lpToken' != ''
        OR data->>'_symbol' LIKE '%-LP'
        OR data->>'_symbol' IN ('MUSDST','SUSDST','safetyUSDST','lendUSDST','saveUSDST')
        OR (data->>'sToken' IS NOT NULL AND data->>'sToken' > '0')
        OR (data->>'mToken' IS NOT NULL AND data->>'mToken' > '0' AND data->>'borrowIndex' IS NOT NULL AND data->>'borrowIndex' > '0')
        OR address = ANY($3)
      )
  `;

  return query<StorageHistoryElement>(sql, [endTime, startTime, addressList]);
}

// Collections fetched in pass 1 (user-specific data + specific-path rows).
const USER_MAPPING_COLLECTIONS = [
  '_balances',
  'claimableAssets',
  'userCollaterals',
  'userLoan',
  'vaults',
  'delegatedStake',    // StratoStaking: user's delegated stake per operator
  'unbondingQueue',    // StratoStaking: user's unclaimed unbonding requests
  'operators',         // StratoStaking: operator self-bond (if user is an operator)
];

// Collections fetched in pass 2, filtered to relevant tokens only.
const GLOBAL_MAPPING_COLLECTIONS = [
  'prices',
  'collateralConfigs',
  'collateralGlobalStates',
];

/**
 * Pass 1: Fetch user-specific mapping rows and specific-path rows.
 *
 * Returns rows matching any of:
 * - User-specific paths (path LIKE '%userAddress%') → user's balances/collaterals/loans/CDP positions
 * - Specific `_balances` paths (liquidity pool, vault bot executor, carry vault idle assets)
 * - Carry vault claimable assets for this user
 * - User's pending withdrawal requests
 * - StratoStaking delegatedStake, unbondingQueue, and operators (self-bond) for this user
 *
 * Excludes prices/collateralConfigs/collateralGlobalStates — those are fetched in pass 2.
 */
export async function fetchUserMappingHistory(
  startTime: string,
  endTime: string,
  filters: NetBalanceMappingFilterParams,
): Promise<MappingHistoryElement[]> {
  const collections = [
    ...USER_MAPPING_COLLECTIONS,
    ...(filters.requestFilters.length > 0 ? ['requests'] : []),
  ];

  // Build the _balances path array: liquidity pool + bot executor + carry vault idle assets
  const balancePaths: string[] = [
    '_balances[0000000000000000000000000000000000001004]', // liquidity pool
  ];
  if (filters.botExecutor) {
    balancePaths.push(`_balances[${filters.botExecutor}]`);
  }
  for (const addr of filters.carryVaultAddrs) {
    balancePaths.push(`_balances[${addr}]`);
  }

  const claimablePath = `claimableAssets[${filters.userAddress}]`;

  const requestAddrs: string[] = [];
  const requestPaths: string[] = [];
  for (const rf of filters.requestFilters) {
    requestAddrs.push(rf.address);
    requestPaths.push(rf.path);
  }

  // Staking-specific address filter (only fetch staking data from the staking contract)
  const stakingAddress = filters.stratoStakingAddress || '';

  // FIX: Exclude staking collections from general path LIKE to prevent matching
  // delegatedStake[userA][operatorB] when querying for operatorB (as the user).
  // Staking data is fetched via the specific key->>'key' condition instead.
  const sql = `
    SELECT address, collection_name, key, path, value, valid_from, valid_to
    FROM "history@mapping"
    WHERE valid_from <= $1
      AND valid_to >= $2
      AND collection_name = ANY($3)
      AND (
        (path LIKE $4 AND collection_name NOT IN ('delegatedStake', 'unbondingQueue', 'operators'))
        OR path = ANY($5)
        OR (address = ANY($6) AND path = $7)
        OR (address = ANY($8) AND path = ANY($9))
        OR (address = $10 AND collection_name IN ('delegatedStake', 'unbondingQueue', 'operators') AND key->>'key' = $11)
      )
  `;

  return query<MappingHistoryElement>(sql, [
    endTime,
    startTime,
    collections,
    `%${filters.userAddress}%`,
    balancePaths,
    filters.carryVaultAddrs,
    claimablePath,
    requestAddrs.length > 0 ? requestAddrs : [''],
    requestPaths.length > 0 ? requestPaths : [''],
    stakingAddress,
    filters.userAddress,
  ]);
}

/**
 * Pass 2: Fetch prices/collateralConfigs/collateralGlobalStates rows ONLY for tokens
 * that are relevant to this user's portfolio. This is the key optimization — instead of
 * returning every price change for every token on the platform, we filter to the small
 * set of tokens that actually affect the user's balance calculation.
 *
 * For a user who holds ~10 tokens out of a platform with ~300, this cuts returned rows
 * by ~15-30x.
 */
export async function fetchGlobalMappingHistory(
  startTime: string,
  endTime: string,
  relevantTokens: string[],
  priceOracle: string,
): Promise<MappingHistoryElement[]> {
  if (relevantTokens.length === 0) return [];

  // `prices` rows must be restricted to the system price oracle address, otherwise
  // stale prices published by other contracts pollute the portfolio history
  // (see fix "restrict portfolio history price query to system oracle").
  const sql = `
    SELECT address, collection_name, key, path, value, valid_from, valid_to
    FROM "history@mapping"
    WHERE valid_from <= $1
      AND valid_to >= $2
      AND collection_name = ANY($3)
      AND key->>'key' = ANY($4)
      AND (collection_name != 'prices' OR address = $5)
  `;

  return query<MappingHistoryElement>(sql, [
    endTime,
    startTime,
    GLOBAL_MAPPING_COLLECTIONS,
    relevantTokens,
    priceOracle,
  ]);
}

/**
 * Determine the set of token addresses that are "relevant" for a user's portfolio history.
 * Used to filter the pass-2 prices/configs/states query.
 *
 * Includes:
 * - Tokens the user directly holds (from _balances[user])
 * - Tokens the user has collateralized or debt against (from userCollaterals/vaults key.key2)
 * - Pool component tokens (tokenA, tokenB) for LP tokens the user holds
 * - borrowableAsset for lending market (mToken) tokens the user holds
 * - Underlying assets for carry vaults (needed for value calculation of claimable/queued)
 * - Vault supported assets and share token
 * - STRATO token (if user has staked STRATO)
 */
function computeRelevantTokens(
  storageHistory: StorageHistoryElement[],
  userMappingHistory: MappingHistoryElement[],
  vaultConfig: { shareToken: string; botExecutor: string; supportedAssets: string[] } | null,
  carryVaultAddrs: string[],
  userAddress: string,
  stratoTokenAddress?: string,
): string[] {
  const tokens = new Set<string>();
  const userBalancePath = `_balances[${userAddress}]`;
  let hasStakingData = false;

  // 1. Direct tokens from user mapping rows
  for (const row of userMappingHistory) {
    if (row.collection_name === '_balances') {
      // Only _balances[user] rows indicate direct user holdings.
      // Other _balances paths (liquidity pool, bot executor, carry vaults) are
      // infrastructure balances — their token prices are covered via storage below.
      if (row.path === userBalancePath) {
        tokens.add(row.address);
      }
    } else if (row.collection_name === 'userCollaterals' || row.collection_name === 'vaults') {
      // Token address is in key.key2
      const tokenAddr = (row.key as any)?.key2;
      if (tokenAddr) tokens.add(tokenAddr);
    } else if (row.collection_name === 'delegatedStake' || row.collection_name === 'unbondingQueue') {
      // User has staking data — we need STRATO token price
      hasStakingData = true;
    }
  }

  // 2. Component tokens derived from user's holdings (via storage rows)
  for (const row of storageHistory) {
    const data = row.data || {};

    // LP tokens → add tokenA, tokenB
    if (data.lpToken && tokens.has(data.lpToken)) {
      if (data.tokenA) tokens.add(data.tokenA);
      if (data.tokenB) tokens.add(data.tokenB);
    }

    // mTokens (lending market shares) → add borrowableAsset
    if (data.mToken && tokens.has(data.mToken)) {
      if (data.borrowableAsset) tokens.add(data.borrowableAsset);
    }

    // Carry vaults → add underlying asset (used for claimable/queued valuation)
    if (data.deployedAssets != null && carryVaultAddrs.includes(row.address)) {
      if (data._asset) tokens.add(data._asset);
    }
  }

  // 3. Vault config assets (always include — if user holds vault share, we need them)
  if (vaultConfig) {
    for (const asset of vaultConfig.supportedAssets) {
      if (asset) tokens.add(asset);
    }
    if (vaultConfig.shareToken) tokens.add(vaultConfig.shareToken);
  }

  // 4. STRATO token (needed for staked STRATO valuation)
  if (hasStakingData && stratoTokenAddress) {
    tokens.add(stratoTokenAddress);
  }

  return Array.from(tokens);
}

/**
 * Fetch vault config needed for portfolio history directly from cirrus DB.
 * Replaces the 3 HTTP calls in getVaultHistoryConfig (vault.service.ts).
 * Only fetches the fields needed for history: shareToken, botExecutor, supportedAssets.
 */
export async function fetchVaultHistoryConfig(
  vaultAddress: string,
): Promise<{ shareToken: string; botExecutor: string; supportedAssets: string[] } | null> {
  if (!vaultAddress) return null;

  const [vaultRows, assetRows] = await Promise.all([
    query<{ shareToken: string; botExecutor: string }>(
      `SELECT "shareToken", "botExecutor" FROM "BlockApps-Vault" WHERE address = $1 LIMIT 1`,
      [vaultAddress],
    ),
    query<{ value: string }>(
      `SELECT value::text FROM "BlockApps-Vault-supportedAssets" WHERE address = $1`,
      [vaultAddress],
    ),
  ]);

  if (!vaultRows.length) return null;

  return {
    shareToken: vaultRows[0].shareToken || "",
    botExecutor: vaultRows[0].botExecutor || "",
    supportedAssets: assetRows
      .map((a) => a.value)
      .filter((addr) => addr && addr !== "0000000000000000000000000000000000000000"),
  };
}

/**
 * Fetch active request IDs for all carry vaults + user in a single query.
 * Replaces N separate fetchActiveRequestId calls.
 */
export async function fetchActiveRequestIds(
  vaultAddresses: string[],
  userAddress: string,
): Promise<Map<string, string>> {
  if (vaultAddresses.length === 0) return new Map();

  const sql = `
    SELECT address, value::text
    FROM "BlockApps-YieldVault-activeRequestId"
    WHERE address = ANY($1) AND key = $2
  `;
  const rows = await query<{ address: string; value: string }>(sql, [
    vaultAddresses,
    userAddress,
  ]);

  const result = new Map<string, string>();
  for (const row of rows) {
    if (row.value && row.value !== "0") {
      result.set(row.address, row.value);
    }
  }
  return result;
}

/**
 * Latest _symbol per token address from history@storage.
 * Used so graph point logs can show real symbols for plain tokens
 * (ETH/STRATO/VOUCHER etc.) that are not in the LP/vault storage filter.
 */
async function fetchTokenSymbols(addresses: string[]): Promise<Map<string, string>> {
  if (addresses.length === 0) return new Map();

  const sql = `
    SELECT DISTINCT ON (address) address, data->>'_symbol' AS symbol
    FROM "history@storage"
    WHERE address = ANY($1)
      AND data->>'_symbol' IS NOT NULL
      AND data->>'_symbol' != ''
    ORDER BY address, valid_from DESC
  `;
  const rows = await query<{ address: string; symbol: string }>(sql, [addresses]);
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.symbol) map.set(row.address, row.symbol);
  }
  return map;
}

/**
 * Direct-SQL version of getHistory for the net-balance-history endpoint.
 *
 * Two-pass approach:
 *   Pass 1: Fetch storage history + user-specific mapping rows in parallel.
 *   Compute relevant-tokens set from pass 1 results.
 *   Pass 2: Fetch prices/configs/states filtered to relevant tokens only.
 *
 * This avoids pulling prices for every token on the platform when the user only
 * holds a handful of them — typically a 10-30x reduction in returned rows.
 */
export async function getHistoryDirect(
  params: HistoryParams,
  storageFilterParams: NetBalanceStorageFilterParams,
  mappingFilterParams: NetBalanceMappingFilterParams,
  vaultConfig: { shareToken: string; botExecutor: string; supportedAssets: string[] } | null,
  initialSnapshotData: any,
  storageReducer: (data: any, element: StorageHistoryElement) => any,
  mappingReducer: (data: any, element: MappingHistoryElement) => any,
  snapshotFn: (snapshot: HistorySnapshot, index: number) => HistorySnapshot,
): Promise<HistorySnapshot[]> {
  const startTimestamp =
    params.endTimestamp - params.interval * params.numTicks;
  const startTime = new Date(startTimestamp).toISOString();
  const endTime = new Date(params.endTimestamp).toISOString();

  // Pass 1: storage + user-specific mapping rows (parallel)
  const [storageHistory, userMappingHistory] = await Promise.all([
    fetchStorageHistory(startTime, endTime, storageFilterParams),
    fetchUserMappingHistory(startTime, endTime, mappingFilterParams),
  ]);

  // Compute relevant tokens set
  const relevantTokens = computeRelevantTokens(
    storageHistory,
    userMappingHistory,
    vaultConfig,
    mappingFilterParams.carryVaultAddrs,
    mappingFilterParams.userAddress,
    mappingFilterParams.stratoTokenAddress,
  );

  // Pass 2: prices/configs/states filtered to relevant tokens
  const globalMappingHistory = await fetchGlobalMappingHistory(
    startTime,
    endTime,
    relevantTokens,
    mappingFilterParams.priceOracle,
  );

  const mappingHistory = [...userMappingHistory, ...globalMappingHistory];

  // Dedup and sort for consistent processing
  const dedupedStorage = sortByBroadFirst(
    dedupByKey(storageHistory, (row) => `${row.address}|${row.valid_from}|${row.valid_to}`)
  );
  const dedupedMapping = sortByBroadFirst(
    dedupByKey(mappingHistory, (row) => 
      `${row.address}|${row.collection_name}|${row.path}|${row.valid_from}|${row.valid_to}`
    )
  );

  console.log(`[getHistoryDirect] Storage: ${storageHistory.length} → ${dedupedStorage.length} after dedup | Mapping: ${mappingHistory.length} → ${dedupedMapping.length} after dedup | tokens=${relevantTokens.length}`);

  // Seed address→symbol so graph point logs show real symbols (not UNKNOWN)
  const symbolMap = await fetchTokenSymbols(relevantTokens);
  const seededInitial = {
    ...initialSnapshotData,
    tokens: { ...(initialSnapshotData.tokens || {}) },
  };
  for (const [addr, symbol] of symbolMap) {
    seededInitial.tokens[addr] = {
      ...(seededInitial.tokens[addr] || {}),
      symbol,
    };
  }

  return buildSnapshots(
    params,
    dedupedStorage,
    dedupedMapping,
    seededInitial,
    storageReducer,
    mappingReducer,
    snapshotFn,
  );
}
