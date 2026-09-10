/**
 * StablePool logic upgrade: point every deployed StablePool proxy at a freshly
 * deployed implementation built from the current app/contracts/concrete source.
 * Dry run by default; nothing is submitted without --execute.
 *
 * What it does, under a SINGLE authentication:
 *
 *   1. Discovers the pools from Cirrus:
 *        {cirrus}/cirrus/search/BlockApps-StablePool?DMaTime=gt.0
 *      (DMaTime > 0 selects initialised pools, i.e. the proxies; implementation
 *      contracts are never initialised). Each address is then checked to be a
 *      Proxy whose current logic contract is itself a StablePool, so a wrong or
 *      stale row can never be repointed by mistake.
 *   2. Deploys ONE new StablePool implementation from Pools/StablePool.sol
 *      (imports combined exactly as upgrade.js does), unless --pool-impl or the
 *      state file already names one.
 *   3. Calls setLogicContract(newImpl) on every pool proxy that is not already
 *      on it. Pool state (balances, LP supply, fees, oracles) lives in the proxy
 *      and is untouched; the storage layout of the patched contract is unchanged.
 *   4. Optionally (--with-factory) does the same for the PoolFactory proxy, so
 *      pools created AFTER the upgrade are stamped from the patched source too.
 *      Without it, createStablePool keeps producing pools from the factory's
 *      embedded (old) StablePool until the factory is upgraded.
 *   5. Verifies every proxy points at the new implementation and that a read
 *      call resolves through an upgraded proxy.
 *
 * Governance: the pools and the factory are owned by the AdminRegistry (0x100c).
 * On a network with several admins, contract creation and setLogicContract each
 * raise a vote issue instead of executing. The script waits a bounded time for
 * each effect, reports PENDING with the issue ids, and exits 2; have the other
 * admins vote, then RE-RUN it. Implementation addresses and in-flight issue ids
 * are kept in upgrade-stablepools.state.<env>.json so a re-run resumes rather
 * than deploying twice. Single-admin networks execute inline.
 *
 * Usage (from app/contracts):
 *   node deploy/upgrade-stablepools.js --env testnet              # dry run (no credentials needed)
 *   node deploy/upgrade-stablepools.js --env prod                 # dry run
 *   node deploy/upgrade-stablepools.js --env testnet --execute    # apply
 *   node deploy/upgrade-stablepools.js --env prod --execute --with-factory
 *
 * Options:
 *   --env testnet|prod       Network (required). Picks the node and Cirrus URLs.
 *   --execute                Submit transactions. Without it the plan is printed only.
 *   --with-factory           Also upgrade the PoolFactory proxy (Pools/PoolFactory.sol).
 *   --pools a,b,c            Restrict to these pool proxies (still validated).
 *   --pool-impl <addr>       Reuse an already-deployed StablePool implementation.
 *   --factory-impl <addr>    Reuse an already-deployed PoolFactory implementation.
 *   --skip-disabled          Leave pools with isDisabled == true on their old logic.
 *   --poll-timeout <ms>      How long to wait for each on-chain effect (default 180000).
 *   --allow-no-pools         Accept "zero pools discovered" (otherwise an error).
 *   --env-file <path>        Credentials file (default app/contracts/.env).
 *
 * Credentials (only for --execute), from the env file:
 *   OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET,
 *   GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD (an AdminRegistry admin),
 *   OAUTH_TOTP (only if the account is OTP-gated).
 *   NODE_URL is set from --env; NODE_URL_OVERRIDE replaces it if you need a different node.
 *
 * Exit codes: 0 = applied and verified (or dry run); 2 = pending governance votes; 1 = error.
 */
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const dotenv = require('dotenv');

const PROFILES = {
  testnet: {
    nodeUrl: 'https://node1.testnet.strato.nexus',
    cirrusUrl: 'https://app.testnet.strato.nexus',
  },
  prod: {
    nodeUrl: 'https://app.strato.nexus',
    cirrusUrl: 'https://app.strato.nexus',
  },
};

const POOL_IMPL = { name: 'StablePool', file: 'BaseCodeCollection.sol' };
const FACTORY_IMPL = { name: 'PoolFactory', file: 'BaseCodeCollection.sol' };
// The owner of an implementation contract is ignored in favour of the proxy owner.
const CONSTRUCTOR_ARGS = { initialOwner: 'deadbeef' };
const EFFECT_POLL_INTERVAL_MS = 5000;

