// Deploy, load and check a SnapshotClaim airdrop from a manifest CSV.
//
//   node snapshot-claim.js plan   <manifest.csv>   # parse and check the file; total, count, sha256, batches (no network)
//   node snapshot-claim.js deploy                  # deploy SnapshotClaim with this account as its loader
//   node snapshot-claim.js load   <manifest.csv>   # set every allocation that differs on-chain (safe to re-run)
//   node snapshot-claim.js close  <manifest.csv>   # verify, then close loading for good
//   node snapshot-claim.js verify <manifest.csv>   # read every row back; exit 0 only if the chain matches exactly
//
// The flow (runbook Phase 6): load, close, verify; the owner multisig then funds the contract
// with the printed total and calls seal(total, count) with the printed values. verify needs
// no login, so each multisig signer can run it against the published manifest.
//
// Env: NODE_URL; for deploy, load and close also OAUTH_URL, OAUTH_CLIENT_ID,
// OAUTH_CLIENT_SECRET, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD (the loader account).
// SNAPSHOT_CLAIM: the contract (40 hex) for load, close and verify. BATCH_SIZE (default 400):
// rows per setAllocations transaction. On helium (2026-11-24) 401 and 800 rows each fit one
// transaction; a 1500-row request was dropped by the node.
// deploy: STRATO_TOKEN, CLAIM_OWNER (the funding multisig), UNCLAIMED_RECIPIENT, and
// CLAIM_WINDOW in seconds (default 7776000, 90 days). verify checks the contract against any
// of those that are set, and against LOADER.
//
// manifest.csv: a header `account,amount_wei` (integer wei) or `account,amount` (decimal
// STRATO, up to 18 places), then one row per account. Accounts are 40 hex, with or without
// 0x, each at most once; amounts are > 0. The sha256 printed is of the file's bytes.
//
// Reads never use Cirrus: a contract deployed by a plain account gets no Cirrus tables.
// Scalars come from the node's JSON-RPC eth_call; per-account allocations from its storage
// API, because eth_call of a public mapping getter keyed by an address returns 0 on current
// nodes (checked on helium 2026-11-24). Removing a row from the manifest after loading it is
// not undone by `load`; verify then reports more accounts on-chain than in the file.
// Nothing is funded before close, so the remedy is a fresh deployment.
require('dotenv').config();
const config = require('./config');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const ADDRESS_RE = /^[0-9a-f]{40}$/;
const DECIMALS = 18;
const DEFAULT_WINDOW = 7776000;
const clean = (v) => String(v || '').trim().replace(/^0x/i, '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtTokens(wei) {
  const s = wei.toString().padStart(DECIMALS + 1, '0');
  const frac = s.slice(-DECIMALS).replace(/0+$/, '');
  return s.slice(0, -DECIMALS) + (frac ? '.' + frac : '');
}

function toWei(text, decimal, where) {
  const s = text.trim();
  if (!decimal) {
    if (!/^\d+$/.test(s)) throw new Error(`${where}: amount_wei must be an integer, got "${text}"`);
    return BigInt(s);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`${where}: bad amount "${text}"`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > DECIMALS) throw new Error(`${where}: "${text}" has more than ${DECIMALS} decimals`);
  return BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt((frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS));
}

function loadManifest(file) {
  if (!file) throw new Error('give the manifest CSV');
  const bytes = fs.readFileSync(file);
  const lines = bytes.toString('utf8').split(/\r?\n/);
  const header = lines[0].replace(/^﻿/, '').trim().toLowerCase().replace(/\s/g, '');
  if (header !== 'account,amount_wei' && header !== 'account,amount') throw new Error(`header must be "account,amount_wei" or "account,amount", got "${lines[0]}"`);
  const decimal = header === 'account,amount';
  const rows = [];
  const seen = new Set();
  let total = 0n;
  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return;
    const where = `line ${i + 2}`;
    const cells = line.split(',');
    if (cells.length !== 2) throw new Error(`${where}: expected 2 columns, got ${cells.length}`);
    const account = clean(cells[0]);
    if (!ADDRESS_RE.test(account) || /^0+$/.test(account)) throw new Error(`${where}: bad account "${cells[0]}"`);
    if (seen.has(account)) throw new Error(`${where}: ${account} appears twice`);
    seen.add(account);
    const amount = toWei(cells[1], decimal, where);
    if (amount <= 0n) throw new Error(`${where}: amount must be > 0`);
    rows.push({ account, amount });
    total += amount;
  });
  if (!rows.length) throw new Error('the manifest has no rows');
  const batchSize = Number(process.env.BATCH_SIZE || 400);
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('BATCH_SIZE must be a positive integer');
  return { file, rows, total, count: BigInt(rows.length), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), batchSize };
}

