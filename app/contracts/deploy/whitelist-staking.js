// Whitelist the StratoStaking proxy in the genesis AdminRegistry (0x100c)
// for voteToAddValidator / voteToRemoveValidator on governance (0x100).
// Run once per admin (GLOBAL_ADMIN_NAME env); identical calls = votes on
// the same issue; executes at quorum.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest } = require('blockapps-rest');

const REGISTRY = '000000000000000000000000000000000000100c';
const GOVERNANCE = '0000000000000000000000000000000000000100';
const STAKING_PROXY = 'd6726e06c3c71a3bad80b5eb6925707a31729b81';

async function callAsync(tokenObj, callArgs) {
  const resp = await rest.call(tokenObj, callArgs, { config, isAsync: true, cacheNonce: true });
  const arr = Array.isArray(resp) ? resp : [resp];
  const hashes = arr.map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const { util } = require('blockapps-rest');
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 60000);
  const final = Array.isArray(results) ? results[0] : results;
  if (!final || final.status !== 'Success') throw new Error('call failed: ' + JSON.stringify(final));
  return final;
}

(async () => {
  const username = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(username, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  console.log('Authenticated as', username);
  for (const func of ['voteToAddValidator', 'voteToRemoveValidator']) {
    const callArgs = {
      contract: { address: REGISTRY, name: 'AdminRegistry' },
      method: 'castVoteOnIssue',
      args: {
        _target: REGISTRY,
        _func: 'addWhitelist',
        _args: [{ type: 'address', value: GOVERNANCE }, func, { type: 'address', value: STAKING_PROXY }],
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    };
    const final = await callAsync(tokenObj, callArgs);
    console.log(`whitelist vote (${func}): ${final.status}`);
  }
  console.log('DONE');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