const normalizeAddr = (value) => String(value || '').toLowerCase().replace(/^0x/, '');
const isZeroAddr = (value) => !value || /^0+$/.test(normalizeAddr(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function printUsage() {
  console.error('Usage: node deploy/upgrade-stablepools.js --env testnet|prod [--execute] [--with-factory]');
  console.error('       [--pools a,b,c] [--pool-impl <addr>] [--factory-impl <addr>] [--skip-disabled]');
  console.error('       [--poll-timeout <ms>] [--allow-no-pools] [--env-file <path>]');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { execute: false };
  const flags = new Set(['execute', 'dry-run', 'with-factory', 'skip-disabled', 'allow-no-pools']);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw new Error(`Unexpected argument: ${args[i]}`);
    const key = args[i].slice(2);
    if (flags.has(key)) {
      parsed[key] = true;
      continue;
    }
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for argument: ${args[i]}`);
    parsed[key] = value;
    i++;
  }
  if (parsed['dry-run'] && parsed.execute) throw new Error('--dry-run and --execute are mutually exclusive');
  if (!parsed.env || !PROFILES[parsed.env]) throw new Error('--env must be testnet or prod');
  return parsed;
}

// ---------------------------------------------------------------------------
// Cirrus (public read endpoints; no credentials needed, so dry runs are free)
// ---------------------------------------------------------------------------

function makeCirrus(profile) {
  return async function cirrus(tableName, params) {
    const { data } = await axios.get(`${profile.cirrusUrl}/cirrus/search/${tableName}`, { params });
    return Array.isArray(data) ? data : [];
  };
}

/** Cirrus `in.(a,b,c)` filters have a URL-length ceiling; chunk generously. */
async function cirrusIn(cirrus, tableName, addresses, select) {
  const out = [];
  for (let i = 0; i < addresses.length; i += 40) {
    const chunk = addresses.slice(i, i + 40);
    out.push(...await cirrus(tableName, { address: `in.(${chunk.join(',')})`, select }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function discover(cirrus, restrictTo) {
  // The user-facing query: initialised pools only (DMaTime is set by initialize()).
  const poolRows = await cirrus('BlockApps-StablePool', {
    DMaTime: 'gt.0',
    select: 'address,poolFactory,_owner,isPaused,isDisabled,tokenA,tokenB,lpToken,block_number',
    order: 'block_number.asc',
  });
  let pools = poolRows.map((r) => ({ ...r, address: normalizeAddr(r.address) }));
  if (restrictTo) {
    const wanted = new Set(restrictTo.map(normalizeAddr));
    const known = new Set(pools.map((p) => p.address));
    const unknown = [...wanted].filter((a) => !known.has(a));
    if (unknown.length > 0) {
      throw new Error(`--pools lists addresses that are not initialised StablePools on this network: ${unknown.join(', ')}`);
    }
    pools = pools.filter((p) => wanted.has(p.address));
  }

  const addresses = pools.map((p) => p.address);
  const proxyRows = await cirrusIn(cirrus, 'BlockApps-Proxy', addresses, 'address,logicContract,_owner');
  const proxies = new Map(proxyRows.map((r) => [normalizeAddr(r.address), {
    logic: normalizeAddr(r.logicContract),
    owner: normalizeAddr(r._owner),
  }]));

  // Type-check the current logic contracts: each must be a StablePool code
  // collection, otherwise this row is a different kind of proxy (or Cirrus lag).
  const logics = [...new Set([...proxies.values()].map((p) => p.logic).filter((a) => !isZeroAddr(a)))];
  const logicRows = await cirrusIn(cirrus, 'BlockApps-StablePool', logics, 'address,contract_name');
  const stablePoolLogics = new Set(logicRows.map((r) => normalizeAddr(r.address)));

  // Name whatever the non-StablePool logics are, so the operator sees e.g. "Pool"
  // (a proxy that was re-pointed at the constant-product implementation) instead
  // of a bare refusal.
  const foreign = logics.filter((a) => !stablePoolLogics.has(a));
  const logicType = new Map();
  for (const table of ['BlockApps-Pool', 'BlockApps-PoolV3']) {
    if (foreign.length === 0) break;
    for (const row of await cirrusIn(cirrus, table, foreign, 'address,contract_name')) {
      logicType.set(normalizeAddr(row.address), row.contract_name);
    }
  }

  for (const pool of pools) {
    const proxy = proxies.get(pool.address);
    pool.proxy = proxy || null;
    pool.logic = proxy ? proxy.logic : '';
    pool.logicIsStablePool = !!proxy && stablePoolLogics.has(proxy.logic);
    pool.logicType = pool.logicIsStablePool ? 'StablePool' : (logicType.get(pool.logic) || 'unknown');
  }

  // Factory: every pool records the factory that created it; expect exactly one.
  const factories = [...new Set(pools.map((p) => normalizeAddr(p.poolFactory)).filter((a) => !isZeroAddr(a)))];
  let factory = null;
  if (factories.length === 1) {
    const row = (await cirrus('BlockApps-Proxy', {
      address: `eq.${factories[0]}`,
      select: 'address,logicContract,_owner',
    }))[0];
    factory = {
      address: factories[0],
      logic: row ? normalizeAddr(row.logicContract) : '',
      owner: row ? normalizeAddr(row._owner) : '',
      isProxy: !!row,
    };
  }
  return { pools, factory, factories };
}

function printPlan(env, pools, factory, poolImplPlan, factoryImplPlan, withFactory, skipDisabled) {
  console.log(`Network:            ${env}`);
  console.log(`Pools discovered:   ${pools.length}`);
  for (const p of pools) {
    const flags = [p.isPaused ? 'paused' : null, p.isDisabled ? 'disabled' : null].filter(Boolean).join(',') || 'live';
    const type = !p.proxy ? '!! NOT A PROXY' : (p.logicIsStablePool ? 'StablePool' : `!! logic is a ${p.logicType}, not a StablePool`);
    const action = !p.proxy || !p.logicIsStablePool
      ? 'SKIP (refused)'
      : (skipDisabled && p.isDisabled ? 'SKIP (--skip-disabled)' : 'upgrade');
    console.log(`  - ${p.address}  logic ${p.logic || '?'}  [${type}, ${flags}]  -> ${action}`);
  }
  console.log(`New StablePool impl: ${poolImplPlan}`);
  if (factory) {
    console.log(`Factory proxy:      ${factory.address}  logic ${factory.logic || '?'}  owner ${factory.owner || '?'}${factory.isProxy ? '' : '  !! NOT A PROXY'}`);
    console.log(`New factory impl:   ${withFactory ? factoryImplPlan : '(not requested; pass --with-factory)'}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Source preparation (same conventions as upgrade.js / upgrade-poolv3-nft.js)
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

async function combineSource(config, importer, contractFile) {
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
// State file: implementation addresses and in-flight issues survive re-runs
// ---------------------------------------------------------------------------

function stateFilePath(env) {
  return path.join(__dirname, `upgrade-stablepools.state.${env}.json`);
}

function loadState(env, nodeUrl) {
  const file = stateFilePath(env);
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed.nodeUrl && parsed.nodeUrl !== nodeUrl) {
    throw new Error(`State file ${file} was written for a different node (${parsed.nodeUrl}); delete it or fix the node before re-running.`);
  }
  return parsed;
}

function saveState(env, nodeUrl, state) {
  const file = stateFilePath(env);
  fs.writeFileSync(file, JSON.stringify({ ...state, nodeUrl }, null, 2));
  console.log(`  (recorded in ${path.basename(file)})`);
}

// ---------------------------------------------------------------------------
// Chain writes (only reachable with --execute)
// ---------------------------------------------------------------------------

/** A 64-hex return value from an AdminRegistry-owned call is the vote-issue id. */
function issueIdFromReceipt(final) {
  const v = final && final.txResult && final.txResult.response && final.txResult.response.v;
  const value = Array.isArray(v) ? v[0] : v;
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value) ? value : null;
}

async function awaitReceipt(chain, hashes, label) {
  const { rest, util, config, tokenObj } = chain;
  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    120000
  );
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error(`${label} failed: ` + JSON.stringify(final || finalResults));
  }
  return final;
}

