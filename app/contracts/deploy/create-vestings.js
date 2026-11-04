// Schedule STRATO vestings on a deployed VestingPoolManager from a schedule file.
// This script only creates vestings; claiming, pausing, cancelling and funding are
// done elsewhere (a management app later; funding is a Token.mint vote today).
//
//   node create-vestings.js plan   <schedule.json>   # every addVestings transaction the file implies (no network)
//   node create-vestings.js create <schedule.json>   # submit them, one AdminRegistry vote per category, skipping done ones
//   node create-vestings.js status <schedule.json>   # which entries exist on-chain and which do not
//   node create-vestings.js verify <schedule.json>   # exit 0 only if every entry is scheduled
//
// Env: NODE_URL, OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, GLOBAL_ADMIN_NAME,
// GLOBAL_ADMIN_PASSWORD (+ OAUTH_TOTP). The schedule file carries the addresses.
//
// schedule.json:
// {
//   "manager": "<40 hex>", "pool": "<40 hex>", "token": "<40 hex>", "decimals": 18,
//   "tge": "2026-12-01T00:00:00Z",      // ISO 8601 with timezone, or unix seconds
//   "secondsPerMonth": 3600,             // OPTIONAL, testing only: cliff month = this many seconds
//   "categories": [
//     { "name": "team", "managed": true, "cliffMonths": 12, "durationWeeks": 104,
//       "entries": [ { "account": "<40 hex>", "tokens": "1234567.89" } ] }
//   ]
// }
// startDate = TGE + cliffMonths calendar months (UTC, day clamped to the shorter
// month), or TGE + cliffMonths * secondsPerMonth when that override is present.
// Amounts are whole tokens in the file, converted to atoms (uint128). One category is
// ONE addVestings call: same managed flag, cliff and duration for every entry; an
// account may appear once per category because ids are parameter hashes.
require('dotenv').config();
const config = require('./config');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { rest, util } = require('blockapps-rest');

const ADDRESS_RE = /^[0-9a-fA-F]{40}$/;
const MAX_UINT128 = (1n << 128n) - 1n;
const clean = (v) => String(v || '').trim().replace(/^0x/, '').toLowerCase();
const iso = (s) => new Date(s * 1000).toISOString();

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

function parseTge(v) {
  if (Number.isInteger(v)) {
    if (v < 1e9 || v > 4e9) throw new Error(`tge ${v} does not look like unix seconds`);
    return v;
  }
  if (typeof v === 'string') {
    const t = /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() + 'T00:00:00Z' : v.trim();
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(t)) throw new Error(`tge "${v}" must carry a timezone (use Z for UTC)`);
    const ms = Date.parse(t);
    if (Number.isNaN(ms)) throw new Error(`tge "${v}" is not an ISO 8601 date`);
    return Math.floor(ms / 1000);
  }
  throw new Error('tge must be an ISO 8601 string or unix seconds');
}

