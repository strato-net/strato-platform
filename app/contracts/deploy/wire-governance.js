// Vote to call setGovernance(0x100, true) on the StratoStaking proxy via the
// AdminRegistry (the proxy's owner). Run once per admin.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');
const REGISTRY = '000000000000000000000000000000000000100c';
const GOVERNANCE = '0000000000000000000000000000000000000100';
const STAKING_PROXY = 'd6726e06c3c71a3bad80b5eb6925707a31729b81';
(async () => {
  const username = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(username, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  console.log('Authenticated as', username);
  const resp = await rest.call(tokenObj, {
    contract: { address: REGISTRY, name: 'AdminRegistry' },
    method: 'castVoteOnIssue',
    args: { _target: STAKING_PROXY, _func: 'setGovernance', _args: [{ type: 'address', value: GOVERNANCE }, true] },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, isAsync: true, cacheNonce: true });
  const arr = Array.isArray(resp) ? resp : [resp];
  const hashes = arr.map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);
  const final = Array.isArray(results) ? results[0] : results;
  console.log('setGovernance vote:', final && final.status);
  if (!final || final.status !== 'Success') process.exit(1);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
