/**
 * eth-carry YieldVault protocol-fee sweep keeper.
 * Design: design-documents/eth-carry-yield-vault-fee-sweep.md
 *
 * The strategy EOA holds wstETH that grows at the gross Base APY while depositors
 * are only owed the vault's perSecondSavingsRate. This script computes the spread
 * (protocol revenue) for the window since the last sweep and transfers that much
 * wstETH from the strategy EOA to the FeeCollector. It never touches vault state:
 * the transfer is an ERC-20 `transferFrom` signed by a dedicated RevenueSweeper
 * key that the strategy has approved (`approve(sweeper, allowance)` — a one-time
 * operator action from the strategy; the keeper never holds the strategy's creds).
 * Keep the allowance modest and top it up periodically: a compromised sweeper can
 * move at most the outstanding allowance.
 *
 * Signing: the sweeper is a raw private key (SWEEPER_PRIVATE_KEY), not a Keycloak
 * account. The transferFrom is a legacy EIP-155 RLP transaction (gasPrice 0, ABI
 * calldata) submitted via eth_sendRawTransaction to the node's /rpc endpoint — the
 * same path external wallets (MetaMask) take in the UI (app/ui/src/pages/Transfer.tsx,
 * app/ui/src/lib/stratoChain.ts). Cirrus reads still need a Bearer token, so the
 * script also takes read-only OAuth creds (CIRRUS_READER_*) for any low-privilege
 * account — it signs nothing and holds no allowance.
 *
 * Amount = clamp(baseAccrual − savingsAccrual, 0, W×R − strategyDebt − buffer):
 *   - savingsAccrual is EXACT: Σ targetAmount over the vault's Accrued events
 *     (full history) plus the pending un-checkpointed accrual, minus the cumulative
 *     already counted at the previous sweep (stored in the state file).
 *   - baseAccrual integrates strategyDebt over the CapitalDeployed / CapitalReturned /
 *     StrategyLossReported timeline at the benchmark baseApyPct, so mid-window
 *     deploys/returns don't skew the estimate. The first run (no lastSweepTs)
 *     anchors at the strategy's first CapitalDeployed event.
 *   - The surplus cap is the only hard solvency invariant: the sweep always leaves
 *     strategyDebt + buffer behind, whatever the target says.
 *
 * Exactly-once: a pending intent (amount + new checkpoint values) is written to the
 * state file BEFORE the transfer and committed after it confirms. On startup the
 * script reconciles any leftover intent against the indexed wstETH Transfer events,
 * so a crash between transfer landing and checkpoint write cannot double-sweep.
 *
 * Usage (from app/contracts):
 *   node deploy/sweep-yield-vault-fees.js --vault <addr> --fee-collector <addr> \
 *        --wsteth <addr> --buffer-wei <wei> [--strategy <addr>] [--dry-run]
 *
 * Arguments (each falls back to the env var in parentheses):
 *   --vault <addr>          YieldVault proxy address (YIELD_VAULT)
 *   --strategy <addr>       Strategy EOA (STRATEGY_ADDRESS); auto-discovered when the
 *                           vault has exactly one strategy with debt
 *   --fee-collector <addr>  FeeCollector address (FEE_COLLECTOR)
 *   --wsteth <addr>         wstETH Token address (WSTETH_TOKEN)
 *   --buffer-wei <wei>      Safety buffer in ETH wei left above principal (BUFFER_WEI)
 *   --base-apy-pct <pct>    Benchmark Base APY override (BASE_APY_PCT); when absent it
 *                           is fetched from BACKEND_URL /earn/yield-vault/<key>/info
 *   --vault-key <key>       Backend vault key for the APY fetch, default eth-carry (VAULT_KEY)
 *   --poll-timeout <ms>     Transfer confirmation timeout, default 180000
 *   --dry-run               Compute and log everything; transfer nothing. Only
 *                           lastRunTs is written to the state file.
 *
 * Required environment variables (.env in app/contracts):
 *   OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,
 *   SWEEPER_PRIVATE_KEY (hex; signs the transferFrom — the sweeper address is
 *   derived from it, and the strategy's approve() must target that address)
 *   CIRRUS_READER_NAME, CIRRUS_READER_PASSWORD (any low-privilege account; Bearer
 *   token for Cirrus reads only — signs nothing)
 *   OAUTH_TOTP (only if the reader account is OTP-gated)
 *   BACKEND_URL (unless --base-apy-pct/BASE_APY_PCT is given)
 *   RPC_URL (defaults to NODE_URL + /rpc), CHAIN_ID (defaults to eth_chainId),
 *   SWEEPER_GAS_LIMIT (default 1000000, gasPrice is always 0 on STRATO)
 *   PRICE_ORACLE (defaults to the system oracle 0000000000000000000000000000000000001002)
 *   MAX_BASE_APY_PCT (sanity bound on the benchmark, default 50)
 *
 * Exit codes: 0 = swept or clean no-op; 2 = skipped with ALERT (strategy at/under
 * principal, or state needs manual attention); 1 = error (fail closed, nothing sent).
 * Lines prefixed "ALERT:" go to stderr — point cron output at your alerting.
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const RAY = 10n ** 27n;
const WAD = 10n ** 18n;
const SECONDS_PER_YEAR = 31536000; // matches backend yieldVault.service.ts
const VAULT_TABLE = 'BlockApps-YieldVault';
const STRATEGY_DEBT_TABLE = 'BlockApps-YieldVault-strategyDebt';
const BALANCES_TABLE = 'BlockApps-Token-_balances';
const ALLOWANCES_TABLE = 'BlockApps-Token-_allowances';
const PRICES_TABLE = 'BlockApps-PriceOracle-prices';
// Event args are typed top-level columns in per-event Cirrus tables. Big uints MUST
// be selected with ::text — the raw columns come back as JSON numbers and lose
// precision above 2^53 (~9e15 wei is only 0.009 ETH).
const ACCRUED_TABLE = 'BlockApps-YieldVault-Accrued';
const CAPITAL_DEPLOYED_TABLE = 'BlockApps-YieldVault-CapitalDeployed';
const CAPITAL_RETURNED_TABLE = 'BlockApps-YieldVault-CapitalReturned';
const STRATEGY_LOSS_TABLE = 'BlockApps-YieldVault-StrategyLossReported';
const TRANSFER_TABLE = 'BlockApps-Token-Transfer';
const EVENT_PAGE_SIZE = 1000;
const DEFAULT_PRICE_ORACLE = '0000000000000000000000000000000000001002';

const normalizeAddr = (value) => String(value || '').toLowerCase().replace(/^0x/, '');
const isZeroAddr = (value) => !value || /^0+$/.test(normalizeAddr(value));
// Cirrus renders block_timestamp as "2026-08-10 20:28:43 UTC" (not ISO 8601).
const toEpochSec = (ts) => {
  const ms = Date.parse(String(ts).replace(' UTC', 'Z').replace(' ', 'T'));
  if (!Number.isFinite(ms)) throw new Error(`Unparseable timestamp: ${ts}`);
  return Math.floor(ms / 1000);
};
const toIso = (epochSec) => new Date(epochSec * 1000).toISOString();
const fmtEth = (wei) => `${wei} wei (${Number(wei) / 1e18})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CONFIRM_POLL_INTERVAL_MS = 3000;

function printUsage() {
  console.error('Usage: node deploy/sweep-yield-vault-fees.js --vault <addr> --fee-collector <addr> \\');
  console.error('            --wsteth <addr> --buffer-wei <wei> [--strategy <addr>] [--dry-run]');
  console.error('Env (.env): OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,');
  console.error('            SWEEPER_PRIVATE_KEY, CIRRUS_READER_NAME, CIRRUS_READER_PASSWORD [, OAUTH_TOTP, BACKEND_URL]');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    if (key === 'dry-run') {
      parsed[key] = true;
      continue;
    }
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for argument: ${args[i]}`);
    }
    parsed[key] = value;
    i++;
  }
  return parsed;
}

// Mirrors the vault's _rpow (YieldVault.sol) and the backend's rpowRay.
function rpow(x, n, base) {
  if (x === 0n) return n === 0n ? base : 0n;
  let z = n % 2n === 0n ? base : x;
  const half = base / 2n;
  for (n = n / 2n; n > 0n; n = n / 2n) {
    x = (x * x + half) / base;
    if (n % 2n === 1n) z = (z * x + half) / base;
  }
  return z;
}

// ---------------------------------------------------------------------------
// Cirrus
// ---------------------------------------------------------------------------

async function cirrus(tokenObj, tableName, params) {
  const baseUrl = config.nodes[0].url.replace(/\/$/, '');
  const { data } = await axios.get(`${baseUrl}/cirrus/search/${tableName}`, {
    headers: { Authorization: `Bearer ${tokenObj.token}` },
    params,
  });
  return Array.isArray(data) ? data : [];
}

async function cirrusAll(tokenObj, tableName, params) {
  const rows = [];
  for (let offset = 0; ; offset += EVENT_PAGE_SIZE) {
    const page = await cirrus(tokenObj, tableName, {
      ...params,
      limit: String(EVENT_PAGE_SIZE),
      offset: String(offset),
    });
    rows.push(...page);
    if (page.length < EVENT_PAGE_SIZE) return rows;
  }
}

// ---------------------------------------------------------------------------
// State file (checkpoint). All bigints are stored as strings.
// ---------------------------------------------------------------------------

function stateFilePath(vault) {
  return path.join(__dirname, `sweep-yield-vault-fees.state.${vault}.json`);
}

function loadState(vault) {
  const file = stateFilePath(vault);
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed.nodeUrl && parsed.nodeUrl !== config.nodes[0].url) {
    throw new Error(
      `State file was written for a different node (${parsed.nodeUrl}); ` +
      'delete it or fix NODE_URL before re-running.'
    );
  }
  return parsed;
}

function saveState(vault, state) {
  const file = stateFilePath(vault);
  fs.writeFileSync(file, JSON.stringify({ ...state, nodeUrl: config.nodes[0].url }, null, 2));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function readVaultState(tokenObj, vault) {
  const [vaultRows, storageRows] = await Promise.all([
    cirrus(tokenObj, VAULT_TABLE, {
      address: `eq.${vault}`,
      select: 'address,_asset,_totalSupply::text',
    }),
    cirrus(tokenObj, 'storage', {
      address: `eq.${vault}`,
      select:
        'data->>accrualInitialized,data->>accrualBaseAssets,data->>perSecondSavingsRate,data->>lastAccrual,data->>rewardDistributor',
      limit: '1',
    }),
  ]);
  if (!vaultRows.length) throw new Error(`Vault ${vault} not found in ${VAULT_TABLE}`);
  const distinct = new Set(vaultRows.map((r) => JSON.stringify(r)));
  if (distinct.size > 1) throw new Error(`Inconsistent Cirrus rows for vault ${vault}`);
  if (!storageRows.length) throw new Error(`Vault ${vault} accrual storage not found`);
  const v = vaultRows[0];
  const s = storageRows[0];
  const accrualInitialized =
    s.accrualInitialized === true || String(s.accrualInitialized).toLowerCase() === 'true';
  return {
    asset: normalizeAddr(v._asset),
    totalSupply: BigInt(v._totalSupply || '0'),
    accrualInitialized,
    accrualBaseAssets: BigInt(s.accrualBaseAssets || '0'),
    perSecondSavingsRate: BigInt(s.perSecondSavingsRate || '0'),
    lastAccrual: BigInt(s.lastAccrual || '0'),
    rewardDistributor: normalizeAddr(s.rewardDistributor),
  };
}

async function readStrategyDebt(tokenObj, vault, strategy) {
  const rows = await cirrus(tokenObj, STRATEGY_DEBT_TABLE, {
    address: `eq.${vault}`,
    key: `eq.${strategy}`,
    select: 'value::text',
  });
  const values = new Set(rows.map((r) => String(r.value || '0')));
  if (values.size > 1) throw new Error(`Inconsistent strategyDebt rows for ${strategy}`);
  return BigInt(rows[0] ? String(rows[0].value || '0') : '0');
}

async function discoverStrategy(tokenObj, vault) {
  const rows = await cirrus(tokenObj, STRATEGY_DEBT_TABLE, {
    address: `eq.${vault}`,
    value: 'gt.0',
    select: 'key',
  });
  const strategies = [...new Set(rows.map((r) => normalizeAddr(r.key)))];
  if (strategies.length !== 1) {
    throw new Error(
      `Cannot auto-discover strategy: vault has ${strategies.length} strategies with debt ` +
      `(${strategies.join(', ') || 'none'}). Pass --strategy explicitly.`
    );
  }
  return strategies[0];
}

async function readTokenBalance(tokenObj, token, holder) {
  const rows = await cirrus(tokenObj, BALANCES_TABLE, {
    address: `eq.${token}`,
    key: `eq.${holder}`,
    select: 'value::text',
  });
  const values = new Set(rows.map((r) => String(r.value || '0')));
  if (values.size > 1) throw new Error(`Inconsistent balance rows for ${holder} on ${token}`);
  return BigInt(rows[0] ? String(rows[0].value || '0') : '0');
}

async function readTokenAllowance(tokenObj, token, owner, spender) {
  const rows = await cirrus(tokenObj, ALLOWANCES_TABLE, {
    address: `eq.${token}`,
    key: `eq.${owner}`,
    key2: `eq.${spender}`,
    select: 'value::text',
  });
  const values = new Set(rows.map((r) => String(r.value || '0')));
  if (values.size > 1) throw new Error(`Inconsistent allowance rows for ${owner}→${spender} on ${token}`);
  return BigInt(rows[0] ? String(rows[0].value || '0') : '0');
}

// The key that signs is the account whose allowance is spent — derive the sweeper
// address from the private key rather than trusting a config value.
function sweeperWallet() {
  const raw = String(process.env.SWEEPER_PRIVATE_KEY || '').trim();
  const key = raw.startsWith('0x') ? raw : `0x${raw}`;
  try {
    return new ethers.Wallet(key);
  } catch (error) {
    throw new Error(`SWEEPER_PRIVATE_KEY is not a valid private key: ${error.message}`);
  }
}

// R = wstETH/ETH as a WAD-scaled rate, from the oracle's WAD-scaled USD prices.
async function readWstEthRate(tokenObj, oracle, wstEth, ethAsset) {
  const rows = await cirrus(tokenObj, PRICES_TABLE, {
    address: `eq.${oracle}`,
    key: `in.(${wstEth},${ethAsset})`,
    select: 'asset:key,price:value::text',
  });
  const prices = new Map(rows.map((r) => [normalizeAddr(r.asset), BigInt(String(r.price || '0'))]));
  const pWst = prices.get(normalizeAddr(wstEth));
  const pEth = prices.get(normalizeAddr(ethAsset));
  if (!pWst || pWst <= 0n) throw new Error(`No oracle price for wstETH ${wstEth}`);
  if (!pEth || pEth <= 0n) throw new Error(`No oracle price for vault asset ${ethAsset}`);
  return (pWst * WAD) / pEth;
}

// Exact depositor entitlement since inception: Σ Accrued.targetAmount over the FULL
// event history (an accrual window can straddle a sweep boundary, so windowed sums
// would double-count) plus the pending un-checkpointed accrual from current state.
async function computeCumSavings(tokenObj, vault, vaultState, nowSec) {
  const rows = await cirrusAll(tokenObj, ACCRUED_TABLE, {
    address: `eq.${vault}`,
    select: 'targetAmount::text',
    order: 'id.asc',
  });
  let sum = 0n;
  for (const row of rows) {
    sum += BigInt(String(row.targetAmount || '0'));
  }
  // Pending term mirrors the vault's _pendingAccrual guards (activeSupply() is
  // totalSupply() in YieldVault.sol:138).
  const { accrualInitialized, accrualBaseAssets, perSecondSavingsRate, lastAccrual, rewardDistributor, totalSupply } = vaultState;
  let pending = 0n;
  if (
    accrualInitialized &&
    BigInt(nowSec) > lastAccrual &&
    totalSupply > 0n &&
    accrualBaseAssets > 0n &&
    perSecondSavingsRate > RAY &&
    !isZeroAddr(rewardDistributor)
  ) {
    const growth = rpow(perSecondSavingsRate, BigInt(nowSec) - lastAccrual, RAY);
    pending = (accrualBaseAssets * (growth - RAY)) / RAY;
  }
  return { cumSavings: sum + pending, accruedEventCount: rows.length, pending };
}

// Piecewise-constant strategyDebt timeline from the vault's capital events. Every
// event carries the post-change strategyDebt, so the timeline is just the sorted
// event sequence. CapitalReturned names its strategy column `from`; the others use
// `strategy`. Ordering across the three tables inside one block is best-effort —
// the caller's sanity check (timeline end == strategyDebt mapping) fails closed on
// any inconsistency.
async function buildDebtTimeline(tokenObj, vault, strategy) {
  const fetchCapitalEvents = (table, strategyColumn) =>
    cirrusAll(tokenObj, table, {
      address: `eq.${vault}`,
      [strategyColumn]: `eq.${strategy}`,
      select: 'strategyDebt::text,block_timestamp,block_number',
      order: 'id.asc',
    });
  const [deployed, returned, losses] = await Promise.all([
    fetchCapitalEvents(CAPITAL_DEPLOYED_TABLE, 'strategy'),
    fetchCapitalEvents(CAPITAL_RETURNED_TABLE, 'from'),
    fetchCapitalEvents(STRATEGY_LOSS_TABLE, 'strategy'),
  ]);
  return [...deployed, ...returned, ...losses]
    .map((row) => ({
      ts: toEpochSec(row.block_timestamp),
      blockNumber: Number(row.block_number || 0),
      debtWei: BigInt(String(row.strategyDebt || '0')),
    }))
    .sort((a, b) => a.blockNumber - b.blockNumber || a.ts - b.ts);
}

// Gross benchmark yield: Σ over segments of debt × ((1 + apy)^(dt/year) − 1).
// Per-segment simple compounding on principal only — yield-on-yield across segments
// is deliberately ignored, which slightly UNDERSTATES gross (conservative: a smaller
// fee target can never eat the depositor share).
function integrateGrossYield(timeline, anchorTs, endTs, apyPct) {
  let gross = 0n;
  for (let i = 0; i < timeline.length; i++) {
    const start = Math.max(timeline[i].ts, anchorTs);
    const end = Math.min(i + 1 < timeline.length ? timeline[i + 1].ts : endTs, endTs);
    if (end <= start || timeline[i].debtWei <= 0n) continue;
    const growth = Math.pow(1 + apyPct / 100, (end - start) / SECONDS_PER_YEAR) - 1;
    if (!Number.isFinite(growth) || growth < 0) {
      throw new Error(`Bad growth factor for apy=${apyPct}% over ${end - start}s`);
    }
    gross += (timeline[i].debtWei * BigInt(Math.round(growth * 1e18))) / WAD;
  }
  return gross;
}

async function fetchBaseApyPct(cli, vaultKey, strategy) {
  const override = cli['base-apy-pct'] || process.env.BASE_APY_PCT;
  const maxApy = Number(process.env.MAX_BASE_APY_PCT || '50');
  let apy;
  if (override !== undefined) {
    apy = Number(override);
  } else {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      throw new Error('Set BACKEND_URL or pass --base-apy-pct/BASE_APY_PCT');
    }
    const url = `${backendUrl.replace(/\/$/, '')}/earn/yield-vault/${vaultKey}/info`;
    const { data } = await axios.get(url);
    const holding = (data.strategyHoldings || []).find(
      (h) => normalizeAddr(h.strategyAddress) === strategy
    );
    if (!holding) throw new Error(`Strategy ${strategy} not in ${url} strategyHoldings`);
    apy = holding.baseApyPct;
  }
  if (typeof apy !== 'number' || !Number.isFinite(apy) || apy < 0) {
    throw new Error(`baseApyPct unavailable or invalid (${apy}) — failing closed`);
  }
  if (apy > maxApy) {
    throw new Error(`baseApyPct ${apy}% exceeds sanity bound MAX_BASE_APY_PCT=${maxApy}%`);
  }
  return apy;
}

// ---------------------------------------------------------------------------
// Transfers: query, send, confirm
// ---------------------------------------------------------------------------

// Only sweeps move wstETH strategy→feeCollector, so the full history is tiny.
// The time filter is applied client-side to stay independent of the server's
// timestamp-literal format ("2026-08-10 20:28:43 UTC").
async function findSweepTransfers(tokenObj, wstEth, strategy, feeCollector, sinceEpochSec) {
  const rows = await cirrusAll(tokenObj, TRANSFER_TABLE, {
    address: `eq.${wstEth}`,
    from: `eq.${strategy}`,
    to: `eq.${feeCollector}`,
    select: 'value::text,block_timestamp,transaction_hash',
    order: 'id.asc',
  });
  return rows
    .map((row) => ({
      value: BigInt(String(row.value || '0')),
      ts: toEpochSec(row.block_timestamp),
      hash: String(row.transaction_hash || ''),
    }))
    .filter((t) => t.ts >= sinceEpochSec);
}

async function rpcCall(method, params) {
  const url = process.env.RPC_URL || `${config.nodes[0].url.replace(/\/$/, '')}/rpc`;
  const { data } = await axios.post(url, { jsonrpc: '2.0', id: 1, method, params });
  if (data.error) throw new Error(`RPC ${method} failed: ${JSON.stringify(data.error)}`);
  return data.result;
}

// Legacy EIP-155 RLP transaction with gasPrice 0 and ABI calldata — the same shape
// external wallets submit in the UI (app/ui/src/pages/Transfer.tsx). Confirmation
// is the indexed Transfer row in Cirrus, matched by transaction hash — the same
// source of truth the reconciliation uses.
async function sendTransfer(tokenObj, wstEth, strategy, feeCollector, amountWei, pollTimeoutMs) {
  const wallet = sweeperWallet();
  const [nonceHex, chainIdHex] = await Promise.all([
    rpcCall('eth_getTransactionCount', [wallet.address, 'latest']),
    process.env.CHAIN_ID ? Promise.resolve(process.env.CHAIN_ID) : rpcCall('eth_chainId', []),
  ]);
  const iface = new ethers.Interface([
    'function transferFrom(address from, address to, uint256 value)',
  ]);
  const rawTx = await wallet.signTransaction({
    type: 0,
    chainId: BigInt(chainIdHex),
    nonce: Number(BigInt(nonceHex)),
    gasPrice: 0n,
    gasLimit: BigInt(process.env.SWEEPER_GAS_LIMIT || '1000000'),
    to: `0x${normalizeAddr(wstEth)}`,
    value: 0n,
    data: iface.encodeFunctionData('transferFrom', [
      `0x${strategy}`,
      `0x${feeCollector}`,
      amountWei,
    ]),
  });
  const txHash = normalizeAddr(await rpcCall('eth_sendRawTransaction', [rawTx]));
  console.log(`  Submitted tx ${txHash}, waiting for Cirrus to index the Transfer...`);
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    const landed = (await findSweepTransfers(tokenObj, wstEth, strategy, feeCollector, 0))
      .find((t) => normalizeAddr(t.hash) === txHash);
    if (landed) return landed.hash;
    await sleep(CONFIRM_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Transfer ${txHash} was not indexed within ${pollTimeoutMs}ms — it may still land. ` +
    'The pending intent is retained; the next run will reconcile it before sweeping again.'
  );
}

// ---------------------------------------------------------------------------
// Intent reconciliation (exactly-once)
// ---------------------------------------------------------------------------

function commitIntent(state, intent, txHash) {
  state.lastSweepTs = intent.newLastSweepTs;
  state.cumSavingsCounted = intent.newCumSavingsCounted;
  state.cumulativeSweptWst = (
    BigInt(state.cumulativeSweptWst || '0') + BigInt(intent.feeWstWei)
  ).toString();
  state.recordedTransferHashes = [...(state.recordedTransferHashes || []), txHash].slice(-10);
  delete state.pendingIntent;
}

async function reconcile(tokenObj, state, vault, wstEth, strategy, feeCollector) {
  if (state.pendingIntent) {
    const intent = state.pendingIntent;
    console.log(`  Found pending intent from ${intent.createdAtIso} (${fmtEth(intent.feeWstWei)} wstETH)`);
    const landed = (
      await findSweepTransfers(tokenObj, wstEth, strategy, feeCollector, toEpochSec(intent.createdAtIso))
    ).find((t) => t.value === BigInt(intent.feeWstWei));
    if (landed) {
      console.log(`  Intent transfer LANDED (tx ${landed.hash}) — committing checkpoint, not re-sweeping.`);
      commitIntent(state, intent, landed.hash);
    } else {
      console.log('  Intent transfer never landed — discarding intent.');
      delete state.pendingIntent;
    }
    saveState(vault, state);
  }
  // Any strategy→feeCollector transfer we did not record means someone swept outside
  // this script (or state was hand-edited); cumSavingsCounted can no longer be
  // trusted. Fail closed and make a human reconcile.
  if (state.lastSweepTs) {
    const recorded = new Set(state.recordedTransferHashes || []);
    const transfers = await findSweepTransfers(
      tokenObj, wstEth, strategy, feeCollector, Number(state.lastSweepTs)
    );
    const unexpected = transfers.filter((t) => !recorded.has(t.hash));
    if (unexpected.length) {
      throw new Error(
        'ALERT: unrecorded strategy→feeCollector transfer(s) found since lastSweepTs: ' +
        unexpected.map((t) => `${t.hash} (${t.value} wei @ ${toIso(t.ts)})`).join(', ') +
        ' — fix the state file manually before the next sweep.'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cli = parseArgs();
  const dryRun = Boolean(cli['dry-run']);
  const pollTimeoutMs = Number(cli['poll-timeout'] || '180000');
  const vault = normalizeAddr(cli.vault || process.env.YIELD_VAULT);
  const feeCollector = normalizeAddr(cli['fee-collector'] || process.env.FEE_COLLECTOR);
  const wstEth = normalizeAddr(cli.wsteth || process.env.WSTETH_TOKEN);
  const bufferRaw = cli['buffer-wei'] || process.env.BUFFER_WEI;
  const vaultKey = cli['vault-key'] || process.env.VAULT_KEY || 'eth-carry';
  const priceOracle = normalizeAddr(process.env.PRICE_ORACLE || DEFAULT_PRICE_ORACLE);
  if (!vault || !feeCollector || !wstEth || bufferRaw === undefined) {
    printUsage();
    throw new Error('Missing required arguments: --vault, --fee-collector, --wsteth, --buffer-wei');
  }
  const buffer = BigInt(bufferRaw);
  if (buffer < 0n) throw new Error('--buffer-wei must be >= 0');
  if (!process.env.SWEEPER_PRIVATE_KEY) {
    throw new Error('Set SWEEPER_PRIVATE_KEY (the RevenueSweeper key signs the transferFrom)');
  }
  if (!process.env.CIRRUS_READER_NAME || !process.env.CIRRUS_READER_PASSWORD) {
    throw new Error('Set CIRRUS_READER_NAME and CIRRUS_READER_PASSWORD (read-only Bearer token for Cirrus queries)');
  }
  const sweeper = normalizeAddr(sweeperWallet().address);

  console.log(`Sweep keeper for vault ${vault}${dryRun ? ' [DRY RUN]' : ''}`);
  const token = await auth.getUserToken(process.env.CIRRUS_READER_NAME, process.env.CIRRUS_READER_PASSWORD);
  const tokenObj = { token };

  const state = loadState(vault);
  const strategy = normalizeAddr(cli.strategy || process.env.STRATEGY_ADDRESS) ||
    (await discoverStrategy(tokenObj, vault));
  console.log(`  strategy=${strategy} sweeper=${sweeper} feeCollector=${feeCollector} wstETH=${wstEth}`);

  if (!dryRun) {
    await reconcile(tokenObj, state, vault, wstEth, strategy, feeCollector);
  } else if (state.pendingIntent) {
    console.log('  ! Pending intent exists; a live run would reconcile it first. Dry-run values below ignore it.');
  }

  // --- Reads (any failure aborts before anything is sent) ---
  const nowSec = Math.floor(Date.now() / 1000);
  const [vaultState, timeline] = await Promise.all([
    readVaultState(tokenObj, vault),
    buildDebtTimeline(tokenObj, vault, strategy),
  ]);
  const [strategyDebt, balanceWst, allowance, rate, savings, baseApyPct] = await Promise.all([
    readStrategyDebt(tokenObj, vault, strategy),
    readTokenBalance(tokenObj, wstEth, strategy),
    readTokenAllowance(tokenObj, wstEth, strategy, sweeper),
    readWstEthRate(tokenObj, priceOracle, wstEth, vaultState.asset),
    computeCumSavings(tokenObj, vault, vaultState, nowSec),
    fetchBaseApyPct(cli, vaultKey, strategy),
  ]);

  if (!timeline.length) throw new Error(`No capital events for strategy ${strategy} — nothing deployed yet`);
  const timelineDebt = timeline[timeline.length - 1].debtWei;
  if (timelineDebt !== strategyDebt) {
    throw new Error(
      `Debt timeline (${timelineDebt}) disagrees with strategyDebt mapping (${strategyDebt}) — ` +
      'Cirrus lag or missed events; failing closed.'
    );
  }

  // --- Amount formula (design doc "Amount formula — spread, capped by surplus") ---
  const anchorTs = state.lastSweepTs ? Number(state.lastSweepTs) : timeline[0].ts;
  if (!state.lastSweepTs) {
    console.log(`  First sweep: anchoring at first CapitalDeployed (${toIso(anchorTs)})`);
  }
  const cumSavingsCounted = BigInt(state.cumSavingsCounted || '0');
  const savingsAccrual = savings.cumSavings - cumSavingsCounted;
  if (savingsAccrual < 0n) {
    throw new Error(
      `cumSavings (${savings.cumSavings}) < cumSavingsCounted (${cumSavingsCounted}) — ` +
      'state file disagrees with chain history; failing closed.'
    );
  }
  const baseAccrual = integrateGrossYield(timeline, anchorTs, nowSec, baseApyPct);
  const targetFee = baseAccrual > savingsAccrual ? baseAccrual - savingsAccrual : 0n;
  const balanceEth = (balanceWst * rate) / WAD;
  const surplus = balanceEth - strategyDebt - buffer;
  const feeEth = targetFee < surplus ? targetFee : surplus;
  const feeWst = feeEth > 0n ? (feeEth * WAD) / rate : 0n;
  const clamped = surplus >= 0n && targetFee > surplus;

  console.log('  --- computed values ---');
  console.log(`  window:          ${toIso(anchorTs)} .. ${toIso(nowSec)} (${nowSec - anchorTs}s)`);
  console.log(`  baseApyPct:      ${baseApyPct}%`);
  console.log(`  strategyDebt:    ${fmtEth(strategyDebt)} ETH (timeline: ${timeline.length} capital events)`);
  console.log(`  savingsAccrual:  ${fmtEth(savingsAccrual)} ETH (${savings.accruedEventCount} Accrued events, pending ${savings.pending})`);
  console.log(`  baseAccrual:     ${fmtEth(baseAccrual)} ETH`);
  console.log(`  targetFeeETH:    ${fmtEth(targetFee)} ETH`);
  console.log(`  balance W:       ${fmtEth(balanceWst)} wstETH, rate R=${rate} (WAD), = ${fmtEth(balanceEth)} ETH`);
  console.log(`  allowance:       ${fmtEth(allowance)} wstETH (strategy → sweeper)`);
  console.log(`  surplusETH:      ${fmtEth(surplus)} ETH (buffer ${buffer})`);
  console.log(`  feeETH:          ${fmtEth(feeEth)} ETH${clamped ? '  [CLAMPED to surplus]' : ''}`);
  console.log(`  feeWstETH:       ${fmtEth(feeWst)} wstETH`);

  const finish = (code) => {
    state.lastRunTs = nowSec;
    saveState(vault, state);
    process.exit(code);
  };

  if (surplus <= 0n) {
    console.error(`ALERT: strategy at/under principal (surplus=${surplus}) — NOT sweeping. Investigate.`);
    finish(2);
  }
  if (clamped) {
    console.error('ALERT: fee target exceeds surplus — benchmark baseApyPct is likely overstating realized yield.');
  }
  if (feeWst <= 0n) {
    console.log('  Nothing to sweep this window.');
    finish(0);
  }
  if (allowance < feeWst) {
    if (dryRun) {
      console.log(`  ! Allowance ${allowance} < fee ${feeWst} — a live run would skip until the strategy tops up approve().`);
    } else {
      console.error(
        `ALERT: allowance ${allowance} < fee ${feeWst} — NOT sweeping. ` +
        `Have the strategy run approve(${sweeper}, <amount>) on the wstETH token, then re-run.`
      );
      finish(2);
    }
  }
  if (dryRun) {
    console.log('  DRY RUN: no transfer sent, checkpoint not advanced.');
    finish(0);
  }

  // --- Execute: intent → re-read & re-clamp → transfer → commit → health check ---
  state.pendingIntent = {
    createdAtIso: toIso(nowSec),
    feeWstWei: feeWst.toString(),
    newLastSweepTs: nowSec,
    newCumSavingsCounted: savings.cumSavings.toString(),
  };
  saveState(vault, state);

  // The operator's wstETH→ETH conversions drain the same address; re-read right
  // before sending so a stale start-of-run snapshot can't overdraw the cap.
  const freshBalance = await readTokenBalance(tokenObj, wstEth, strategy);
  let sendWst = feeWst;
  if (freshBalance !== balanceWst) {
    const freshSurplus = (freshBalance * rate) / WAD - strategyDebt - buffer;
    if (freshSurplus <= 0n) {
      console.error('ALERT: balance moved during run and surplus is gone — NOT sweeping.');
      delete state.pendingIntent;
      finish(2);
    }
    const freshSurplusWst = (freshSurplus * WAD) / rate;
    if (freshSurplusWst < sendWst) {
      console.log(`  Balance moved during run; re-clamping ${sendWst} -> ${freshSurplusWst} wstETH`);
      sendWst = freshSurplusWst;
      state.pendingIntent.feeWstWei = sendWst.toString();
      saveState(vault, state);
    }
  }

  console.log(`  Transferring ${fmtEth(sendWst)} wstETH (transferFrom ${strategy}) -> ${feeCollector} ...`);
  const txHash = await sendTransfer(tokenObj, wstEth, strategy, feeCollector, sendWst, pollTimeoutMs);
  console.log(`  Transfer confirmed: ${txHash}`);
  commitIntent(state, state.pendingIntent, txHash);
  saveState(vault, state);

  const afterBalance = await readTokenBalance(tokenObj, wstEth, strategy);
  const afterEth = (afterBalance * rate) / WAD;
  if (afterEth < strategyDebt + buffer) {
    console.error(
      `ALERT: post-sweep health check FAILED: W'×R (${afterEth}) < strategyDebt + buffer ` +
      `(${strategyDebt + buffer}). Investigate before the next run.`
    );
    finish(2);
  }
  console.log(`  Post-sweep health check OK (W'×R = ${fmtEth(afterEth)} ETH).`);
  console.log(`  Cumulative swept: ${fmtEth(BigInt(state.cumulativeSweptWst || '0'))} wstETH`);
  finish(0);
}

main().catch((error) => {
  const message = String((error && error.message) || error);
  console.error(message.startsWith('ALERT:') ? message : `Error: ${message}`);
  process.exit(message.startsWith('ALERT:') ? 2 : 1);
});