function printManifest(m) {
  console.log(`manifest ${m.file}: sha256 ${m.sha256}`);
  console.log(`  ${m.count} accounts, total ${m.total} wei (${fmtTokens(m.total)} STRATO), ${Math.ceil(m.rows.length / m.batchSize)} batch(es) of up to ${m.batchSize}`);
}

// ---- reads: no login ------------------------------------------------------------------------

const SEL = {
  totalAllocated: '45f7f249', allocationCount: 'cd8227f9',
  totalClaimed: 'd54ad2a1', loadingClosed: '84949862', deadline: '29dcb0cf', token: 'fc0c546a',
  loader: 'f74e2c3f', unclaimedRecipient: '6a2bfdda', claimWindow: 'c5d37ae1', owner: '8da5cb5b',
  balanceOf: '70a08231',
};
const addressWord = (a) => a.padStart(64, '0');

async function ethCall(to, data) {
  const { data: res } = await axios.post(`${config.nodes[0].url.replace(/\/$/, '')}/rpc`,
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x' + to, data: '0x' + data }, 'latest'] },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
  if (!res || typeof res.result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(res.result)) throw new Error(`eth_call ${data.slice(0, 8)} to ${to} failed: ${JSON.stringify(res).slice(0, 200)}`);
  return res.result.slice(2);
}
const uintAt = async (to, sel, arg = '') => BigInt('0x' + await ethCall(to, sel + arg));
const addressAt = async (to, sel) => (await ethCall(to, sel)).slice(24);

// One account's allocation from the node's storage API (no row: never set, or set to 0).
async function storedAllocation(claim, account) {
  const { data } = await axios.get(`${config.nodes[0].url.replace(/\/$/, '')}/strato-api/eth/v1.2/storage`, { params: { address: claim, key: `allocation[${account}]` }, timeout: 30000 });
  if (!Array.isArray(data)) throw new Error(`storage read for ${account} failed: ${JSON.stringify(data).slice(0, 200)}`);
  if (!data.length) return 0n;
  if (!/^\d+$/.test(String(data[0].value))) throw new Error(`unexpected stored allocation for ${account}: ${JSON.stringify(data[0]).slice(0, 200)}`);
  return BigInt(data[0].value);
}

// Every manifest account's on-chain allocation, a few reads at a time.
async function onChainAllocations(claim, rows) {
  const out = new Array(rows.length);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < rows.length) {
      const i = next++;
      out[i] = await storedAllocation(claim, rows[i].account);
    }
  }));
  return out;
}

async function readContract(claim) {
  const c = { address: claim };
  for (const k of ['token', 'loader', 'unclaimedRecipient', 'owner']) c[k] = await addressAt(claim, SEL[k]);
  for (const k of ['claimWindow', 'totalAllocated', 'allocationCount', 'totalClaimed', 'deadline']) c[k] = await uintAt(claim, SEL[k]);
  c.loadingClosed = (await uintAt(claim, SEL.loadingClosed)) !== 0n;
  c.balance = await uintAt(c.token, SEL.balanceOf, addressWord(claim));
  return c;
}

// The contract against the manifest. ok only when every row matches and the chain holds
// no other allocation (the counts and totals agree).
async function compare(claim, m) {
  const c = await readContract(claim);
  const amounts = await onChainAllocations(claim, m.rows);
  const differing = m.rows.map((r, i) => ({ ...r, onChain: amounts[i] })).filter((r) => r.onChain !== r.amount);
  const ok = differing.length === 0 && c.allocationCount === m.count && c.totalAllocated === m.total;
  return { c, differing, ok };
}

function expectedConfigProblems(c) {
  const problems = [];
  const want = { token: process.env.STRATO_TOKEN, owner: process.env.CLAIM_OWNER, unclaimedRecipient: process.env.UNCLAIMED_RECIPIENT, loader: process.env.LOADER };
  for (const [k, v] of Object.entries(want)) if (v && clean(v) !== c[k]) problems.push(`${k} is ${c[k]}, expected ${clean(v)}`);
  if (process.env.CLAIM_WINDOW && BigInt(process.env.CLAIM_WINDOW) !== c.claimWindow) problems.push(`claimWindow is ${c.claimWindow}, expected ${process.env.CLAIM_WINDOW}`);
  return problems;
}

