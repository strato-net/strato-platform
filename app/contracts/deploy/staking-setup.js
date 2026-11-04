// Staking setup steps, each a registry vote (run once per admin) unless marked direct:
//   node staking-setup.js <init|usdst|govstaking|setvreg|setparams|validators|mint>
//   node staking-setup.js joinsfrom <block>                 admission opens at this block (movable until it passes)
//   node staking-setup.js commit <e0Wei> <s0Wei> <r0Wei> <startUnix>   commit the emission schedule, once
//   node staking-setup.js fundreserve <amountWei>           (direct) fund the emission reserve
//   node staking-setup.js index                            (direct) index helium's existing set
//   node staking-setup.js reconcile                        (direct) lower an unbacked reserve after the swap
//   node staking-setup.js announceremoval <validator> <grounds...>   start a removal: published grounds, a week's notice
//   node staking-setup.js removevalidator <validator>      execute an announced removal after its notice
//   node staking-setup.js emergencyremove <validator> <grounds...>   remove one validator at once, with grounds
//   node staking-setup.js removeformisses <validator>      (direct) remove a validator at the liveness miss limit
//   node staking-setup.js qualify <user> <validator>       (direct) let a position that waited its week start earning
// Addresses default to helium; set STAKING_PROXY, VALIDATOR_REGISTRY_PROXY and STRATO_TOKEN
// for another network.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

const hex40 = (v) => String(v || '').replace(/^0x/, '');
const isHex40 = (v) => /^[0-9a-fA-F]{40}$/.test(hex40(v));
const REGISTRY = '000000000000000000000000000000000000100c';
const GOVERNANCE = '0000000000000000000000000000000000000100';
const STAKING = hex40(process.env.STAKING_PROXY || 'd6726e06c3c71a3bad80b5eb6925707a31729b81');
const VREG = hex40(process.env.VALIDATOR_REGISTRY_PROXY || 'bfbb75bb6bd0bafa2f5c5b735fe518ade76808dd');
const TOKEN = hex40(process.env.STRATO_TOKEN || '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04');
const USDST = '937efa7e3a77e20bbdbd7c0d32b6514f368c1010';
const FUNDER = '7b1f8cd02cd09ab9510e30fc8e15ff898a639771'; // blockapps_test_1
const VALIDATORS = [
  '0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82',
  'bdd3fe1b9a87a88cff8259528c0a4d6464625713',
  'ebcd85c4212e53a2546cbcea765c1de531b14fb1',
  'f1e4082464ff5c399e43f2c9177904db9547d6a2',
];
const FORTY_K = '40000000000000000000000';

const removal = (func, [validator, ...grounds], withGrounds) => {
  if (!isHex40(validator) || (withGrounds && !grounds.join(' ').trim())) {
    throw new Error(`usage: ${func} <validator>${withGrounds ? ' <grounds...>' : ''}`);
  }
  const args = [{ type: 'address', value: hex40(validator) }];
  if (withGrounds) args.push(grounds.join(' ').trim());
  return { target: VREG, func, args };
};

