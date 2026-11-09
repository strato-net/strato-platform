// Schedule STRATO vestings on a deployed VestingPoolManager from a schedule file.
// This script only creates vestings; claiming, pausing, cancelling and funding are
// done elsewhere (a management app later; funding is a Token.mint vote today).
//
//   node create-vestings.js plan   <schedule.json>   # every addVestings transaction the file implies (no network)
//   node create-vestings.js create <schedule.json>   # vote every pending batch, then wait until each executes
//   node create-vestings.js status <schedule.json>   # which entries exist on-chain, and how many tokens to send the pool
//   node create-vestings.js verify <schedule.json>   # exit 0 only if every entry is scheduled
//
// Env: NODE_URL, OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, GLOBAL_ADMIN_NAME,
// GLOBAL_ADMIN_PASSWORD (+ OAUTH_TOTP). The schedule file carries the addresses.
// VOTE_WAIT_MINUTES (default 60): how long `create` waits for the other admins.
//
// Admin flow: admin 1 runs `create`, which casts one vote per batch by calling
// AdminRegistry.castVoteOnIssue(manager, "addVestings", typedArgs) directly (the
// registry no longer accepts votes routed through the target's onlyOwner fallback;
// calling manager.addVestings directly fails with "Only an admin or a whitelisted
// account can call castVoteOnIssue"). Arguments go in the registry's variadic slot
// with explicit Solidity type hints, exactly as the app backend does
// (app/backend/src/api/services/user.service.ts hintedArg), so the issue id matches
// what the admin UI computes. Admin 2 confirms the printed issues in the admin UI;
// the script polls the pool's vestings table and reports each batch as it executes.
// ADMIN_REGISTRY (env) or schedule.adminRegistry overrides the genesis address.
//
// schedule.json:
// {
//   "manager": "<40 hex>", "pool": "<40 hex>", "token": "<40 hex>", "decimals": 18,
//   "tge": "2026-12-01T00:00:00Z",      // ISO 8601 with timezone, or unix seconds
//   "secondsPerMonth": 3600,             // TESTING ONLY: cliff month = this many seconds. Without it a
//                                        // cliff month is a real calendar month. `create` refuses a
//                                        // file that has it unless ALLOW_TEST_SCALE=1 is set.
//   "batchSize": 25,                     // OPTIONAL, default 25: entries per addVestings transaction
//   "categories": [
//     { "name": "team", "managed": true, "cliffMonths": 12, "durationWeeks": 104,
//       "entries": [ { "account": "<40 hex>", "tokens": "1234567.89" } ] }
//   ]
// }
// startDate = TGE + cliffMonths calendar months (UTC, day clamped to the shorter
// month), or TGE + cliffMonths * secondsPerMonth when that override is present.
// Amounts are whole tokens in the file, converted to atoms (uint128). A category is
// split into batches of batchSize entries, in file order; each batch is ONE
// addVestings transaction (one vote) with the category's managed flag, cliff and
// duration, and is atomic: one bad entry reverts that batch only. An account may
// appear once per category because ids are parameter hashes.
require('dotenv').config();
const config = require('./config');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
// blockapps-rest is only used for auth here; transactions are posted directly so that
// uint values in the registry's variadic slot can travel as bare JSON numbers.
const { getIssueId } = require('./util');

const ADDRESS_RE = /^[0-9a-fA-F]{40}$/;
const MAX_UINT128 = (1n << 128n) - 1n;
const DEFAULT_REGISTRY = '000000000000000000000000000000000000100c';
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
  s.adminRegistry = clean(s.adminRegistry || process.env.ADMIN_REGISTRY || DEFAULT_REGISTRY);
  if (!ADDRESS_RE.test(s.adminRegistry)) throw new Error('adminRegistry must be a 20-byte hex address');
  if (s.tge === undefined) throw new Error('schedule.tge is required (ISO 8601 with timezone, or unix seconds)');
  s.tgeSeconds = parseTge(s.tge);
  if (s.secondsPerMonth !== undefined && (!Number.isInteger(s.secondsPerMonth) || s.secondsPerMonth <= 0)) throw new Error('secondsPerMonth must be a positive integer');
  if (s.batchSize === undefined) s.batchSize = 25;
  if (!Number.isInteger(s.batchSize) || s.batchSize <= 0) throw new Error('batchSize must be a positive integer');
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
    c.batches = [];
    for (let i = 0; i < c.accounts.length; i += s.batchSize) {
      const accounts = c.accounts.slice(i, i + s.batchSize), amounts = c.amounts.slice(i, i + s.batchSize);
      c.batches.push({ index: c.batches.length, from: i, accounts, amounts, total: amounts.reduce((t, x) => t + BigInt(x), 0n) });
    }
  }
  return s;
}

