/**
 * V3 position-NFT rollout: one-shot, idempotent upgrade script for admins.
 *
 * Rolls out the PositionManagerV3 (position NFTs) feature to a network where the
 * PoolV3Factory, its pools, and a PositionManagerV3 proxy already exist. Under a
 * SINGLE authentication it:
 *
 *   1. Deploys a new PoolV3Factory implementation (whose code collection contains the
 *      updated PoolV3 with getPositionFeeGrowthInside) and points the factory proxy at
 *      it — so pools created in the FUTURE are stamped from the new code.
 *   2. Deploys one new PoolV3 implementation and points every EXISTING pool proxy at
 *      it. Pool state (price, ticks, positions, balances) lives in the proxies and is
 *      untouched.
 *   3. Deploys a new PositionManagerV3 implementation and points the manager proxy at
 *      it, then initializes the proxy (name/symbol, factory wiring) if not already
 *      initialized. The manager proxy's logic is (re)pointed every run, so this is also
 *      the path for shipping later manager logic fixes.
 *   4. Verifies: EVERY proxy (factory, pools, AND manager) points at the new
 *      implementation, pool prices are unchanged, and the new getter answers through a
 *      pool proxy. A run that discovers ZERO pools is reported as INCOMPLETE (not
 *      success) unless --allow-no-pools is given, since it usually means Cirrus lag or a
 *      wrong --factory rather than a genuinely empty network.
 *
 * The script is IDEMPOTENT and safe to re-run:
 *   - Implementation addresses AND in-flight governance issues are recorded in a state
 *     file next to this script (upgrade-poolv3-nft.state.<factory>.json), so a re-run
 *     reuses/resumes them instead of deploying duplicates.
 *   - Proxies already pointing at the target implementation are skipped.
 *   - On networks with MULTIPLE AdminRegistry admins, EVERYTHING here is vote-gated:
 *     contract creation routes through the caller's user-contract and raises a
 *     CREATE-ISSUE (the implementation only exists once it's voted through), and
 *     setLogicContract/initialize likewise surface vote issues. The script waits a
 *     bounded time for each effect, then reports PENDING with the issue ids — have the
 *     other admins vote (Vote-on-Issues tab), then RE-RUN this script; it picks up
 *     where it left off. (Single-admin networks execute inline; nothing is pending.)
 *
 * Usage (from app/contracts):
 *   node deploy/upgrade-poolv3-nft.js --factory <factory-proxy> --manager <manager-proxy> [--dry-run]
 *
 * Arguments:
 *   --factory <addr>        PoolV3Factory PROXY address (falls back to env POOL_V3_FACTORY)
 *   --manager <addr>        PositionManagerV3 PROXY address (falls back to env POSITION_MANAGER_V3)
 *   --factory-impl <addr>   Reuse an already-deployed PoolV3Factory implementation
 *   --pool-impl <addr>      Reuse an already-deployed PoolV3 implementation
 *   --manager-impl <addr>   Reuse an already-deployed PositionManagerV3 implementation
 *   --poll-timeout <ms>     How long to wait for each on-chain effect (default 180000)
 *   --allow-no-pools        Accept "zero pools discovered" as success (genuinely empty network)
 *   --dry-run               Discover and print the plan; change nothing
 *
 * Required environment variables (.env in app/contracts):
 *   OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,
 *   GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD (an AdminRegistry admin)
 *   OAUTH_TOTP (only if the account is OTP-gated)
 *
 * Exit codes: 0 = everything applied and verified; 2 = steps pending governance votes
 * (re-run after voting); 1 = error.
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, importer, util } = require('blockapps-rest');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const FACTORY_IMPL = { name: 'PoolV3Factory', file: 'Pools/PoolV3Factory.sol' };
const POOL_IMPL = { name: 'PoolV3', file: 'Pools/PoolV3.sol' };
const MANAGER_NAME = 'PositionManagerV3';
const MANAGER_IMPL = { name: MANAGER_NAME, file: 'Pools/PositionManagerV3.sol' };
// The owner of an implementation contract is ignored in favor of the proxy owner
const CONSTRUCTOR_ARGS = { initialOwner: 'deadbeef' };
const EFFECT_POLL_INTERVAL_MS = 5000;

const normalizeAddr = (value) => String(value || '').toLowerCase().replace(/^0x/, '');
const isZeroAddr = (value) => !value || /^0+$/.test(normalizeAddr(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printUsage() {
  console.error('Usage: node deploy/upgrade-poolv3-nft.js --factory <factory-proxy> --manager <manager-proxy> [--dry-run]');
  console.error('');
  console.error('Optional: --factory-impl <addr> --pool-impl <addr> --poll-timeout <ms>');
  console.error('Env (.env): OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,');
  console.error('            GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD [, OAUTH_TOTP]');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    if (key === 'dry-run' || key === 'allow-no-pools') {
      parsed[key] = true;
      continue;
    }
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for argument: ${args[i]}`);
    parsed[key] = value;
    i++;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Source preparation (same conventions as upgrade.js / deploy.js)
// ---------------------------------------------------------------------------

const stripComments = (str) => {
  let out = str.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.split('\n').map((ln) => {
    const t = ln.trim();
    if (t.startsWith('//')) {
      return t.includes('SPDX-License-Identifier') ? ln : '';
    }
    return ln.replace(/\/\/.*$/, '');
  }).join('\n');
  return out;
};

async function combineSource(contractFile) {
  const contractsDir = config.resolvePath(config.contractsDir);
  const contractFilePath = path.join(contractsDir, contractFile);
  if (!fs.existsSync(contractFilePath)) {
    throw new Error(`Contract file not found: ${contractFilePath}`);
  }
  let source = await importer.combine(contractFilePath);
  if (Buffer.isBuffer(source)) return stripComments(source.toString());
  if (typeof source === 'string') return stripComments(source);
  if (typeof source === 'object') {
    return Object.keys(source).map((k) => {
      let content = source[k];
      content = typeof content === 'string' ? content : String(content);
      content = content.replace(/^.*?\.sol,\s*/i, '');
      return stripComments(content);
    }).join('\n');
  }
  return stripComments(String(source));
}