// TGE + n calendar months in UTC, time of day kept, day clamped (Jan 31 + 1 = Feb 28/29).
function addMonthsUtc(seconds, months) {
  const d = new Date(seconds * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return Math.floor(target.getTime() / 1000);
}

function loadSchedule(file) {
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['manager', 'pool', 'token']) {
    s[k] = clean(s[k]);
    if (!ADDRESS_RE.test(s[k])) throw new Error(`schedule.${k} must be a 20-byte hex address`);
  }
  s.decimals = Number.isInteger(s.decimals) ? s.decimals : 18;
  if (s.tge === undefined) throw new Error('schedule.tge is required (ISO 8601 with timezone, or unix seconds)');
  s.tgeSeconds = parseTge(s.tge);
  if (s.secondsPerMonth !== undefined && (!Number.isInteger(s.secondsPerMonth) || s.secondsPerMonth <= 0)) throw new Error('secondsPerMonth must be a positive integer');
  if (!Array.isArray(s.categories) || !s.categories.length) throw new Error('schedule.categories is empty');
  const names = new Set();
  for (const c of s.categories) {
    if (!c.name || names.has(c.name)) throw new Error(`category name missing or duplicated: "${c.name}"`);
    names.add(c.name);
    if (typeof c.managed !== 'boolean') throw new Error(`${c.name}: managed must be true/false`);
    if (!Number.isInteger(c.durationWeeks) || c.durationWeeks < 0 || c.durationWeeks > 65535) throw new Error(`${c.name}: durationWeeks must be 0..65535`);
    if (c.startDate !== undefined) throw new Error(`${c.name}: startDate is derived from tge + cliffMonths; remove it`);
    if (!Number.isInteger(c.cliffMonths) || c.cliffMonths < 0 || c.cliffMonths > 1200) throw new Error(`${c.name}: cliffMonths must be an integer 0..1200`);
    c.startDate = s.secondsPerMonth ? s.tgeSeconds + c.cliffMonths * s.secondsPerMonth : addMonthsUtc(s.tgeSeconds, c.cliffMonths);
    if (!Array.isArray(c.entries) || !c.entries.length) throw new Error(`${c.name}: no entries`);
    const seen = new Set();
    c.accounts = []; c.amounts = []; c.total = 0n;
    for (const e of c.entries) {
      const a = clean(e.account);
      if (!ADDRESS_RE.test(a)) throw new Error(`${c.name}: bad account "${e.account}"`);
      if (seen.has(a)) throw new Error(`${c.name}: ${a} appears twice (same parameters would collide on the vesting id)`);
      seen.add(a);
      const atoms = toAtoms(e.tokens, s.decimals);
      c.accounts.push(a); c.amounts.push(atoms.toString()); c.total += atoms;
    }
  }
  return s;
}

const argsFor = (c) => ({ accounts: c.accounts, amounts: c.amounts, managed: c.managed, durationWeeks: c.durationWeeks, startDate: c.startDate });
const argsHash = (c) => crypto.createHash('sha256').update(JSON.stringify(argsFor(c))).digest('hex');
const fmtTokens = (atoms, d) => (Number(atoms) / 10 ** d).toLocaleString('en-US');

function printPlan(s) {
  console.log(`TGE ${s.tgeSeconds} (${iso(s.tgeSeconds)})${s.secondsPerMonth ? `; TEST SCALE: 1 cliff month = ${s.secondsPerMonth} s` : ''}`);
  console.log(`manager ${s.manager}  pool ${s.pool}  token ${s.token}  decimals ${s.decimals}`);
  let grand = 0n;
  s.categories.forEach((c, i) => {
    grand += c.total;
    console.log(`\n[${i + 1}] ${s.manager}.addVestings(accounts[${c.accounts.length}], amounts[${c.accounts.length}], managed=${c.managed}, durationWeeks=${c.durationWeeks}, startDate=${c.startDate})   # ${c.name}`);
    console.log(`    start ${iso(c.startDate)} (cliff ${c.cliffMonths} months)  end ${iso(c.startDate + c.durationWeeks * 604800)}${c.durationWeeks === 0 ? ' (fully vested at start)' : ''}`);
    c.accounts.forEach((a, j) => console.log(`    ${a}  ${c.amounts[j]} atoms  (${fmtTokens(c.amounts[j], s.decimals)} tokens)`));
    console.log(`    total ${c.total} atoms (${fmtTokens(c.total, s.decimals)} tokens)   args sha256 ${argsHash(c)}`);
  });
  console.log(`\n${s.categories.length} transactions; ${grand} atoms (${fmtTokens(grand, s.decimals)} tokens) must be available in the pool before they execute.`);
}

async function login() {
  const auth = require('./auth');
  const user = process.env.GLOBAL_ADMIN_NAME;
  if (!user) throw new Error('GLOBAL_ADMIN_NAME is not set');
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  return { user, tokenObj: { token } };
}

async function cirrus(tokenObj, table, params) {
  const { data } = await axios.get(`${config.nodes[0].url}/cirrus/search/${table}`, { headers: { Authorization: `Bearer ${tokenObj.token}` }, params });
  return Array.isArray(data) ? data : [];
}