// addVestings(address[] accounts, uint128[] amounts, bool managed, uint16 durationWeeks, uint64 startDate)
// as typed variadic arguments for AdminRegistry.castVoteOnIssue. Integers are BigInt and
// are serialised as bare JSON numbers (see toBody), addresses carry 0x, like the backend.
const typedArgsFor = (c, b) => ([
  { type: 'address[]', value: b.accounts.map((a) => '0x' + a) },
  { type: 'uint128[]', value: b.amounts.map((x) => BigInt(x)) },
  { type: 'bool', value: c.managed },
  { type: 'uint16', value: BigInt(c.durationWeeks) },
  { type: 'uint64', value: BigInt(c.startDate) },
]);
// JSON with BigInt rendered as bare numbers (JSON.stringify cannot do it natively).
const toBody = (obj) => JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? `__BIG__${v.toString()}__` : v)).replace(/"__BIG__(-?\d+)__"/g, '$1');
const argsHash = (c, b) => crypto.createHash('sha256').update(toBody(typedArgsFor(c, b))).digest('hex');
const batchLabel = (c, b) => c.batches.length > 1 ? `${c.name} batch ${b.index + 1}/${c.batches.length}` : c.name;
const fmtTokens = (atoms, d) => (Number(atoms) / 10 ** d).toLocaleString('en-US');

function printPlan(s) {
  console.log(`TGE ${s.tgeSeconds} (${iso(s.tgeSeconds)})${s.secondsPerMonth ? `; TEST SCALE: 1 cliff month = ${s.secondsPerMonth} s` : ''}`);
  console.log(`manager ${s.manager}  pool ${s.pool}  token ${s.token}  decimals ${s.decimals}`);
  let grand = 0n, txs = 0;
  for (const c of s.categories) {
    grand += c.total;
    console.log(`\n== ${c.name}: ${c.accounts.length} entries in ${c.batches.length} transaction(s) of up to ${s.batchSize}; managed=${c.managed}; start ${iso(c.startDate)} (cliff ${c.cliffMonths} months); end ${iso(c.startDate + c.durationWeeks * 604800)}${c.durationWeeks === 0 ? ' (fully vested at start)' : ''}; total ${fmtTokens(c.total, s.decimals)} tokens`);
    for (const b of c.batches) {
      txs++;
      console.log(`[${txs}] AdminRegistry(${s.adminRegistry}).castVoteOnIssue(${s.manager}, "addVestings", [accounts[${b.accounts.length}], amounts[${b.accounts.length}], managed=${c.managed}, durationWeeks=${c.durationWeeks}, startDate=${c.startDate}])   # ${batchLabel(c, b)}`);
      b.accounts.forEach((a, j) => console.log(`    ${a}  ${b.amounts[j]} atoms  (${fmtTokens(b.amounts[j], s.decimals)} tokens)`));
      console.log(`    batch total ${b.total} atoms (${fmtTokens(b.total, s.decimals)} tokens)   args sha256 ${argsHash(c, b)}`);
    }
  }
  console.log(`\n${txs} transactions; ${grand} atoms (${fmtTokens(grand, s.decimals)} tokens) must be available in the pool before they execute.`);
}

async function login() {
  const auth = require('./auth');
  const user = process.env.GLOBAL_ADMIN_NAME;
  if (!user) throw new Error('GLOBAL_ADMIN_NAME is not set');
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  return { user, tokenObj: { token } };
}

async function cirrus(tokenObj, table, params) {
  try {
    const { data } = await axios.get(`${config.nodes[0].url}/cirrus/search/${table}`, { headers: { Authorization: `Bearer ${tokenObj.token}` }, params });
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.response && e.response.status === 401) { // access token expired during a long wait
      tokenObj.token = (await login()).tokenObj.token;
      const { data } = await axios.get(`${config.nodes[0].url}/cirrus/search/${table}`, { headers: { Authorization: `Bearer ${tokenObj.token}` }, params });
      return Array.isArray(data) ? data : [];
    }
    throw e;
  }
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

// Pool funding from Cirrus. Values are fetched with ::text: as JSON numbers they would
// lose precision in JavaScript at these magnitudes (10^23 atoms and up).
async function poolFunding(tokenObj, s) {
  const bal = await cirrus(tokenObj, 'BlockApps-Token-_balances', { address: `eq.${s.token}`, key: `eq.${s.pool}`, select: 'value::text', limit: '1' });
  const pool = await cirrus(tokenObj, 'BlockApps-VestingPool', { address: `eq.${s.pool}`, select: 'totalTokensInVesting::text', limit: '1' });
  const balance = BigInt(bal.length && /^\d+$/.test(String(bal[0].value)) ? String(bal[0].value) : '0');
  const committed = BigInt(pool.length && /^\d+$/.test(String(pool[0].totalTokensInVesting)) ? String(pool[0].totalTokensInVesting) : '0');
  return { balance, committed, available: balance - committed };
}

