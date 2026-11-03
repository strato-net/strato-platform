// Deploy the VestingPoolManager (which deploys its VestingPool in the constructor)
// as GLOBAL_ADMIN_NAME. The script flattens the manager, the pool and their imports
// itself, so there is nothing to generate first; it prints the sha256 of the source
// it submits so every admin can confirm they are creating byte-identical code.
//
// On helium and mainnet, contract creation is itself an AdminRegistry issue, so run
// this once per admin until quorum; every run reports the same address.
//
//   STRATO_TOKEN=<40 hex> [ADMIN_REGISTRY=<40 hex>] GLOBAL_ADMIN_NAME=... node deploy-vesting-manager.js
//   DRY_RUN=1 node deploy-vesting-manager.js      # only writes vesting-source.txt + hash, no network
//
// Env: NODE_URL, OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, GLOBAL_ADMIN_NAME,
// GLOBAL_ADMIN_PASSWORD (+ OAUTH_TOTP if the account uses it), STRATO_TOKEN (the
// $STRATO Token address, no 0x), ADMIN_REGISTRY (default: the backend's genesis
// address 000000000000000000000000000000000000100c), VESTING_MANAGER_NAME (optional).
require('dotenv').config();
const config = require('./config');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { rest, util, importer } = require('blockapps-rest');

const NAME = process.env.VESTING_MANAGER_NAME || 'VestingPoolManager';
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

(async () => {
  const source = await buildSource();
  if (process.env.DRY_RUN) { console.log('DRY_RUN set: not deploying.'); return; }

  const STRATO_TOKEN = clean(process.env.STRATO_TOKEN);
  const ADMIN_REGISTRY = clean(process.env.ADMIN_REGISTRY || '000000000000000000000000000000000000100c');
  if (!ADDRESS_RE.test(STRATO_TOKEN)) throw new Error('STRATO_TOKEN must be a 20-byte hex address');
  if (!ADDRESS_RE.test(ADMIN_REGISTRY)) throw new Error('ADMIN_REGISTRY must be a 20-byte hex address');

  const auth = require('./auth');
  const { getCreatedAddress, getIssueId, pollForCreateIssueExecution } = require('./util');
  const user = process.env.GLOBAL_ADMIN_NAME;
  if (!user) throw new Error('GLOBAL_ADMIN_NAME is not set');
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  const submittedAt = new Date().toISOString();

  console.log(`${user}: creating ${NAME}(token_=${STRATO_TOKEN}, initialOwner=${ADMIN_REGISTRY}) on ${config.nodes[0].url}`);
  const resp = await rest.createContract(tokenObj, {
    name: NAME,
    source,
    args: { token_: STRATO_TOKEN, initialOwner: ADMIN_REGISTRY },
    txParams: { gasPrice: config.gasPrice, gasLimit: 8000000 },
  }, { config, isAsync: true, cacheNonce: true, query: { username: 'BlockApps' } });

  const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));

  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 300000);
  const final = Array.isArray(results) ? results[0] : results;

  let addr = getCreatedAddress(final);
  if (!addr) {
    const issueId = getIssueId(final);
    if (issueId) addr = await pollForCreateIssueExecution(tokenObj, issueId, final, submittedAt, `${NAME} address`);
  }
  console.log(`${user} create: ${final && final.status} | created contract from receipt: ${addr || '(awaiting another admin\'s vote)'}`);
  if (!addr) return;

  const r = await resolveManagerAndPool(tokenObj, addr);
  if (!r) { console.log(`Cirrus rows not visible yet; look up BlockApps-VestingPool (poolManager column) for ${addr} later.`); return; }
  console.log(`VestingPoolManager: ${r.manager}`);
  console.log(`VestingPool:        ${r.pool}`);
  console.log(`manager owner:      ${r.owner}`);
  if (clean(r.owner).toLowerCase() !== ADMIN_REGISTRY.toLowerCase()) console.error('WARNING: manager owner is not the AdminRegistry you passed');
})().catch(e => { console.error(process.env.GLOBAL_ADMIN_NAME || 'deploy', 'FAILED:', (e.message || String(e)).slice(0, 300)); process.exit(1); });