// ---------------------------------------------------------------------------
// Chain access (single token for the whole run)
// ---------------------------------------------------------------------------

async function cirrus(tokenObj, tableName, params) {
  const baseUrl = config.nodes[0].url.replace(/\/$/, '');
  const { data } = await axios.get(`${baseUrl}/cirrus/search/${tableName}`, {
    headers: { Authorization: `Bearer ${tokenObj.token}` },
    params,
  });
  return Array.isArray(data) ? data : [];
}

/** A 64-hex string in a receipt's response value is an AdminRegistry issue id. */
function issueIdFromReceipt(final) {
  const v = final && final.txResult && final.txResult.response && final.txResult.response.v;
  const value = Array.isArray(v) ? v[0] : v;
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value) ? value : null;
}

/**
 * Submit an implementation deployment. On nodes where contract creation routes
 * through the caller's user-contract + AdminRegistry, the tx succeeds by raising a
 * CREATE-ISSUE (contractsCreated is empty and the receipt's response is the issue
 * id); the implementation only exists once the issue is voted through. Returns
 * { address } for a direct creation or { issueId } for the governance path.
 */
async function submitImplementationDeploy(tokenObj, impl, source) {
  console.log(`  Deploying new ${impl.name} implementation (from ${impl.file})...`);
  const contractArgs = {
    name: impl.name,
    source,
    args: CONSTRUCTOR_ARGS,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
  const options = {
    config,
    logger: console,
    history: [impl.name],
    cacheNonce: true,
    isAsync: true,
    query: { username: 'BlockApps' },
  };
  const response = await rest.createContract(tokenObj, contractArgs, options);
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error('rest.createContract returned no tx hash: ' + JSON.stringify(response));
  }
  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    120000
  );
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error(`${impl.name} implementation deployment failed: ` + JSON.stringify(final || finalResults));
  }
  const created = final.txResult && final.txResult.contractsCreated;
  const address = Array.isArray(created) ? created[0] : created;
  if (address) return { address: normalizeAddr(address) };
  const issueId = issueIdFromReceipt(final);
  if (issueId) return { issueId };
  throw new Error(`${impl.name} deployed but no contractsCreated in receipt: ` + JSON.stringify(final));
}

