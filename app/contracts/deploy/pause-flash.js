// Pause (or resume) every flash facility on the network at NODE_URL:
// FlashMint.setPaused on each wired FlashMint, PoolV3.setFlashPaused on each pool.
//
// Targets are read from Cirrus: the initialized FlashMints and PoolV3s the genesis
// AdminRegistry owns. A pool whose logic predates flash() has no setFlashPaused and
// is skipped. A pool created later starts with flash enabled, so re-run after
// creating one.
//
//   node pause-flash.js [--unpause] [--dry-run]
//
// Run once per admin (GLOBAL_ADMIN_NAME); identical calls vote on one issue, which
// executes at quorum. Targets already in the requested state are left alone, and
// --dry-run only lists each target's state. Exits 2 while votes are still needed.
require('dotenv').config();
const axios = require('axios');
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('./strato');
const { getVoteResult } = require('./util');

const REGISTRY = '000000000000000000000000000000000000100c';
// wired: a column only an initialized instance has set, which leaves out bare implementations
const FACILITIES = [
  { name: 'FlashMint', method: 'setPaused', flag: 'paused', wired: 'token' },
  { name: 'PoolV3', method: 'setFlashPaused', flag: 'isFlashPaused', wired: 'token0' },
];
const flags = process.argv.slice(2);
const paused = !flags.includes('--unpause');
const dryRun = flags.includes('--dry-run');
const nodeUrl = config.nodes[0].url.replace(/\/$/, '');
const label = ({ name, address }) => `${name} ${address}`;

async function readTargets(tokenObj) {
  const perFacility = await Promise.all(FACILITIES.map(async (facility) => {
    const rows = await rest.search(tokenObj, { name: `BlockApps-${facility.name}` }, {
      config,
      query: { select: `address,${facility.flag}`, _owner: `eq.${REGISTRY}`, [facility.wired]: 'neq.', order: 'address' },
    });
    return rows.map((row) => ({ ...facility, address: row.address, paused: row[facility.flag] }));
  }));
  return perFacility.flat();
}

async function hasMethod(tokenObj, { name, address, method }) {
  const { data } = await axios.get(`${nodeUrl}/bloc/v2.2/contracts/${name}/${address}/functions`, {
    headers: { Authorization: `Bearer ${tokenObj.token}` },
  });
  return data.includes(method);
}

(async () => {
  if (flags.some((flag) => !['--unpause', '--dry-run'].includes(flag))) {
    throw new Error('usage: node pause-flash.js [--unpause] [--dry-run]');
  }
  const username = process.env.GLOBAL_ADMIN_NAME;
  const tokenObj = { token: await auth.getUserToken(username, process.env.GLOBAL_ADMIN_PASSWORD) };
  const wanted = paused ? 'paused' : 'unpaused';
  console.log(`${paused ? 'Pause' : 'Resume'} flash on ${nodeUrl} as ${username}${dryRun ? ' (dry run)' : ''}`);

  const targets = await readTargets(tokenObj);
  const supported = await Promise.all(targets.map((target) => hasMethod(tokenObj, target)));
  const todo = targets.filter((target, i) => supported[i] && target.paused !== paused);
  targets.forEach((target, i) => {
    const state = !supported[i] ? `skipped, no ${target.method} in its logic`
      : target.paused === paused ? `already ${wanted}`
      : 'to vote';
    console.log(`  ${label(target)}: ${state}`);
  });
  if (dryRun || !todo.length) return;

  const pending = await rest.callList(tokenObj, todo.map(({ address, method }) => ({
    contract: { address: REGISTRY, name: 'AdminRegistry' },
    method: 'castVoteOnIssue',
    args: { _target: address, _func: method, _args: [{ type: 'bool', value: paused }] },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  })), { config, isAsync: true, cacheNonce: true });
  const hashes = pending.map((tx) => tx.hash);
  const receipts = await util.until(
    (rs) => rs.length === hashes.length && rs.every((r) => r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true }, 180000);

  let open = 0;
  let failed = 0;
  console.log(`Votes by ${username}:`);
  receipts.forEach((receipt, i) => {
    const vote = receipt.status === 'Success' ? getVoteResult(receipt) : null;
    if (!vote) failed++;
    else if (!vote.executed) open++;
    const outcome = !vote ? `FAILED ${String((receipt.txResult && receipt.txResult.message) || receipt.status).slice(0, 200)}`
      : vote.executed ? wanted
      : `vote recorded, issue ${vote.value}`;
    console.log(`  ${label(todo[i])}: ${outcome}`);
  });
  if (failed) throw new Error(`${failed} of ${todo.length} votes failed`);
  if (open) {
    console.log(`${open} of ${todo.length} still need votes; have another admin run this.`);
    process.exit(2);
  }
  console.log(`DONE: flash is ${wanted} on all ${todo.length}.`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