/**
 * Submit an implementation deployment. On multi-admin networks contract creation
 * raises a CREATE-ISSUE: the receipt succeeds with no contractsCreated and the
 * issue id as its response. Returns { address } or { issueId }.
 */
async function submitImplementationDeploy(chain, impl, source) {
  const { rest, config, tokenObj } = chain;
  console.log(`  Deploying new ${impl.name} implementation (from ${impl.file}, ${source.length} bytes)...`);
  const response = await rest.createContract(tokenObj, {
    name: impl.name,
    source,
    args: CONSTRUCTOR_ARGS,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, {
    config,
    logger: console,
    history: [impl.name],
    cacheNonce: true,
    isAsync: true,
    query: { username: 'BlockApps' },
  });
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) throw new Error('rest.createContract returned no tx hash: ' + JSON.stringify(response));
  const final = await awaitReceipt(chain, hashes, `${impl.name} implementation deployment`);
  const created = final.txResult && final.txResult.contractsCreated;
  const address = Array.isArray(created) ? created[0] : created;
  if (address) return { address: normalizeAddr(address) };
  const issueId = issueIdFromReceipt(final);
  if (issueId) return { issueId };
  throw new Error(`${impl.name} deployed but no contractsCreated in receipt: ` + JSON.stringify(final));
}

