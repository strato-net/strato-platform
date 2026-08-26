// Staking activation steps, each a registry vote (run once per admin):
//   node staking-setup.js <init|setvreg|params|setparams|operators|mint>
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

const REGISTRY = '000000000000000000000000000000000000100c';
const GOVERNANCE = '0000000000000000000000000000000000000100';
const STAKING = 'd6726e06c3c71a3bad80b5eb6925707a31729b81';
const VREG = 'bfbb75bb6bd0bafa2f5c5b735fe518ade76808dd';
const TOKEN = '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04';
const USDST = '937efa7e3a77e20bbdbd7c0d32b6514f368c1010';
const FUNDER = '7b1f8cd02cd09ab9510e30fc8e15ff898a639771'; // blockapps_test_1
const FEE_ROUTER = '44769a27b4339f1dbdab8920be9b5689b6652178'; // HeliumFeeRouter (payFees + payBlockRewards)
const VALIDATORS = [
  '0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82',
  'bdd3fe1b9a87a88cff8259528c0a4d6464625713',
  'ebcd85c4212e53a2546cbcea765c1de531b14fb1',
  'f1e4082464ff5c399e43f2c9177904db9547d6a2',
];
const TEN_K = '10000000000000000000000';       // 10,000 * 1e18
const FORTY_K = '40000000000000000000000';

const STEPS = {
  init:      { target: STAKING, func: 'initialize',
               args: [TOKEN, USDST, 86400, 500, 2000, 50] },
  // This deployment was initialized before USDST joined the fee path, so initialize()
  // can no longer reach it; setUsdstToken is the in-place route.
  usdst:     { target: STAKING, func: 'setUsdstToken',
               args: [{ type: 'address', value: USDST }] },
  // Authorises the staking contract to call governance's onlyStaking functions.
  // Must land immediately after the governance logic upgrade: until it does,
  // every _activate / _syncValidator reverts.
  govstaking: { target: GOVERNANCE, func: 'setStakingContract',
                args: [{ type: 'address', value: STAKING }] },
  setvreg:   { target: STAKING, func: 'setValidatorRegistry', args: [VREG] },
  params:    { target: STAKING, func: 'setValidatorParams',
               args: [TEN_K, 0, 1000, 100, 3600] },
  setparams: { target: STAKING, func: 'setSetParams',
               args: ['50', '50', '500', '4', '86400', '86400', '10000', false] },
  operators: { target: VREG, func: 'addOperators',
               args: [VALIDATORS, [0,0,0,0],
                      ['node1-validator','node2-validator','node3-validator','node4-validator'],
                      ['genesis validator','genesis validator','genesis validator','genesis validator'],
                      ['','','',''], ['','','',''], VALIDATORS] },
  mint:      { target: TOKEN, func: 'mint', args: [FUNDER, FORTY_K] },
  // Fund the fee router so it can pay the flat per-block reward. It pays 0.01
  // STRATO per block (~230/day at the current rate) and silently pays nothing
  // once it runs dry, so top this up rather than letting it empty.
  fundrouter: { target: TOKEN, func: 'mint',
                args: [{ type: 'address', value: FEE_ROUTER }, '10000000000000000000000'] },
};

async function callAsync(tokenObj, callArgs) {
  const resp = await rest.call(tokenObj, callArgs, { config, isAsync: true, cacheNonce: true });
  const arr = Array.isArray(resp) ? resp : [resp];
  const hashes = arr.map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);
  const final = Array.isArray(results) ? results[0] : results;
  if (!final || final.status !== 'Success') throw new Error('call failed: ' + JSON.stringify(final).slice(0, 300));
  return final;
}

(async () => {
  const step = STEPS[process.argv[2]];
  if (!step) throw new Error('unknown step: ' + process.argv[2]);
  const username = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(username, process.env.GLOBAL_ADMIN_PASSWORD);
  const final = await callAsync({ token }, {
    contract: { address: REGISTRY, name: 'AdminRegistry' },
    method: 'castVoteOnIssue',
    args: { _target: step.target, _func: step.func, _args: step.args },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  });
  console.log(`${process.argv[2]} vote by ${username}: ${final.status}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
