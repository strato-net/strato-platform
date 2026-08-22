// Point the Decider at a payFees implementation.
//
//   node install-feerouter.js status
//   node install-feerouter.js install [address]   (default: the deployed HeliumFeeRouter)
//   node install-feerouter.js rollback            (back to DeciderState's own payFees)
//
// DeciderState.updatePayFeeContract is onlyOwner and the owner is an EOA, not the
// AdminRegistry, so this is a single direct transaction — no vote. Run it as the
// owner (blockapps_test), not as one of the voting admins.
//
// The platform DELEGATECALLs payFees for every transaction, so a bad implementation
// here fails the whole chain; rollback restores DeciderState's own legacy payFees.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const axios = require('axios');
const { rest, util } = require('blockapps-rest');

const DECIDER_STATE = '00000000000000000000000000000000dec1de02';
const FEE_ROUTER = 'c0bb14f312168231272bdf4425a9f559d65cf53e';
const LEGACY = DECIDER_STATE; // DeciderState is its own default implementation

async function deciderState() {
  const { data } = await axios.get(`${config.nodes[0].url}/strato-api/eth/v1.2/storage`, {
    params: { address: DECIDER_STATE }, timeout: 30000,
  });
  const pick = (k) => {
    const row = data.find(r => r.key === k);
    if (!row) return null;
    const m = /address\(([0-9a-fA-F]{40})\)/.exec(row.value);
    return m ? m[1] : row.value;
  };
  return { owner: pick('owner'), currentFeeContract: pick('currentFeeContract') };
}

(async () => {
  const mode = process.argv[2] || 'status';
  const before = await deciderState();
  console.log(`DeciderState ${DECIDER_STATE}`);
  console.log(`  owner              ${before.owner}`);
  console.log(`  currentFeeContract ${before.currentFeeContract}` +
    (before.currentFeeContract === LEGACY ? '  (legacy: whole fee to the collector)' : ''));

  if (mode === 'status') return;

  const target = mode === 'rollback' ? LEGACY : (process.argv[3] || FEE_ROUTER).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{40}$/.test(target)) throw new Error(`not an address: ${target}`);
  if (target === before.currentFeeContract) {
    console.log(`\nAlready pointed at ${target}; nothing to do.`);
    return;
  }

  const user = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  const key = await rest.getKey(tokenObj, { config });
  console.log(`\nSigning as ${user} (${key})`);
  if (key.toLowerCase() !== String(before.owner).toLowerCase()) {
    throw new Error(`${user} is ${key} but DeciderState's owner is ${before.owner}; updatePayFeeContract would revert`);
  }

  console.log(`Setting currentFeeContract -> ${target} ...`);
  const resp = await rest.call(tokenObj, {
    contract: { address: DECIDER_STATE, name: 'DeciderState' },
    method: 'updatePayFeeContract',
    args: { _newFeeContract: target },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, isAsync: true, cacheNonce: true });

  const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);
  const final = Array.isArray(results) ? results[0] : results;
  console.log(`updatePayFeeContract: ${final && final.status}` +
    (final && final.status !== 'Success' ? ` | ${JSON.stringify(final).slice(0, 300)}` : ''));

  const after = await deciderState();
  console.log(`  currentFeeContract is now ${after.currentFeeContract}`);
  if (after.currentFeeContract !== target) process.exit(1);
})().catch(e => { console.error('FAILED:', e.message.slice(0, 300)); process.exit(1); });
