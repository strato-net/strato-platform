/**
 * Incident response: cancel in-flight MercataBridge withdrawals and move their
 * escrow to a triage wallet (MercataBridge.cancelAndSweepWithdrawalBatch).
 * Dry run by default; nothing is submitted without --execute.
 *
 * Usage (from app/contracts):
 *   node deploy/sweep-withdrawal.js --env testnet --ids 12,13 --triage <addr>            # show what would be swept
 *   node deploy/sweep-withdrawal.js --env prod    --ids 12,13 --triage <addr> --execute  # cast the governance call
 *
 * Options:
 *   --env testnet|prod     Network (required).
 *   --ids a,b,c            Withdrawal ids (required). Only INITIATED (1) / PENDING_REVIEW (2) are sweepable.
 *   --triage <addr>        Wallet that receives the escrow (required).
 *   --bridge <addr>        MercataBridge proxy (default 0x1008).
 *   --execute              Submit the call as GLOBAL_ADMIN_NAME.
 *   --env-file <path>      Credentials file (default app/contracts/.env).
 *
 * The bridge is owned by the AdminRegistry, so on a multi-admin network the call
 * records a vote and returns the issue id; the sweep lands when the vote passes.
 * Every admin must submit the SAME ids and triage wallet (they are part of the
 * issue id). For PENDING_REVIEW withdrawals the proposed custody (Safe)
 * transaction on the external chain must be rejected as well; its hash is shown.
 *
 * Exit codes: 0 = done (or dry run); 2 = vote recorded, awaiting other admins; 1 = error.
 */
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const dotenv = require('dotenv');

const PROFILES = {
  testnet: { nodeUrl: 'https://node1.testnet.strato.nexus', cirrusUrl: 'https://app.testnet.strato.nexus' },
  prod: { nodeUrl: 'https://app.strato.nexus', cirrusUrl: 'https://app.strato.nexus' },
};
const DEFAULT_BRIDGE = '0000000000000000000000000000000000001008';
const STATUS_NAMES = { 0: 'NONE', 1: 'INITIATED', 2: 'PENDING_REVIEW', 3: 'COMPLETED', 4: 'ABORTED', 5: 'SWEPT' };
const SWEEPABLE = new Set(['1', '2']);

const normalizeAddr = (v) => String(v || '').toLowerCase().replace(/^0x/, '');
const isAddr = (v) => /^[0-9a-f]{40}$/.test(normalizeAddr(v));

