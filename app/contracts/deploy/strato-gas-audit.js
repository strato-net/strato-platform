// Read-only qualification audit of STRATO-as-gas on a live network: the activation
// gates of the migration plan's step 6 that chain data can answer.
//
//   node strato-gas-audit.js [router] [--blocks N] [--nodes url,url,...] [--json]
//
// router  the installed FeeRouter (default: what DeciderState points at)
// --blocks  how many recent blocks to re-read as receipts (default 300)
// --nodes   RPC bases whose tip hashes must agree (default: NODE_URL only)
//
// Everything is read from NODE_URL's Cirrus and RPC; nothing is signed or sent. Each
// gate prints PASS/FAIL/INFO with the numbers behind it, so a run is the evidence.
require('dotenv').config();
const config = require('./config');
const axios = require('axios');

const DECIDER_STATE = '00000000000000000000000000000000dec1de02';
const ZERO = '0000000000000000000000000000000000000000';
const DEAD = 'deaddeaddeaddeaddeaddeaddeaddeaddeaddead'; // FeeRouter.BURN_ADDRESS (V6 on); routers through V5 burned to ZERO
const WAD = 10n ** 18n;
const USD_FEE = 10n ** 16n;
const FEE_PAID_TOPIC = '0x9766415a366eee49dea2373907d50273c3aefcd4207d8c7063a5bb343305a8e0'; // FeePaid(address,uint8,uint256,uint256)
const Q96 = 2n ** 96n;
const PAGE = 1000;

const node = config.nodes[0].url;
const cirrus = `${node}/cirrus/search`;

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { router: null, blocks: 300, nodes: [node], json: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--blocks') o.blocks = parseInt(a[++i], 10);
    else if (a[i] === '--nodes') o.nodes = a[++i].split(',');
    else if (a[i] === '--json') o.json = true;
    else o.router = a[i].replace(/^0x/, '');
  }
  return o;
}

async function rpc(base, method, params) {
  const { data } = await axios.post(`${base}/rpc`, { jsonrpc: '2.0', id: 1, method, params }, { timeout: 60000 });
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result;
}

async function storage(address) {
  const { data } = await axios.get(`${node}/strato-api/eth/v1.2/storage`, { params: { address }, timeout: 60000 });
  const rows = {};
  for (const r of data) rows[r.key] = r.value;
  return rows;
}
const strato4 = (w) => `${w / WAD}.${(w % WAD).toString().padStart(18, '0').slice(0, 4)}`;
const addrOf = (v) => { const m = /\(([0-9a-fA-F]{40})\)/.exec(v || ''); return m ? m[1] : String(v || ''); };

