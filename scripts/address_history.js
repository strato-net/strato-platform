#!/usr/bin/env node
/*
 * Forensic history for a STRATO address.
 *
 * Reconstructs, for an arbitrary account:
 *   1. Identity        - EOA vs contract, nonce (# txs), gas balance
 *   2. Origins of funds - bridge-ins, external wallet transfers, mints
 *   3. Activity        - one chronological, colored timeline of everything
 *                        that touched the address (own txs + bridge-ins +
 *                        inbound transfers), enriched with assets moved and
 *                        success/failure + reason. Approvals hidden unless
 *                        they fail.
 *   4. Current holdings - live token balances
 *   5. Asking for       - pending bridge-out withdrawals still in flight
 *
 * Data sources (proper STRATO APIs, with local fallbacks):
 *   * Cirrus via PostgREST -> tokens, contracts, transfers, deposits,
 *     withdrawals, balances. Amounts are selected as ::text so BigInt stays
 *     exact. Set CIRRUS_URL (+ AUTH_TOKEN) to hit it over HTTP; otherwise the
 *     local `strato-postgrest-1` container is queried directly.
 *   * strato-api / eth DB  -> account state, transaction list, and per-tx
 *     execution result (Success / Failure + reason), which are NOT fronted by
 *     PostgREST. Set NODE_URL (+ AUTH_TOKEN) to use the node API; otherwise
 *     the script reads the `eth` Postgres DB directly.
 *
 * Usage:
 *   ./scripts/address_history.js <address>
 *   NO_COLOR=1 ./scripts/address_history.js <address>       # disable colors
 */

'use strict';
const { execFileSync } = require('child_process');

const PG_CONTAINER = process.env.PG_CONTAINER || 'strato-postgres-1';
const POSTGREST_CONTAINER = process.env.POSTGREST_CONTAINER || 'strato-postgrest-1';
const CIRRUS_URL = (process.env.CIRRUS_URL || '').replace(/\/$/, '');
const NODE_URL = (process.env.NODE_URL || '').replace(/\/$/, '');
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
const ZERO = '0'.repeat(40);
const PRICE_ORACLE = '0000000000000000000000000000000000001002';
const CHAINS = { 1: 'Ethereum', 10: 'Optimism', 56: 'BNB', 137: 'Polygon',
  8453: 'Base', 42161: 'Arbitrum' };
const chainName = (id) => CHAINS[id] ? `${CHAINS[id]} (${id})` : `chain ${id}`;

const GENERIC = new Set(['Context', 'Ownable', 'Proxy', 'Pausable', 'ERC20',
  'IERC20', 'IERC20Metadata', 'ERC4626', 'Token', 'TokenMetadata',
  'Decider', 'DeciderState']);
const PROTOCOL = new Set(['MercataBridge', 'StablePool', 'Pool', 'CDPEngine',
  'YieldVault', 'SaveUSDSTVault', 'LendingPool', 'LiquidityPool', 'Rewards',
  'Vault', 'Escrow', 'MetalForge', 'PoolFactory', 'TokenFactory',
  'SafetyModule', 'StratoNativeBridge', 'VaultFactory', 'PoolV3', 'DirectMintPSM',
  'Market', 'Offer', 'Bid']);
const VERBS = {
  approve: 'approve', swap: 'swap on {t}', exchange: 'swap (stable) on {t}',
  deposit: 'deposit into {t}', depositLiquidity: 'supply liquidity to {t}',
  addLiquidity: 'add liquidity to {t}',
  addLiquidityGeneral: 'add liquidity to {t}',
  addLiquiditySingleToken: 'add liquidity to {t}',
  withdraw: 'withdraw from {t}', withdrawMax: 'withdraw all from {t}',
  withdrawLiquidityAll: 'remove all liquidity from {t}',
  removeLiquidity: 'remove liquidity from {t}',
  removeLiquidityGeneral: 'remove liquidity from {t}',
  redeem: 'redeem from {t}', redeemOrQueue: 'redeem from {t}',
  claim: 'claim from {t}', claimAllRewards: 'claim rewards from {t}',
  mint: 'borrow / mint against {t}', repay: 'repay debt to {t}',
  repayAll: 'repay all debt to {t}',
  requestWithdrawal: 'BRIDGE-OUT request via {t}',
};

const CONTRACT_VERBS = {
  Market: { redeem: 'Prediction-market payout', split: 'Buy paired prediction tokens',
    merge: 'Redeem paired prediction tokens' },
  Offer: { fill: 'Buy prediction tokens' },
  Bid: { fill: 'Sell prediction tokens' },
  CDPEngine: { mint: 'Borrow from {t}' },
  DirectMintPSM: { mint: 'Convert via {t}', redeem: 'Convert via {t}' },
};

