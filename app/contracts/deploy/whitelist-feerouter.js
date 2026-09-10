// Let the fee router move STRATO while the token is paused.
//
// Token.transfer carries whenNotPausedOrOwner: while _paused is true, a caller
// that is not the token owner is only allowed through if the genesis
// AdminRegistry whitelists it for that contract and function. Without this the
// router's block-reward transfer reverts, gets swallowed by payBlockRewards'
// catch, and every block silently pays nothing.
//
// Run once per admin (GLOBAL_ADMIN_NAME); identical calls vote on one issue.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

const REGISTRY = '000000000000000000000000000000000000100c';
const STRATO_TOKEN = '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04';
const FEE_ROUTER = '44769a27b4339f1dbdab8920be9b5689b6652178';

(async () => {
  const username = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(username, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };

  const resp = await rest.call(tokenObj, {
    contract: { address: REGISTRY, name: 'AdminRegistry' },
    method: 'castVoteOnIssue',
    args: {
      _target: REGISTRY,
      _func: 'addWhitelist',
      _args: [
        { type: 'address', value: STRATO_TOKEN },
        'transfer',
        { type: 'address', value: FEE_ROUTER },
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
  console.log(`whitelist transfer vote by ${username}: ${final && final.status}`);
  if (!final || final.status !== 'Success') process.exit(1);
})().catch(e => { console.error('FAILED:', e.message.slice(0, 200)); process.exit(1); });
