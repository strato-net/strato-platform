// Deploy MercataGovernance from governance-source.txt and vote setLogicContract
// on the genesis governance Proxy at 0x100. Run once per admin.
//
// 0x100 is a Proxy, so its logic can be replaced; its storage (validators,
// admins, and the vote maps) is name-keyed and survives, and the V2 fields
// (stakingContract, validatorStake, stakingManaged, hardCapValidators) start
// empty. So do the admin-override fields (forcedInByAdmins, forcedOutByAdmins,
// stakingIntent, stakingWeight, validatorVoteDirection): no validator carries a
// designation until the admins vote one on, and an empty stakingIntent reads as
// "staking has not spoken", which leaves every existing validator where it is.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const fs = require('fs');
const { rest, util } = require('blockapps-rest');
const { getCreatedAddress, getIssueId, pollForCreateIssueExecution } = require('./util');

const GOVERNANCE_PROXY = '0000000000000000000000000000000000000100';

async function poll(tokenObj, hashes) {
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts), { config, isAsync: true }, 300000);
  return Array.isArray(results) ? results[0] : results;
}

(async () => {
  const source = fs.readFileSync('governance-source.txt', 'utf8');
  const user = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  const submittedAt = new Date().toISOString();

  const resp = await rest.createContract(tokenObj, {
    name: 'MercataGovernance',
    source,
    args: { _initialOwner: 'deadbeef' }, // ignored: the proxy's owner governs
    txParams: { gasPrice: 10, gasLimit: 6000000 },
  }, { config, isAsync: true, cacheNonce: true, query: { username: 'BlockApps' } });

  const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const final = await poll(tokenObj, hashes);

  let impl = getCreatedAddress(final);
  if (!impl) {
    const issueId = getIssueId(final);
    if (issueId) impl = await pollForCreateIssueExecution(tokenObj, issueId, final, submittedAt, 'governance impl');
  }
  console.log(`${user} create: ${final && final.status} | impl: ${impl || '(awaiting second vote)'}`);
  if (!impl) return;

  const up = await rest.call(tokenObj, {
    contract: { address: GOVERNANCE_PROXY, name: 'Proxy' },
    method: 'setLogicContract',
    args: { _logicContract: impl },
    txParams: { gasPrice: 10, gasLimit: 5000000 },
  }, { config, isAsync: true, cacheNonce: true });
  const uf = await poll(tokenObj, (Array.isArray(up) ? up : [up]).map(r => r && r.hash).filter(Boolean));
  console.log(`${user} setLogicContract: ${uf && uf.status}`);
})().catch(e => { console.error(process.env.GLOBAL_ADMIN_NAME, 'FAILED:', e.message.slice(0, 200)); process.exit(1); });
