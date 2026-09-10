// Deploy StratoStaking from frozen-source.txt as GLOBAL_ADMIN_NAME, then vote setLogicContract.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const fs = require('fs');
const { rest, util } = require('blockapps-rest');
const { getCreatedAddress, getIssueId, pollForCreateIssueExecution } = require('./util');
const PROXY = 'd6726e06c3c71a3bad80b5eb6925707a31729b81';
async function poll(tokenObj, hashes) {
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts), { config, isAsync: true }, 300000);
  return Array.isArray(results) ? results[0] : results;
}
(async () => {
  const source = fs.readFileSync('frozen-source.txt', 'utf8');
  const user = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  const submittedAt = new Date().toISOString();
  const resp = await rest.createContract(tokenObj, { name: 'StratoStaking', source, args: {'initialOwner':'deadbeef'}, txParams: { gasPrice: 10, gasLimit: 6000000 } }, { config, isAsync: true, cacheNonce: true, query: { username: 'BlockApps' } });
  const arr = Array.isArray(resp) ? resp : [resp];
  const hashes = arr.map(r => r && r.hash).filter(Boolean);
  const final = await poll(tokenObj, hashes);
  let impl = getCreatedAddress(final);
  if (!impl) { const iid = getIssueId(final); if (iid) impl = await pollForCreateIssueExecution(tokenObj, iid, final, submittedAt, 'impl'); }
  console.log(user, 'create result:', final && final.status, '| impl:', impl || '(pending 2nd vote)');
  if (!impl) return;
  const up = await rest.call(tokenObj, { contract: { address: PROXY, name: 'Proxy' }, method: 'setLogicContract', args: { _logicContract: impl }, txParams: { gasPrice: 10, gasLimit: 5000000 } }, { config, isAsync: true, cacheNonce: true });
  const uh = (Array.isArray(up)?up:[up]).map(r=>r&&r.hash).filter(Boolean);
  const uf = await poll(tokenObj, uh);
  console.log(user, 'setLogicContract:', uf && uf.status);
})().catch(e => { console.error(process.env.GLOBAL_ADMIN_NAME, 'FAILED:', e.message.slice(0,160)); process.exit(1); });
