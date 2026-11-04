// Let the VestingPool pay claims while the STRATO token is paused.
//
// Token.transfer carries whenNotPausedOrOwner: while _paused is true, a caller that
// is not the token owner is only allowed through if the AdminRegistry whitelists it
// for that contract and function. VestingPool.claimVestedTokens calls Token.transfer
// with the pool as msg.sender, so without this entry every claim reverts with
// "not whitelisted" (same situation as the fee router, see whitelist-feerouter.js).
//
// Run once per admin (GLOBAL_ADMIN_NAME) with the same values; identical calls vote
// on one issue. The second admin can equally confirm the issue in the admin UI.
//
//   STRATO_TOKEN=<40 hex> VESTING_POOL=<40 hex> [ADMIN_REGISTRY=<40 hex>] node whitelist-vesting-pool.js
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

const ADDRESS_RE = /^[0-9a-fA-F]{40}$/;
const clean = (v) => String(v || '').trim().replace(/^0x/, '');
const REGISTRY = clean(process.env.ADMIN_REGISTRY || '000000000000000000000000000000000000100c');
const STRATO_TOKEN = clean(process.env.STRATO_TOKEN);
const VESTING_POOL = clean(process.env.VESTING_POOL);
for (const [k, v] of [['ADMIN_REGISTRY', REGISTRY], ['STRATO_TOKEN', STRATO_TOKEN], ['VESTING_POOL', VESTING_POOL]]) {
  if (!ADDRESS_RE.test(v)) { console.error(`${k} must be a 20-byte hex address`); process.exit(2); }
}

(async () => {
  const username = process.env.GLOBAL_ADMIN_NAME;
  if (!username) throw new Error('GLOBAL_ADMIN_NAME is not set');
  const token = await auth.getUserToken(username, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };

  console.log(`${username}: voting AdminRegistry.addWhitelist(token=${STRATO_TOKEN}, "transfer", pool=${VESTING_POOL})`);
  const resp = await rest.call(tokenObj, {
    contract: { address: REGISTRY, name: 'AdminRegistry' },
    method: 'castVoteOnIssue',
    args: {
      _target: REGISTRY,
      _func: 'addWhitelist',
      _args: [
        { type: 'address', value: STRATO_TOKEN },
        'transfer',
        { type: 'address', value: VESTING_POOL },
      ],
    },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, isAsync: true, cacheNonce: true });

  const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);
  const final = Array.isArray(results) ? results[0] : results;
  console.log(`whitelist transfer vote by ${username}: ${final && final.status}. Check: Cirrus BlockApps-AdminRegistry-whitelist with key=${STRATO_TOKEN}, key2=transfer, key3=${VESTING_POOL}.`);
  if (!final || final.status !== 'Success') process.exit(1);
})().catch(e => { console.error('FAILED:', (e.message || String(e)).slice(0, 200)); process.exit(1); });
