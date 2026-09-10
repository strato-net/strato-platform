// Cast a setLogicContract vote on a Proxy as GLOBAL_ADMIN_NAME.
// Usage: node vote-setlogic.js <proxyAddress> <implementationAddress>
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');
(async () => {
  const [proxy, impl] = process.argv.slice(2);
  if (!proxy || !impl) throw new Error('usage: node vote-setlogic.js <proxy> <impl>');
  const username = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(username, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  console.log('Authenticated as', username);
  const resp = await rest.call(tokenObj, {
    contract: { address: proxy, name: 'Proxy' },
    method: 'setLogicContract',
    args: { _logicContract: impl },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, isAsync: true, cacheNonce: true });
  const arr = Array.isArray(resp) ? resp : [resp];
  const hashes = arr.map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);
  const final = Array.isArray(results) ? results[0] : results;
  console.log('setLogicContract vote:', final && final.status);
  if (!final || final.status !== 'Success') process.exit(1);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
