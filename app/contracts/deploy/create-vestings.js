// Create STRATO vestings on a deployed VestingPoolManager from a schedule file, one
// AdminRegistry vote per run (identical arguments across admins reach quorum), and
// verify the result from Cirrus.
//
//   node create-vestings.js plan   <schedule.json> [category]   # print exact args + hash, no network
//   node create-vestings.js fund   <schedule.json> <category>   # vote Token.mint(pool, category total)
//   node create-vestings.js create <schedule.json> <category>   # vote manager.addVestings(...)
//   node create-vestings.js verify <schedule.json> <category>   # AddedVesting rows per account
//   node create-vestings.js status <schedule.json>              # pool balance, committed, available
//
// Env: NODE_URL, OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, GLOBAL_ADMIN_NAME,
// GLOBAL_ADMIN_PASSWORD (+ OAUTH_TOTP). The schedule file carries the addresses.
//
// schedule.json:
// {
//   "manager": "<40 hex>", "pool": "<40 hex>", "token": "<40 hex>", "decimals": 18,
//   "categories": [
//     { "name": "investors", "managed": false, "durationWeeks": 104, "startDate": 1800000000,
//       "entries": [ { "account": "<40 hex>", "tokens": "1234567.89" }, ... ] }
//   ]
// }
// Amounts are whole tokens in the file and are converted to atoms here (uint128).
// Each category is ONE addVestings call: same managed flag, duration and start for
// every entry. An account may appear once per category (ids are parameter hashes).
require('dotenv').config();
const config = require('./config');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { rest, util } = require('blockapps-rest');

const ADDRESS_RE = /^[0-9a-fA-F]{40}$/;
const MAX_UINT128 = (1n << 128n) - 1n;
const clean = (v) => String(v || '').trim().replace(/^0x/, '').toLowerCase();

function toAtoms(tokens, decimals) {
  const s = String(tokens).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`bad token amount "${tokens}"`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new Error(`"${tokens}" has more than ${decimals} decimals`);
  const atoms = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals));
  if (atoms <= 0n) throw new Error(`amount must be > 0 (got "${tokens}")`);
  if (atoms > MAX_UINT128) throw new Error(`"${tokens}" exceeds uint128`);
  return atoms;
}

function loadSchedule(file) {
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['manager', 'pool', 'token']) {
    s[k] = clean(s[k]);
    if (!ADDRESS_RE.test(s[k])) throw new Error(`schedule.${k} must be a 20-byte hex address`);
  }
  s.decimals = Number.isInteger(s.decimals) ? s.decimals : 18;
  if (!Array.isArray(s.categories) || !s.categories.length) throw new Error('schedule.categories is empty');
  for (const c of s.categories) {
    if (!c.name) throw new Error('category without name');
    if (typeof c.managed !== 'boolean') throw new Error(`${c.name}: managed must be true/false`);
    if (!Number.isInteger(c.durationWeeks) || c.durationWeeks < 0 || c.durationWeeks > 65535) throw new Error(`${c.name}: durationWeeks must be 0..65535`);
    if (!Number.isInteger(c.startDate) || c.startDate <= 0) throw new Error(`${c.name}: startDate must be a unix timestamp (seconds)`);
    if (!Array.isArray(c.entries) || !c.entries.length) throw new Error(`${c.name}: no entries`);
    const seen = new Set();
    c.accounts = []; c.amounts = []; c.total = 0n;
    for (const e of c.entries) {
      const a = clean(e.account);
      if (!ADDRESS_RE.test(a)) throw new Error(`${c.name}: bad account "${e.account}"`);
      if (seen.has(a)) throw new Error(`${c.name}: ${a} appears twice (same params would collide on the vesting id)`);
      seen.add(a);
      const atoms = toAtoms(e.tokens, s.decimals);
      c.accounts.push(a); c.amounts.push(atoms.toString()); c.total += atoms;
    }
  }
  return s;
}

function pick(s, name) {
  const c = s.categories.find((x) => x.name === name);
  if (!c) throw new Error(`category "${name}" not in schedule (have: ${s.categories.map((x) => x.name).join(', ')})`);
  return c;
}

function argsFor(c) {
  return { accounts: c.accounts, amounts: c.amounts, managed: c.managed, durationWeeks: c.durationWeeks, startDate: c.startDate };
}

function describe(s, c) {
  const args = argsFor(c);
  const hash = crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex');
  console.log(`category ${c.name}: ${c.accounts.length} entries, total ${c.total} atoms (${(Number(c.total) / 10 ** s.decimals).toLocaleString('en-US')} tokens), managed=${c.managed}, durationWeeks=${c.durationWeeks}, startDate=${c.startDate} (${new Date(c.startDate * 1000).toISOString()})`);
  console.log(`args sha256 ${hash}  <- every admin must see the same hash before voting`);
  return args;
}

async function login() {
  const auth = require('./auth');
  const user = process.env.GLOBAL_ADMIN_NAME;
  if (!user) throw new Error('GLOBAL_ADMIN_NAME is not set');
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  return { user, tokenObj: { token } };
}

