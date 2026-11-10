// Deploy the VestingPoolManager (which deploys its VestingPool in the constructor)
// as GLOBAL_ADMIN_NAME. The script flattens the manager, the pool and their imports
// itself, so there is nothing to generate first; it prints the sha256 of the source
// it submits so every admin can confirm they are creating byte-identical code.
//
// Creation is an AdminRegistry vote: the script calls
// AdminRegistry.castVoteOnIssue(registry, "createContract", [name, source, token_, initialOwner])
// directly (the registry no longer accepts votes routed through a target's onlyOwner
// fallback, which is how the previous bloc "username" wrapper reached it). Run it once
// per admin, or let the second admin confirm the printed issue in the admin UI; the
// script waits for the registry's ContractCreated event and prints the manager and
// pool addresses.
//
//   STRATO_TOKEN=<40 hex> [ADMIN_REGISTRY=<40 hex>] GLOBAL_ADMIN_NAME=... node deploy-vesting-manager.js
//   DRY_RUN=1 node deploy-vesting-manager.js      # only writes vesting-source.txt + hash, no network
//
// Env: NODE_URL, OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, GLOBAL_ADMIN_NAME,
// GLOBAL_ADMIN_PASSWORD (+ OAUTH_TOTP if the account uses it), STRATO_TOKEN (the
// $STRATO Token address, no 0x), ADMIN_REGISTRY (default: the backend's genesis
// address 000000000000000000000000000000000000100c), VOTE_WAIT_MINUTES (default 60).
require('dotenv').config();
const config = require('./config');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { importer } = require('./strato'); // the repo's adapter (blockapps-rest is not a declared dependency)

const NAME = 'VestingPoolManager'; // fixed: it must match the contract declared in the flattened source
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

