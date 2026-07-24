/**
 * Standalone, one-shot setup script for a non-technical admin. Under a SINGLE
 * authentication it:
 *   1. Deploys an empty Proxy
 *   2. Deploys a logic implementation (default PoolV3Factory)
 *   3. Points the proxy at it via setLogicContract
 *   4. Calls initialize() on the proxy with the "initialize" args from the config
 *   5. Creates every pool in the config's "pools" array via createPoolV3
 *
 * The admin only has to fill in initialize-args.json and run one command:
 *   {
 *     "initialize": { "_tokenFactory": "...", "_feeCollector": "..." },
 *     "pools": [ { "tokenA": "...", "tokenB": "...", "fee": 3000,
 *                  "price": "1793.25" } ]
 *   }
 *
 * Each pool sets its starting price via exactly one of:
 *   - "price": human-readable tokenB-per-tokenA (converted to sqrtPriceX96 here
 *     using each token's on-chain decimals, same math as the backend createPool), or
 *   - "initialSqrtPriceX96": a raw Q64.96 sqrt price (advanced/manual).
 *
 * Because everything runs in one process, OTP-gated accounts need only a single
 * TOTP code for the whole run.
 *
 * Usage:
 *   node deployPoolV3FactoryProxy.js [--owner <addr>] [--contract-name <name>]
 *                                    [--contract-file <file>] [--initialize-args <path>]
 *
 * Defaults:
 *   --owner            100c
 *   --contract-name    PoolV3Factory
 *   --contract-file    BaseCodeCollection.sol
 *   --initialize-args  ./initialize-args.json (next to this script; holds initialize + pools)
 *
 * Required environment variables (.env):
 *   OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,
 *   GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD
 *   OAUTH_TOTP (only if the account is OTP-gated)
 */
const path = require('path');
// Load .env from the contracts dir so the script works regardless of cwd
// (the npm-run scripts rely on cwd being the contracts dir; this doesn't).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const config = require('./config');
const auth = require('./auth');
const { getCreatedAddress, getIssueId, pollForCreateIssueExecution } = require('./util');
const { rest, importer, util } = require('blockapps-rest');
const axios = require('axios');
const fs = require('fs-extra');

const EMPTY_PROXY_IMPL = '0xdeadbeef';
// The owner of the implementation address is ignored in favor of the proxy owner
const DEFAULT_CONSTRUCTOR_ARGS = { initialOwner: 'deadbeef' };

// Q64.96 sqrt-price bounds (canonical Uniswap V3 / poolV3Math.helper.ts).
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

const normalizeAddr = (value) => (value || '').toLowerCase().replace(/^0x/, '');

/** Integer square root (ported verbatim from poolV3Math.helper.ts). */
function isqrt(n) {
  if (n < 0n) throw new Error('isqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Convert a human-readable price to a Q64.96 sqrt price. Ported verbatim from the
 * backend's poolV3Math.helper.ts so the script matches the createPool endpoint.
 * @param {string} price token1-per-token0 (tokenB per tokenA), e.g. "2000", "1793.25"
 * @param {number} decimals0 decimals of token0 (tokenA)
 * @param {number} decimals1 decimals of token1 (tokenB)
 * @returns {bigint} sqrtPriceX96
 */
function priceToSqrtPriceX96(price, decimals0, decimals1) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(price).trim());
  if (!m) throw new Error(`price must be a non-negative decimal string, got: ${price}`);
  const frac = m[2] || '';
  const priceNum = BigInt(m[1] + frac); // price * 10^frac.length
  if (priceNum === 0n) throw new Error('price must be greater than zero');

  let numerator = priceNum << 192n;
  let denominator = 10n ** BigInt(frac.length);
  const e = decimals1 - decimals0;
  if (e >= 0) numerator *= 10n ** BigInt(e);
  else denominator *= 10n ** BigInt(-e);

  const sqrtPriceX96 = isqrt(numerator / denominator);
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
    throw new Error(`price ${price} is outside the representable range for this token pair`);
  }
  return sqrtPriceX96;
}