async function callAndWait(tokenObj, callArgs) {
  const resp = await rest.call(tokenObj, callArgs, { config, isAsync: true, cacheNonce: true });
  const hashes = (Array.isArray(resp) ? resp : [resp]).map((r) => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const results = await util.until(
    (rs) => Array.isArray(rs) && rs.length > 0 && rs.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 300000);
  const final = Array.isArray(results) ? results[0] : results;
  const status = final && final.status;
  const msg = (final && final.txResult && final.txResult.message) || '';
  const ret = final && final.txResult && final.txResult.response && final.txResult.response.v;
  return { status, msg, ret, hash: hashes[0] };
}

async function cirrus(tokenObj, table, params) {
  const { data } = await axios.get(`${config.nodes[0].url}/cirrus/search/${table}`, { headers: { Authorization: `Bearer ${tokenObj.token}` }, params });
  return Array.isArray(data) ? data : [];
}

async function poolStatus(tokenObj, s) {
  const bal = await cirrus(tokenObj, 'BlockApps-Token-_balances', { address: `eq.${s.token}`, key: `eq.${s.pool}`, select: 'value', limit: '1' });
  const pool = await cirrus(tokenObj, 'BlockApps-VestingPool', { address: `eq.${s.pool}`, select: 'totalTokensInVesting', limit: '1' });
  const balance = BigInt(bal.length ? String(bal[0].value || '0') : '0');
  const committed = BigInt(pool.length ? String(pool[0].totalTokensInVesting || '0') : '0');
  return { balance, committed, available: balance - committed };
}

async function verify(tokenObj, s, c) {
  const rows = await cirrus(tokenObj, 'BlockApps-VestingPool-AddedVesting', { address: `eq.${s.pool}`, account: `in.(${c.accounts.join(',')})`, select: 'id,account,block_timestamp', order: 'block_timestamp.desc', limit: String(c.accounts.length * 4) });
  const byAccount = new Map();
  for (const r of rows) if (!byAccount.has(clean(r.account))) byAccount.set(clean(r.account), r);
  let missing = 0;
  for (const a of c.accounts) {
    const r = byAccount.get(a);
    if (r) console.log(`  ${a}  id ${r.id}  (${r.block_timestamp})`); else { console.log(`  ${a}  MISSING`); missing++; }
  }
  const pool = await cirrus(tokenObj, 'BlockApps-VestingPool', { address: `eq.${s.pool}`, select: 'totalTokensInVesting', limit: '1' });
  console.log(`pool totalTokensInVesting: ${pool.length ? pool[0].totalTokensInVesting : '?'}; ${c.accounts.length - missing}/${c.accounts.length} entries of ${c.name} have an AddedVesting row`);
  return missing === 0;
}

(async () => {
  const [cmd, file, name] = process.argv.slice(2);
  if (!cmd || !file) { console.error('usage: node create-vestings.js plan|fund|create|verify <schedule.json> [category]'); process.exit(2); }
  const s = loadSchedule(file);

  if (cmd === 'plan') {
    const cats = name ? [pick(s, name)] : s.categories;
    let grand = 0n;
    for (const c of cats) { describe(s, c); grand += c.total; }
    console.log(`manager ${s.manager}, pool ${s.pool}, token ${s.token}, decimals ${s.decimals}; grand total ${grand} atoms`);
    return;
  }
  const { user, tokenObj } = await login();
  if (cmd === 'status') {
    const st = await poolStatus(tokenObj, s);
    console.log(`pool ${s.pool}: balance ${st.balance} atoms, committed ${st.committed}, available for new vestings ${st.available} (${(Number(st.available) / 10 ** s.decimals).toLocaleString('en-US')} tokens)`);
    return;
  }
  if (!name) { console.error(`${cmd} needs a category name`); process.exit(2); }
  const c = pick(s, name);

  if (cmd === 'fund') {
    console.log(`${user}: voting Token.mint(${s.pool}, ${c.total}) on token ${s.token} for category ${c.name}`);
    const r = await callAndWait(tokenObj, { contract: { name: 'Token', address: s.token }, method: 'mint', args: { to: s.pool, amount: c.total.toString() }, txParams: { gasPrice: config.gasPrice, gasLimit: 2000000 } });
    console.log(`result: ${r.status} ${r.msg ? '| ' + r.msg.slice(0, 160) : ''} ${r.ret ? '| ' + String(r.ret).slice(0, 80) : ''}`);
    return;
  }
  if (cmd === 'create') {
    const args = describe(s, c);
    const st = await poolStatus(tokenObj, s);
    if (st.available < c.total) console.error(`WARNING: pool has ${st.available} atoms available but ${c.name} needs ${c.total}; the executing vote will revert with "Not enough tokens available" unless funded first (run: fund)`);
    console.log(`${user}: voting ${s.manager}.addVestings for category ${c.name}`);
    const r = await callAndWait(tokenObj, { contract: { name: 'VestingPoolManager', address: s.manager }, method: 'addVestings', args, txParams: { gasPrice: config.gasPrice, gasLimit: 8000000 } });
    console.log(`result: ${r.status} ${r.msg ? '| ' + r.msg.slice(0, 160) : ''} ${r.ret ? '| ' + String(r.ret).slice(0, 80) : ''}`);
    console.log('If this vote reached quorum the vestings exist now; otherwise another admin must run the same command. Then: verify.');
    return;
  }
  if (cmd === 'verify') {
    const ok = await verify(tokenObj, s, c);
    process.exit(ok ? 0 : 1);
  }
  console.error(`unknown command ${cmd}`); process.exit(2);
})().catch((e) => { console.error('FAILED:', (e.message || String(e)).slice(0, 300)); process.exit(1); });
