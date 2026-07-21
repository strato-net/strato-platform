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
const ZERO = '0'.repeat(40);
const CHAINS = { 1: 'Ethereum', 10: 'Optimism', 56: 'BNB', 137: 'Polygon',
  8453: 'Base', 42161: 'Arbitrum' };
const chainName = (id) => CHAINS[id] ? `${CHAINS[id]} (${id})` : `chain ${id}`;

const GENERIC = new Set(['Context', 'Ownable', 'Proxy', 'Pausable', 'ERC20',
  'IERC20', 'IERC20Metadata', 'ERC4626', 'Token', 'TokenMetadata',
  'Decider', 'DeciderState']);
const PROTOCOL = new Set(['MercataBridge', 'StablePool', 'Pool', 'CDPEngine',
  'YieldVault', 'SaveUSDSTVault', 'LendingPool', 'LiquidityPool', 'Rewards',
  'Vault', 'Escrow', 'MetalForge', 'PoolFactory', 'TokenFactory',
  'SafetyModule', 'StratoNativeBridge', 'VaultFactory']);
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
  if (!list.length) return {};
  const inlist = `in.(${list.join(',')})`;
  const labels = {};
  for (const r of await cirrus('BlockApps-Token', { address: inlist, select: 'address,_name,_symbol' }))
    labels[r.address] = r._symbol || r._name;
  const names = {};
  for (const r of await cirrus('contract', { address: inlist, select: 'address,contract_name' }))
    (names[r.address] || (names[r.address] = new Set())).add(r.contract_name);
  for (const [addr, set] of Object.entries(names)) {
    if (labels[addr]) continue;
    const pick = ([...set].filter((n) => PROTOCOL.has(n)).sort()[0])
      || ([...set].filter((n) => !GENERIC.has(n)).sort()[0]);
    labels[addr] = pick || 'contract';
  }
  return labels;
}
const senderKind = (addr, labels) =>
  addr === ZERO ? 'mint' : (PROTOCOL.has(labels[addr]) ? 'protocol' : 'wallet');

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
  if (outs.length) return red('-') + outs.join(' + ');
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
  const xfers = await cirrus('BlockApps-Token-Transfer',
    { or: `(to.eq.${addr},from.eq.${addr})`, order: 'block_number',
      select: 'transaction_hash,block_number,block_timestamp,from,to,address,value::text' });
  const bals = await cirrus('BlockApps-Token-_balances', { key: `eq.${addr}`, value: 'gt.0', select: 'address,value::text' });
  const wreq = await cirrus('BlockApps-MercataBridge-WithdrawalRequested',
    { user: `eq.${addr}`, order: 'withdrawalId',
      select: 'transaction_hash,withdrawalId,block_timestamp,destChainId,token,stratoTokenAmount::text' });
  const setOf = async (ev) => new Set((await cirrus(`BlockApps-MercataBridge-${ev}`, { select: 'withdrawalId' })).map((r) => r.withdrawalId));
  const done = await setOf('WithdrawalCompleted'), abort = await setOf('WithdrawalAborted'), pend = await setOf('WithdrawalPending');

  // A receive-only account has no native-state row (nonceRaw null); that's fine as
  // long as it shows up somewhere. Only bail if there's genuinely no activity.
  if (nonceRaw === null && !ownTxs.length && !deps.length && !xfers.length && !bals.length) {
    console.error(`address ${addr} not found (no txs, transfers, deposits, or balances)`);
    process.exit(1);
  }
  const nonce = nonceRaw ?? 0n, gas = gasRaw ?? 0n;
  const wStatus = (id) =>
    done.has(id) ? { text: 'COMPLETED', color: green }
    : abort.has(id) ? { text: 'ABORTED', color: dim }
    : pend.has(id) ? { text: 'PENDING', color: yellow }
    : { text: 'REQUESTED', color: yellow };
  const wreqByTx = new Map(wreq.map((w) => [w.transaction_hash, w]));

  const refs = new Set([...ownTxs.map((t) => t.to), ...deps.map((d) => d.stratoToken),
    ...xfers.map((x) => x.from), ...xfers.map((x) => x.to), ...xfers.map((x) => x.address),
    ...bals.map((b) => b.address), ...wreq.map((w) => w.token)]);
  const labels = await buildLabels(refs);
  const lbl = (a) => (!a || a === ZERO) ? '0x0' : (labels[a] || a.slice(0, 10) + '…');
  const pad = (s, n) => String(s).padStart(n);

  // ---- 1. identity
  console.log(`\n${'='.repeat(72)}\n${bold('ADDRESS')}  ${addr}`);
  console.log(`type     ${specialTags.length ? `CONTRACT (${specialTags.sort().join(',')})` : 'EOA (wallet)'}`);
  console.log(`txs sent ${nonce}    gas ${fmt(gas, 6)}    latest block ${latest}\n${'='.repeat(72)}`);

  // ---- 2. origins summary
  console.log(bold('\n[ ORIGINS OF FUNDS ]'));
  if (deps.length) {
    console.log('  bridge-ins:');
    for (const d of deps)
      console.log(`    ${dim(d.block_timestamp.slice(0, 10))}  ${pad(amt(big(d.stratoTokenAmount)), 14)} ${cyan(lbl(d.stratoToken).padEnd(10))} from ${chainName(d.externalChainId)}`);
  }
  const origins = new Map(), mints = new Map();
  for (const x of xfers) {
    if (x.to !== addr) continue;
    const kind = senderKind(x.from, labels);
    const bucket = kind === 'wallet' ? origins : kind === 'mint' ? mints : null;
    if (!bucket) continue;
    const key = kind === 'wallet' ? `${x.from}|${x.address}` : x.address;
    const cur = bucket.get(key) || [0n, 0];
    bucket.set(key, [cur[0] + big(x.value), cur[1] + 1]);
  }
  if (origins.size) {
    console.log('  transfers in from other wallets:');
    for (const [k, [t, n]] of [...origins].sort((a, b) => b[1][0] > a[1][0] ? 1 : -1)) {
      const [src, tok] = k.split('|');
      console.log(`    ${pad(amt(t), 14)} ${cyan(lbl(tok).padEnd(10))} from ${src.slice(0, 10)}… (${n}x)`);
    }
  }
  if (mints.size) {
    console.log('  minted (bridge / reward / LP receipts):');
    for (const [tok, [t, n]] of mints)
      console.log(`    ${pad(amt(t), 14)} ${cyan(lbl(tok).padEnd(10))} (${n}x)`);
  }
  if (!deps.length && !origins.size && !mints.size) console.log('  (none)');

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

  console.log(bold('\n[ ACTIVITY (chronological - everything touching the address) ]'));
  let shown = 0;
  const entries = [...byTx.values()].sort((a, b) => (a.block - b.block) || ((a.nonce ?? 0) - (b.nonce ?? 0)));
  for (const e of entries) {
    if (e.own && e.func === 'approve' && e.ok !== false) continue;   // hide successful approvals
    shown++;
    const when = dim((e.ts || '').slice(0, 16));
    const tag = e.own ? dim(`#${String(e.nonce).padEnd(3)}`) : dim('  ↦ ');
    let label, wOverride;
    if (e.own) {
      label = (VERBS[e.func] || e.func).replace('{t}', lbl(e.to));
      const w = wreqByTx.get(e.hash);   // matched bridge-out: link to its withdrawal
      if (w) { label = `BRIDGE-OUT #${w.withdrawalId} → ${chainName(w.destChainId)}`; wOverride = wStatus(w.withdrawalId); }
    }
    else if (e.hasMint) label = e.bridgeChain ? `BRIDGE-IN from ${chainName(e.bridgeChain)}` : 'mint';
    else label = `transfer in from ${lbl([...e.sources][0] || '')}`;
    const moves = renderMoves(e.moves, labels);
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
  for (const b of bals.sort((a, c2) => big(c2.value) > big(a.value) ? 1 : -1))
    console.log(`    ${pad(amt(big(b.value)), 16)} ${cyan(lbl(b.address))}`);
  console.log(`    ${pad(fmt(gas, 6), 16)} gas (native)`);

  // ---- 5. asking for
  console.log(bold('\n[ ASKING FOR - bridge-out withdrawals ]'));
  if (wreq.length) {
    let outstanding = 0n;
    for (const w of wreq) {
      const id = w.withdrawalId;
      const ws = wStatus(id);
      if (!done.has(id) && !abort.has(id)) outstanding += big(w.stratoTokenAmount);
      console.log(`    #${String(id).padEnd(4)} ${dim(w.block_timestamp.slice(0, 10))}  ` +
        `${pad(amt(big(w.stratoTokenAmount)), 12)} ${cyan(lbl(w.token).padEnd(8))} -> ${chainName(w.destChainId)}  ${ws.color(`[${ws.text}]`)}`);
    }
    console.log(`    outstanding (not yet completed): ${outstanding > 0n ? yellow(amt(outstanding)) : amt(outstanding)}`);
  } else console.log('    (none)');
  console.log();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