/** The created-contract address of an EXECUTED create-issue, or null if not executed yet. */
async function issueExecutedAddress(tokenObj, issueId) {
  const rows = await cirrus(tokenObj, 'BlockApps-AdminRegistry-IssueExecuted', {
    issueId: `eq.${issueId}`,
    select: 'transaction_hash',
    order: 'block_timestamp.desc',
    limit: '1',
  });
  const txHash = rows[0] && rows[0].transaction_hash;
  if (!txHash) return null;
  const finalResults = await rest.getBlocResults(tokenObj, [txHash], { config, isAsync: true });
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  const created = final && final.txResult && final.txResult.contractsCreated;
  const address = Array.isArray(created) ? created[0] : created;
  return address ? normalizeAddr(address) : null;
}

/**
 * Idempotently produce an implementation address for `impl`, driving the state file:
 * reuse a recorded address; else resume a recorded create-issue (waiting boundedly for
 * votes); else submit a fresh deployment. Returns null when still awaiting votes —
 * the caller reports PENDING and the next run resumes from the recorded issue.
 */
async function ensureImplementation(tokenObj, impl, state, addrKey, issueKey, factory, pollTimeoutMs) {
  if (state[addrKey]) {
    console.log(`  Reusing ${impl.name} implementation: ${state[addrKey]}`);
    return state[addrKey];
  }
  if (state[issueKey]) {
    console.log(`  ${impl.name}: resuming governance create-issue ${state[issueKey]}`);
  } else {
    const source = await combineSource(impl.file);
    const submitted = await submitImplementationDeploy(tokenObj, impl, source);
    if (submitted.address) {
      state[addrKey] = submitted.address;
      saveState(factory, state);
      console.log(`  -> ${impl.name} implementation: ${submitted.address}`);
      return submitted.address;
    }
    state[issueKey] = submitted.issueId;
    saveState(factory, state);
    console.log(`  ${impl.name}: creation raised governance issue ${submitted.issueId}; waiting for votes...`);
  }

  const deadline = Date.now() + pollTimeoutMs;
  for (;;) {
    const address = await issueExecutedAddress(tokenObj, state[issueKey]);
    if (address) {
      state[addrKey] = address;
      saveState(factory, state);
      console.log(`  -> ${impl.name} implementation (via issue execution): ${address}`);
      return address;
    }
    if (Date.now() >= deadline) {
      console.log(`  ! ${impl.name} implementation awaiting votes (issue ${state[issueKey]})`);
      return null;
    }
    await sleep(EFFECT_POLL_INTERVAL_MS);
  }
}

/**
 * Async contract call + poll for the receipt. When the target is owned by
 * AdminRegistry the tx SUCCEEDS by casting a governance vote; the effect lands when
 * the vote passes (immediately on single-admin networks). Callers verify the effect
 * separately via waitForEffect.
 */
async function callContract(tokenObj, contract, method, args) {
  const callArgs = {
    contract,
    method,
    args,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
  const response = await rest.call(tokenObj, callArgs, { config, cacheNonce: true, isAsync: true });
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error(`rest.call(${method}) returned no tx hash: ` + JSON.stringify(response));
  }
  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    120000
  );
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error(`${method} call failed: ` + JSON.stringify(final || finalResults));
  }
  return final;
}

/** A 64-hex return value from an onlyOwner call is the AdminRegistry vote-issue id. */
function voteIssueHint(receipt) {
  const v = receipt && receipt.txResult && receipt.txResult.response && receipt.txResult.response.v;
  const value = Array.isArray(v) ? v[0] : v;
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value) ? value : null;
}

/** Poll until checkFn() is true. Returns 'done' or 'pending' (never throws on timeout). */
async function waitForEffect(checkFn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await checkFn()) return 'done';
    if (Date.now() >= deadline) {
      console.log(`  ! ${label}: not yet in effect (likely awaiting governance votes)`);
      return 'pending';
    }
    await sleep(EFFECT_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// State file: implementation addresses survive re-runs (idempotency across votes)
// ---------------------------------------------------------------------------

function stateFilePath(factory) {
  return path.join(__dirname, `upgrade-poolv3-nft.state.${factory}.json`);
}

function loadState(factory) {
  const file = stateFilePath(factory);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.nodeUrl && parsed.nodeUrl !== config.nodes[0].url) {
      throw new Error(
        `State file ${file} was written for a different node (${parsed.nodeUrl}); ` +
        'delete it or fix NODE_URL before re-running.'
      );
    }
    return parsed;
  } catch (error) {
    if (error.message.includes('different node')) throw error;
    console.log(`  (state file unreadable, ignoring: ${error.message})`);
    return {};
  }
}