const STEPS = {
  // Fresh deployments only; helium's proxy was initialized long ago. 20% commission ceiling,
  // batches of 50. The self-bond minimum, the notices and the readiness rules are constants.
  init:      { target: STAKING, func: 'initialize',
               args: [TOKEN, USDST, 2000, 50] },
  // This deployment was initialized before USDST joined the income path, so initialize()
  // can no longer reach it; setUsdstToken is the in-place route.
  usdst:     { target: STAKING, func: 'setUsdstToken',
               args: [{ type: 'address', value: USDST }] },
  // Authorises the staking contract to call governance's onlyStaking functions.
  // Must land immediately after the governance logic upgrade: until it does,
  // every _activate / _syncValidator reverts.
  govstaking: { target: GOVERNANCE, func: 'setStakingContract',
                args: [{ type: 'address', value: STAKING }] },
  setvreg:   { target: STAKING, func: 'setValidatorRegistry', args: [VREG] },
  // maxActiveValidators, hardCapActiveValidators (only lowers). Churn per block, the
  // replacement margin and admission itself are the contract's commitment.
  setparams: { target: STAKING, func: 'setSetParams', args: ['50', '50'] },
  // Genesis validators, each listed as its own operator (admin listing needs no key signature).
  validators: { target: VREG, func: 'addValidators',
                args: [VALIDATORS, VALIDATORS, [0,0,0,0],
                       ['node1-validator','node2-validator','node3-validator','node4-validator'],
                       ['genesis validator','genesis validator','genesis validator','genesis validator'],
                       ['','','',''], ['','','','']] },
  // Admission opens at this block for everyone (nobody, the owner included, before it).
  // Movable until it passes; never closed again.
  joinsfrom: ([blockNumber]) => {
    if (!/^[1-9][0-9]*$/.test(String(blockNumber || ''))) throw new Error('usage: joinsfrom <block>');
    return { target: STAKING, func: 'setJoinsOpenFromBlock', args: [blockNumber] };
  },
  // Commit the emission schedule, once: e0 wei a year at s0 wei of earning stake with r0 wei in
  // reserve, from start (unix seconds; 0 = at the vote). The reserve must already hold r0
  // (fundreserve first). No pause, restart or re-calibration exists afterwards.
  commit:    ([e0, s0, r0, start]) => {
    if (![e0, s0, r0, start].every((v) => /^[0-9]+$/.test(String(v || '')))) {
      throw new Error('usage: commit <e0Wei> <s0Wei> <r0Wei> <startUnix>');
    }
    return { target: STAKING, func: 'commitEmissionSchedule', args: [e0, s0, r0, start] };
  },
  // Direct, by the funding account: approve, then move its own STRATO into the reserve.
  // Irrevocable; a later top-up raises R and nothing else.
  fundreserve: ([amount]) => {
    if (!/^[0-9]+$/.test(String(amount || ''))) throw new Error('usage: fundreserve <amountWei>');
    return { direct: true, calls: [
      { target: TOKEN, name: 'Token', func: 'approve', args: { spender: STAKING, value: amount } },
      { target: STAKING, name: 'StratoStaking', func: 'fundRewardReserve', args: { amount } },
    ] };
  },
  // Permissionless, so a direct call rather than a vote: indexes the consensus set that
  // predates StratoStaking.activeValidators. Idempotent.
  index:     { direct: true, target: STAKING, name: 'StratoStaking', func: 'indexValidatorSet',
               args: { validators: VALIDATORS } },
  // Permissionless, so a direct call rather than a vote: lowers a reserve the retired schedule
  // left under the same name to what the contract holds beyond principal and owed rewards.
  // Idempotent; moves nothing.
  reconcile: { direct: true, target: STAKING, name: 'StratoStaking', func: 'reconcileRewardReserve',
               args: {} },
  // Quality control: an ordinary removal is announced with its published grounds and
  // executes a week later; the emergency path removes one named validator at once.
  announceremoval: (rest) => removal('announceRemoval', rest, true),
  removevalidator: (rest) => removal('removeValidator', rest, false),
  emergencyremove: (rest) => removal('emergencyRemove', rest, true),
  // Permissionless, so a direct call rather than a vote: a validator at the liveness miss
  // limit leaves the set; it may be seated again a week later after a fresh readiness trial.
  removeformisses: ([validator]) => {
    if (!isHex40(validator)) throw new Error('usage: removeformisses <validator>');
    return { direct: true, target: STAKING, name: 'StratoStaking', func: 'removeForMissedProposals',
             args: { validator: hex40(validator) } };
  },
  // Permissionless, so a direct call rather than a vote: touches a delegation so a
  // qualification that has come due takes effect.
  qualify:   ([user, validator]) => {
    if (!isHex40(user) || !isHex40(validator)) throw new Error('usage: qualify <user> <validator>');
    return { direct: true, target: STAKING, name: 'StratoStaking', func: 'qualifyStake',
             args: { user: hex40(user), validator: hex40(validator) } };
  },
  mint:      { target: TOKEN, func: 'mint', args: [FUNDER, FORTY_K] },
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
  const entry = STEPS[process.argv[2]];
  if (!entry) throw new Error('unknown step: ' + process.argv[2]);
  const step = typeof entry === 'function' ? entry(process.argv.slice(3)) : entry;
  const username = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(username, process.env.GLOBAL_ADMIN_PASSWORD);
  if (step.direct) {
    for (const call of step.calls || [step]) {
      const final = await callAsync({ token }, {
        contract: { address: call.target, name: call.name },
        method: call.func,
        args: call.args,
        txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
      });
      console.log(`${process.argv[2]} ${call.func} call by ${username}: ${final.status}`);
    }
    return;
  }
  const final = await callAsync({ token }, {
    contract: { address: REGISTRY, name: 'AdminRegistry' },
    method: 'castVoteOnIssue',
    args: { _target: step.target, _func: step.func, _args: step.args },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  });
  console.log(`${process.argv[2]} vote by ${username}: ${final.status}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
