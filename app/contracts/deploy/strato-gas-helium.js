// Helium rollout of STRATO-as-gas: the canonical STRATO/USDST PoolV3 the FeeRouter
// prices from, and the token-side prerequisites around it.
//
//   node strato-gas-helium.js status [router]
//   node strato-gas-helium.js unpause                      (STRATO.unpause; vote, run per admin)
//   node strato-gas-helium.js create-pool [usdstPerStrato] (createPoolV3; vote, run per admin)
//   node strato-gas-helium.js seed-pool <pool> <usdst>     (grow the ring + full-range mint, as a funded account)
//   node strato-gas-helium.js swap <pool> <amountIn> [strato] (USDST -> STRATO, or STRATO -> USDST; writes an observation)
//   node strato-gas-helium.js burn <pool>                  (remove the caller's full-range liquidity; seed-pool restores it)
//   node strato-gas-helium.js transfer <to> <strato>       (STRATO.transfer)
//
// Ownable turns a non-owner call into an AdminRegistry vote and the tx still reports
// Success, so every vote step re-reads state instead of trusting the receipt.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const axios = require('axios');
const { rest, util } = require('blockapps-rest');

const STRATO = '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04';
const USDST = '937efa7e3a77e20bbdbd7c0d32b6514f368c1010';
const POOL_V3_FACTORY = 'e6b6f05a88e649e4102a801aade9a6bae02f352d'; // backend defaultPoolV3FactoryFor helium
const DECIDER_STATE = '00000000000000000000000000000000dec1de02';
const FEE_TIER = 3000; // tickSpacing 60
const FULL_RANGE = 887220; // MAX_TICK rounded down to the tier's spacing
const ORACLE_STRATO_PRICE = '904955339400000000'; // PriceOracle 0x1002's STRATO price, USDST per STRATO
const Q96 = 2n ** 96n;
const WAD = 10n ** 18n;
const CARDINALITY = 500;

const isqrt = (n) => { let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
const cirrusUrl = 'https://app.testnet.strato.nexus/cirrus/search';

async function storage(address) {
  const { data } = await axios.get(`${config.nodes[0].url}/strato-api/eth/v1.2/storage`, { params: { address }, timeout: 30000 });
  const rows = {};
  for (const r of data) rows[r.key] = r.value;
  return rows;
}
const addrOf = (v) => { const m = /address\(([0-9a-fA-F]{40})\)/.exec(v || ''); return m ? m[1] : v; };

async function findPool() {
  const { data } = await axios.get(`${cirrusUrl}/BlockApps-PoolV3`, {
    params: {
      poolV3Factory: `eq.${POOL_V3_FACTORY}`, fee: `eq.${FEE_TIER}`,
      or: `(and(token0.eq.${STRATO},token1.eq.${USDST}),and(token0.eq.${USDST},token1.eq.${STRATO}))`,
      select: 'address,token0,token1,sqrtPriceX96,currentTick,liquidity,observationCardinality,observationCardinalityNext,observationIndex',
    }, timeout: 30000,
  });
  return data[0] || null;
}

async function login() {
  const user = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  const key = await rest.getKey(tokenObj, { config });
  console.log(`Signing as ${user} (${key})`);
  return { tokenObj, key };
}

async function callAsync(tokenObj, contract, method, args) {
  const resp = await rest.call(tokenObj, {
    contract, method, args,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, isAsync: true, cacheNonce: true });
  const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);
  const final = Array.isArray(results) ? results[0] : results;
  console.log(`${contract.name}.${method}: ${final && final.status}` +
    (final && final.status !== 'Success' ? ` | ${JSON.stringify(final).slice(0, 400)}` : ''));
  if (!final || final.status !== 'Success') process.exit(1);
  return final;
}