/**
 * Fetch each token's decimals from Cirrus (/BlockApps-Token.customDecimals,
 * default 18) using the token we already hold — no extra authentication.
 */
async function fetchTokenDecimals(tokenObj, addresses) {
  const addrs = [...new Set(addresses.map(normalizeAddr))];
  const baseUrl = config.nodes[0].url.replace(/\/$/, '');
  const response = await axios.get(`${baseUrl}/cirrus/search/BlockApps-Token`, {
    headers: { Authorization: `Bearer ${tokenObj.token}` },
    params: { address: `in.(${addrs.join(',')})`, select: 'address,customDecimals' },
  });
  const map = new Map();
  for (const row of response.data || []) {
    map.set(normalizeAddr(row.address), row.customDecimals == null ? 18 : Number(row.customDecimals));
  }
  return map;
}

const DEFAULTS = {
  owner: '100c',
  'contract-name': 'PoolV3Factory',
  'contract-file': 'BaseCodeCollection.sol',
  'initialize-args': path.join(__dirname, 'initialize-args.json'),
};

function printUsage() {
  console.error('Usage: node deployPoolV3FactoryProxy.js [--owner <addr>] [--contract-name <name>] [--contract-file <file>] [--initialize-args <path>]');
  console.error('');
  console.error('Defaults: --owner 100c --contract-name PoolV3Factory --contract-file BaseCodeCollection.sol --initialize-args ./initialize-args.json');
  console.error('');
  console.error('Required environment variables (.env):');
  console.error('  OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD');
  console.error('  OAUTH_TOTP (only for OTP-gated accounts)');
}

// A value is "unfilled" if it's not a non-empty string or still a <placeholder>.
function isUnfilled(value) {
  return typeof value !== 'string' || value.trim() === '' || value.trim().startsWith('<');
}

/**
 * Load and validate the setup config JSON ({ initialize, pools }). Fails loudly
 * with admin-friendly messages so a non-technical operator knows what to fix.
 */
function loadSetupConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Config file is not valid JSON (${configPath}): ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file must be a JSON object (${configPath}).`);
  }

  // ----- initialize args -----
  const initialize = parsed.initialize;
  if (!initialize || typeof initialize !== 'object' || Array.isArray(initialize)) {
    throw new Error(`Config file must contain an "initialize" object (${configPath}).`);
  }
  const unfilledInit = Object.entries(initialize)
    .filter(([, value]) => isUnfilled(value))
    .map(([key]) => key);
  if (unfilledInit.length > 0) {
    throw new Error(`Please fill in real values under "initialize" in ${configPath} for: ${unfilledInit.join(', ')}`);
  }

  // ----- pools (optional; empty/omitted = create none) -----
  const pools = parsed.pools === undefined ? [] : parsed.pools;
  if (!Array.isArray(pools)) {
    throw new Error(`"pools" must be an array in ${configPath}.`);
  }
  pools.forEach((pool, i) => {
    if (!pool || typeof pool !== 'object' || Array.isArray(pool)) {
      throw new Error(`pools[${i}] must be an object in ${configPath}.`);
    }
    ['tokenA', 'tokenB'].forEach((key) => {
      if (isUnfilled(pool[key])) {
        throw new Error(`Please fill in a real value for pools[${i}].${key} in ${configPath}.`);
      }
    });
    const feeNum = Number(pool.fee);
    if (!Number.isInteger(feeNum) || feeNum <= 0) {
      throw new Error(`pools[${i}].fee must be a positive integer (fee tier in pips) in ${configPath}.`);
    }

    // Each pool sets its starting price via exactly one of: a readable "price"
    // (tokenB per tokenA, converted here) or a raw "initialSqrtPriceX96".
    const hasPrice = pool.price !== undefined && pool.price !== null &&
      !(typeof pool.price === 'string' && (pool.price.trim() === '' || pool.price.trim().startsWith('<')));
    const hasSqrt = pool.initialSqrtPriceX96 !== undefined && !isUnfilled(pool.initialSqrtPriceX96);
    if (hasPrice === hasSqrt) {
      throw new Error(`pools[${i}] must set exactly one of "price" or "initialSqrtPriceX96" in ${configPath}.`);
    }
    if (hasPrice && !/^\d+(?:\.\d+)?$/.test(String(pool.price).trim())) {
      throw new Error(`pools[${i}].price must be a non-negative decimal (e.g. "1793.25") in ${configPath}.`);
    }
    if (hasSqrt && (!/^\d+$/.test(String(pool.initialSqrtPriceX96)) || String(pool.initialSqrtPriceX96) === '0')) {
      throw new Error(`pools[${i}].initialSqrtPriceX96 must be a positive integer (as a string) in ${configPath}.`);
    }
  });

  return { initialize, pools };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for argument: ${args[i]}`);
      }
      parsed[key] = value;
      i++;
    }
  }
  return parsed;
}

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