// On-chain vestings of the pool, from the record table of the `vestings` struct mapping:
// one row per id with the struct as JSON in `value`.
async function onChainVestings(tokenObj, s) {
  const rows = await cirrus(tokenObj, 'BlockApps-VestingPool-vestings', { address: `eq.${s.pool}`, select: 'key,value', limit: '5000' });
  return rows.map((r) => {
    const v = typeof r.value === 'string' ? JSON.parse(r.value) : (r.value || {});
    return { id: r.key, account: clean(v.account), managed: v.managed === true || v.managed === 'true', durationWeeks: Number(v.durationWeeks), startDate: Number(v.startDate), amount: String(v.amount), cancelled: v.cancelled === true || v.cancelled === 'true' };
  });
}

function matchEntry(onchain, c, j) {
  const want = BigInt(c.amounts[j]);
  return onchain.find((v) => v.account === c.accounts[j] && v.managed === c.managed && v.durationWeeks === c.durationWeeks && v.startDate === c.startDate
    && (/^\d+$/.test(v.amount) ? BigInt(v.amount) === want : Number(v.amount) === Number(want)));
}

async function status(tokenObj, s, quiet) {
  const onchain = await onChainVestings(tokenObj, s);
  const report = [];
  for (const c of s.categories) {
    const found = c.accounts.map((_, j) => matchEntry(onchain, c, j));
    const done = found.filter(Boolean).length;
    report.push({ c, found, done });
    if (!quiet) {
      console.log(`${c.name}: ${done}/${c.accounts.length} scheduled`);
      c.accounts.forEach((a, j) => console.log(`  ${found[j] ? 'OK      ' : 'MISSING '} ${a}  ${fmtTokens(c.amounts[j], s.decimals)} tokens${found[j] ? `  id ${found[j].id}${found[j].cancelled ? '  (cancelled)' : ''}` : ''}`));
    }
  }
  return report;
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
  return { status: final && final.status, msg: (final && final.txResult && final.txResult.message) || '', hash: hashes[0] };
}

(async () => {
  const [cmd, file] = process.argv.slice(2);
  if (!cmd || !file) { console.error('usage: node create-vestings.js plan|create|status|verify <schedule.json>'); process.exit(2); }
  const s = loadSchedule(file);

  if (cmd === 'plan') { printPlan(s); return; }

  const { user, tokenObj } = await login();

  if (cmd === 'status') { await status(tokenObj, s, false); return; }

  if (cmd === 'verify') {
    const report = await status(tokenObj, s, false);
    const missing = report.reduce((n, r) => n + (r.c.accounts.length - r.done), 0);
    console.log(missing === 0 ? 'COMPLETE: every entry in the file is scheduled on-chain.' : `INCOMPLETE: ${missing} entries are not scheduled.`);
    process.exit(missing === 0 ? 0 : 1);
  }

  if (cmd === 'create') {
    const report = await status(tokenObj, s, true);
    for (const { c, done } of report) {
      if (done === c.accounts.length) { console.log(`${c.name}: already scheduled (${done}/${done}), skipping`); continue; }
      if (done > 0) { console.error(`${c.name}: ${done}/${c.accounts.length} entries already exist; a re-run would collide on their ids ("Vesting id already used"). Fix the file first.`); process.exit(1); }
      console.log(`${c.name}: ${user} voting ${s.manager}.addVestings for ${c.accounts.length} entries, ${fmtTokens(c.total, s.decimals)} tokens, args sha256 ${argsHash(c)}`);
      const r = await callAndWait(tokenObj, { contract: { name: 'VestingPoolManager', address: s.manager }, method: 'addVestings', args: argsFor(c), txParams: { gasPrice: config.gasPrice, gasLimit: 8000000 } });
      console.log(`  result: ${r.status}${r.msg ? ' | ' + r.msg.slice(0, 200) : ''} (tx ${r.hash})`);
    }
    console.log('Run `status` to see what executed; a vote below quorum needs another admin to run `create` with the same file.');
    return;
  }
  console.error(`unknown command ${cmd}`); process.exit(2);
})().catch((e) => { console.error('FAILED:', (e.message || String(e)).slice(0, 300)); process.exit(1); });