async function status(router) {
  const strato = await storage(STRATO);
  console.log(`STRATO ${STRATO}: paused=${strato._paused} logic=${addrOf(strato.logicContract)} totalSupply=${strato._totalSupply}`);
  const decider = await storage(DECIDER_STATE);
  console.log(`DeciderState currentFeeContract=${addrOf(decider.currentFeeContract)}`);
  const pool = await findPool();
  if (!pool) { console.log('Canonical pool: none'); return; }
  console.log(`Pool ${pool.address}: token0=${pool.token0 === STRATO ? 'STRATO' : pool.token0} tick=${pool.currentTick} ` +
    `liquidity=${pool.liquidity} cardinality=${pool.observationCardinality}/${pool.observationCardinalityNext} index=${pool.observationIndex}`);
  const rows = await storage(pool.address);
  const now = Math.floor(Date.now() / 1000);
  const obs = Object.keys(rows).filter(k => /^observations\[\d+\]\.blockTimestamp$/.test(k))
    .map(k => ({ slot: k, ts: Number(rows[k]), init: rows[k.replace('blockTimestamp', 'initialized')] }))
    .filter(o => o.init === 'true' || o.init === true).sort((a, b) => a.ts - b.ts);
  if (obs.length) console.log(`Observations: ${obs.length} initialized, oldest ${obs[0].ts} (${now - obs[0].ts}s ago), newest ${obs[obs.length - 1].ts}`);
  if (router) {
    const r = await storage(router);
    console.log(`Router ${router}: quotedFee=${r.quotedFee} quotedAt=${r.quotedAt} priceVersion=${r.priceVersion} lastRewardedBlock=${r.lastRewardedBlock}`);
    // Block rewards come out of the router's own STRATO (0.01 per block, FeeRouter.BLOCK_REWARD),
    // so its balance is the validators' runway.
    const { data: held } = await axios.get(`${cirrusUrl}/BlockApps-Token-_balances`, {
      params: { address: `eq.${STRATO}`, key: `eq.${router}`, select: 'value::text' }, timeout: 30000,
    });
    const balance = BigInt(held[0]?.value || '0');
    const blocksLeft = balance / BLOCK_REWARD;
    const secondsPerBlock = await recentSecondsPerBlock();
    console.log(`Router STRATO balance: ${Number(balance) / 1e18} = ${blocksLeft} blocks of rewards` +
      ` (~${(Number(blocksLeft) * secondsPerBlock / 86400).toFixed(1)} days at ${secondsPerBlock.toFixed(2)} s/block)`);
  }
}

const BLOCK_REWARD = 10n ** 16n; // FeeRouter.BLOCK_REWARD, 0.01 STRATO per block
const RATE_WINDOW = 5000; // blocks the block-time estimate averages over

async function recentSecondsPerBlock() {
  const block = async (tag) => {
    const { data } = await axios.post(`${config.nodes[0].url}/rpc`,
      { jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: [tag, false] }, { timeout: 30000 });
    return { number: Number(data.result.number), timestamp: Number(data.result.timestamp) };
  };
  const tip = await block('latest');
  const past = await block(`0x${(tip.number - RATE_WINDOW).toString(16)}`);
  return (tip.timestamp - past.timestamp) / (tip.number - past.number);
}