async function combineSource(contractFilePath) {
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

/**
 * Async createContract + poll for receipt. Sync createContract returns `{}` when
 * routed through the caller's user-contract, so we pull the new address out of
 * `txResult.contractsCreated` (or resolve it via the governance issue) ourselves.
 */
async function deployContractAsync(tokenObj, contractArgs, baseOptions, addressLabel) {
  const asyncOptions = { ...baseOptions, isAsync: true };
  const submittedAt = new Date().toISOString();
  const response = await rest.createContract(tokenObj, contractArgs, asyncOptions);
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) {
    const voteIssueId = responseArray.find((r) => typeof r === 'string');
    if (voteIssueId) {
      return pollForCreateIssueExecution(tokenObj, voteIssueId, null, submittedAt, addressLabel);
    }
    throw new Error('rest.createContract returned no tx hash: ' + JSON.stringify(response));
  }

  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    60000
  );

  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error(`${addressLabel} deployment failed: ` + JSON.stringify(final || finalResults));
  }

  const address = getCreatedAddress(final);
  if (address) return address;

  const issueId = getIssueId(final);
  if (issueId) {
    return pollForCreateIssueExecution(tokenObj, issueId, final, submittedAt, addressLabel);
  }
  throw new Error(`Deployment succeeded but no contractsCreated entry (${addressLabel}): ` + JSON.stringify(final));
}

/**
 * Async contract call + poll. The sync resolver crashes on user-contract-routed
 * calls (reads `.contents` on a null `data`); isAsync + getBlocResults confirms
 * success via the raw receipt instead.
 */
async function callAsync(tokenObj, callArgs, baseOptions) {
  const asyncOptions = { ...baseOptions, isAsync: true };
  const response = await rest.call(tokenObj, callArgs, asyncOptions);
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error('rest.call returned no tx hash: ' + JSON.stringify(response));
  }

  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    60000
  );

  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error('setLogicContract call failed: ' + JSON.stringify(final || finalResults));
  }
  return final;
}

