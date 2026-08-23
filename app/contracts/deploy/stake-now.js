// Direct calls as GLOBAL_ADMIN_NAME: approve then stakeBatch (10k STRATO x 4 validators).
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');
const STAKING = 'd6726e06c3c71a3bad80b5eb6925707a31729b81';
const TOKEN = '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04';
const VALIDATORS = [
  '0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82',
  'bdd3fe1b9a87a88cff8259528c0a4d6464625713',
  'ebcd85c4212e53a2546cbcea765c1de531b14fb1',
  'f1e4082464ff5c399e43f2c9177904db9547d6a2',
];
const TEN_K = '10000000000000000000000';
const FORTY_K = '40000000000000000000000';
async function callAsync(tokenObj, callArgs) {
  const resp = await rest.call(tokenObj, callArgs, { config, isAsync: true, cacheNonce: true });
  const arr = Array.isArray(resp) ? resp : [resp];
  const hashes = arr.map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash');
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);
  const final = Array.isArray(results) ? results[0] : results;
  if (!final || final.status !== 'Success') throw new Error('failed: ' + JSON.stringify(final).slice(0, 400));
  return final;
}
(async () => {
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  await callAsync(tokenObj, { contract: { address: TOKEN, name: 'Token' }, method: 'approve',
    args: { spender: STAKING, value: FORTY_K }, txParams: { gasPrice: 10, gasLimit: 1000000 } });
  console.log('approve: Success');
  await callAsync(tokenObj, { contract: { address: STAKING, name: 'StratoStaking' }, method: 'stakeBatch',
    args: { stakeOperators: VALIDATORS, amounts: [TEN_K, TEN_K, TEN_K, TEN_K] }, txParams: { gasPrice: 10, gasLimit: 5000000 } });
  console.log('stakeBatch: Success');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