async function cirrus(tokenObj, table, params) {
  const url = `${config.nodes[0].url}/cirrus/search/${table}`;
  try {
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${tokenObj.token}` }, params });
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; } // table may not exist yet
}

// The creation transaction creates TWO contracts: the pool (inside the manager's
// constructor, so it is listed first) and the manager. Whichever address the receipt
// helper hands back, resolve both through Cirrus: both contracts are `record`s, and
// the pool row names its manager while the manager row names its pool and _owner.
async function resolveManagerAndPool(tokenObj, address) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const asManager = await cirrus(tokenObj, `BlockApps-${NAME}`, { address: `eq.${address}`, select: 'address,pool,_owner', limit: '1' });
    if (asManager.length) return { manager: asManager[0].address, pool: asManager[0].pool, owner: asManager[0]._owner };
    const asPool = await cirrus(tokenObj, 'BlockApps-VestingPool', { address: `eq.${address}`, select: 'address,poolManager', limit: '1' });
    if (asPool.length) {
      const mgr = await cirrus(tokenObj, `BlockApps-${NAME}`, { address: `eq.${asPool[0].poolManager}`, select: 'address,pool,_owner', limit: '1' });
      return { manager: asPool[0].poolManager, pool: asPool[0].address, owner: mgr.length ? mgr[0]._owner : '(manager row not indexed yet)' };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

// The issue id the registry recorded for a vote transaction.
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

// AdminRegistry.createContract emits ContractCreated(contractAddress, contractName) when the
// issue executes; the manager is the only contract created with this name by the registry
// after `since`.
async function waitForCreation(tokenObj, since) {
  const deadline = Date.now() + Number(process.env.VOTE_WAIT_MINUTES || 60) * 60000;
  let tick = 0;
  while (Date.now() < deadline) {
    const rows = await cirrus(tokenObj, 'BlockApps-AdminRegistry-ContractCreated', { contractName: `eq.${NAME}`, block_timestamp: `gte.${since}`, select: 'contractAddress,block_timestamp', order: 'block_timestamp.desc', limit: '1' });
    if (rows.length && rows[0].contractAddress) return clean(rows[0].contractAddress);
    if (tick % 4 === 0) console.log(`  waiting for the create issue to be confirmed by another admin... [${new Date().toISOString()}]`);
    tick++;
    await sleep(15000);
  }
  return null;
}

// Cirrus block_timestamp format is "YYYY-MM-DD HH:MM:SS UTC".
const cirrusTime = (d) => d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

(async () => {
  const source = await buildSource();
  if (process.env.DRY_RUN) { console.log('DRY_RUN set: not deploying.'); return; }

  const STRATO_TOKEN = clean(process.env.STRATO_TOKEN);
  const ADMIN_REGISTRY = clean(process.env.ADMIN_REGISTRY || '000000000000000000000000000000000000100c');
  if (!ADDRESS_RE.test(STRATO_TOKEN)) throw new Error('STRATO_TOKEN must be a 20-byte hex address');
  if (!ADDRESS_RE.test(ADMIN_REGISTRY)) throw new Error('ADMIN_REGISTRY must be a 20-byte hex address');

  const auth = require('./auth');
  const user = process.env.GLOBAL_ADMIN_NAME;
  if (!user) throw new Error('GLOBAL_ADMIN_NAME is not set');
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  const since = cirrusTime(new Date(Date.now() - 60000)); // a minute of slack for clock skew

  // AdminRegistry.createContract(string _contractName, string _contractSrc, variadic _args):
  // the constructor arguments ride in the variadic tail with explicit address hints.
  const payload = {
    contractName: 'AdminRegistry',
    contractAddress: ADMIN_REGISTRY,
    method: 'castVoteOnIssue',
    args: {
      _target: ADMIN_REGISTRY,
      _func: 'createContract',
      _args: [NAME, source, { type: 'address', value: '0x' + STRATO_TOKEN }, { type: 'address', value: '0x' + ADMIN_REGISTRY }],
    },
  };
  const base = config.nodes[0].url.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${tokenObj.token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  console.log(`${user}: voting AdminRegistry(${ADMIN_REGISTRY}).castVoteOnIssue(registry, "createContract", [${NAME}, <source>, token_=${STRATO_TOKEN}, initialOwner=${ADMIN_REGISTRY}]) on ${base}`);
  const { data } = await axios.post(`${base}/strato/v2.3/transaction/parallel?resolve=true`,
    JSON.stringify({ txs: [{ type: 'FUNCTION', payload }], txParams: { gasLimit: 8000000, gasPrice: config.gasPrice } }), { headers, timeout: 180000 });
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
  if (!final || final.status !== 'Success') {
    const reason = (final && final.txResult && final.txResult.message) || JSON.stringify(final).slice(0, 300);
    console.error(`${user} vote FAILED: ${final && final.status} | ${reason} (tx ${hashes[0]})`);
    process.exit(1);
  }
  const issueId = await issueIdForTx(tokenObj, hashes[0]);
  console.log(`${user} vote tx Success (${hashes[0]})${issueId ? `  issue ${issueId}` : ''}`);
  console.log(`If the registry needs more votes, confirm issue ${issueId || '(see the admin UI, target AdminRegistry, function createContract)'} in the admin UI. Waiting up to ${process.env.VOTE_WAIT_MINUTES || 60} minutes for ContractCreated...`);

  const manager = await waitForCreation(tokenObj, since);
  if (!manager) { console.error('TIMEOUT: no ContractCreated for ' + NAME + ' yet; re-run later or check the admin UI.'); process.exit(1); }
  const r = await resolveManagerAndPool(tokenObj, manager);
  if (!r) { console.log(`created ${NAME} at ${manager}; Cirrus rows not visible yet, look up BlockApps-${NAME} for the pool address later.`); return; }
  console.log(`VestingPoolManager: ${r.manager}`);
  console.log(`VestingPool:        ${r.pool}`);
  console.log(`manager owner:      ${r.owner}`);
  if (clean(r.owner).toLowerCase() !== ADMIN_REGISTRY.toLowerCase()) console.error('WARNING: manager owner is not the AdminRegistry you passed');
})().catch((e) => { console.error(process.env.GLOBAL_ADMIN_NAME || 'deploy', 'FAILED:', (e.message || String(e)).slice(0, 300)); process.exit(1); });