/** The created-contract address of an EXECUTED create-issue, or null if not executed yet. */
async function issueExecutedAddress(chain, cirrus, issueId) {
  const rows = await cirrus('BlockApps-AdminRegistry-IssueExecuted', {
    issueId: `eq.${issueId}`,
    select: 'transaction_hash',
    order: 'block_timestamp.desc',
    limit: '1',
  });
  const txHash = rows[0] && rows[0].transaction_hash;
  if (!txHash) return null;
  const finalResults = await chain.rest.getBlocResults(chain.tokenObj, [txHash], { config: chain.config, isAsync: true });
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  const created = final && final.txResult && final.txResult.contractsCreated;
  const address = Array.isArray(created) ? created[0] : created;
  return address ? normalizeAddr(address) : null;
}

/**
 * Idempotently produce an implementation address: reuse a recorded one, else
 * resume a recorded create-issue, else deploy. Returns null while votes are pending.
 */
async function ensureImplementation(chain, cirrus, impl, state, addrKey, issueKey, env, pollTimeoutMs) {
  if (state[addrKey]) {
    console.log(`  Reusing ${impl.name} implementation: ${state[addrKey]}`);
    return state[addrKey];
  }
  if (state[issueKey]) {
    console.log(`  ${impl.name}: resuming governance create-issue ${state[issueKey]}`);
  } else {
    const source = await combineSource(chain.config, chain.importer, impl.file);
    const submitted = await submitImplementationDeploy(chain, impl, source);
    if (submitted.address) {
      state[addrKey] = submitted.address;
      saveState(env, chain.nodeUrl, state);
      console.log(`  -> ${impl.name} implementation: ${submitted.address}`);
      return submitted.address;
    }
    state[issueKey] = submitted.issueId;
    saveState(env, chain.nodeUrl, state);
    console.log(`  ${impl.name}: creation raised governance issue ${submitted.issueId}; waiting for votes...`);
  }
  const deadline = Date.now() + pollTimeoutMs;
  for (;;) {
    const address = await issueExecutedAddress(chain, cirrus, state[issueKey]);
    if (address) {
      state[addrKey] = address;
      saveState(env, chain.nodeUrl, state);
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

async function callContract(chain, contract, method, args) {
  const { rest, config, tokenObj } = chain;
  const response = await rest.call(tokenObj, {
    contract,
    method,
    args,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, cacheNonce: true, isAsync: true });
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) throw new Error(`rest.call(${method}) returned no tx hash: ` + JSON.stringify(response));
  return awaitReceipt(chain, hashes, `${method} call`);
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

async function repointProxy(chain, cirrus, label, proxyAddress, targetImpl, pollTimeoutMs) {
  const receipt = await callContract(
    chain,
    { address: proxyAddress, name: 'Proxy' },
    'setLogicContract',
    { _logicContract: targetImpl }
  );
  const issue = issueIdFromReceipt(receipt);
  if (issue) console.log(`  ${label}: governance vote issue ${issue}`);
  return waitForEffect(async () => {
    const rows = await cirrus('BlockApps-Proxy', { address: `eq.${proxyAddress}`, select: 'logicContract' });
    return rows[0] && normalizeAddr(rows[0].logicContract) === targetImpl;
  }, pollTimeoutMs, `${label} upgrade`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(`Error parsing arguments: ${error.message}\n`);
    printUsage();
    process.exit(1);
  }
  const env = args.env;
  const profile = PROFILES[env];
  const execute = !!args.execute;
  const withFactory = !!args['with-factory'];
  const skipDisabled = !!args['skip-disabled'];
  const pollTimeoutMs = parseInt(args['poll-timeout'] || '180000', 10);
  const restrictTo = args.pools ? args.pools.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const cirrus = makeCirrus(profile);

  console.log(`StablePool logic upgrade — ${execute ? 'EXECUTE' : 'DRY RUN'} on ${env}`);
  console.log('=====================================================\n');

  // -------- Discovery (public Cirrus; works without credentials) --------
  console.log(`Discovering pools via ${profile.cirrusUrl}/cirrus/search/BlockApps-StablePool?DMaTime=gt.0 ...`);
  const { pools, factory, factories } = await discover(cirrus, restrictTo);
  if (factories.length > 1) {
    throw new Error(`Pools report more than one factory (${factories.join(', ')}); refusing to guess. Use --pools to split the run.`);
  }
  if (pools.length === 0 && !args['allow-no-pools']) {
    throw new Error('No initialised StablePools found. If the network genuinely has none, re-run with --allow-no-pools.');
  }

  const refused = pools.filter((p) => !p.proxy || !p.logicIsStablePool);
  const targets = pools.filter((p) => p.proxy && p.logicIsStablePool && !(skipDisabled && p.isDisabled));

  const state = execute ? loadState(env, process.env.NODE_URL_OVERRIDE || profile.nodeUrl) : {};
  const poolImplTarget = normalizeAddr(args['pool-impl'] || state.poolImpl || '');
  const factoryImplTarget = normalizeAddr(args['factory-impl'] || state.factoryImpl || '');
  const implPlan = (target, issue) => target || (issue ? `(resume create-issue ${issue})` : `(will deploy from ${POOL_IMPL.file})`);

  printPlan(
    env, pools, factory,
    implPlan(poolImplTarget, state.poolImplIssue),
    factoryImplTarget || (state.factoryImplIssue ? `(resume create-issue ${state.factoryImplIssue})` : `(will deploy from ${FACTORY_IMPL.file})`),
    withFactory, skipDisabled
  );

  if (refused.length > 0) {
    console.log(`Refusing ${refused.length} address(es) whose proxy/logic could not be confirmed as a StablePool (see !! above).`);
    console.log('Usually Cirrus lag; wait and re-run, or exclude them with --pools.\n');
  }
  const alreadyDone = poolImplTarget ? targets.filter((p) => p.logic === poolImplTarget).length : 0;
  console.log(`Would repoint ${targets.length - alreadyDone} of ${targets.length} target pool(s)${alreadyDone ? ` (${alreadyDone} already on the target implementation)` : ''}.`);
  if (withFactory && factory && !factory.isProxy) {
    throw new Error(`--with-factory requested but ${factory.address} has no BlockApps-Proxy row.`);
  }
  if (!withFactory) {
    console.log('Note: the factory keeps creating NEW pools from its embedded StablePool source until it is upgraded too (--with-factory).');
  }

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to submit these transactions.');
    return;
  }

  // -------- Credentials and chain access (only now) --------
  const envFile = args['env-file'] ? path.resolve(args['env-file']) : path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envFile)) throw new Error(`Credentials file not found: ${envFile}`);
  dotenv.config({ path: envFile });
  process.env.NODE_URL = process.env.NODE_URL_OVERRIDE || profile.nodeUrl;
  const requiredVars = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL'];
  const missingVars = requiredVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables in ${envFile}: ${missingVars.join(', ')}`);
  }
  // config.js reads NODE_URL at load time, so require it only after setting it.
  const config = require('./config');
  const auth = require('./auth');
  const { rest, importer, util } = require('blockapps-rest');

  console.log(`\nNode:               ${config.nodes[0].url}`);
  console.log(`Authenticating as ${process.env.GLOBAL_ADMIN_NAME}...`);
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const chain = { rest, importer, util, config, tokenObj: { token }, nodeUrl: config.nodes[0].url };
  console.log('Authenticated.\n');

  const pending = [];

  // -------- Step 1: implementations --------
  console.log(`Step 1/${withFactory ? 4 : 3}: Implementation${withFactory ? 's' : ''}`);
  if (poolImplTarget) state.poolImpl = poolImplTarget;
  if (factoryImplTarget) state.factoryImpl = factoryImplTarget;
  const poolImpl = await ensureImplementation(chain, cirrus, POOL_IMPL, state, 'poolImpl', 'poolImplIssue', env, pollTimeoutMs);
  if (!poolImpl) pending.push(`StablePool implementation — vote on issue ${state.poolImplIssue}`);
  let factoryImpl = null;
  if (withFactory) {
    factoryImpl = await ensureImplementation(chain, cirrus, FACTORY_IMPL, state, 'factoryImpl', 'factoryImplIssue', env, pollTimeoutMs);
    if (!factoryImpl) pending.push(`PoolFactory implementation — vote on issue ${state.factoryImplIssue}`);
  }
  console.log('');

  // -------- Step 2: pool proxies --------
  console.log(`Step 2/${withFactory ? 4 : 3}: ${targets.length} pool prox${targets.length === 1 ? 'y' : 'ies'} -> new StablePool implementation`);
  for (let i = 0; i < targets.length; i++) {
    const pool = targets[i];
    const label = `[${i + 1}/${targets.length}] ${pool.address}`;
    if (!poolImpl) {
      console.log('  Skipped — implementation not created yet (awaiting votes).');
      break;
    }
    if (pool.logic === poolImpl) {
      console.log(`  ${label}: already upgraded; skipping.`);
      continue;
    }
    const result = await repointProxy(chain, cirrus, label, pool.address, poolImpl, pollTimeoutMs);
    if (result === 'pending') pending.push(`pool ${pool.address} -> ${poolImpl}`);
    else console.log(`  ${label}: upgraded.`);
  }
  console.log('');

  // -------- Step 3 (optional): factory proxy --------
  if (withFactory) {
    console.log('Step 3/4: Factory proxy -> new PoolFactory implementation');
    if (!factoryImpl) {
      console.log('  Skipped — implementation not created yet (awaiting votes).');
    } else if (factory.logic === factoryImpl) {
      console.log('  Already upgraded; skipping.');
    } else {
      const result = await repointProxy(chain, cirrus, `factory ${factory.address}`, factory.address, factoryImpl, pollTimeoutMs);
      if (result === 'pending') pending.push(`factory ${factory.address} -> ${factoryImpl}`);
      else console.log('  Factory upgraded.');
    }
    console.log('');
  }

  // -------- Verification --------
  console.log(`Step ${withFactory ? 4 : 3}/${withFactory ? 4 : 3}: Verification`);
  let verifyFailed = false;
  const after = await discover(cirrus, restrictTo);
  const afterLogic = new Map(after.pools.map((p) => [p.address, p.logic]));
  const upgraded = poolImpl ? targets.filter((p) => afterLogic.get(p.address) === poolImpl) : [];
  console.log(`  Pools on new logic: ${upgraded.length}/${targets.length}`);
  if (withFactory && after.factory) {
    console.log(`  Factory logic:      ${factoryImpl && after.factory.logic === factoryImpl ? 'NEW' : 'old (pending)'}`);
  }
  if (poolImpl && upgraded.length < targets.length && pending.length === 0) {
    verifyFailed = true;
    console.log('  ! Some pools did not end up on the new implementation although nothing is pending.');
  }
  if (upgraded.length > 0) {
    // A read through an upgraded proxy proves the new code collection is wired and dispatches.
    try {
      await callContract(chain, { address: upgraded[0].address, name: 'StablePool' }, 'getNumCoins', {});
      console.log(`  Smoke call:         getNumCoins OK through ${upgraded[0].address}`);
    } catch (error) {
      verifyFailed = true;
      console.log(`  Smoke call:         FAILED through ${upgraded[0].address} — ${error.message}`);
    }
  } else {
    console.log('  Smoke call:         skipped (no pool upgraded yet)');
  }

  console.log('\n====== Summary ======');
  console.log(`Network:              ${env}`);
  console.log(`New StablePool impl:  ${poolImpl || `(pending — issue ${state.poolImplIssue})`}`);
  if (withFactory) console.log(`New PoolFactory impl: ${factoryImpl || `(pending — issue ${state.factoryImplIssue})`}`);
  console.log(`Pools upgraded:       ${upgraded.length}/${targets.length}`);
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
  console.log('=====================');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nUpgrade failed:', error.message);
    // The message is the operator-facing part; the stack only helps when debugging the script itself.
    if (process.env.DEBUG && error.stack) console.error(error.stack);
    process.exit(1);
  });
}

module.exports = main;
