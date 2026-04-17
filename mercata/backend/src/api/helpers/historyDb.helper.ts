import { query } from "../../utils/dbService";
import {
  HistoryParams,
  HistorySnapshot,
  StorageHistoryElement,
  MappingHistoryElement,
} from "./history.helper";

export interface BuildSnapshotsResult {
  snapshots: HistorySnapshot[];
  applyStorageMs: number;
  applyMappingMs: number;
  snapshotFnMs: number;
}

/**
 * Reconstruct time-series snapshots from raw history rows.
 * Rows should be sorted by valid_from for optimal early-termination in the inner loops.
 * Returns the snapshots along with phase timings (for profiling).
 */
export function buildSnapshots(
  params: HistoryParams,
  storageHistory: StorageHistoryElement[],
  mappingHistory: MappingHistoryElement[],
  initialSnapshotData: any,
  storageReducer: (data: any, element: StorageHistoryElement) => any,
  mappingReducer: (data: any, element: MappingHistoryElement) => any,
  snapshotFn: (snapshot: HistorySnapshot, index: number) => HistorySnapshot,
): BuildSnapshotsResult {
  const { endTimestamp, interval, numTicks } = params;
  const startTimestamp = endTimestamp - interval * numTicks;

  const snapshots: HistorySnapshot[] = new Array(numTicks + 1)
    .fill(null)
    .map((_, i) => ({
      timestamp: endTimestamp - interval * (numTicks - i),
      data: initialSnapshotData,
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
          if (snapshots[i].timestamp <= validTo) {
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
            snapshots[i].timestamp <= validTo
          ) {
            snapshots[i].data = reducer(snapshots[i].data, h);
          }
          if (snapshots[i].timestamp > validTo) {
            break;
          }
        }
      }
    }
  };

  const tStorageStart = performance.now();
  applyRows(storageHistory, storageReducer);
  const tMappingStart = performance.now();
  applyRows(mappingHistory, mappingReducer);
  const tSnapshotFnStart = performance.now();
  const finalized = snapshots.map((snapshot, i) => snapshotFn(snapshot, i));
  const tEnd = performance.now();

  return {
    snapshots: finalized,
    applyStorageMs: tMappingStart - tStorageStart,
    applyMappingMs: tSnapshotFnStart - tMappingStart,
    snapshotFnMs: tEnd - tSnapshotFnStart,
  };
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
    ORDER BY valid_from
  `;

  return query<StorageHistoryElement>(sql, [endTime, startTime, addressList]);
}

/**
 * Fetch mapping history rows directly from Postgres.
 *
 * Optimizations vs PostgREST OR-filter approach:
 * - The three `path LIKE 'prices[%'`, `path LIKE 'collateralConfigs[%'`,
 *   `path LIKE 'collateralGlobalStates[%'` are replaced by a single
 *   `collection_name IN (...)` check — those LIKE patterns were only needed because
 *   PostgREST had no way to express "all rows in these collections within the time range".
 *   The collection_name filter already constrains which collections are returned, so for
 *   prices/collateralConfigs/collateralGlobalStates we just need to NOT require a path match.
 * - Multiple `path = _balances[addr]` consolidated into a single ANY() array.
 * - Multiple `(address = X AND path = claimableAssets[user])` for each carry vault
 *   consolidated into `(address = ANY(cvAddrs) AND path = singleClaimablePath)`.
 * - Request filters consolidated into `(address, path) IN (VALUES ...)` or ANY() pairs.
 */
export async function fetchMappingHistory(
  startTime: string,
  endTime: string,
  collectionNames: string[],
  filters: NetBalanceMappingFilterParams,
): Promise<MappingHistoryElement[]> {
  // Collections whose rows are needed in full (no path filter required).
  // In PostgREST these required individual `path LIKE 'collName[%'` ORs.
  const globalCollections = ['prices', 'collateralConfigs', 'collateralGlobalStates'];

  // Build the _balances path array: user-specific paths + bot executor + carry vault idle assets
  const balancePaths: string[] = [
    '_balances[0000000000000000000000000000000000001004]', // liquidity pool
  ];
  if (filters.botExecutor) {
    balancePaths.push(`_balances[${filters.botExecutor}]`);
  }
  for (const addr of filters.carryVaultAddrs) {
    balancePaths.push(`_balances[${addr}]`);
  }

  // Claimable assets: same path for all carry vaults, different addresses
  const claimablePath = `claimableAssets[${filters.userAddress}]`;

  // Request filter (address, path) pairs
  const requestAddrs: string[] = [];
  const requestPaths: string[] = [];
  for (const rf of filters.requestFilters) {
    requestAddrs.push(rf.address);
    requestPaths.push(rf.path);
  }

  // $1 = endTime, $2 = startTime, $3 = collectionNames,
  // $4 = userAddress path pattern, $5 = globalCollections,
  // $6 = balancePaths, $7 = carryVaultAddrs, $8 = claimablePath,
  // $9 = requestAddrs, $10 = requestPaths
  const sql = `
    SELECT address, collection_name, key, path, value, valid_from, valid_to
    FROM "history@mapping"
    WHERE valid_from <= $1
      AND valid_to >= $2
      AND collection_name = ANY($3)
      AND (
        -- User-specific rows: balances, collaterals, loans, vaults
        path LIKE $4
        -- Global reference data: all rows for prices, collateralConfigs, collateralGlobalStates
        OR collection_name = ANY($5)
        -- Specific _balances lookups (liquidity pool, bot executor, carry vault idle assets)
        OR path = ANY($6)
        -- Carry vault claimable assets for this user
        OR (address = ANY($7) AND path = $8)
        -- Carry vault pending withdrawal requests
        OR (address = ANY($9) AND path = ANY($10))
      )
    ORDER BY valid_from
  `;

  return query<MappingHistoryElement>(sql, [
    endTime,
    startTime,
    collectionNames,
    `%${filters.userAddress}%`,
    globalCollections,
    balancePaths,
    filters.carryVaultAddrs,
    claimablePath,
    requestAddrs.length > 0 ? requestAddrs : [''],
    requestPaths.length > 0 ? requestPaths : [''],
  ]);
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

export interface HistoryDirectTimings {
  sqlMs: number;
  storageRows: number;
  mappingRows: number;
  applyStorageMs: number;
  applyMappingMs: number;
  snapshotFnMs: number;
  numSnapshots: number;
}

export interface HistoryDirectResult {
  snapshots: HistorySnapshot[];
  timings: HistoryDirectTimings;
}

/**
 * Direct-SQL version of getHistory for the net-balance-history endpoint.
 * Fetches storage + mapping history in parallel, then reconstructs snapshots.
 * Returns per-phase timings for profiling.
 */
export async function getHistoryDirect(
  params: HistoryParams,
  storageFilterParams: NetBalanceStorageFilterParams,
  mappingFilterParams: NetBalanceMappingFilterParams,
  collectionNames: string[],
  initialSnapshotData: any,
  storageReducer: (data: any, element: StorageHistoryElement) => any,
  mappingReducer: (data: any, element: MappingHistoryElement) => any,
  snapshotFn: (snapshot: HistorySnapshot, index: number) => HistorySnapshot,
): Promise<HistoryDirectResult> {
  const startTimestamp =
    params.endTimestamp - params.interval * params.numTicks;
  const startTime = new Date(startTimestamp).toISOString();
  const endTime = new Date(params.endTimestamp).toISOString();

  const tSqlStart = performance.now();
  const [storageHistory, mappingHistory] = await Promise.all([
    fetchStorageHistory(startTime, endTime, storageFilterParams),
    fetchMappingHistory(startTime, endTime, collectionNames, mappingFilterParams),
  ]);
  const sqlMs = performance.now() - tSqlStart;

  const { snapshots, applyStorageMs, applyMappingMs, snapshotFnMs } = buildSnapshots(
    params,
    storageHistory,
    mappingHistory,
    initialSnapshotData,
    storageReducer,
    mappingReducer,
    snapshotFn,
  );

  return {
    snapshots,
    timings: {
      sqlMs,
      storageRows: storageHistory.length,
      mappingRows: mappingHistory.length,
      applyStorageMs,
      applyMappingMs,
      snapshotFnMs,
      numSnapshots: snapshots.length,
    },
  };
}