function printComparison(m, { c, differing, ok }) {
  console.log(`contract ${c.address}: token ${c.token}, loader ${c.loader}, owner ${c.owner}`);
  console.log(`  unclaimed recipient ${c.unclaimedRecipient}, claim window ${c.claimWindow} s (${Number(c.claimWindow) / 86400} days)`);
  console.log(`  loading ${c.loadingClosed ? 'CLOSED' : 'open'}; ${c.deadline === 0n ? 'not sealed' : `sealed, deadline ${new Date(Number(c.deadline) * 1000).toISOString()}`}`);
  console.log(`  on-chain: ${c.allocationCount} accounts, total ${c.totalAllocated} wei (${fmtTokens(c.totalAllocated)} STRATO); claimed ${fmtTokens(c.totalClaimed)}; holds ${c.balance} wei`);
  for (const r of differing.slice(0, 20)) console.log(`  DIFFERS ${r.account}: manifest ${r.amount}, on-chain ${r.onChain}`);
  if (differing.length > 20) console.log(`  ... and ${differing.length - 20} more`);
  if (!differing.length && c.allocationCount > m.count) console.log(`  ${c.allocationCount - m.count} account(s) on-chain are not in the manifest; deploy afresh (nothing is funded before close)`);
  console.log(ok ? '  MATCHES the manifest exactly' : `  DOES NOT MATCH: ${differing.length} row(s) differ`);
}

// ---- writes: the loader account -----------------------------------------------------------

async function login() {
  const auth = require('./auth');
  const user = process.env.GLOBAL_ADMIN_NAME;
  if (!user) throw new Error('GLOBAL_ADMIN_NAME is not set');
  return { token: await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD) };
}

async function myAddress(tokenObj) {
  const { data } = await axios.get(`${config.nodes[0].url.replace(/\/$/, '')}/strato/v2.3/key`, { headers: { Authorization: `Bearer ${tokenObj.token}` } });
  return clean(data.address);
}

// JSON with BigInt as bare numbers, so 18-decimal amounts reach the node exactly.
const toBody = (obj) => JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? `__BIG__${v.toString()}__` : v)).replace(/"__BIG__(-?\d+)__"/g, '$1');

// One FUNCTION transaction through the parallel endpoint, waiting for its result. A reverted
// transaction comes back as HTTP 422 with the revert message as the body.
async function sendTx(tokenObj, method, args) {
  const base = config.nodes[0].url.replace(/\/$/, '');
  const body = toBody({ txs: [{ type: 'FUNCTION', payload: { contractName: 'SnapshotClaim', contractAddress: process.env.SNAPSHOT_CLAIM, method, args } }], txParams: { gasLimit: config.gasLimit, gasPrice: config.gasPrice } });
  const post = () => axios.post(`${base}/strato/v2.3/transaction/parallel?resolve=true`, body, { headers: { Authorization: `Bearer ${tokenObj.token}`, 'Content-Type': 'application/json' }, timeout: 120000 });
  let data;
  try {
    ({ data } = await post());
  } catch (e) {
    if (e.response && e.response.status === 401) { tokenObj.token = (await login()).token; ({ data } = await post()); }
    else if (e.response) return { status: 'Rejected', msg: `HTTP ${e.response.status} | ${typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data)}`.slice(0, 400) };
    else throw e;
  }
  let results = Array.isArray(data) ? data : [data];
  const hashes = results.map((r) => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(data).slice(0, 300));
  const until = Date.now() + 300000;
  while (results.some((r) => !r || !r.status || r.status === 'Pending') && Date.now() < until) {
    await sleep(3000);
    const res = await axios.post(`${base}/bloc/v2.2/transactions/results`, JSON.stringify(hashes), { headers: { Authorization: `Bearer ${tokenObj.token}`, 'Content-Type': 'application/json' }, timeout: 60000 });
    results = Array.isArray(res.data) ? res.data : [res.data];
  }
  const r = results[0];
  return { status: r && r.status, msg: (r && r.txResult && r.txResult.message) || '', hash: hashes[0] };
}

function claimAddress() {
  const a = clean(process.env.SNAPSHOT_CLAIM);
  if (!ADDRESS_RE.test(a)) throw new Error('SNAPSHOT_CLAIM must be the contract address (40 hex)');
  process.env.SNAPSHOT_CLAIM = a;
  return a;
}

// The loader account must be the contract's loader, and loading still open.
async function asLoader(claim) {
  const tokenObj = await login();
  const me = await myAddress(tokenObj);
  const c = await readContract(claim);
  if (c.loader !== me) throw new Error(`this account is ${me}; the contract's loader is ${c.loader}`);
  if (c.loadingClosed) throw new Error('loading is already closed');
  return tokenObj;
}

const stripComments = (str) => str.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((ln) => ln.replace(/\/\/.*$/, '')).join('\n');

