// Deploy the FeeRouter from feerouter-source.txt as GLOBAL_ADMIN_NAME. Contract
// creation is itself an AdminRegistry issue, so run this once per admin (identical
// source) to reach quorum; both runs report the same created address.
//
//   node gen-feerouter-source.js
//   GLOBAL_ADMIN_NAME=blockapps_test_1 ... node deploy-feerouter.js
//   GLOBAL_ADMIN_NAME=blockapps_test_2 ... node deploy-feerouter.js
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const fs = require('fs');
const { rest, util } = require('blockapps-rest');
const { getCreatedAddress, getIssueId, pollForCreateIssueExecution } = require('./util');

const NAME = process.env.FEE_ROUTER_NAME || 'HeliumFeeRouter';

(async () => {
  const source = fs.readFileSync('feerouter-source.txt', 'utf8');
  const user = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  const submittedAt = new Date().toISOString();

  const resp = await rest.createContract(tokenObj, {
    name: NAME,
    source,
    args: {},
    txParams: { gasPrice: 10, gasLimit: 6000000 },
  }, { config, isAsync: true, cacheNonce: true, query: { username: 'BlockApps' } });

  const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));

  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 300000);
  const final = Array.isArray(results) ? results[0] : results;

  let addr = getCreatedAddress(final);
  if (!addr) {
    const issueId = getIssueId(final);
    if (issueId) addr = await pollForCreateIssueExecution(tokenObj, issueId, final, submittedAt, 'FeeRouter address');
  }
  console.log(`${user} create: ${final && final.status} | ${NAME}: ${addr || '(awaiting second vote)'}`);
})().catch(e => { console.error(process.env.GLOBAL_ADMIN_NAME, 'FAILED:', e.message.slice(0, 200)); process.exit(1); });
