// Let the fee router move STRATO while the token is paused.
//
// Token.transferFrom carries whenNotPausedOrOwner: while _paused is true, a caller
// that is not the token owner is only allowed through if the genesis
// AdminRegistry whitelists it for that contract and function. payFees has the
// router transferFrom the fee to the burn address, so without this every
// transaction paying in STRATO is rejected while the token is paused. Whitelist
// before installing the router.
//
//   node whitelist-feerouter.js <router>
//
// Run once per admin (GLOBAL_ADMIN_NAME); identical calls vote on one issue.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

const REGISTRY = '000000000000000000000000000000000000100c';
const STRATO_TOKEN = '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04';
const FEE_ROUTER = (process.argv[2] || '').replace(/^0x/, '');

(async () => {
  if (!/^[0-9a-fA-F]{40}$/.test(FEE_ROUTER)) throw new Error('usage: node whitelist-feerouter.js <router>');
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
        'transferFrom',
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
  console.log(`whitelist transferFrom vote by ${username}: ${final && final.status}`);
  if (!final || final.status !== 'Success') process.exit(1);
})().catch(e => { console.error('FAILED:', e.message.slice(0, 200)); process.exit(1); });
