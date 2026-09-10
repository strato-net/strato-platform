// End-to-end check that a stake change in StratoStaking reaches
// MercataGovernance. Stakes a small amount against one validator's operator and
// reports governance's validatorStake before and after.
//
//   node test-stake-propagation.js [operator] [amountWei]
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const axios = require('axios');
const { rest, util } = require('blockapps-rest');

const STAKING = 'd6726e06c3c71a3bad80b5eb6925707a31729b81';
const STRATO_TOKEN = '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04';
const GOVERNANCE = '0000000000000000000000000000000000000100';
const OPERATOR = (process.argv[2] || '0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82').replace(/^0x/, '');
const AMOUNT = process.argv[3] || '1000000000000000000'; // 1 STRATO

async function govStake(validator) {
  const { data } = await axios.get(`${config.nodes[0].url}/strato-api/eth/v1.2/storage`, {
    params: { address: GOVERNANCE }, timeout: 30000,
  });
  const row = data.find(r => r.key === `validatorStake[${validator}]`);
  return row ? BigInt(row.value) : 0n;
}

(async () => {
  const user = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };

  const before = await govStake(OPERATOR);
  console.log(`governance validatorStake before: ${Number(before) / 1e18} STRATO`);

  // stake() pulls the tokens with transferFrom, so the staker has to allow it first.
  const appr = await rest.call(tokenObj, {
    contract: { address: STRATO_TOKEN, name: 'Token' },
    method: 'approve',
    args: { spender: { type: 'address', value: STAKING }, value: AMOUNT },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, isAsync: true, cacheNonce: true });
  const ah = (Array.isArray(appr) ? appr : [appr]).map(r => r && r.hash).filter(Boolean);
  const ares = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, ah, opts),
    { config, isAsync: true }, 180000);
  const afinal = Array.isArray(ares) ? ares[0] : ares;
  console.log(`approve: ${afinal && afinal.status}`);
  if (!afinal || afinal.status !== 'Success') process.exit(1);

  const resp = await rest.call(tokenObj, {
    contract: { address: STAKING, name: 'StratoStaking' },
    method: 'stake',
    args: { operator: { type: 'address', value: OPERATOR }, amount: AMOUNT },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, isAsync: true, cacheNonce: true });

  const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);
  const final = Array.isArray(results) ? results[0] : results;
  console.log(`stake(${Number(AMOUNT) / 1e18} STRATO): ${final && final.status}` +
    (final && final.status !== 'Success' ? ` | ${JSON.stringify(final).slice(0, 300)}` : ''));
  if (!final || final.status !== 'Success') process.exit(1);

  const after = await govStake(OPERATOR);
  const delta = after - before;
  console.log(`governance validatorStake after:  ${Number(after) / 1e18} STRATO  (delta ${Number(delta) / 1e18})`);
  console.log(delta === BigInt(AMOUNT) ? 'PROPAGATED correctly' : 'MISMATCH — governance did not track the change');
})().catch(e => { console.error('FAILED:', e.message.slice(0, 250)); process.exit(1); });
