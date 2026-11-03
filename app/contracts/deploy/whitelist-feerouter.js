// Let the fee router move STRATO while the token is paused.
//
// Token.transferFrom carries whenNotPausedOrOwner: while _paused is true, a caller
// that is not the token owner is only allowed through if the genesis
// AdminRegistry whitelists it for that contract and function. payFees has the
// router transferFrom the fee to the burn address, so without this every
// transaction paying in STRATO is rejected while the token is paused. Whitelist
// before installing the router.
//
//   node whitelist-feerouter.js <network> <router>          (transferFrom)
//   node whitelist-feerouter.js <network> transfer <pool>   (the pool pays STRATO out to swappers)
//
// Network: helium | upquark | forktest (networks.js). Run once per admin
// (GLOBAL_ADMIN_NAME); identical calls vote on one issue.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

const REGISTRY = '000000000000000000000000000000000000100c';
const NETWORKS = require('./networks');
const [network, a1, a2] = process.argv.slice(2);
const STRATO_TOKEN = (NETWORKS[network] || {}).strato;
const [FUNC, CALLEE] = a2 ? [a1, a2] : ['transferFrom', a1];
const callee = (CALLEE || '').replace(/^0x/, '');

(async () => {
  if (!STRATO_TOKEN || !['transferFrom', 'transfer'].includes(FUNC) || !/^[0-9a-fA-F]{40}$/.test(callee)) {
    throw new Error('usage: node whitelist-feerouter.js <network> <router> | <network> transfer <pool>');
  }
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
        FUNC,
        { type: 'address', value: callee },
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
  console.log(`whitelist ${FUNC} vote by ${username}: ${final && final.status}`);
  if (!final || final.status !== 'Success') process.exit(1);
})().catch(e => { console.error('FAILED:', e.message.slice(0, 200)); process.exit(1); });
