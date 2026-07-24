/**
 * Create the PoolV3 pools listed in initialize-args.json against an ALREADY
 * deployed + initialized PoolV3Factory proxy. This is Step 5 of
 * deployPoolV3FactoryProxy.js pulled out on its own: it does NOT deploy a proxy,
 * deploy a logic contract, wire them, or call initialize.
 *
 * It reads the "pools" array from initialize-args.json and, for each entry,
 * calls createPoolV3(tokenA, tokenB, fee, initialSqrtPriceX96) on the proxy.
 *
 * Each pool sets its starting price via exactly one of:
 *   - "price": human-readable tokenB-per-tokenA (converted to sqrtPriceX96 here
 *     using each token's on-chain decimals, same math as the backend createPool), or
 *   - "initialSqrtPriceX96": a raw Q64.96 sqrt price (advanced/manual).
 *
 * Usage:
 *   node createPoolsV3.js <poolV3FactoryProxyAddress>
 *
 * Required environment variables (.env):
 *   OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,
 *   GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD
 *   OAUTH_TOTP (only if the account is OTP-gated)
 */
const path = require('path');
// Load .env from the contracts dir so the script works regardless of cwd.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');
const axios = require('axios');
const fs = require('fs-extra');

// The logic contract name so blockapps-rest can resolve createPoolV3 on the proxy.
const CONTRACT_NAME = 'PoolV3Factory';
// Config file (next to this script) that holds the "pools" array.
const INITIALIZE_ARGS_PATH = path.join(__dirname, 'initialize-args.json');

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

function printUsage() {
  console.error('Usage: node createPoolsV3.js <poolV3FactoryProxyAddress>');
  console.error('');
  console.error(`Reads the "pools" array from ${INITIALIZE_ARGS_PATH}`);
  console.error('');
  console.error('Required environment variables (.env):');
  console.error('  OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD');
  console.error('  OAUTH_TOTP (only for OTP-gated accounts)');
}

// A value is "unfilled" if it's not a non-empty string or still a <placeholder>.
function isUnfilled(value) {
  return typeof value !== 'string' || value.trim() === '' || value.trim().startsWith('<');
}

/** Load and validate the "pools" array from the config JSON. */
function loadPools(configPath) {
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

  return pools;
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
    throw new Error('createPoolV3 call failed: ' + JSON.stringify(final || finalResults));
  }
  return final;
}

async function main() {
  console.log('Create PoolV3 pools on an existing PoolV3Factory proxy');
  console.log('=====================================================\n');

  const proxyAddress = normalizeAddr(process.argv[2]);
  if (!proxyAddress) {
    console.error('Error: missing required PoolV3Factory proxy address.\n');
    printUsage();
    process.exit(1);
  }

  // Validate the pools config up front, BEFORE authenticating, so we don't burn
  // a (time-limited) OTP code just to fail on a bad config file.
  let pools;
  try {
    pools = loadPools(INITIALIZE_ARGS_PATH);
  } catch (error) {
    console.error(`${error.message}\n`);
    printUsage();
    process.exit(1);
  }
  if (pools.length === 0) {
    console.error(`No pools configured in ${INITIALIZE_ARGS_PATH}; nothing to do.`);
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

  // Resolve each pool's starting price to sqrtPriceX96 up front — before creating
  // anything — so an unindexed token or out-of-range price fails fast. Readable
  // "price" values are converted using the tokens' on-chain decimals (same math
  // as the backend createPool endpoint).
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
  console.log('');

  const sharedTxParams = { gasPrice: config.gasPrice, gasLimit: config.gasLimit };

  // -------- Create pools via createPoolV3 (one tx per pool) --------
  console.log(`Creating ${pools.length} pool(s) via createPoolV3 on proxy ${proxyAddress}`);
  const poolResults = [];
  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const initialSqrtPriceX96 = poolSqrtPrices[i];
    console.log(`  [${i + 1}/${pools.length}] createPoolV3 tokenA=${pool.tokenA} tokenB=${pool.tokenB} fee=${pool.fee} initialSqrtPriceX96=${initialSqrtPriceX96}`);
    const poolReceipt = await callAsync(
      tokenObj,
      {
        contract: { address: proxyAddress, name: CONTRACT_NAME },
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
  console.log('');

  console.log('====== Done ======');
  console.log(`Proxy Address:  ${proxyAddress}`);
  console.log(`pools created:  ${poolResults.length}`);
  poolResults.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.tokenA} / ${p.tokenB} @ fee ${p.fee}: ${p.status}`);
  });
  console.log('Great success!');
  console.log('==================');

  return { proxyAddress, pools: poolResults };
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nScript failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  });
}

module.exports = main;
