require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');
const STAKING = 'd6726e06c3c71a3bad80b5eb6925707a31729b81';
const VALIDATORS = [
  '0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82',
  'bdd3fe1b9a87a88cff8259528c0a4d6464625713',
  'ebcd85c4212e53a2546cbcea765c1de531b14fb1',
  'f1e4082464ff5c399e43f2c9177904db9547d6a2',
];
async function callAsync(tokenObj, callArgs) {
  const resp = await rest.call(tokenObj, callArgs, { config, isAsync: true, cacheNonce: true });
  const arr = Array.isArray(resp) ? resp : [resp];
  const hashes = arr.map(r => r && r.hash).filter(Boolean);
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);
  const final = Array.isArray(results) ? results[0] : results;
  if (!final || final.status !== 'Success') throw new Error('failed: ' + JSON.stringify(final && final.txResult && final.txResult.message || final).slice(0, 200));
  return final;
}
(async () => {
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  for (const v of VALIDATORS) {
    try {
      await callAsync(tokenObj, { contract: { address: STAKING, name: 'StratoStaking' }, method: 'tryActivate',
        args: { operator: v }, txParams: { gasPrice: 10, gasLimit: 2000000 } });
      console.log('tryActivate', v.slice(0, 10), 'Success');
    } catch (e) { console.log('tryActivate', v.slice(0, 10), 'FAILED:', e.message.slice(0, 120)); }
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