// Every row of a Cirrus table matching params, in id order (keyset, so size is no limit).
async function page(table, params) {
  const rows = [];
  let after = 0;
  for (;;) {
    const { data } = await axios.get(`${cirrus}/${table}`, {
      params: { ...params, id: `gt.${after}`, order: 'id.asc', limit: String(PAGE) }, timeout: 120000,
    });
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    after = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
  return rows;
}

// Mapping tables have no id column: page them by offset instead.
async function pageOffset(table, params) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await axios.get(`${cirrus}/${table}`, { params: { ...params, offset: String(offset), limit: String(PAGE) }, timeout: 120000 });
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const results = [];
const gate = (status, name, detail) => { results.push({ status, name, detail }); };

(async () => {
  const opts = parseArgs();
  const decider = await storage(DECIDER_STATE);
  const router = opts.router || addrOf(decider.currentFeeContract).toLowerCase();
  const tip = parseInt(await rpc(node, 'eth_blockNumber', []), 16);

  // ---- 1. One quote and one reward per block since the router went live ----
  const quotes = await page('event', { address: `eq.${router}`, event_name: 'eq.StratoFeeQuoted', select: 'id,block_number,attributes' });
  if (quotes.length === 0) { console.log(`Router ${router} has never quoted; nothing to audit.`); return; }
  const installBlock = Number(quotes[0].block_number);
  // The chain moves while this pages, so audit up to the last block the quotes cover.
  const auditTip = Number(quotes[quotes.length - 1].block_number);
  const blocksLive = auditTip - installBlock + 1;
  const feeAt = new Map();
  let dupQuotes = 0;
  for (const q of quotes) {
    const b = Number(q.block_number);
    if (feeAt.has(b)) dupQuotes++;
    feeAt.set(b, BigInt(q.attributes.fee));
  }
  const rewards = (await page('event', { address: `eq.${router}`, event_name: 'eq.BlockRewardsPaid', select: 'id,block_number,attributes' }))
    .filter(r => Number(r.block_number) <= auditTip);
  const rewardBlocks = new Set(rewards.map(r => Number(r.block_number)));
  // blockReward() exists from V5; an older router pays the original flat 0.01 STRATO.
  const BLOCK_REWARD = await rpc(node, 'eth_call', [{ to: `0x${router}`, data: '0x0ac168a1' }, 'latest']).then(BigInt, () => 10n ** 16n);
  gate(dupQuotes === 0 && quotes.length === blocksLive ? 'PASS' : 'FAIL', 'one STRATO quote per block',
    `${quotes.length} quotes over ${blocksLive} blocks since ${installBlock}, ${dupQuotes} duplicate blocks`);
  if (BLOCK_REWARD === 0n) gate(rewards.length === 0 ? 'PASS' : 'FAIL', 'block rewards switched off', `${rewards.length} rewards paid`);
  else gate(rewardBlocks.size === rewards.length && rewards.length === blocksLive ? 'PASS' : 'FAIL', 'one block reward per block',
    `${rewards.length} rewards, ${rewardBlocks.size} distinct blocks, ${rewards.length - rewardBlocks.size} repeats`);

  // ---- 2. Every fee charged equals that block's quote (or one whole voucher) ----
  const fees = await page('event', { event_name: 'eq.FeePaid', block_number: `gte.${installBlock}`, and: `(block_number.lte.${auditTip})`,
    select: 'id,block_number,transaction_hash,attributes' });
  const byMethod = {};
  let wrongVoucher = 0, wrongStrato = 0, burned = 0n;
  const perBlockPayer = new Map();
  const payers = new Map();
  const burnTxs = new Map();
  for (const f of fees) {
    const method = String(f.attributes.method).replace(/^FeeMethod\./, '');
    const amount = BigInt(f.attributes.amount);
    const b = Number(f.block_number);
    byMethod[method] = (byMethod[method] || 0) + 1;
    if (method === 'VOUCHER') { if (amount !== WAD) wrongVoucher++; }
    else if (method === 'USDST_COLLECTED') { if (amount !== USD_FEE) wrongVoucher++; } // legacy fee before the activation block
    else { if (amount !== feeAt.get(b)) wrongStrato++; burned += amount; burnTxs.set(f.transaction_hash, (burnTxs.get(f.transaction_hash) || 0n) + amount); }
    const key = `${b}:${f.attributes.payer}`;
    perBlockPayer.set(key, (perBlockPayer.get(key) || 0) + 1);
    const p = payers.get(f.attributes.payer) || {};
    p[method] = (p[method] || 0) + 1; payers.set(f.attributes.payer, p);
  }
  gate(wrongVoucher === 0 && wrongStrato === 0 ? 'PASS' : 'FAIL', 'fees charged at the block quote',
    `${fees.length} fees: ${JSON.stringify(byMethod)}; ${wrongVoucher} voucher/legacy amounts off, ${wrongStrato} STRATO amounts != block quote`);
  const multi = [...perBlockPayer.values()].filter(n => n > 1);
  gate(multi.length ? 'PASS' : 'INFO', 'multi-transaction blocks (same payer, several fees in one block)',
    `${multi.length} payer-blocks with >1 fee, max ${Math.max(0, ...multi)} in one block`);
  const swapPayers = [...payers.entries()].filter(([, p]) => p.USDST_SWAP_BURN).length;
  gate(swapPayers ? 'PASS' : 'INFO', 'USDST-only accounts bought their STRATO fee', `${swapPayers} payers used USDST_SWAP_BURN`);

  // ---- 3. Supply: every STRATO fee left circulation (burned, or sent to the burn address),
  // nothing ever left the burn address, and the supply is the balances ----
  const strato = (await axios.get(`${cirrus}/event`, { params: { event_name: 'eq.FeePaid', 'attributes->>method': 'eq.FeeMethod.STRATO_BURN', select: 'transaction_hash', limit: '1' }, timeout: 60000 })).data[0];
  const stratoTx = strato && strato.transaction_hash;
  const sample = stratoTx && await rpc(node, 'eth_getTransactionReceipt', [`0x${stratoTx}`]);
  const stratoToken = sample && sample.logs.find(l => [ZERO, DEAD].some(a => l.topics[2] === `0x${'0'.repeat(24)}${a}`))?.address.replace(/^0x/, '');
  let supplyDetail = 'no STRATO fee found yet';
  let supplyOk = true;
  if (stratoToken) {
    const burns = await page('event', { address: `eq.${stratoToken}`, event_name: 'eq.Transfer', block_number: `gte.${installBlock}`,
      and: `(block_number.lte.${auditTip})`, 'attributes->>to': `in.(${ZERO},${DEAD})`, select: 'id,transaction_hash,attributes' });
    let feeBurns = 0n, otherBurns = 0n, mismatchedTx = 0;
    const burnByTx = new Map();
    for (const t of burns) burnByTx.set(t.transaction_hash, (burnByTx.get(t.transaction_hash) || 0n) + BigInt(t.attributes.value));
    for (const [tx, amount] of burnByTx) {
      const fee = burnTxs.get(tx);
      if (fee === undefined) otherBurns += amount;
      else { feeBurns += amount; if (amount !== fee) mismatchedTx++; }
    }
    const [{ _totalSupply }] = (await axios.get(`${cirrus}/BlockApps-Token`, { params: { address: `eq.${stratoToken}`, select: '_totalSupply::text' }, timeout: 60000 })).data;
    const balances = await pageOffset('BlockApps-Token-_balances', { address: `eq.${stratoToken}`, select: 'key,value::text', order: 'key.asc' });
    const sumBalances = balances.reduce((s, r) => s + BigInt(r.value), 0n);
    // Nothing can sign for the burn address, so its balance is every transfer ever made into it.
    const deadIn = await page('event', { address: `eq.${stratoToken}`, event_name: 'eq.Transfer', 'attributes->>to': `eq.${DEAD}`, select: 'id,attributes' });
    const deadSent = deadIn.reduce((s, t) => s + BigInt(t.attributes.value), 0n);
    const deadBalance = BigInt(balances.find(r => r.key === DEAD)?.value || 0);
    supplyOk = mismatchedTx === 0 && feeBurns === burned && sumBalances === BigInt(_totalSupply) && deadBalance === deadSent;
    supplyDetail = `fees burned or sent to the burn address ${strato4(feeBurns)} STRATO in ${burnTxs.size} txs ` +
      `(${mismatchedTx} tx amounts differ from FeePaid), other burns or sends ${otherBurns / WAD} STRATO; ` +
      `totalSupply ${BigInt(_totalSupply) / WAD} == sum of ${balances.length} balances: ${sumBalances === BigInt(_totalSupply)}; ` +
      `burn address holds ${strato4(deadBalance)} STRATO == ${deadIn.length} transfers into it: ${deadBalance === deadSent}`;
  }
  gate(supplyOk ? 'PASS' : 'FAIL', 'STRATO fees reconcile with supply and the burn address', supplyDetail);

  // ---- 4. Included transactions all paid, reverted ones included ----
  // Paid = Cirrus holds a FeePaid for the transaction. Whether the node's receipt also
  // shows that log is a separate, wallet-facing check.
  let ok = 0, reverted = 0, revertedPaid = 0, unpaid = 0, logMissing = 0;
  const examples = [];
  const paidTxs = new Set(fees.map(f => `0x${f.transaction_hash}`));
  for (const f of await page('event', { event_name: 'eq.FeePaid', block_number: `gt.${auditTip}`, select: 'id,transaction_hash' })) paidTxs.add(`0x${f.transaction_hash}`);
  for (let b = Math.max(installBlock, tip - opts.blocks + 1); b <= tip; b++) {
    const receipts = await rpc(node, 'eth_getBlockReceipts', [`0x${b.toString(16)}`]);
    for (const r of receipts) {
      const paid = paidTxs.has(r.transactionHash);
      if (!paid) { unpaid++; if (examples.length < 3) examples.push(`${r.transactionHash} from ${r.from} status ${r.status}`); }
      if (paid && !r.logs.some(l => l.topics[0] === FEE_PAID_TOPIC)) logMissing++;
      if (r.status === '0x1') ok++; else { reverted++; if (paid) revertedPaid++; }
    }
  }
  gate(unpaid === 0 && reverted === revertedPaid ? 'PASS' : 'FAIL', `every included transaction paid (last ${opts.blocks} blocks)`,
    `${ok} succeeded, ${reverted} reverted of which ${revertedPaid} paid, ${unpaid} unpaid` +
    (examples.length ? `\n     e.g. ${examples.join('\n          ')}` : ''));
  if (reverted === 0) gate('INFO', 'reverted transactions still pay', 'no reverted transaction in the window: produce one (runbook gate 2) and re-run');
  gate(logMissing === 0 ? 'PASS' : 'FAIL', 'receipts carry the FeePaid log', `${logMissing} paid receipts without it`);

  // ---- 5. Oracle: time-weighted quote moves slowly, pool is deep enough ----
  const series = [...feeAt.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f);
  let maxStep = 0;
  for (let i = 1; i < series.length; i++) {
    const step = Number((series[i] > series[i - 1] ? series[i] - series[i - 1] : series[i - 1] - series[i]) * 10000n / series[i - 1]) / 100;
    if (step > maxStep) maxStep = step;
  }
  const r = await storage(router);
  const USDST = '937efa7e3a77e20bbdbd7c0d32b6514f368c1010';
  const poolAddr = (await axios.get(`${cirrus}/BlockApps-PoolV3`, { params: {
    select: 'address,token0,sqrtPriceX96::text,liquidity::text',
    or: `(and(token0.eq.${stratoToken},token1.eq.${USDST}),and(token0.eq.${USDST},token1.eq.${stratoToken}))`,
    order: 'liquidity.desc', limit: '1' }, timeout: 60000 })).data[0];
  let spotDetail = 'pool not found';
  if (poolAddr) {
    const sqrtP = BigInt(poolAddr.sqrtPriceX96);
    const ratio = sqrtP * sqrtP;
    const spotFee = poolAddr.token0 === stratoToken ? (USD_FEE * Q96 * Q96 + ratio - 1n) / ratio : (USD_FEE * ratio + Q96 * Q96 - 1n) / (Q96 * Q96);
    const quoted = BigInt(r.quotedFee);
    const dev = Number((spotFee > quoted ? spotFee - quoted : quoted - spotFee) * 10000n / quoted) / 100;
    spotDetail = `quoted ${quoted} vs spot ${spotFee} (${dev}% apart), pool liquidity ${BigInt(poolAddr.liquidity)}`;
  }
  gate(maxStep < 5 ? 'PASS' : 'FAIL', 'quote moves like a time-weighted price', `largest block-to-block move ${maxStep}% over ${series.length} quotes; ${spotDetail}`);
  gate('INFO', 'quote freshness', `quotedAt ${r.quotedAt}, priceVersion ${r.priceVersion}, lastRewardedBlock ${r.lastRewardedBlock}`);

  // ---- 6. Proposer and verifiers agree ----
  const heights = await Promise.all(opts.nodes.map(n => rpc(n, 'eth_blockNumber', []).then(h => parseInt(h, 16))));
  const common = Math.min(...heights);
  const hashes = await Promise.all(opts.nodes.map(n => rpc(n, 'eth_getBlockByNumber', [`0x${common.toString(16)}`, false]).then(b => b.hash)));
  gate(new Set(hashes).size === 1 ? 'PASS' : 'FAIL', `${opts.nodes.length} node(s) agree on block ${common}`,
    `heights ${heights.join('/')}, ${new Set(hashes).size} distinct hash(es)`);

  // ---- 7. Reward runway ----
  const held = (await axios.get(`${cirrus}/BlockApps-Token-_balances`, { params: { address: `eq.${stratoToken}`, key: `eq.${router}`, select: 'value::text' }, timeout: 60000 })).data;
  const balance = BigInt(held[0]?.value || '0');
  const tipBlock = await rpc(node, 'eth_getBlockByNumber', ['latest', false]);
  const past = await rpc(node, 'eth_getBlockByNumber', [`0x${(tip - 5000).toString(16)}`, false]);
  const spb = (Number(tipBlock.timestamp) - Number(past.timestamp)) / 5000;
  if (BLOCK_REWARD === 0n) gate('INFO', 'router funded for block rewards', `rewards off; ${Number(balance) / 1e18} STRATO held`);
  else {
    const days = Number(balance / BLOCK_REWARD) * spb / 86400;
    gate(days > 14 ? 'PASS' : 'FAIL', 'router funded for block rewards', `${Number(balance) / 1e18} STRATO = ${balance / BLOCK_REWARD} blocks ≈ ${days.toFixed(1)} days at ${spb.toFixed(2)} s/block`);
  }

  if (opts.json) { console.log(JSON.stringify({ router, installBlock, tip, results }, null, 2)); return; }
  console.log(`Router ${router}, live since block ${installBlock}, tip ${tip}`);
  for (const g of results) console.log(`${g.status.padEnd(4)} ${g.name}\n     ${g.detail}`);
  process.exitCode = results.some(g => g.status === 'FAIL') ? 1 : 0;
})().catch(e => {
  console.error(e.response ? `${e.config.url} ${JSON.stringify(e.config.params)} -> ${e.response.status} ${JSON.stringify(e.response.data)}` : e.message);
  process.exit(2);
});