function printFunding(s, f, needed) {
  const shortfall = needed > f.available ? needed - f.available : 0n;
  console.log(`\npool ${s.pool}: balance ${fmtTokens(f.balance, s.decimals)} tokens, committed ${fmtTokens(f.committed, s.decimals)}, available for new vestings ${fmtTokens(f.available, s.decimals)}`);
  console.log(`unscheduled entries need ${fmtTokens(needed, s.decimals)} tokens (${needed} atoms)`);
  if (needed === 0n) console.log('nothing left to schedule.');
  else if (shortfall === 0n) console.log('the pool already holds enough: run `create`.');
  else console.log(`SEND ${fmtTokens(shortfall, s.decimals)} tokens (${shortfall} atoms) to the pool ${s.pool} (Token.mint or transfer), then run \`create\`.`);
  return shortfall;
}

const neededFor = (report) => report.reduce((n, r) => n + r.c.amounts.reduce((m, a, j) => m + (r.found[j] ? 0n : BigInt(a)), 0n), 0n);

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
    const batches = c.batches.map((b) => ({ b, done: b.accounts.filter((_, j) => found[b.from + j]).length }));
    report.push({ c, found, done, batches });
    if (!quiet) {
      console.log(`${c.name}: ${done}/${c.accounts.length} scheduled` + (c.batches.length > 1 ? ` (${batches.filter((x) => x.done === x.b.accounts.length).length}/${c.batches.length} batches complete)` : ''));
      c.accounts.forEach((a, j) => console.log(`  ${found[j] ? 'OK      ' : 'MISSING '} ${a}  ${fmtTokens(c.amounts[j], s.decimals)} tokens${found[j] ? `  id ${found[j].id}${found[j].cancelled ? '  (cancelled)' : ''}` : ''}`));
    }
  }
  return report;
}

