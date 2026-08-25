// Create-only: submit createContract from frozen-source.txt as GLOBAL_ADMIN_NAME. Fresh nonce.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const fs = require('fs');
const { rest, util } = require('blockapps-rest');
(async () => {
  const source = fs.readFileSync('frozen-source.txt', 'utf8');
  const user = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  const resp = await rest.createContract(tokenObj, { name: 'StratoStaking', source, args: {'initialOwner':'deadbeef'}, txParams: { gasPrice: 10, gasLimit: 6000000 } }, { config, isAsync: true, query: { username: 'BlockApps' } });
  const hashes = (Array.isArray(resp)?resp:[resp]).map(r=>r&&r.hash).filter(Boolean);
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length && rs.every(r=>r&&r.status&&r.status!=='Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts), { config, isAsync: true }, 300000);
  const f = Array.isArray(results)?results[0]:results;
  console.log(user, 'create outer tx:', f && f.status, '|', ((f&&f.txResult&&f.txResult.message)||'').slice(0,150));
})().catch(e => { console.error(process.env.GLOBAL_ADMIN_NAME, 'FAILED:', e.message.slice(0,150)); process.exit(1); });
