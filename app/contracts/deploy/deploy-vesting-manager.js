// Deploy the VestingPoolManager (which deploys its VestingPool in the constructor)
// from vesting-source.txt as GLOBAL_ADMIN_NAME. On helium and mainnet, contract
// creation is itself an AdminRegistry issue, so run this once per admin with the
// identical source and arguments until quorum; every run reports the same address.
//
//   node gen-vesting-source.js
//   STRATO_TOKEN=<40 hex> [ADMIN_REGISTRY=<40 hex>] GLOBAL_ADMIN_NAME=... node deploy-vesting-manager.js
//
// Env: NODE_URL, OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, GLOBAL_ADMIN_NAME,
// GLOBAL_ADMIN_PASSWORD (+ OAUTH_TOTP if the account uses it), STRATO_TOKEN (the
// $STRATO Token address, no 0x), ADMIN_REGISTRY (default: the backend's genesis
// address 000000000000000000000000000000000000100c), VESTING_MANAGER_NAME (optional).
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const fs = require('fs');
const axios = require('axios');
const { rest, util } = require('blockapps-rest');
const { getCreatedAddress, getIssueId, pollForCreateIssueExecution } = require('./util');

const NAME = process.env.VESTING_MANAGER_NAME || 'VestingPoolManager';
const SOURCE_FILE = process.env.VESTING_SOURCE || 'vesting-source.txt';
const ADDRESS_RE = /^[0-9a-fA-F]{40}$/;
const clean = (v) => (v || '').trim().replace(/^0x/, '');

const STRATO_TOKEN = clean(process.env.STRATO_TOKEN);
const ADMIN_REGISTRY = clean(process.env.ADMIN_REGISTRY || '000000000000000000000000000000000000100c');
if (!ADDRESS_RE.test(STRATO_TOKEN)) { console.error('FAILED: STRATO_TOKEN must be a 20-byte hex address'); process.exit(1); }
if (!ADDRESS_RE.test(ADMIN_REGISTRY)) { console.error('FAILED: ADMIN_REGISTRY must be a 20-byte hex address'); process.exit(1); }

async function readManagerRow(tokenObj, address) {
  // The manager is a `record` contract: Cirrus exposes its state (pool, owner) per address.
  const url = `${config.nodes[0].url}/cirrus/search/BlockApps-${NAME}`;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${tokenObj.token}` },
        params: { address: `eq.${address}`, select: 'address,pool,owner', limit: '1' },
      });
      if (Array.isArray(data) && data.length) return data[0];
    } catch (e) { /* table may not exist yet */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

(async () => {
  const source = fs.readFileSync(SOURCE_FILE, 'utf8');
  const user = process.env.GLOBAL_ADMIN_NAME;
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
  console.log(`${user} create: ${final && final.status} | ${NAME}: ${addr || '(awaiting another admin\'s vote)'}`);
  if (!addr) return;

  const row = await readManagerRow(tokenObj, addr);
  if (row) {
    console.log(`manager ${row.address}: pool=${row.pool} owner=${row.owner}`);
    if (clean(row.owner).toLowerCase() !== ADMIN_REGISTRY.toLowerCase()) console.error('WARNING: owner is not the AdminRegistry you passed');
  } else {
    console.log(`Cirrus row for BlockApps-${NAME} not visible yet; query it later for the pool address.`);
  }
})().catch(e => { console.error(process.env.GLOBAL_ADMIN_NAME, 'FAILED:', (e.message || String(e)).slice(0, 300)); process.exit(1); });
