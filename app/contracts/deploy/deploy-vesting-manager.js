// Deploy the VestingPoolManager (which deploys its VestingPool in the constructor)
// as GLOBAL_ADMIN_NAME. The script flattens the manager, the pool and their imports
// itself, so there is nothing to generate first; it prints the sha256 of the source
// it submits so every admin can confirm they are creating byte-identical code.
//
// Creation is an AdminRegistry vote whose TARGET is the "BlockApps" User wallet:
//   AdminRegistry.castVoteOnIssue(<BlockApps User wallet>, "createContract", [name, source, token_, initialOwner])
// The registry itself also has a createContract, but the node only indexes a new
// contract into Cirrus when a User wallet is in the call stack at creation time: the
// wallet's username becomes the table namespace, and a contract created with no wallet
// in the stack gets no Cirrus tables at all (solid-vm SM.hs, getUsername/
// addNewCodeCollection). create-vestings.js and the app read BlockApps-VestingPool* and
// BlockApps-VestingPoolManager, so the creator is always the BlockApps wallet; no other
// namespace is supported. The registry owns that wallet, so its vote may call the
// wallet's onlyOwner createContract; the script derives the wallet from the UserRegistry
// and checks both facts before voting. Votes routed through a target's onlyOwner
// fallback are no longer accepted by the registry, so the vote is cast directly.
//
// Run it once per admin, or let the second admin confirm the printed issue in the admin
// UI. The script follows ITS issue: it waits for the issue's IssueExecuted event, reads
// the contracts created by that execution transaction, and reports the manager among
// them from its Cirrus row (which also names the pool and owner). An older or
// concurrent deployment can therefore not be mistaken for this one.
//
//   STRATO_TOKEN=<40 hex> [ADMIN_REGISTRY=<40 hex>] GLOBAL_ADMIN_NAME=... node deploy-vesting-manager.js
//   DRY_RUN=1 node deploy-vesting-manager.js      # only writes vesting-source.txt + hash, no network
//
// Env: NODE_URL, OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, GLOBAL_ADMIN_NAME,
// GLOBAL_ADMIN_PASSWORD (+ OAUTH_TOTP if the account uses it), STRATO_TOKEN (the
// $STRATO Token address, no 0x), ADMIN_REGISTRY (default: the backend's genesis
// address 000000000000000000000000000000000000100c), USER_REGISTRY (default: genesis
// 0x720), VOTE_WAIT_MINUTES (default 60).
require('dotenv').config();
const config = require('./config');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { importer } = require('./strato'); // the repo's adapter (blockapps-rest is not a declared dependency)

const NAME = 'VestingPoolManager'; // fixed: it must match the contract declared in the flattened source
const NAMESPACE = 'BlockApps'; // fixed: the only Cirrus namespace the vesting tooling reads
const ARTIFACT = process.env.VESTING_SOURCE_OUT || 'vesting-source.txt';
const ADDRESS_RE = /^[0-9a-fA-F]{40}$/;
const clean = (v) => (v || '').trim().replace(/^0x/, '');

// Same flattening as gen-source.js / gen-feerouter-source.js: combine imports, strip
// comments except SPDX lines (VestingPool.sol is LGPL-3.0-only; the notice must stay).
const stripComments = (str) => {
  let out = str.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.split('\n').map((ln) => {
    const t = ln.trim();
    if (t.startsWith('//')) return t.includes('SPDX-License-Identifier') ? ln : '';
    return ln.replace(/\/\/.*$/, '');
  }).join('\n');
  return out;
};