async function deploy() {
  const { importer, rest } = require('./strato');
  const token = clean(process.env.STRATO_TOKEN);
  const owner = clean(process.env.CLAIM_OWNER);
  const recipient = clean(process.env.UNCLAIMED_RECIPIENT);
  const window = Number(process.env.CLAIM_WINDOW || DEFAULT_WINDOW);
  for (const [k, v] of Object.entries({ STRATO_TOKEN: token, CLAIM_OWNER: owner, UNCLAIMED_RECIPIENT: recipient })) {
    if (!ADDRESS_RE.test(v)) throw new Error(`${k} must be 40 hex`);
  }
  if (!Number.isSafeInteger(window) || window <= 0) throw new Error('CLAIM_WINDOW must be a positive number of seconds');
  // combine returns [file, source] pairs, imports first; import lines come back commented out.
  const files = await importer.combine(path.join(config.resolvePath(config.contractsDir), 'Tokenomics/SnapshotClaim.sol'));
  const source = stripComments(files.map(([, src]) => src).join('\n'));
  if (!/contract\s+SnapshotClaim\b/.test(source)) throw new Error('flattened source has no SnapshotClaim');
  const tokenObj = await login();
  const loader = await myAddress(tokenObj);
  console.log(`source sha256 ${crypto.createHash('sha256').update(source).digest('hex')}`);
  console.log(`deploying: token ${token}, loader ${loader} (this account), unclaimed recipient ${recipient}, window ${window} s, owner ${owner}`);
  const { address } = await rest.createContract(tokenObj, {
    name: 'SnapshotClaim', source,
    args: { _token: token, _loader: loader, _unclaimedRecipient: recipient, _claimWindow: window, initialOwner: owner },
    txParams: { gasLimit: config.gasLimit, gasPrice: config.gasPrice },
  }, { config });
  console.log(`SnapshotClaim deployed at ${clean(address)}. Set SNAPSHOT_CLAIM=${clean(address)} for load, close and verify.`);
}

async function load(m) {
  const claim = claimAddress();
  const tokenObj = await asLoader(claim);
  const amounts = await onChainAllocations(claim, m.rows);
  const pending = m.rows.filter((r, i) => amounts[i] !== r.amount);
  console.log(`${m.rows.length - pending.length} row(s) already on-chain; ${pending.length} to set in ${Math.ceil(pending.length / m.batchSize)} transaction(s)`);
  for (let i = 0; i < pending.length; i += m.batchSize) {
    const batch = pending.slice(i, i + m.batchSize);
    const label = `batch ${i / m.batchSize + 1} (${batch.length} rows, ${batch[0].account}..${batch[batch.length - 1].account})`;
    const r = await sendTx(tokenObj, 'setAllocations', { accounts: batch.map((x) => '0x' + x.account), amounts: batch.map((x) => x.amount) });
    console.log(`${label}: ${r.status}${r.msg ? ' | ' + r.msg : ''}${r.hash ? ` (${r.hash})` : ''}`);
    if (r.status !== 'Success') throw new Error(`${label} failed; nothing in it was set. Fix the cause (a smaller BATCH_SIZE if it ran out of gas) and re-run load.`);
  }
  const result = await compare(claim, m);
  printComparison(m, result);
  if (!result.ok) process.exit(1);
}

async function close(m) {
  const claim = claimAddress();
  const tokenObj = await asLoader(claim);
  const result = await compare(claim, m);
  printComparison(m, result);
  if (!result.ok) throw new Error('not closing: the contract does not match the manifest');
  const r = await sendTx(tokenObj, 'closeLoading', {});
  console.log(`closeLoading: ${r.status}${r.msg ? ' | ' + r.msg : ''}${r.hash ? ` (${r.hash})` : ''}`);
  if (r.status !== 'Success') process.exit(1);
  printSeal(m, await readContract(claim));
}

function printSeal(m, c) {
  const short = m.total > c.balance ? m.total - c.balance : 0n;
  console.log(`\nFor the owner multisig: fund ${claimAddress()} with ${short} wei (${fmtTokens(short)} STRATO) more, then call`);
  console.log(`  seal(${m.total}, ${m.count})    // manifest sha256 ${m.sha256}`);
}

async function verify(m) {
  const claim = claimAddress();
  const result = await compare(claim, m);
  printComparison(m, result);
  const problems = expectedConfigProblems(result.c);
  for (const p of problems) console.log(`  WRONG ${p}`);
  if (!result.ok || problems.length) process.exit(1);
  if (result.c.loadingClosed && result.c.deadline === 0n) printSeal(m, result.c);
  else if (!result.c.loadingClosed) console.log('\nLoading is still open: the loader runs `close` next.');
}

(async () => {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'deploy') return deploy();
  if (!['plan', 'load', 'close', 'verify'].includes(cmd)) {
    console.error('usage: node snapshot-claim.js <plan|load|close|verify> <manifest.csv> | deploy');
    process.exit(2);
  }
  const m = loadManifest(file);
  printManifest(m);
  if (cmd === 'plan') return;
  if (cmd === 'load') return load(m);
  if (cmd === 'close') return close(m);
  return verify(m);
})().catch((e) => { console.error('FAILED:', (e.message || String(e)).slice(0, 400)); process.exit(1); });