async function main() {
  console.log('Deploy Proxy + Logic and wire them together');
  console.log('===========================================\n');

  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(`Error parsing arguments: ${error.message}\n`);
    printUsage();
    process.exit(1);
  }

  const owner = args.owner || DEFAULTS.owner;
  const contractName = args['contract-name'] || DEFAULTS['contract-name'];
  const contractFile = args['contract-file'] || DEFAULTS['contract-file'];
  const configPath = args['initialize-args'] || DEFAULTS['initialize-args'];

  // Validate the whole config up front, BEFORE authenticating, so we don't burn
  // a (time-limited) OTP code just to fail on a bad config file.
  let initializeArgs;
  let pools;
  try {
    ({ initialize: initializeArgs, pools } = loadSetupConfig(configPath));
  } catch (error) {
    console.error(`${error.message}\n`);
    printUsage();
    process.exit(1);
  }

  const requiredVars = [
    'GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD',
    'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL', 'NODE_URL',
  ];
  const missingVars = requiredVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}\n`);
    printUsage();
    process.exit(1);
  }

  const username = process.env.GLOBAL_ADMIN_NAME;
  const password = process.env.GLOBAL_ADMIN_PASSWORD;

  // Authenticate ONCE — reused for every transaction below (single OTP code).
  console.log(`Authenticating as ${username}...`);
  const token = await auth.getUserToken(username, password);
  const tokenObj = { token };
  console.log('Authenticated.\n');

  // Resolve each pool's starting price to sqrtPriceX96 up front — before deploying
  // anything — so an unindexed token or out-of-range price fails fast instead of
  // leaving a half-configured factory. Readable "price" values are converted using
  // the tokens' on-chain decimals (same math as the backend createPool endpoint).
  const poolSqrtPrices = new Array(pools.length);
  const priceTokenAddrs = pools
    .filter((pool) => pool.price !== undefined && pool.price !== null && String(pool.price).trim() !== '')
    .flatMap((pool) => [pool.tokenA, pool.tokenB]);
  const decimalsMap = priceTokenAddrs.length > 0
    ? await fetchTokenDecimals(tokenObj, priceTokenAddrs)
    : new Map();
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const usePrice = pool.price !== undefined && pool.price !== null && String(pool.price).trim() !== '';
    if (!usePrice) {
      poolSqrtPrices[i] = String(pool.initialSqrtPriceX96);
      continue;
    }
    const dec0 = decimalsMap.get(normalizeAddr(pool.tokenA));
    const dec1 = decimalsMap.get(normalizeAddr(pool.tokenB));
    if (dec0 === undefined || dec1 === undefined) {
      throw new Error(
        `Could not resolve token decimals for pools[${i}] (${pool.tokenA} / ${pool.tokenB}). Are both tokens indexed in Cirrus (/BlockApps-Token)?`
      );
    }
    poolSqrtPrices[i] = priceToSqrtPriceX96(pool.price, dec0, dec1).toString();
    console.log(`Pool ${i + 1}: price ${pool.price} (tokenB/tokenA) -> sqrtPriceX96 ${poolSqrtPrices[i]} [dec0=${dec0}, dec1=${dec1}]`);
  }
  if (pools.length > 0) console.log('');

  const contractsDir = config.resolvePath(config.contractsDir);
  const contractFilePath = path.join(contractsDir, contractFile);
  if (!fs.existsSync(contractFilePath)) {
    throw new Error(`Contract file not found: ${contractFilePath}`);
  }

  console.log(`Combining source from: ${contractFilePath}`);
  const source = await combineSource(contractFilePath);
  console.log('Comments stripped from combined source(s)\n');

  const sharedTxParams = { gasPrice: config.gasPrice, gasLimit: config.gasLimit };

  // -------- Step 1: Deploy empty Proxy --------
  console.log('Step 1/5: Deploying empty Proxy');
  console.log(`  _logicContract: ${EMPTY_PROXY_IMPL} (empty proxy)`);
  console.log(`  _initialOwner:  ${owner}`);
  const proxyAddress = await deployContractAsync(
    tokenObj,
    {
      name: 'Proxy',
      source,
      args: { _logicContract: EMPTY_PROXY_IMPL, _initialOwner: owner },
      txParams: sharedTxParams,
    },
    { config, logger: console, history: ['Proxy'], cacheNonce: true, query: { username: 'BlockApps' } },
    'Proxy address'
  );
  console.log(`  -> Proxy deployed at: ${proxyAddress}\n`);

  // -------- Step 2: Deploy logic implementation --------
  console.log(`Step 2/5: Deploying implementation ${contractName}`);
  const implementationAddress = await deployContractAsync(
    tokenObj,
    {
      name: contractName,
      source,
      args: DEFAULT_CONSTRUCTOR_ARGS,
      txParams: sharedTxParams,
    },
    { config, logger: console, history: [contractName], cacheNonce: true, query: { username: 'BlockApps' } },
    'implementation address'
  );
  console.log(`  -> ${contractName} deployed at: ${implementationAddress}\n`);

  // -------- Step 3: Point the proxy at the implementation --------
  console.log('Step 3/5: Calling setLogicContract on the proxy');
  console.log(`  Proxy:          ${proxyAddress}`);
  console.log(`  Implementation: ${implementationAddress}`);
  const upgradeReceipt = await callAsync(
    tokenObj,
    {
      contract: { address: proxyAddress, name: 'Proxy' },
      method: 'setLogicContract',
      args: { _logicContract: implementationAddress },
      txParams: sharedTxParams,
    },
    { config, cacheNonce: true }
  );
  const upgradeVoteHint = upgradeReceipt && upgradeReceipt.txResult && upgradeReceipt.txResult.message;
  console.log(`  -> setLogicContract: ${upgradeReceipt.status}\n`);

  // -------- Step 4: Initialize the proxy (delegatecalls into the logic) --------
  // Called on the proxy address with the logic contract's name so blockapps-rest
  // can resolve the method; runs in the proxy's storage context via delegatecall.
  console.log(`Step 4/5: Calling initialize on the proxy`);
  console.log(`  Args: ${JSON.stringify(initializeArgs)}`);
  const initializeReceipt = await callAsync(
    tokenObj,
    {
      contract: { address: proxyAddress, name: contractName },
      method: 'initialize',
      args: initializeArgs,
      txParams: sharedTxParams,
    },
    { config, cacheNonce: true }
  );
  const initializeVoteHint = initializeReceipt && initializeReceipt.txResult && initializeReceipt.txResult.message;
  console.log(`  -> initialize: ${initializeReceipt.status}\n`);

  // -------- Step 5: Create pools via createPoolV3 (one tx per pool) --------
  console.log(`Step 5/5: Creating ${pools.length} pool(s) via createPoolV3`);
  const poolResults = [];
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const initialSqrtPriceX96 = poolSqrtPrices[i];
    console.log(`  [${i + 1}/${pools.length}] createPoolV3 tokenA=${pool.tokenA} tokenB=${pool.tokenB} fee=${pool.fee} initialSqrtPriceX96=${initialSqrtPriceX96}`);
    const poolReceipt = await callAsync(
      tokenObj,
      {
        contract: { address: proxyAddress, name: contractName },
        method: 'createPoolV3',
        args: {
          tokenA: pool.tokenA,
          tokenB: pool.tokenB,
          fee: Number(pool.fee),
          initialSqrtPriceX96,
        },
        txParams: sharedTxParams,
      },
      { config, cacheNonce: true }
    );
    const poolVoteHint = poolReceipt && poolReceipt.txResult && poolReceipt.txResult.message;
    console.log(`      -> createPoolV3: ${poolReceipt.status}`);
    poolResults.push({ ...pool, initialSqrtPriceX96, status: poolReceipt.status, voteHint: poolVoteHint });
  }
  if (pools.length === 0) {
    console.log('  No pools configured; skipping pool creation.');
  }
  console.log('');

  const poolVoteHints = poolResults.filter((p) => p.voteHint);

  console.log('====== Done ======');
  console.log(`Proxy Address:      ${proxyAddress}`);
  console.log(`Implementation:     ${implementationAddress} (${contractName})`);
  console.log(`Owner:              ${owner}`);
  console.log(`setLogicContract:   ${upgradeReceipt.status}`);
  console.log(`initialize:         ${initializeReceipt.status}`);
  console.log(`pools created:      ${poolResults.length}`);
  poolResults.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.tokenA} / ${p.tokenB} @ fee ${p.fee}: ${p.status}`);
  });
  console.log('Great success!');
  console.log('==================');

  return { proxyAddress, implementationAddress, contractName, owner, initializeArgs, pools: poolResults };
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nScript failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  });
}

module.exports = main;