// -------------------------------------------------------------------- colors
const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s);
const dim = (s) => c('2', s), bold = (s) => c('1', s);
const red = (s) => c('31', s), green = (s) => c('32', s);
const yellow = (s) => c('33', s), cyan = (s) => c('36', s);

// ------------------------------------------------------------- amount helpers
function big(v) { try { return BigInt(v); } catch { return 0n; } }
function grp(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmt(b, dec) {
  const neg = b < 0n; let x = neg ? -b : b;
  const scale = 10n ** BigInt(dec);
  let whole = x / WAD;
  let frac = (x % WAD) * scale / WAD;
  if ((x % WAD) * scale % WAD * 2n >= WAD) frac += 1n;   // round half up
  if (frac >= scale) { whole += 1n; frac -= scale; }
  let out = grp(whole.toString());
  if (dec > 0) out += '.' + frac.toString().padStart(dec, '0');
  return (neg ? '-' : '') + out;
}
const amt = (b) => (b < 0n ? -b : b) < WAD ? fmt(b, 4) : fmt(b, 2);

// -------------------------------------------------------------- data sources
async function httpGet(url) {
  const headers = AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    return res.ok ? res.text() : null;
  } catch { return null; }
}
function dockerCurl(url) {
  try {
    return execFileSync('docker',
      ['exec', POSTGREST_CONTAINER, 'curl', '-sS', '-m', '20', url],
      { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch { return ''; }
}
function ethSql(sql) {
  const out = execFileSync('docker',
    ['exec', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'eth', '-tAF', '\t', '-c', sql],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  return out.split('\n').filter(Boolean).map((l) => l.split('\t'));
}
async function cirrus(resource, params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const body = CIRRUS_URL ? await httpGet(`${CIRRUS_URL}/${resource}?${qs}`)
    : dockerCurl(`http://localhost:3001/${resource}?${qs}`);
  if (!body) return [];
  try { return JSON.parse(body); }
  catch { throw new Error(`cirrus non-JSON for ${resource}: ${body.slice(0, 200)}`); }
}

async function getAccount(addr) {
  if (NODE_URL) {
    const body = await httpGet(`${NODE_URL}/bloc/v2.2/account?address=${addr}`);
    if (body) { const r = JSON.parse(body); if (r.length) return [BigInt(r[0].nonce), big(r[0].balance)]; }
  }
  const r = ethSql(`select nonce,balance from address_state_ref where address='${addr}'`);
  return r.length ? [BigInt(r[0][0]), big(r[0][1])] : [null, null];
}
function getOwnTxs(addr) {
  // (nonce, ts, func, to, block, hash, status)  -- eth DB (node API lacks result detail here)
  return ethSql(
    'select rt.nonce,rt.timestamp,rt.func_name,rt.to_address,rt.block_number,rt.tx_hash,' +
    "coalesce(res.status,'') from raw_transaction rt " +
    'left join transaction_result res on res.transaction_hash=rt.tx_hash ' +
    `where rt.from_address='${addr}' order by rt.nonce::int`)
    .map(([n, ts, fn, to, blk, hash, st]) =>
      ({ nonce: Number(n), ts, func: fn, to, block: Number(blk), hash, status: st }));
}
function getTxCalls(hashes) {
  const calls = [];
  for (let i = 0; i < hashes.length; i += 500)
    calls.push(...ethSql('select tx_hash,func_name,to_address from raw_transaction where tx_hash in (' +
      hashes.slice(i, i + 500).map((h) => `'${h}'`).join(',') + ')')
      .map(([hash, func, to]) => ({ hash, func, to })));
  return calls;
}
const latestBlock = () => { const r = ethSql('select max(number) from block_data_ref'); return r.length ? r[0][0] : '?'; };

// parse the Haskell "Success" / "Failure {...}" status string
function parseStatus(s) {
  if (!s || s === 'Success') return { ok: true, reason: '' };
  let m = s.match(/trfDetails = Just "((?:\\.|[^"\\])*)"/);
  let reason = m ? m[1].replace(/\\"/g, '"') : '';
  if (!reason) { const t = s.match(/trfType = (\w+)/); reason = t ? t[1] : 'failed'; }
  reason = reason.replace(/^solidity require failed: /, '')
    .replace(/^custom user error: /, '')
    .replace(/^revert: REVERT \[BString "(.*)"\]:?$/, '$1')
    .replace(/^Reverting based on\s+Error Method: /, '');
  return { ok: false, reason: reason.trim() };
}

// -------------------------------------------------------------------- labels
async function buildLabels(addrs) {
  const list = [...addrs].filter((a) => a && a !== ZERO).sort();
  if (!list.length) return { labels: {}, vaultShares: new Map() };
  const inlist = `in.(${list.join(',')})`;
  const labels = {};
  for (const resource of ['BlockApps-ERC20', 'BlockApps-Token'])
    for (const r of await cirrus(resource, { address: inlist, select: 'address,_name,_symbol' }))
      labels[r.address] = r._symbol || r._name;
  const names = {};
  for (const r of await cirrus('contract', { address: inlist, select: 'address,contract_name' }))
    (names[r.address] || (names[r.address] = new Set())).add(r.contract_name);
  const vaultShares = new Map();
  for (const [addr, set] of Object.entries(names)) {
    if (set.has('SaveUSDSTVault') || set.has('YieldVault') || set.has('ERC4626')) {
      vaultShares.set(addr, labels[addr] || 'vault shares');
      labels[addr] = set.has('SaveUSDSTVault') ? 'SaveUSDSTVault' : set.has('YieldVault') ? 'YieldVault' : 'ERC4626';
    }
    if (labels[addr]) continue;
    const pick = ([...set].filter((n) => PROTOCOL.has(n)).sort()[0])
      || ([...set].filter((n) => !GENERIC.has(n)).sort()[0]);
    if (pick || [...set].some((n) => n !== 'Decider' && n !== 'DeciderState'))
      labels[addr] = pick || 'contract';
  }
  return { labels, vaultShares };
}

async function buildPrices(tokens) {
  const rows = await cirrus('BlockApps-PriceOracle-prices',
    { address: `eq.${PRICE_ORACLE}`, select: 'key,value::text' });
  const prices = new Map((Array.isArray(rows) ? rows : [])
    .filter((r) => big(r.value) > 0n).map((r) => [r.key, big(r.value)]));
  const missing = [...tokens].filter((token) => !prices.has(token));
  if (missing.length) {
    const pools = await cirrus('BlockApps-Pool', {
      lpToken: `in.(${missing.join(',')})`,
      select: 'tokenA,tokenB,tokenABalance::text,tokenBBalance::text,lpToken:lpToken_fkey(address,_totalSupply::text)',
    });
    for (const pool of Array.isArray(pools) ? pools : []) {
      const supply = big(pool.lpToken?._totalSupply);
      const priceA = prices.get(pool.tokenA), priceB = prices.get(pool.tokenB);
      if (supply > 0n && priceA && priceB) {
        const value = (big(pool.tokenABalance) * priceA + big(pool.tokenBBalance) * priceB) / WAD;
        prices.set(pool.lpToken.address, value * WAD / supply);
      }
    }
  }
  return prices;
}

async function getPositions(addr) {
  const vaults = (await cirrus('BlockApps-CDPEngine-vaults',
    { key: `eq.${addr}`, select: 'address,key2,value' }))
    .filter((r) => big(r.value.collateral) > 0n || big(r.value.scaledDebt) > 0n);
  const rates = vaults.length ? await cirrus('BlockApps-CDPEngine-collateralGlobalStates', {
    address: `in.(${[...new Set(vaults.map((r) => r.address))].join(',')})`,
    key: `in.(${[...new Set(vaults.map((r) => r.key2))].join(',')})`,
    select: 'address,key,value',
  }) : [];
  const balances = (await cirrus('strato-predict-OutcomeToken-balanceOf',
    { key: `eq.${addr}`, select: 'address,value::text' })).filter((r) => big(r.value) > 0n);
  const tokens = balances.length ? await cirrus('strato-predict-OutcomeToken', {
    address: `in.(${balances.map((r) => r.address).join(',')})`, select: 'address,symbol,market,isYes',
  }) : [];
  const markets = tokens.length ? await cirrus('strato-predict-Market', {
    address: `in.(${[...new Set(tokens.map((r) => r.market))].join(',')})`, select: 'address,status,expiry,claimsOpenAt',
  }) : [];
  const stakes = (await cirrus('BlockApps-StratoStaking-delegatedStake',
    { key: `eq.${addr}`, select: 'address,key2,value::text' })).filter((r) => big(r.value) > 0n);
  const unbonding = (await cirrus('BlockApps-StratoStaking-unbondingQueue',
    { key: `eq.${addr}`, select: 'address,key2,value' }))
    .filter((r) => !r.value.claimed && big(r.value.amount) > 0n);
  const stakingAddresses = [...new Set([...stakes, ...unbonding].map((r) => r.address))];
  const staking = stakingAddresses.length ? await cirrus('BlockApps-StratoStaking',
    { address: `in.(${stakingAddresses.join(',')})`, select: 'address,stratoToken' }) : [];
  return { vaults, rates: new Map(rates.map((r) => [`${r.address}|${r.key}`, big(r.value.rateAccumulator)])),
    balances, tokens: new Map(tokens.map((r) => [r.address, r])), markets: new Map(markets.map((r) => [r.address, r])),
    stakes, unbonding, stakingTokens: new Map(staking.map((r) => [r.address, r.stratoToken])) };
}
// ------------------------------------------------------------------ movements
function renderMoves(moves, labels) {
  const lbl = (a) => labels[a] || a.slice(0, 8) + '…';
  const outs = [], ins = [];
  for (const [tok, v] of [...moves].sort((a, b) => (b[1] < 0n ? -b[1] : b[1]) > (a[1] < 0n ? -a[1] : a[1]) ? 1 : -1)) {
    if (v < 0n) outs.push(`${amt(-v)} ${cyan(lbl(tok))}`);
    else if (v > 0n) ins.push(`${amt(v)} ${cyan(lbl(tok))}`);
  }
  if (outs.length && ins.length) return `${outs.join(' + ')} ${dim('→')} ${ins.join(' + ')}`;
  if (ins.length) return green('+') + ins.join(' + ');
  if (outs.length) return outs.map((v) => red('-') + v).join(' ');
  return '';
}

// ------------------------------------------------------------------------ main
async function main() {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: address_history.js <address>'); process.exit(1); }
  const addr = arg.toLowerCase().replace(/^0x/, '');

  const [nonceRaw, gasRaw] = await getAccount(addr);   // null when no native-state row (receive-only / never sent a tx)
  const latest = latestBlock();
  const ctags = new Set((await cirrus('contract', { address: `eq.${addr}`, select: 'contract_name' })).map((r) => r.contract_name));
  const specialTags = [...ctags].filter((t) => !GENERIC.has(t));

  const ownTxs = getOwnTxs(addr);
  const deps = await cirrus('BlockApps-MercataBridge-DepositCompleted',
    { stratoRecipient: `eq.${addr}`, order: 'block_number',
      select: 'transaction_hash,block_timestamp,externalChainId,stratoToken,stratoTokenAmount::text' });
  const autoSaved = await cirrus('BlockApps-MercataBridge-AutoSavedUSDST',
    { recipient: `eq.${addr}`, order: 'block_number',
      select: 'transaction_hash,block_timestamp,block_number,externalChainId,sourceToken,sourceAmount::text,usdstAmount::text,saveToken,shares::text' });
  const savingVaults = autoSaved.length ? await cirrus('BlockApps-SaveUSDSTVault',
    { address: `in.(${[...new Set(autoSaved.map((s) => s.saveToken))].join(',')})`, select: 'address,assetToken' }) : [];
  const savingAssets = new Map(savingVaults.map((v) => [v.address, v.assetToken]));
  const xfers = await cirrus('BlockApps-Token-Transfer',
    { or: `(to.eq.${addr},from.eq.${addr})`, order: 'block_number',
      select: 'transaction_hash,block_number,block_timestamp,from,to,address,value::text' });
  const balanceRows = await cirrus('BlockApps-Token-_balances', { key: `eq.${addr}`, value: 'gt.0', select: 'address,value::text' });
  const erc20Rows = await cirrus('BlockApps-ERC20-_balances', { key: `eq.${addr}`, value: 'gt.0', select: 'address,value::text' });
  const bals = [...new Map([...balanceRows, ...erc20Rows].map((r) => [r.address, r])).values()].filter((r) => big(r.value) > 0n);
  const positions = await getPositions(addr);
  const bridgeRequests = await cirrus('BlockApps-MercataBridge-WithdrawalRequested',
    { user: `eq.${addr}`, order: 'withdrawalId',
      select: 'address,transaction_hash,withdrawalId,block_timestamp,destChainId,token,stratoTokenAmount::text' });
  const nativeRequests = await cirrus('BlockApps-StratoNativeBridge-NativeWithdrawalRequested',
    { stratoSender: `eq.${addr}`, order: 'withdrawalId',
      select: 'address,transaction_hash,withdrawalId,block_timestamp,externalChainId,stratoToken,stratoTokenAmount::text' });
  const wreq = [...bridgeRequests, ...nativeRequests.map((w) =>
    ({ ...w, native: true, destChainId: w.externalChainId, token: w.stratoToken }))]
    .sort((a, b) => a.block_timestamp.localeCompare(b.block_timestamp));
  const withdrawalKey = (w) => `${w.address}:${w.withdrawalId}`;
  const withdrawalLabel = (w) => `#${w.withdrawalId}${w.native ? ' (native)' : ''}`;
  const setOf = async (ev) => {
    const rows = await cirrus(`BlockApps-MercataBridge-Withdrawal${ev}`, { select: 'address,withdrawalId' });
    if (nativeRequests.length) rows.push(...await cirrus(`BlockApps-StratoNativeBridge-NativeWithdrawal${ev}`,
      { select: 'address,withdrawalId' }));
    return new Set(rows.map(withdrawalKey));
  };
  const done = await setOf('Completed'), abort = await setOf('Aborted'), pend = await setOf('Pending');

  // A receive-only account has no native-state row (nonceRaw null); that's fine as
  // long as it shows up somewhere. Only bail if there's genuinely no activity.
  if (nonceRaw === null && !ownTxs.length && !deps.length && !xfers.length && !bals.length && !positions.vaults.length && !positions.balances.length && !positions.stakes.length && !positions.unbonding.length) {
    console.error(`address ${addr} not found (no txs, transfers, deposits, or balances)`);
    process.exit(1);
  }
  const nonce = nonceRaw ?? 0n, gas = gasRaw ?? 0n;
  const wStatus = (w) =>
    done.has(withdrawalKey(w)) ? { text: 'COMPLETED', color: green }
    : abort.has(withdrawalKey(w)) ? { text: 'ABORTED', color: dim }
    : pend.has(withdrawalKey(w)) ? { text: 'PENDING', color: yellow }
    : { text: 'REQUESTED', color: yellow };
  const wreqByTx = new Map(wreq.map((w) => [w.transaction_hash, w]));
  const ownTxByHash = new Map(ownTxs.map((t) => [t.hash, t]));
  const externalCalls = getTxCalls([...new Set(xfers.map((x) => x.transaction_hash))]
    .filter((hash) => !ownTxByHash.has(hash)));
  const callsByHash = new Map([...ownTxs, ...externalCalls].map((t) => [t.hash, t]));

  const refs = new Set([...ownTxs.map((t) => t.to), ...deps.map((d) => d.stratoToken),
    ...autoSaved.flatMap((s) => [s.sourceToken, s.saveToken]), ...savingAssets.values(),
    ...externalCalls.map((t) => t.to), ...positions.stakingTokens.values(),
    ...xfers.map((x) => x.from), ...xfers.map((x) => x.to), ...xfers.map((x) => x.address),
    ...bals.map((b) => b.address), ...wreq.map((w) => w.token), ...positions.vaults.map((r) => r.key2)]);
  const { labels, vaultShares } = await buildLabels(refs);
  const prices = await buildPrices(new Set([...xfers.map((x) => x.address), ...bals.map((b) => b.address),
    ...positions.vaults.map((v) => v.key2), ...positions.stakingTokens.values(),
    ...autoSaved.map((s) => s.sourceToken), ...savingAssets.values()]));
  const lbl = (a) => (!a || a === ZERO) ? '0x0' : (labels[a] || a.slice(0, 10) + '…');
  const pad = (s, n) => String(s).padStart(n);

  // ---- 1. identity
  console.log(`\n${'='.repeat(72)}\n${bold('ADDRESS')}  ${addr}`);
  console.log(`type     ${specialTags.length ? `CONTRACT (${specialTags.sort().join(',')})` : 'EOA (wallet)'}`);
  console.log(`txs sent ${nonce}    gas ${fmt(gas, 6)}    latest block ${latest}\n${'='.repeat(72)}`);

  // ---- 2. origins summary
  const depositsByTx = new Map(deps.map((d) => [d.transaction_hash, d]));
  const sections = new Map([['FUNDING', new Map()], ['BORROWING (must be repaid)', new Map()],
    ['ACTIVITY AND RESULTS', new Map()], ['BRIDGE-OUTS', new Map()]]);
  const formatAmount = (token, amount, showToken = true, symbol = lbl(token)) => {
    const price = prices.get(token);
    const usd = price === undefined ? '(USD unavailable)' : `($${fmt(amount * price / WAD, 2)})`;
    return `${amt(amount)}${showToken ? ` ${symbol}` : ''} ${usd}`;
  };
  const addFlow = (section, purpose, token, direction, amount) => {
    const groups = sections.get(section);
    let group = groups.get(purpose);
    if (!group) { group = { tokens: new Map() }; groups.set(purpose, group); }
    const amounts = group.tokens.get(token) || { received: 0n, spent: 0n };
    amounts[direction] += amount;
    group.tokens.set(token, amounts);
  };
  for (const x of xfers.sort((a, b) => Number(a.block_number) - Number(b.block_number))) {
    if (x.from === x.to || big(x.value) === 0n) continue;
    const incoming = x.to === addr;
    const other = incoming ? x.from : x.to;
    const tx = callsByHash.get(x.transaction_hash);
    const deposit = depositsByTx.get(x.transaction_hash);
    const withdrawal = wreqByTx.get(x.transaction_hash);
    let section = 'ACTIVITY AND RESULTS', purpose;
    if (labels[other] === 'FeeCollector') purpose = 'Network transaction fees';
    else if (deposit) { section = 'FUNDING'; purpose = `Bridged in from ${chainName(deposit.externalChainId)}`; }
    else if (withdrawal) {
      section = 'BRIDGE-OUTS';
      purpose = `${withdrawalLabel(withdrawal)} to ${chainName(withdrawal.destChainId)} [${wStatus(withdrawal).text}]`;
    } else if (labels[other] === 'MercataBridge' || labels[other] === 'StratoNativeBridge') {
      section = 'BRIDGE-OUTS'; purpose = 'Other bridge transfers';
    } else if (incoming && tx && labels[tx.to] === 'CDPEngine' && tx.func === 'mint') {
      section = 'BORROWING (must be repaid)'; purpose = 'Borrowed from CDPEngine (debt, not earnings)';
    } else if (incoming && !ownTxByHash.has(x.transaction_hash) && other !== ZERO && !labels[other]
        && (!tx || tx.to === x.address)) {
      section = 'FUNDING'; purpose = `Transfer from ${other}`;
    } else {
      const contract = labels[tx?.to] || labels[other];
      if (contract === 'Market' || contract === 'Offer' || contract === 'Bid' || contract === 'OrderBook') purpose = 'Prediction markets';
      else if (tx && (tx.func === 'swap' || tx.func === 'exchange' || contract === 'DirectMintPSM')) purpose = 'Swaps and conversions';
      else if (contract === 'Pool' || contract === 'StablePool' || contract === 'PoolV3') purpose = 'Liquidity pools';
      else if (contract === 'CDPEngine') purpose = 'CDP collateral and repayments';
      else if (contract) purpose = contract;
      else if (other === ZERO) purpose = 'Token issuance (source unidentified)';
      else purpose = `${incoming ? 'Transfer from' : 'Transfer to'} ${other}`;
    }
    addFlow(section, purpose, x.address, incoming ? 'received' : 'spent', big(x.value));
  }
  for (const s of autoSaved) {
    const asset = savingAssets.get(s.saveToken);
    if (!asset) throw new Error(`Underlying asset unavailable for savings vault ${s.saveToken}`);
    addFlow('FUNDING', `Bridged in from ${chainName(s.externalChainId)}`, s.sourceToken, 'received', big(s.sourceAmount));
    if (s.sourceToken !== asset) {
      addFlow('ACTIVITY AND RESULTS', 'Swaps and conversions', s.sourceToken, 'spent', big(s.sourceAmount));
      addFlow('ACTIVITY AND RESULTS', 'Swaps and conversions', asset, 'received', big(s.usdstAmount));
    }
    addFlow('ACTIVITY AND RESULTS', lbl(s.saveToken), asset, 'spent', big(s.usdstAmount));
  }
  for (const [heading, groups] of sections) {
    console.log(bold(`\n[ ${heading} - USD equivalents at current prices ]`));
    const row = (value, description) => console.log(`  ${value.padEnd(42)} ${description}`);
    if (heading === 'ACTIVITY AND RESULTS') {
      console.log('  Cumulative flows, including reinvestment; net cash flow is not profit on open positions.');
      const activityRow = (spent, received, net, description) =>
        console.log(`  ${spent.padStart(24)}  ${received.padStart(24)}  ${net.padStart(25)}  ${description}`);
      activityRow('Spent', 'Received', 'Net (+ gained / − spent)', 'Activity / token');
      for (const [purpose, group] of groups) {
        const description = purpose === 'Prediction markets' ? 'Prediction-market bets / payouts' : purpose;
        let spentUSD = 0n, receivedUSD = 0n;
        const priced = [...group.tokens.keys()].every((token) => prices.has(token));
        for (const [token, amounts] of group.tokens) {
          const value = (amount) => formatAmount(token, amount, false);
          const net = amounts.received - amounts.spent;
          activityRow(amounts.spent ? value(amounts.spent) : '—',
            amounts.received ? value(amounts.received) : '—',
            `${net < 0n ? '−' : '+'}${value(net < 0n ? -net : net)}`, `${description} / ${lbl(token)}`);
          if (priced) {
            spentUSD += amounts.spent * prices.get(token) / WAD;
            receivedUSD += amounts.received * prices.get(token) / WAD;
          }
        }
        if (group.tokens.size > 1) {
          const net = receivedUSD - spentUSD;
          activityRow(priced ? `$${fmt(spentUSD, 2)}` : 'USD unavailable',
            priced ? `$${fmt(receivedUSD, 2)}` : 'USD unavailable',
            priced ? `${net < 0n ? '−' : '+'}$${fmt(net < 0n ? -net : net, 2)}` : 'USD unavailable',
            `${description} / total at current prices`);
        }
      }
    } else {
      for (const [purpose, group] of groups) {
        for (const [token, amounts] of group.tokens) {
          if (amounts.spent) row(formatAmount(token, amounts.spent),
            heading === 'BRIDGE-OUTS' && purpose.startsWith('#') ? `Sent to bridge escrow — ${purpose}`
            : `Spent on ${purpose}`);
          if (amounts.received) row(formatAmount(token, amounts.received),
            heading === 'FUNDING' || heading === 'BORROWING (must be repaid)' ? purpose : `Received from ${purpose}`);
        }
      }
    }
    if (!groups.size) console.log('  (none)');
  }

  // ---- 3. activity timeline (everything touching the address)
  const byTx = new Map();
  const entry = (hash, ts, block) => {
    let e = byTx.get(hash);
    if (!e) { e = { hash, ts, block, own: false, moves: new Map(), sources: new Set() }; byTx.set(hash, e); }
    if (block != null && (e.block == null || block < e.block)) e.block = block;
    if (ts && (!e.ts || ts < e.ts)) e.ts = ts;
    return e;
  };
  for (const t of ownTxs) {
    const e = entry(t.hash, t.ts, t.block);
    const st = parseStatus(t.status);
    Object.assign(e, { own: true, nonce: t.nonce, func: t.func, to: t.to, ok: st.ok, reason: st.reason });
  }
  for (const x of xfers) {
    const e = entry(x.transaction_hash, x.block_timestamp, Number(x.block_number));
    const v = big(x.value);
    if (x.to === addr) { e.moves.set(x.address, (e.moves.get(x.address) || 0n) + v); if (x.from !== addr) e.sources.add(x.from); }
    if (x.from === addr) e.moves.set(x.address, (e.moves.get(x.address) || 0n) - v);
    if (x.from === ZERO && x.to === addr) e.hasMint = true;
  }
  for (const d of deps) { const e = byTx.get(d.transaction_hash); if (e) e.bridgeChain = d.externalChainId; }
  for (const s of autoSaved) {
    const e = entry(s.transaction_hash, s.block_timestamp, Number(s.block_number));
    e.autoSaved = s;
  }

  console.log(bold('\n[ ACTIVITY (chronological - everything touching the address) ]'));
  let shown = 0;
  const entries = [...byTx.values()].sort((a, b) => (a.block - b.block) || ((a.nonce ?? 0) - (b.nonce ?? 0)));
  for (const e of entries) {
    if (e.own && e.func === 'approve' && e.ok !== false) continue;   // hide successful approvals
    shown++;
    const when = dim((e.ts || '').slice(0, 16));
    const tag = e.own ? dim(`#${String(e.nonce).padEnd(3)}`) : dim('  ↦ ');
    let label, wOverride;
    if (e.autoSaved) label = `BRIDGE-IN from ${chainName(e.autoSaved.externalChainId)} → savings`;
    else if (e.own) {
      label = (CONTRACT_VERBS[labels[e.to]]?.[e.func] || VERBS[e.func] || e.func).replace('{t}', lbl(e.to));
      const w = wreqByTx.get(e.hash);   // matched bridge-out: link to its withdrawal
      if (w) { label = `BRIDGE-OUT ${withdrawalLabel(w)} → ${chainName(w.destChainId)}`; wOverride = wStatus(w); }
    }
    else if (e.hasMint) label = e.bridgeChain ? `BRIDGE-IN from ${chainName(e.bridgeChain)}` : 'mint';
    else label = `transfer in from ${lbl([...e.sources][0] || '')}`;
    const moves = e.autoSaved
      ? `${amt(big(e.autoSaved.sourceAmount))} ${lbl(e.autoSaved.sourceToken)} → ${amt(big(e.autoSaved.shares))} ${vaultShares.get(e.autoSaved.saveToken) || lbl(e.autoSaved.saveToken)} shares`
      : renderMoves(e.moves, labels);
    let status;
    if (e.own && e.ok === false) status = red(`[FAILED: ${e.reason || 'reverted'}]`);
    else if (wOverride) status = wOverride.color(`[${wOverride.text}]`);
    else status = green('[ok]');
    const parts = [`  ${when}  ${tag} ${label.padEnd(34)}`];
    if (moves) parts.push(moves);
    parts.push(status);
    console.log(parts.join('  '));
  }
  if (!shown) console.log('  (no activity)');

  // ---- 4. holdings
  console.log(bold('\n[ CURRENT HOLDINGS ]'));
  const holdingRow = (value, description) => console.log(`  ${value.padEnd(42)} ${description}`);
  for (const b of bals.sort((a, c2) => big(c2.value) > big(a.value) ? 1 : -1))
    holdingRow(formatAmount(b.address, big(b.value), true, vaultShares.get(b.address) || lbl(b.address)),
      vaultShares.has(b.address) ? 'Savings / vault shares' : 'Wallet balance');
  holdingRow(`${fmt(gas, 6)} gas`, 'Native gas balance');
  if (positions.vaults.length) {
    for (const v of positions.vaults) {
      const scaledDebt = big(v.value.scaledDebt), rate = positions.rates.get(`${v.address}|${v.key2}`);
      const debt = scaledDebt === 0n ? '0.00 USDST' : rate ? `${amt(scaledDebt * rate / RAY)} USDST` : 'unavailable';
      holdingRow(formatAmount(v.key2, big(v.value.collateral)), 'Locked CDP collateral (still owned)');
      holdingRow(debt, `CDP debt owed against ${lbl(v.key2)} (subtract from assets)`);
    }
  }
  for (const s of positions.stakes)
    holdingRow(formatAmount(positions.stakingTokens.get(s.address), big(s.value)), 'Staked (still owned)');
  for (const u of positions.unbonding) {
    const release = new Date(Number(u.value.releaseTime) * 1000);
    holdingRow(formatAmount(positions.stakingTokens.get(u.address), big(u.value.amount)),
      release.getTime() <= Date.now() ? 'Unstaked; ready to withdraw'
      : `Unstaking; available ${release.toISOString().slice(0, 10)}`);
  }
  const predictionHoldings = positions.balances.filter((b) => {
    const token = positions.tokens.get(b.address), market = positions.markets.get(token?.market);
    const status = Number(market?.status);
    return (status !== 2 && status !== 3) || typeof token?.isYes !== 'boolean' || token.isYes === (status === 2);
  });
  if (predictionHoldings.length) {
    console.log('  Prediction tokens:');
    for (const b of predictionHoldings) {
      const token = positions.tokens.get(b.address), market = positions.markets.get(token?.market);
      const status = Number(market?.status), balance = big(b.value);
      let detail = 'payout unknown';
      if (status === 1) detail = 'unresolved; payout unknown';
      else if (status === 2 || status === 3) {
        detail = typeof token?.isYes !== 'boolean' ? 'payout unknown' : `winning; payout ${amt(balance)} USDST`;
      } else if (status === 4) detail = `voided; payout ${amt(balance / 2n)} USDST`;
      if (status >= 2 && status <= 4 && Number(market.claimsOpenAt) * 1000 > Date.now()) detail += '; claims not open yet';
      const expiry = market?.expiry ? ` (${new Date(Number(market.expiry) * 1000).toISOString().slice(0, 10)})` : '';
      console.log(`    ${amt(balance)} ${token?.symbol || b.address}${expiry}: ${detail}`);
    }
  }

  // ---- 5. asking for
  console.log(bold('\n[ ASKING FOR - bridge-out withdrawals ]'));
  if (wreq.length) {
    const outstanding = new Map();
    for (const w of wreq) {
      const ws = wStatus(w);
      if (ws.text !== 'COMPLETED' && ws.text !== 'ABORTED')
        outstanding.set(w.token, (outstanding.get(w.token) || 0n) + big(w.stratoTokenAmount));
      console.log(`    ${withdrawalLabel(w).padEnd(5)} ${dim(w.block_timestamp.slice(0, 10))}  ` +
        `${pad(amt(big(w.stratoTokenAmount)), 12)} ${cyan(lbl(w.token).padEnd(8))} -> ${chainName(w.destChainId)}  ${ws.color(`[${ws.text}]`)}`);
    }
    console.log(`    outstanding (not yet completed): ${outstanding.size
      ? [...outstanding].map(([token, amount]) => `${yellow(amt(amount))} ${lbl(token)}`).join(' + ') : '0.0000'}`);
  } else console.log('    (none)');
  console.log();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
