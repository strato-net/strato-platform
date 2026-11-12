// Staking setup steps, each a registry vote (run once per admin) unless marked direct:
//   node staking-setup.js <init|usdst|govstaking|setvreg|params|setparams|validators|mint|fundrouter>
//   node staking-setup.js grace <unixSeconds>              end of the self-bond grace period
//   node staking-setup.js setoperator <validator> <operator>
//   node staking-setup.js index                            (direct) index helium's existing set
//   node staking-setup.js bootstrapstakes                  (direct) publish the full set after the staking fork
//   node staking-setup.js govsync <on|off>                 staking's governance link (off across the staking fork)
//   node staking-setup.js joinsfrom <block>                permissionless admission opens at this block
//   node staking-setup.js selfbondmin <amountWei>          own bond a new seat needs (10,000 until set)
//   node staking-setup.js fundreserve <amountWei>          (direct) fund the emission reserve
//   node staking-setup.js emission <e0Wei> <s0Wei> <r0Wei> <startUnix>   commit the emission schedule, once
// Addresses default to helium; set STAKING_PROXY, VALIDATOR_REGISTRY_PROXY and STRATO_TOKEN
// for another network.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('./strato');

const REGISTRY = '000000000000000000000000000000000000100c';
const GOVERNANCE = '0000000000000000000000000000000000000100';
const STAKING = (process.env.STAKING_PROXY || 'd6726e06c3c71a3bad80b5eb6925707a31729b81').replace(/^0x/, '');
const VREG = (process.env.VALIDATOR_REGISTRY_PROXY || 'bfbb75bb6bd0bafa2f5c5b735fe518ade76808dd').replace(/^0x/, '');
const TOKEN = (process.env.STRATO_TOKEN || '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04').replace(/^0x/, '');
const USDST = '937efa7e3a77e20bbdbd7c0d32b6514f368c1010';
const FUNDER = '7b1f8cd02cd09ab9510e30fc8e15ff898a639771'; // blockapps_test_1
// HeliumFeeRouter (payFees + payBlockRewards); set FEE_ROUTER to fund a newer router.
const FEE_ROUTER = (process.env.FEE_ROUTER || '44769a27b4339f1dbdab8920be9b5689b6652178').replace(/^0x/, '');
const VALIDATORS = [
  '0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82',
  'bdd3fe1b9a87a88cff8259528c0a4d6464625713',
  'ebcd85c4212e53a2546cbcea765c1de531b14fb1',
  'f1e4082464ff5c399e43f2c9177904db9547d6a2',
];
const TEN_K = '10000000000000000000000';       // 10,000 * 1e18
const FORTY_K = '40000000000000000000000';

const STEPS = {
  // Fresh deployments only; helium's proxy was initialized long ago.
  init:      { target: STAKING, func: 'initialize',
               args: [TOKEN, USDST, 86400, 2000, 50] },
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
  // minStake (seats held from before the self-bond rule; new seats need selfBondMinimum, see
  // selfbondmin and setSelfBondGraceUntil), proposerFeeBps, maxConsecutiveMisses, jailCooldown
  params:    { target: STAKING, func: 'setValidatorParams',
               args: [TEN_K, 1000, 100, 3600] },
  setparams: { target: STAKING, func: 'setSetParams',
               args: ['50', '50', '500', '4', '86400', '86400', '10000'] },
  // Genesis validators, each listed as its own operator (admin listing needs no key signature).
  validators: { target: VREG, func: 'addValidators',
                args: [VALIDATORS, VALIDATORS, [0,0,0,0],
                       ['node1-validator','node2-validator','node3-validator','node4-validator'],
                       ['genesis validator','genesis validator','genesis validator','genesis validator'],
                       ['','','',''], ['','','','']] },
  // From this time on an incumbent seat's minStake must be met by self-bond alone. A time in
  // the past applies that immediately and removes validators without enough self-bond, so bond first.
  grace:     ([until]) => {
    if (!/^[0-9]+$/.test(String(until || ''))) throw new Error('usage: grace <unixSeconds>');
    return { target: STAKING, func: 'setSelfBondGraceUntil', args: [until] };
  },
  // Hand a validator to an operator account. The outgoing operator's accrued rewards are
  // paid to it and its self-bond starts unbonding to it.
  setoperator: ([validator, operator]) => {
    const hex = (v) => String(v || '').replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{40}$/.test(hex(validator)) || !/^[0-9a-fA-F]{40}$/.test(hex(operator))) {
      throw new Error('usage: setoperator <validator> <operator>');
    }
    return { target: VREG, func: 'adminSetOperator',
             args: [{ type: 'address', value: hex(validator) }, { type: 'address', value: hex(operator) }] };
  },
  // Permissionless, so a direct call rather than a vote: indexes the consensus set that
  // predates StratoStaking.activeValidators, as governance lists it, and attempts to
  // sync every member's weight in the same transaction. Idempotent.
  index:     { direct: true, target: STAKING, name: 'StratoStaking', func: 'indexValidatorSet',
               args: {} },
  // After the staking fork, publish every governance weight in one transaction.
  // Pre-fork calls cannot populate V2 headers; retry after activation if needed.
  bootstrapstakes: { direct: true, target: GOVERNANCE, name: 'MercataGovernance',
                     func: 'publishValidatorStakeSnapshot', args: {} },
  // Staking's governance link. Off from before the staking fork until bootstrapstakes is in a
  // header, so no weight is published alone first; turning it on resyncs the set.
  govsync: ([state]) => {
    if (state !== 'on' && state !== 'off') throw new Error('usage: govsync <on|off>');
    return { target: STAKING, func: 'setGovernance',
             args: [{ type: 'address', value: GOVERNANCE }, state === 'on'] };
  },
  // From this block anyone may seat an eligible validator, and nobody before it. Can be set
  // or moved only to a future block, and only until it is reached.
  joinsfrom: ([blockNumber]) => {
    if (!/^[1-9][0-9]*$/.test(String(blockNumber || ''))) throw new Error('usage: joinsfrom <block>');
    return { target: STAKING, func: 'setJoinsOpenFromBlock', args: [blockNumber] };
  },
  // The operator's own bond a candidate, or a seat taken under the self-bond rule, needs.
  selfbondmin: ([amount]) => {
    if (!/^[1-9][0-9]*$/.test(String(amount || ''))) throw new Error('usage: selfbondmin <amountWei>');
    return { target: STAKING, func: 'setSelfBondMinimum', args: [amount] };
  },
  // Anyone may fund the emission reserve, from the logged-in account; nothing takes it back out.
  fundreserve: ([amount]) => {
    if (!/^[1-9][0-9]*$/.test(String(amount || ''))) throw new Error('usage: fundreserve <amountWei>');
    return { direct: true, calls: [
      { target: TOKEN, name: 'Token', func: 'approve', args: { spender: STAKING, value: amount } },
      { target: STAKING, name: 'StratoStaking', func: 'fundEmissionReserve', args: { amount } },
    ] };
  },
  // Commit the emission schedule, once: E0 STRATO a year at S0 of consensus weight with R0 in
  // reserve (funded first), from START (unix seconds; 0 = at execution).
  emission:  ([e0, s0, r0, start]) => {
    if (![e0, s0, r0, start].every((v) => /^[0-9]+$/.test(String(v || '')))) {
      throw new Error('usage: emission <e0Wei> <s0Wei> <r0Wei> <startUnix>');
    }
    return { target: STAKING, func: 'commitEmissionSchedule', args: [e0, s0, r0, start] };
  },
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
