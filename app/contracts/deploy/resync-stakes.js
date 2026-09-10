// Republish every validator's stake weight from StratoStaking to
// MercataGovernance, so governance's validatorStake matches staking's view and
// each one emits ValidatorStakeUpdated.
//
// syncValidator is permissionless (it only requires the operator to exist), so
// this needs no admin vote. It is idempotent: governance drops a no-op update
// without emitting, so re-running it is free.
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

(async () => {
  const user = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };

  for (const operator of VALIDATORS) {
    const resp = await rest.call(tokenObj, {
      contract: { address: STAKING, name: 'StratoStaking' },
      method: 'syncValidator',
      args: { operator: { type: 'address', value: operator } },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    }, { config, isAsync: true, cacheNonce: true });

    const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
    const results = await util.until(
      rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
      opts => rest.getBlocResults(tokenObj, hashes, opts),
      { config, isAsync: true }, 180000);
    const final = Array.isArray(results) ? results[0] : results;
    console.log(`syncValidator(${operator.slice(0, 10)}…): ${final && final.status}` +
      (final && final.status !== 'Success' ? ` | ${JSON.stringify(final).slice(0, 200)}` : ''));
  }
})().catch(e => { console.error('FAILED:', e.message.slice(0, 250)); process.exit(1); });