function saveState(factory, state) {
  const file = stateFilePath(factory);
  fs.writeFileSync(file, JSON.stringify({ ...state, nodeUrl: config.nodes[0].url }, null, 2));
  console.log(`  (recorded in ${path.basename(file)})`);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function getProxyRow(tokenObj, address) {
  const rows = await cirrus(tokenObj, 'BlockApps-Proxy', {
    address: `eq.${address}`,
    select: 'address,logicContract,_owner',
  });
  return rows[0] || null;
}

async function discover(tokenObj, factory, manager) {
  const factoryProxy = await getProxyRow(tokenObj, factory);
  if (!factoryProxy) {
    throw new Error(`Factory ${factory} is not a Proxy on this network (no BlockApps-Proxy row).`);
  }
  const managerProxy = await getProxyRow(tokenObj, manager);
  if (!managerProxy) {
    throw new Error(`Manager ${manager} is not a Proxy on this network (no BlockApps-Proxy row).`);
  }

  // Type-check the --factory arg before mutating anything: a real PoolV3Factory proxy has
  // its own state row (owner/tokenFactory/poolV3Implementation) indexed under
  // BlockApps-PoolV3Factory at the proxy address. Absent means a wrong address or
  // --factory/--manager swapped — either would point later steps at the wrong contract.
  const factoryStateRows = await cirrus(tokenObj, 'BlockApps-PoolV3Factory', {
    address: `eq.${factory}`,
    select: 'address',
  });
  if (factoryStateRows.length === 0) {
    throw new Error(
      `Factory ${factory} has no BlockApps-PoolV3Factory state row — it is not a PoolV3Factory ` +
      `on this network (wrong --factory address, or --factory/--manager swapped).`
    );
  }

  const poolRows = await cirrus(tokenObj, 'BlockApps-PoolV3Factory-allPools', {
    address: `eq.${factory}`,
    select: 'value',
  });
  const pools = [...new Set(poolRows.map((r) => normalizeAddr(r.value)).filter((a) => !isZeroAddr(a)))];

  const poolProxies = new Map();
  const poolPrices = new Map();
  if (pools.length > 0) {
    const inList = `in.(${pools.join(',')})`;
    for (const row of await cirrus(tokenObj, 'BlockApps-Proxy', { address: inList, select: 'address,logicContract' })) {
      poolProxies.set(normalizeAddr(row.address), normalizeAddr(row.logicContract));
    }
    for (const row of await cirrus(tokenObj, 'BlockApps-PoolV3', { address: inList, select: 'address,sqrtPriceX96::text' })) {
      poolPrices.set(normalizeAddr(row.address), String(row.sqrtPriceX96));
    }
  }

  // The manager's logic-contract state row appears under BlockApps-PositionManagerV3
  // once initialize has written through the proxy; absent (or zero factory) = uninitialized.
  const managerRows = await cirrus(tokenObj, `BlockApps-${MANAGER_NAME}`, {
    address: `eq.${manager}`,
    select: 'address,poolV3Factory,nextTokenId',
  });
  const managerState = managerRows[0] || null;

  return { factoryProxy, managerProxy, pools, poolProxies, poolPrices, managerState };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('V3 position-NFT rollout (factory + pools + manager)');
  console.log('====================================================\n');

  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(`Error parsing arguments: ${error.message}\n`);
    printUsage();
    process.exit(1);
  }

  const factory = normalizeAddr(args.factory || process.env.POOL_V3_FACTORY);
  const manager = normalizeAddr(args.manager || process.env.POSITION_MANAGER_V3);
  const pollTimeoutMs = parseInt(args['poll-timeout'] || '180000', 10);
  if (!factory || !manager) {
    console.error('Missing --factory and/or --manager (or POOL_V3_FACTORY / POSITION_MANAGER_V3 env).\n');
    printUsage();
    process.exit(1);
  }
  if (factory === manager) {
    console.error('--factory and --manager must be different proxy addresses.\n');
    printUsage();
    process.exit(1);
  }

  const requiredVars = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL', 'NODE_URL'];
  const missingVars = requiredVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}\n`);
    printUsage();
    process.exit(1);
  }

  // Authenticate ONCE — reused for every transaction below (single OTP code).
  console.log(`Authenticating as ${process.env.GLOBAL_ADMIN_NAME}...`);
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  console.log('Authenticated.\n');

  // -------- Discovery --------
  console.log('Discovering current on-chain state...');
  const state = loadState(factory);
  const { factoryProxy, managerProxy, pools, poolProxies, poolPrices, managerState } =
    await discover(tokenObj, factory, manager);

  const factoryImplTarget = normalizeAddr(args['factory-impl'] || state.factoryImpl || '');
  const poolImplTarget = normalizeAddr(args['pool-impl'] || state.poolImpl || '');
  const managerImplTarget = normalizeAddr(args['manager-impl'] || state.managerImpl || '');
  const managerFactory = managerState ? normalizeAddr(managerState.poolV3Factory) : '';
  const managerInitialized = !isZeroAddr(managerFactory);

  if (managerInitialized && managerFactory !== factory) {
    throw new Error(
      `PositionManagerV3 ${manager} is already initialized against a DIFFERENT factory ` +
      `(${managerFactory}, expected ${factory}). Refusing to continue.`
    );
  }

  console.log(`  Factory proxy:   ${factory} (owner ${factoryProxy._owner}, logic ${normalizeAddr(factoryProxy.logicContract)})`);
  console.log(`  Manager proxy:   ${manager} (owner ${managerProxy._owner}, logic ${normalizeAddr(managerProxy.logicContract)})`);
  console.log(`  Manager state:   ${managerInitialized ? `initialized (factory ${managerFactory}, nextTokenId ${managerState.nextTokenId})` : 'NOT initialized'}`);
  console.log(`  Pools to check:  ${pools.length}`);
  pools.forEach((p) => {
    console.log(`    - ${p} (logic ${poolProxies.get(p) || '?'}, sqrtPriceX96 ${poolPrices.get(p) || '?'})`);
  });
  const implPlan = (target, issue) =>
    target || (issue ? `(resume create-issue ${issue})` : '(will deploy)');
  console.log(`  New factory impl: ${implPlan(factoryImplTarget, state.factoryImplIssue)}`);
  console.log(`  New pool impl:    ${implPlan(poolImplTarget, state.poolImplIssue)}`);
  console.log(`  New manager impl: ${implPlan(managerImplTarget, state.managerImplIssue)}`);
  console.log('');

  if (args['dry-run']) {
    console.log('Dry run — nothing was changed.');
    return;
  }

  const pending = [];

  // -------- Step 1: implementations --------
  console.log('Step 1/5: Implementations');
  if (factoryImplTarget) state.factoryImpl = factoryImplTarget;
  if (poolImplTarget) state.poolImpl = poolImplTarget;
  if (managerImplTarget) state.managerImpl = managerImplTarget;
  const factoryImpl = await ensureImplementation(
    tokenObj, FACTORY_IMPL, state, 'factoryImpl', 'factoryImplIssue', factory, pollTimeoutMs
  );
  if (!factoryImpl) pending.push(`PoolV3Factory implementation — vote on issue ${state.factoryImplIssue}`);
  const poolImpl = await ensureImplementation(
    tokenObj, POOL_IMPL, state, 'poolImpl', 'poolImplIssue', factory, pollTimeoutMs
  );
  if (!poolImpl) pending.push(`PoolV3 implementation — vote on issue ${state.poolImplIssue}`);
  const managerImpl = await ensureImplementation(
    tokenObj, MANAGER_IMPL, state, 'managerImpl', 'managerImplIssue', factory, pollTimeoutMs
  );
  if (!managerImpl) pending.push(`PositionManagerV3 implementation — vote on issue ${state.managerImplIssue}`);
  console.log('');

  // -------- Step 2: factory proxy --------
  console.log('Step 2/5: Factory proxy -> new PoolV3Factory implementation');
  if (!factoryImpl) {
    console.log('  Skipped — implementation not created yet (awaiting votes).');
  } else if (normalizeAddr(factoryProxy.logicContract) === factoryImpl) {
    console.log('  Already upgraded; skipping.');
  } else {
    const receipt = await callContract(
      tokenObj,
      { address: factory, name: 'Proxy' },
      'setLogicContract',
      { _logicContract: factoryImpl }
    );
    const issue = voteIssueHint(receipt);
    if (issue) console.log(`  Governance vote issue: ${issue}`);
    const result = await waitForEffect(async () => {
      const row = await getProxyRow(tokenObj, factory);
      return row && normalizeAddr(row.logicContract) === factoryImpl;
    }, pollTimeoutMs, 'factory upgrade');
    if (result === 'pending') pending.push(`factory ${factory} -> ${factoryImpl}`);
    else console.log('  Factory upgraded.');
  }
  console.log('');

  // -------- Step 3: pool proxies --------
  console.log(`Step 3/5: ${pools.length} pool prox${pools.length === 1 ? 'y' : 'ies'} -> new PoolV3 implementation`);
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const label = `[${i + 1}/${pools.length}] ${pool}`;
    if (!poolImpl) {
      console.log('  Skipped — implementation not created yet (awaiting votes).');
      break;
    }
    if (poolProxies.get(pool) === poolImpl) {
      console.log(`  ${label}: already upgraded; skipping.`);
      continue;
    }
    const receipt = await callContract(
      tokenObj,
      { address: pool, name: 'Proxy' },
      'setLogicContract',
      { _logicContract: poolImpl }
    );
    const issue = voteIssueHint(receipt);
    if (issue) console.log(`  ${label}: governance vote issue ${issue}`);
    const result = await waitForEffect(async () => {
      const row = await getProxyRow(tokenObj, pool);
      return row && normalizeAddr(row.logicContract) === poolImpl;
    }, pollTimeoutMs, `${label} upgrade`);
    if (result === 'pending') pending.push(`pool ${pool} -> ${poolImpl}`);
    else console.log(`  ${label}: upgraded.`);
  }
  console.log('');

  // -------- Step 4: manager proxy --------
  // Point the manager proxy at the new implementation, exactly as the factory/pool
  // proxies above. This runs every rollout: a proxy created "empty" (0xdeadbeef) or
  // pointing at stale logic is upgraded here, and it is also how later manager logic
  // fixes ship. initialize() below executes against whatever logic the proxy points at,
  // so the swap must land FIRST — managerLogicReady gates Step 5.
  console.log('Step 4/5: Manager proxy -> new PositionManagerV3 implementation');
  let managerLogicReady = false;
  if (!managerImpl) {
    console.log('  Skipped — implementation not created yet (awaiting votes).');
  } else if (normalizeAddr(managerProxy.logicContract) === managerImpl) {
    console.log('  Already upgraded; skipping.');
    managerLogicReady = true;
  } else {
    const receipt = await callContract(
      tokenObj,
      { address: manager, name: 'Proxy' },
      'setLogicContract',
      { _logicContract: managerImpl }
    );
    const issue = voteIssueHint(receipt);
    if (issue) console.log(`  Governance vote issue: ${issue}`);
    const result = await waitForEffect(async () => {
      const row = await getProxyRow(tokenObj, manager);
      return row && normalizeAddr(row.logicContract) === managerImpl;
    }, pollTimeoutMs, 'manager upgrade');
    if (result === 'pending') pending.push(`manager ${manager} -> ${managerImpl}`);
    else { console.log('  Manager upgraded.'); managerLogicReady = true; }
  }
  console.log('');

  // -------- Step 5: manager initialize --------
  console.log('Step 5/5: PositionManagerV3 initialize');
  if (managerInitialized) {
    console.log('  Already initialized; skipping.');
  } else if (!managerLogicReady) {
    // initialize would run against the OLD/empty logic — defer until the swap lands.
    console.log('  Skipped — manager proxy not yet pointing at the new implementation (awaiting votes).');
    pending.push(`manager ${manager} initialize (blocked until the logic upgrade lands; re-run after voting)`);
  } else {
    const receipt = await callContract(
      tokenObj,
      { address: manager, name: MANAGER_NAME },
      'initialize',
      { _poolV3Factory: factory }
    );
    const issue = voteIssueHint(receipt);
    if (issue) console.log(`  Governance vote issue: ${issue}`);
    const result = await waitForEffect(async () => {
      const rows = await cirrus(tokenObj, `BlockApps-${MANAGER_NAME}`, {
        address: `eq.${manager}`,
        select: 'poolV3Factory',
      });
      return rows[0] && normalizeAddr(rows[0].poolV3Factory) === factory;
    }, pollTimeoutMs, 'manager initialize');
    if (result === 'pending') pending.push(`manager ${manager} initialize(${factory})`);
    else console.log('  Manager initialized.');
  }
  console.log('');

  // -------- Verification --------
  console.log('Verification');
  let verifyFailed = false;

  // Pool state must be byte-identical after the swap: prices live in proxy storage.
  const after = await discover(tokenObj, factory, manager);
  for (const pool of pools) {
    const before = poolPrices.get(pool);
    const now = after.poolPrices.get(pool);
    if (before !== undefined && now !== undefined && before !== now) {
      // A concurrent swap can legitimately move the price mid-rollout; flag, don't fail.
      console.log(`  ? ${pool}: sqrtPriceX96 changed during rollout (${before} -> ${now}) — expected only if the pool traded meanwhile.`);
    }
  }

  const upgradedPools = poolImpl ? pools.filter((p) => after.poolProxies.get(p) === poolImpl) : [];
  const managerLogicNew = !!managerImpl && normalizeAddr(after.managerProxy.logicContract) === managerImpl;
  console.log(`  Factory logic:    ${factoryImpl && normalizeAddr(after.factoryProxy.logicContract) === factoryImpl ? 'NEW' : 'old (pending)'}`);
  console.log(`  Pools upgraded:   ${upgradedPools.length}/${pools.length}`);
  console.log(`  Manager logic:    ${managerLogicNew ? 'NEW' : 'old (pending)'}`);
  const afterManagerFactory = after.managerState ? normalizeAddr(after.managerState.poolV3Factory) : '';
  console.log(`  Manager:          ${!isZeroAddr(afterManagerFactory) ? `initialized (nextTokenId ${after.managerState.nextTokenId})` : 'NOT initialized (pending)'}`);

  // The manager proxy must end up on the new implementation. If nothing is pending
  // (governance settled or single-admin) yet the logic is still old, the swap silently
  // failed — fail verification rather than report a manager running unknown logic.
  if (managerImpl && !managerLogicNew && pending.length === 0) {
    verifyFailed = true;
    console.log('  ! Manager proxy did not end up pointing at the new implementation.');
  }

  // Functional smoke: the new getter must resolve through an upgraded pool proxy.
  if (upgradedPools.length > 0) {
    try {
      await callContract(
        tokenObj,
        { address: upgradedPools[0], name: 'PoolV3' },
        'getPositionFeeGrowthInside',
        { positionOwner: manager, tickLower: 0, tickUpper: 0 }
      );
      console.log(`  Smoke call:       getPositionFeeGrowthInside OK on pool ${upgradedPools[0]}`);
    } catch (error) {
      verifyFailed = true;
      console.log(`  Smoke call:       FAILED on pool ${upgradedPools[0]} — ${error.message}`);
    }
  } else {
    console.log('  Smoke call:       skipped (no pool upgraded yet)');
  }

  // Zero pools discovered means Step 3 and its smoke test never ran. On a network that
  // has pools this is a false-empty read (Cirrus lag on allPools, or a --factory that is
  // a Proxy but whose allPools is not yet indexed) — do NOT report a rollout that
  // upgraded no pools as fully verified unless the operator asserts the network is empty.
  if (pools.length === 0 && !args['allow-no-pools']) {
    verifyFailed = true;
    console.log('  ! No pools discovered — the pool upgrade (Step 3) and its smoke test did NOT run.');
    console.log('    If this network has pools, this is Cirrus lag or a wrong --factory; wait/retry.');
    console.log('    If the network genuinely has no pools yet, re-run with --allow-no-pools.');
  }

  console.log('\n====== Summary ======');
  console.log(`Factory proxy:        ${factory}`);
  console.log(`New factory impl:     ${factoryImpl || `(pending — issue ${state.factoryImplIssue})`}`);
  console.log(`New pool impl:        ${poolImpl || `(pending — issue ${state.poolImplIssue})`}`);
  console.log(`New manager impl:     ${managerImpl || `(pending — issue ${state.managerImplIssue})`}`);
  console.log(`Manager proxy:        ${manager}`);
  if (pending.length > 0) {
    console.log('\nPENDING GOVERNANCE VOTES (have the other admins vote, then RE-RUN this script):');
    pending.forEach((p) => console.log(`  - ${p}`));
    console.log('=====================');
    process.exit(2);
  }
  if (verifyFailed) {
    console.log('\nVERIFICATION FAILED — see the messages above before proceeding.');
    console.log('=====================');
    process.exit(1);
  }
  console.log('\nAll steps applied and verified.');
  console.log('Backend follow-up: set POSITION_MANAGER_V3=' + manager + ' (env or config defaults) and restart.');
  console.log('=====================');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nRollout failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  });
}

module.exports = main;