// Submit one FUNCTION transaction through the node's parallel endpoint (what the app
// backend does), with BigInt values as bare JSON numbers, and wait for its result.
async function postFunctionTx(tokenObj, payload, gasLimit) {
  const base = config.nodes[0].url;
  const body = toBody({ txs: [{ type: 'FUNCTION', payload }], txParams: { gasLimit, gasPrice: config.gasPrice } });
  const headers = { Authorization: `Bearer ${tokenObj.token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const { data } = await axios.post(`${base}/strato/v2.3/transaction/parallel?resolve=true`, body, { headers, timeout: 120000 });
  let results = Array.isArray(data) ? data : [data];
  const hashes = results.map((r) => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(data).slice(0, 300));
  const deadline = Date.now() + 300000;
  while (results.some((r) => !r || !r.status || r.status === 'Pending') && Date.now() < deadline) {
    await sleep(3000);
    const res = await axios.post(`${base}/bloc/v2.2/transactions/results`, JSON.stringify(hashes), { headers, timeout: 60000 });
    results = Array.isArray(res.data) ? res.data : [res.data];
  }
  const final = results[0];
  return { status: final && final.status, msg: (final && final.txResult && final.txResult.message) || '', hash: hashes[0] };
}

// The issue id the registry recorded for a vote transaction (IssueCreated for the first
// vote, IssueVoted for later ones). Cirrus indexes a few seconds after the receipt.
async function issueIdForTx(tokenObj, hash) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const ev of ['IssueCreated', 'IssueVoted']) {
      const rows = await cirrus(tokenObj, `BlockApps-AdminRegistry-${ev}`, { transaction_hash: `eq.${hash}`, select: 'issueId', limit: '1' });
      if (rows.length && rows[0].issueId) return rows[0].issueId;
    }
    await sleep(3000);
  }
  return null;
}

async function castVote(tokenObj, s, c, b) {
  const payload = {
    contractName: 'AdminRegistry',
    contractAddress: s.adminRegistry,
    method: 'castVoteOnIssue',
    args: { _target: s.manager, _func: 'addVestings', _args: typedArgsFor(c, b) },
  };
  const r = await postFunctionTx(tokenObj, payload, 8000000);
  r.issueId = r.status === 'Success' ? await issueIdForTx(tokenObj, r.hash) : null;
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until every submitted batch has all its entries on-chain. The vote that reaches
// quorum executes the batch; until then the issue sits in the AdminRegistry for the
// other admins. Returns the batches still pending at the deadline.
async function waitForExecution(tokenObj, s, submitted) {
  const deadline = Date.now() + Number(process.env.VOTE_WAIT_MINUTES || 60) * 60000;
  let pending = submitted.slice();
  let tick = 0;
  while (pending.length && Date.now() < deadline) {
    const onchain = await onChainVestings(tokenObj, s);
    const still = [];
    for (const x of pending) {
      const done = x.b.accounts.every((_, j) => matchEntry(onchain, x.c, x.b.from + j));
      if (done) console.log(`  EXECUTED ${x.label}: ${x.b.accounts.length} entries on-chain`);
      else still.push(x);
    }
    pending = still;
    if (!pending.length) break;
    if (tick % 4 === 0) console.log(`  waiting for ${pending.length} issue(s) to be confirmed by another admin: ${pending.map((x) => `${x.label}=${x.issueId || '?'}`).join(', ')}  [${new Date().toISOString()}]`);
    tick++;
    await sleep(15000);
  }
  return pending;
}

(async () => {
  const [cmd, file] = process.argv.slice(2);
  if (!cmd || !file) { console.error('usage: node create-vestings.js plan|create|status|verify <schedule.json>'); process.exit(2); }
  const s = loadSchedule(file);

  if (cmd === 'plan') { printPlan(s); return; }

  const { user, tokenObj } = await login();

  if (cmd === 'status') {
    const report = await status(tokenObj, s, false);
    printFunding(s, await poolFunding(tokenObj, s), neededFor(report));
    return;
  }

  if (cmd === 'verify') {
    const report = await status(tokenObj, s, false);
    const missing = report.reduce((n, r) => n + (r.c.accounts.length - r.done), 0);
    if (missing > 0) printFunding(s, await poolFunding(tokenObj, s), neededFor(report));
    console.log(missing === 0 ? 'COMPLETE: every entry in the file is scheduled on-chain.' : `INCOMPLETE: ${missing} entries are not scheduled.`);
    process.exit(missing === 0 ? 0 : 1);
  }

  if (cmd === 'create') {
    if (s.secondsPerMonth && process.env.ALLOW_TEST_SCALE !== '1') {
      console.error(`refusing to create: the schedule has secondsPerMonth=${s.secondsPerMonth} (test scale: a cliff month is ${s.secondsPerMonth} s, not a calendar month). Remove it for a real deployment, or set ALLOW_TEST_SCALE=1 for a rehearsal.`);
      process.exit(1);
    }
    const report = await status(tokenObj, s, true);
    const needed = neededFor(report);
    if (needed === 0n) { console.log('every entry is already scheduled; nothing to do.'); return; }
    const shortfall = printFunding(s, await poolFunding(tokenObj, s), needed);
    if (shortfall > 0n) { console.error('not submitting: the executing vote would revert with "Not enough tokens available". Fund the pool first.'); process.exit(1); }
    const submitted = [];
    for (const { c, batches } of report) {
      for (const { b, done } of batches) {
        const label = batchLabel(c, b);
        if (done === b.accounts.length) { console.log(`${label}: already scheduled (${done}/${done}), skipping`); continue; }
        if (done > 0) { console.error(`${label}: ${done}/${b.accounts.length} entries already exist; re-submitting would collide on their ids ("Vesting id already used"). Fix the file (or the batch boundaries) first.`); process.exit(1); }
        console.log(`${label}: ${user} voting castVoteOnIssue(${s.manager}, addVestings) for ${b.accounts.length} entries, ${fmtTokens(b.total, s.decimals)} tokens, args sha256 ${argsHash(c, b)}`);
        const r = await castVote(tokenObj, s, c, b);
        console.log(`  vote tx ${r.status}${r.msg ? ' | ' + r.msg.slice(0, 160) : ''} (${r.hash})${r.issueId ? `  issue ${r.issueId}` : ''}`);
        if (r.status !== 'Success') { console.error(`  the vote itself failed; nothing was recorded for ${label}. Fix the cause and re-run.`); process.exit(1); }
        submitted.push({ c, b, label, issueId: r.issueId, hash: r.hash });
      }
    }
    if (!submitted.length) return;
    console.log(`\n${submitted.length} vote(s) cast. If the registry needs more votes, confirm these issues in the admin UI:`);
    for (const x of submitted) console.log(`  ${x.label}: issue ${x.issueId || '(id not in receipt; look for addVestings on ' + s.manager + ')'}`);
    console.log(`Waiting up to ${process.env.VOTE_WAIT_MINUTES || 60} minutes for execution (Ctrl-C is safe: re-running \`create\` skips executed batches and re-casts only pending ones)...`);
    const pending = await waitForExecution(tokenObj, s, submitted);
    if (pending.length) {
      console.error(`\nTIMEOUT: ${pending.length} batch(es) not executed yet: ${pending.map((x) => x.label).join(', ')}. Re-run \`create\` or \`status\` later.`);
      process.exit(1);
    }
    console.log('\nAll submitted batches executed. Run `verify` for the full picture.');
    return;
  }
  console.error(`unknown command ${cmd}`); process.exit(2);
})().catch((e) => { console.error('FAILED:', (e.message || String(e)).slice(0, 300)); process.exit(1); });