(async () => {
  const [cmd, a1, a2, a3] = process.argv.slice(2);
  if (!cmd || cmd === 'status') return status(a1);

  const { tokenObj, key } = await login();
  const token = (address) => ({ address, name: 'Token' });

  if (cmd === 'unpause') {
    await callAsync(tokenObj, token(STRATO), 'unpause', {});
    console.log(`STRATO paused: ${(await storage(STRATO))._paused}  (stays true until the second admin votes)`);
  } else if (cmd === 'create-pool') {
    const price = BigInt(a1 || ORACLE_STRATO_PRICE);
    const sqrtPriceX96 = isqrt(price * Q96 * Q96 / WAD).toString();
    console.log(`createPoolV3(STRATO, USDST, ${FEE_TIER}, ${sqrtPriceX96})  (${Number(price) / 1e18} USDST per STRATO)`);
    await callAsync(tokenObj, { address: POOL_V3_FACTORY, name: 'PoolV3Factory' }, 'createPoolV3', {
      tokenA: STRATO, tokenB: USDST, fee: FEE_TIER, initialSqrtPriceX96: sqrtPriceX96,
    });
    const pool = await findPool();
    console.log(pool ? `Pool created: ${pool.address}` : 'Pool not created yet (needs the second admin vote)');
  } else if (cmd === 'seed-pool') {
    const pool = a1.replace(/^0x/, '');
    const amount1 = BigInt(a2) * WAD;
    const row = await findPool();
    if (!row || row.address !== pool) throw new Error(`${pool} is not the canonical STRATO/USDST pool`);
    const sqrtP = BigInt(row.sqrtPriceX96);
    const stratoIs0 = row.token0 === STRATO;
    // Full range: amount0 ~= L / sqrtP, amount1 ~= L * sqrtP (the range edges contribute ~0).
    const liquidity = stratoIs0 ? amount1 * Q96 / sqrtP : amount1 * sqrtP / Q96;
    const amount0 = liquidity * Q96 / sqrtP;
    const amount1Calc = liquidity * sqrtP / Q96;
    const max = (x) => (x * 101n / 100n).toString();
    const [stratoAmt, usdstAmt] = stratoIs0 ? [amount0, amount1Calc] : [amount1Calc, amount0];
    console.log(`liquidity ${liquidity} -> ~${Number(stratoAmt / WAD)} STRATO + ~${Number(usdstAmt / WAD)} USDST`);
    await callAsync(tokenObj, { address: pool, name: 'PoolV3' }, 'increaseObservationCardinalityNext', { next: CARDINALITY });
    await callAsync(tokenObj, token(STRATO), 'approve', { spender: pool, value: max(stratoAmt) });
    await callAsync(tokenObj, token(USDST), 'approve', { spender: pool, value: max(usdstAmt) });
    await callAsync(tokenObj, { address: pool, name: 'PoolV3' }, 'mint', {
      recipient: key, tickLower: -FULL_RANGE, tickUpper: FULL_RANGE, amount: liquidity.toString(),
      amount0Max: max(amount0), amount1Max: max(amount1Calc), deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    await status();
  } else if (cmd === 'swap') {
    const pool = a1.replace(/^0x/, '');
    const row = await findPool();
    if (!row || row.address !== pool) throw new Error(`${pool} is not the canonical STRATO/USDST pool`);
    const amountIn = (BigInt(a2) * WAD).toString();
    const tokenIn = a3 === 'strato' ? STRATO : USDST;
    await callAsync(tokenObj, token(tokenIn), 'approve', { spender: pool, value: amountIn });
    await callAsync(tokenObj, { address: pool, name: 'PoolV3' }, 'swap', {
      recipient: key, zeroForOne: row.token0 === tokenIn, amountSpecified: amountIn,
      sqrtPriceLimitX96: 0, amountLimit: 1, deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    await status();
  } else if (cmd === 'burn') {
    const pool = a1.replace(/^0x/, '');
    const { data: [pos] } = await axios.get(`${cirrusUrl}/BlockApps-PoolV3-positions`, {
      params: { address: `eq.${pool}`, key: `eq.${key.toLowerCase()}`, key2: `eq.${-FULL_RANGE}`, key3: `eq.${FULL_RANGE}`, select: 'value' }, timeout: 30000,
    });
    const liquidity = pos ? pos.value.liquidity : '0';
    console.log(`Burning liquidity ${liquidity}`);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    await callAsync(tokenObj, { address: pool, name: 'PoolV3' }, 'burn', { tickLower: -FULL_RANGE, tickUpper: FULL_RANGE, amount: liquidity, deadline });
    const max = (2n ** 128n - 1n).toString();
    await callAsync(tokenObj, { address: pool, name: 'PoolV3' }, 'collect', { recipient: key, tickLower: -FULL_RANGE, tickUpper: FULL_RANGE, amount0Requested: max, amount1Requested: max });
    await status();
  } else if (cmd === 'transfer') {
    await callAsync(tokenObj, token(STRATO), 'transfer', { to: a1.replace(/^0x/, ''), value: (BigInt(a2) * WAD).toString() });
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
})().catch(e => { console.error('FAILED:', e.message.slice(0, 400)); process.exit(1); });
