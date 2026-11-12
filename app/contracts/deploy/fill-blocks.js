// Advance a lazy-block network to a target height, one transaction per block.
// Each transaction is AdminRegistry.isAdminAddress as GLOBAL_ADMIN_NAME: it
// writes nothing and emits no validator or stake events.
//
//   node fill-blocks.js 1149      (stop when the head is 1149)
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('./strato');
const REGISTRY = '000000000000000000000000000000000000100c';

async function head() {
  const res = await fetch(`${process.env.NODE_URL}/strato-api/eth/v1.2/block/last/1`);
  return Number((await res.json())[0].blockData.number);
}

(async () => {
  const target = Number(process.argv[2]);
  if (!Number.isInteger(target)) throw new Error('usage: node fill-blocks.js <target head>');
  const tokenObj = { token: await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD) };
  const sender = await rest.getKey(tokenObj, { config });
  let at = await head();
  if (at > target) throw new Error(`head ${at} is already past ${target}`);
  while (at < target) {
    const resp = await rest.call(tokenObj, { contract: { address: REGISTRY, name: 'AdminRegistry' }, method: 'isAdminAddress',
      args: { _admin: sender }, txParams: { gasPrice: 10, gasLimit: 1000000 } }, { config, isAsync: true, cacheNonce: true });
    const hash = (Array.isArray(resp) ? resp[0] : resp).hash;
    await util.until(rs => rs[0] && rs[0].status !== 'Pending', opts => rest.getBlocResults(tokenObj, [hash], opts),
      { config, isAsync: true }, 180000);
    const next = await head();
    if (next !== at + 1) throw new Error(`head moved ${at} -> ${next}, expected one block; someone else is transacting`);
    at = next;
    console.log(`head ${at}, ${target - at} to go`);
  }
  console.log(`done: head ${at}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