function printUsage() {
  console.error('Usage: node deploy/sweep-withdrawal.js --env testnet|prod --ids a,b,c --triage <addr> [--bridge <addr>] [--execute] [--env-file <path>]');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { execute: false };
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw new Error(`Unexpected argument: ${args[i]}`);
    const key = args[i].slice(2);
    if (key === 'execute' || key === 'dry-run') { parsed[key] = true; continue; }
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for argument: ${args[i]}`);
    parsed[key] = value;
    i++;
  }
  if (!parsed.env || !PROFILES[parsed.env]) throw new Error('--env must be testnet or prod');
  if (!parsed.ids) throw new Error('--ids is required');
  if (!parsed.triage || !isAddr(parsed.triage)) throw new Error('--triage must be a 40-hex address');
  parsed.ids = parsed.ids.split(',').map((s) => s.trim()).filter(Boolean);
  if (parsed.ids.length === 0 || parsed.ids.some((id) => !/^\d+$/.test(id) || id === '0')) {
    throw new Error('--ids must be a comma-separated list of positive integers');
  }
  parsed.triage = normalizeAddr(parsed.triage);
  parsed.bridge = normalizeAddr(parsed.bridge || DEFAULT_BRIDGE);
  return parsed;
}

async function fetchWithdrawals(profile, bridge, ids) {
  const { data } = await axios.get(`${profile.cirrusUrl}/cirrus/search/BlockApps-MercataBridge-withdrawals`, {
    params: { address: `eq.${bridge}`, key: `in.(${ids.join(',')})`, select: 'key,value' },
  });
  const byId = new Map();
  for (const row of Array.isArray(data) ? data : []) byId.set(String(row.key), row.value || {});
  return byId;
}

async function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(`Error parsing arguments: ${error.message}\n`);
    printUsage();
    process.exit(1);
  }
  const profile = PROFILES[args.env];
  console.log(`MercataBridge withdrawal sweep — ${args.execute ? 'EXECUTE' : 'DRY RUN'} on ${args.env}`);
  console.log('=====================================================\n');
  console.log(`Bridge:        ${args.bridge}`);
  console.log(`Triage wallet: ${args.triage}\n`);

  const rows = await fetchWithdrawals(profile, args.bridge, args.ids);
  let blocked = false;
  for (const id of args.ids) {
    const w = rows.get(id);
    if (!w) {
      console.log(`  - #${id}: NOT FOUND on this bridge/network`);
      blocked = true;
      continue;
    }
    const status = String(w.bridgeStatus);
    const ok = SWEEPABLE.has(status);
    if (!ok) blocked = true;
    console.log(`  - #${id}: ${STATUS_NAMES[status] || status}${ok ? '' : '  !! not sweepable'}`);
    console.log(`      sender ${w.stratoSender}  token ${w.stratoToken}  amount ${w.stratoTokenAmount}`);
    console.log(`      -> chain ${w.externalChainId} recipient ${w.externalRecipient} (${w.externalTokenAmount} of ${w.externalToken})`);
    if (status === '2') {
      console.log(`      !! custody tx already proposed: ${w.custodyTxHash} — reject it on the external chain too`);
    }
  }
  console.log('');
  if (blocked) {
    throw new Error('One or more ids are missing or not sweepable; fix the list (the whole batch reverts otherwise).');
  }
  if (!args.execute) {
    console.log('Dry run only. Re-run with --execute to cast the governance call.');
    return;
  }

  const envFile = args['env-file'] ? path.resolve(args['env-file']) : path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envFile)) throw new Error(`Credentials file not found: ${envFile}`);
  dotenv.config({ path: envFile });
  process.env.NODE_URL = process.env.NODE_URL_OVERRIDE || profile.nodeUrl;
  const missing = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL'].filter((v) => !process.env[v]);
  if (missing.length > 0) throw new Error(`Missing required environment variables in ${envFile}: ${missing.join(', ')}`);
  // config.js reads NODE_URL at load time, so require it only after setting it.
  const config = require('./config');
  const auth = require('./auth');
  const { rest, util } = require('blockapps-rest');

  console.log(`Authenticating as ${process.env.GLOBAL_ADMIN_NAME} against ${config.nodes[0].url}...`);
  const tokenObj = { token: await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD) };

  const response = await rest.call(tokenObj, {
    contract: { address: args.bridge, name: 'MercataBridge' },
    method: 'cancelAndSweepWithdrawalBatch',
    args: { ids: args.ids.map(Number), triageWallet: args.triage },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, cacheNonce: true, isAsync: true });
  const hashes = (Array.isArray(response) ? response : [response]).map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) throw new Error('rest.call returned no tx hash: ' + JSON.stringify(response));
  const results = await util.until(
    (rs) => Array.isArray(rs) && rs.length > 0 && rs.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    180000
  );
  const final = Array.isArray(results) ? results[0] : results;
  if (!final || final.status !== 'Success') throw new Error('Sweep call failed: ' + JSON.stringify(final || results));

  const v = final.txResult && final.txResult.response && final.txResult.response.v;
  const value = Array.isArray(v) ? v[0] : v;
  const issueId = typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value) ? value : null;

  const after = await fetchWithdrawals(profile, args.bridge, args.ids);
  const swept = args.ids.filter((id) => String((after.get(id) || {}).bridgeStatus) === '5');
  console.log(`\nSwept now: ${swept.length}/${args.ids.length}`);
  if (swept.length === args.ids.length) {
    console.log('Done. Escrow is in the triage wallet; reject any listed custody transactions on the external chain.');
    return;
  }
  if (issueId) {
    console.log(`Vote recorded; governance issue ${issueId}. Other admins must submit the same ids and triage wallet.`);
    process.exit(2);
  }
  console.log('The call succeeded but the withdrawals are not yet SWEPT; Cirrus may be lagging. Re-check shortly.');
  process.exit(2);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nSweep failed:', error.message);
    if (process.env.DEBUG && error.stack) console.error(error.stack);
    process.exit(1);
  });
}

module.exports = main;