async function buildSource() {
  const fp = path.join(config.resolvePath(config.contractsDir), 'Tokenomics/VestingPoolManager.sol');
  let source = await importer.combine(fp);
  if (Buffer.isBuffer(source)) source = stripComments(source.toString());
  else if (typeof source === 'object') {
    source = Object.keys(source).map((k) => {
      let c = source[k]; c = typeof c === 'string' ? c : String(c);
      c = c.replace(/^.*?\.sol,\s*/i, ''); return stripComments(c);
    }).join('\n');
  } else source = stripComments(String(source));
  const contracts = [...source.matchAll(/^\s*(?:abstract\s+)?contract\s+(?:record\s+)?([A-Za-z0-9_]+)/gm)].map(m => m[1]);
  for (const must of ['VestingPool', 'VestingPoolManager', 'Ownable', 'AdminRegistry']) {
    if (!contracts.includes(must)) throw new Error(`flattened source is missing contract ${must}`);
  }
  fs.writeFileSync(ARTIFACT, source);
  const sha = crypto.createHash('sha256').update(source).digest('hex');
  console.log(`source: ${source.length} bytes, sha256 ${sha}, contracts: ${contracts.join(', ')} (written to ${ARTIFACT})`);
  return source;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = () => config.nodes[0].url.replace(/\/$/, '');

async function cirrus(tokenObj, table, params) {
  const url = `${base()}/cirrus/search/${table}`;
  try {
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${tokenObj.token}` }, params });
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; } // table may not exist yet
}

// Read-only calls through the node's JSON-RPC (same as create-vestings.js). Selectors are
// keccak256 of the signatures; SolidVM answers eth_call with ABI-encoded words.
const SEL = { deriveUserAddress: 'd36a884a', username: '61fac54d', owner: '8da5cb5b' };
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const encodeString = (s) => { // ABI: offset, length, utf8 bytes right-padded to 32
  const hex = Buffer.from(s, 'utf8').toString('hex');
  return word(32) + word(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
};
const decodeString = (hex) => { // ABI: offset word, length word, bytes
  const off = Number(BigInt('0x' + hex.slice(0, 64))) * 2;
  const len = Number(BigInt('0x' + hex.slice(off, off + 64))) * 2;
  return Buffer.from(hex.slice(off + 64, off + 64 + len), 'hex').toString('utf8');
};
async function ethCall(to, data, what) {
  const { data: res } = await axios.post(`${base()}/rpc`,
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0x' + to, data: '0x' + data }, 'latest'] },
    { headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (deploy-vesting-manager)' }, timeout: 30000 });
  if (!res || typeof res.result !== 'string' || !/^0x([0-9a-fA-F]{64})+$/.test(res.result)) throw new Error(`${what}: eth_call to ${to} failed: ${JSON.stringify(res).slice(0, 200)}`);
  return clean(res.result);
}
const addressFromWord = (w) => w.slice(24, 64);

// The BlockApps User wallet, whose username namespaces the Cirrus tables. UserRegistry
// derives wallet addresses from the username (the same derivation bloc uses), so nothing
// is hard-coded per chain; the wallet is then checked to carry that username and to be
// owned by the registry, otherwise the registry's createContract call on it would revert
// as unauthorized.
async function resolveCreatorWallet(userRegistry, adminRegistry) {
  const wallet = addressFromWord(await ethCall(userRegistry, SEL.deriveUserAddress + encodeString(NAMESPACE), `UserRegistry.deriveUserAddress("${NAMESPACE}")`));
  if (!/^[0-9a-f]{40}$/.test(wallet) || /^0+$/.test(wallet)) throw new Error(`UserRegistry ${userRegistry} derived no wallet for "${NAMESPACE}"`);
  const name = decodeString(await ethCall(wallet, SEL.username, 'wallet.username()'));
  if (name !== NAMESPACE) throw new Error(`wallet ${wallet} has username "${name}", expected "${NAMESPACE}"`);
  const owner = addressFromWord(await ethCall(wallet, SEL.owner, 'wallet.owner()'));
  if (owner.toLowerCase() !== adminRegistry.toLowerCase()) throw new Error(`wallet ${wallet} ("${NAMESPACE}") is owned by ${owner}, not the AdminRegistry ${adminRegistry}; the registry cannot call its createContract`);
  return wallet;
}

// The issue id the registry recorded for a vote transaction, with the vote's block number.
async function issueForTx(tokenObj, hash) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    for (const ev of ['IssueCreated', 'IssueVoted']) {
      const rows = await cirrus(tokenObj, `BlockApps-AdminRegistry-${ev}`, { transaction_hash: `eq.${hash}`, select: 'issueId,block_number', limit: '1' });
      if (rows.length && rows[0].issueId) return { issueId: rows[0].issueId, block: Number(rows[0].block_number) };
    }
    await sleep(3000);
  }
  return null;
}

// The transaction that executed THIS issue: an IssueExecuted event for the issue id, no
// earlier than the vote itself (issue ids repeat for identical target/func/args, so an
// execution of an identical earlier deployment is skipped by block number).
async function waitForExecution(tokenObj, issueId, notBefore) {
  const deadline = Date.now() + Number(process.env.VOTE_WAIT_MINUTES || 60) * 60000;
  let tick = 0;
  while (Date.now() < deadline) {
    const rows = await cirrus(tokenObj, 'BlockApps-AdminRegistry-IssueExecuted', { issueId: `eq.${issueId}`, select: 'transaction_hash,block_number', order: 'block_timestamp.desc', limit: '5' });
    const hit = rows.find((r) => Number(r.block_number) >= notBefore && r.transaction_hash);
    if (hit) return clean(hit.transaction_hash);
    if (tick % 4 === 0) console.log(`  waiting for issue ${issueId} to be confirmed by another admin... [${new Date().toISOString()}]`);
    tick++;
    await sleep(15000);
  }
  return null;
}

// The contracts created by a transaction, from the node's public transaction result
// (the pool is created inside the manager's constructor, so both are listed).
async function createdContracts(hash) {
  const { data } = await axios.get(`${base()}/strato-api/eth/v1.2/transactionResult/${hash}`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (deploy-vesting-manager)' }, timeout: 30000 });
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) throw new Error(`no transaction result for ${hash}`);
  const created = [r.contractsCreated].flat().filter(Boolean).map(clean);
  return { status: r.status, message: r.message, created };
}

// The manager among the created contracts, from its Cirrus row (proof it is indexed
// under the BlockApps namespace); the row names the pool and the owner.
async function managerRowAmong(tokenObj, addresses) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const rows = await cirrus(tokenObj, `${NAMESPACE}-${NAME}`, { address: `in.(${addresses.join(',')})`, select: 'address,pool,_owner', limit: '2' });
    if (rows.length) return rows[0];
    await sleep(5000);
  }
  return null;
}

(async () => {
  const source = await buildSource();
  if (process.env.DRY_RUN) { console.log('DRY_RUN set: not deploying.'); return; }

  const STRATO_TOKEN = clean(process.env.STRATO_TOKEN);
  const ADMIN_REGISTRY = clean(process.env.ADMIN_REGISTRY || '000000000000000000000000000000000000100c');
  const USER_REGISTRY = clean(process.env.USER_REGISTRY || '0000000000000000000000000000000000000720');
  if (!ADDRESS_RE.test(STRATO_TOKEN)) throw new Error('STRATO_TOKEN must be a 20-byte hex address');
  if (!ADDRESS_RE.test(ADMIN_REGISTRY)) throw new Error('ADMIN_REGISTRY must be a 20-byte hex address');
  if (!ADDRESS_RE.test(USER_REGISTRY)) throw new Error('USER_REGISTRY must be a 20-byte hex address');

  const auth = require('./auth');
  const user = process.env.GLOBAL_ADMIN_NAME;
  if (!user) throw new Error('GLOBAL_ADMIN_NAME is not set');
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };

  const WALLET = await resolveCreatorWallet(USER_REGISTRY, ADMIN_REGISTRY);
  console.log(`creator: User wallet ${WALLET} ("${NAMESPACE}", owned by AdminRegistry ${ADMIN_REGISTRY}); tables will be ${NAMESPACE}-${NAME} and ${NAMESPACE}-VestingPool`);

  // User.createContract(string contractName, string contractSrc, variadic args): the
  // constructor arguments ride in the variadic tail with explicit address hints.
  const payload = {
    contractName: 'AdminRegistry',
    contractAddress: ADMIN_REGISTRY,
    method: 'castVoteOnIssue',
    args: {
      _target: WALLET,
      _func: 'createContract',
      _args: [NAME, source, { type: 'address', value: '0x' + STRATO_TOKEN }, { type: 'address', value: '0x' + ADMIN_REGISTRY }],
    },
  };
  const headers = { Authorization: `Bearer ${tokenObj.token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  console.log(`${user}: voting AdminRegistry(${ADMIN_REGISTRY}).castVoteOnIssue(wallet ${WALLET}, "createContract", [${NAME}, <source>, token_=${STRATO_TOKEN}, initialOwner=${ADMIN_REGISTRY}]) on ${base()}`);
  const { data } = await axios.post(`${base()}/strato/v2.3/transaction/parallel?resolve=true`,
    JSON.stringify({ txs: [{ type: 'FUNCTION', payload }], txParams: { gasLimit: 8000000, gasPrice: config.gasPrice } }), { headers, timeout: 180000 });
  let results = Array.isArray(data) ? data : [data];
  const hashes = results.map((r) => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(data).slice(0, 300));
  const deadline = Date.now() + 300000;
  while (results.some((r) => !r || !r.status || r.status === 'Pending') && Date.now() < deadline) {
    await sleep(3000);
    const res = await axios.post(`${base()}/bloc/v2.2/transactions/results`, JSON.stringify(hashes), { headers, timeout: 60000 });
    results = Array.isArray(res.data) ? res.data : [res.data];
  }
  const final = results[0];
  if (!final || final.status !== 'Success') {
    const reason = (final && final.txResult && final.txResult.message) || JSON.stringify(final).slice(0, 300);
    console.error(`${user} vote FAILED: ${final && final.status} | ${reason} (tx ${hashes[0]})`);
    process.exit(1);
  }
  const issue = await issueForTx(tokenObj, hashes[0]);
  if (!issue) { console.error(`${user} vote tx Success (${hashes[0]}) but its issue id is not in Cirrus yet; re-run later or check the admin UI (target ${WALLET}, function createContract).`); process.exit(1); }
  console.log(`${user} vote tx Success (${hashes[0]})  issue ${issue.issueId}`);
  console.log(`If the registry needs more votes, confirm issue ${issue.issueId} in the admin UI. Waiting up to ${process.env.VOTE_WAIT_MINUTES || 60} minutes for it to execute...`);

  const execTx = await waitForExecution(tokenObj, issue.issueId, issue.block);
  if (!execTx) { console.error(`TIMEOUT: issue ${issue.issueId} has not executed yet; re-run later or check the admin UI.`); process.exit(1); }
  const exec = await createdContracts(execTx);
  if (!exec.created.length) {
    console.error(`issue ${issue.issueId} executed in tx ${execTx} but created no contract (${exec.status}: ${exec.message}); the wallet's createContract failed, see the transaction.`);
    process.exit(1);
  }
  const row = await managerRowAmong(tokenObj, exec.created);
  if (!row) { console.error(`tx ${execTx} created ${exec.created.join(', ')} but none has a ${NAMESPACE}-${NAME} row: not indexed under the ${NAMESPACE} namespace.`); process.exit(1); }
  console.log(`execution tx:       ${execTx}`);
  console.log(`VestingPoolManager: ${clean(row.address)}`);
  console.log(`VestingPool:        ${clean(row.pool) || '(pool column empty: look up BlockApps-VestingPool by poolManager)'}`);
  console.log(`manager owner:      ${clean(row._owner)}`);
  if (clean(row._owner).toLowerCase() !== ADMIN_REGISTRY.toLowerCase()) console.error('WARNING: manager owner is not the AdminRegistry you passed');
})().catch((e) => { console.error(process.env.GLOBAL_ADMIN_NAME || 'deploy', 'FAILED:', (e.message || String(e)).slice(0, 300)); process.exit(1); });
