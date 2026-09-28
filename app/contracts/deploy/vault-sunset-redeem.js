/**
 * Diversified Vault sunset: redeem every remaining holder via Vault.redeemAllFor.
 *
 * Admin 1 runs this. It lists the share holders from Cirrus, splits them into
 * deterministic batches and submits one redeemAllFor(batch) call per batch as the
 * global admin. The vault proxy is owned by the AdminRegistry, so each call records
 * admin 1's vote and opens a governance issue; admin 2 approves the same issues from
 * the admin UI (castVoteOnIssue), which is what actually executes them.
 *
 * Batches are deterministic (holders with shares > 0, sorted by shares desc then by
 * address, chunked to --batch-size) because both votes must carry byte-identical
 * arguments to land on the same issue.
 *
 * Usage:
 *   node vault-sunset-redeem.js --vault <vaultProxyAddress> [options]
 *
 * Options:
 *   --batch-size <n>      holders per redeemAllFor call (default 10)
 *   --batch <n>           submit only batch n (1-based); default submits every batch
 *   --dry-run             list holders and batches, submit nothing (no credentials needed)
 *   --wait                after submitting, poll IssueExecuted for each issue, then re-list holders
 *   --timeout-minutes <n> how long --wait polls (default 60)
 *   --node-url <url>      overrides NODE_URL (dry runs default to https://app.strato.nexus)
 *
 * Examples:
 *   node vault-sunset-redeem.js --vault 34bc729f66106a146b0864e673a3571b28fa23e1 --dry-run
 *   node vault-sunset-redeem.js --vault 34bc729f66106a146b0864e673a3571b28fa23e1 --batch 1
 *   node vault-sunset-redeem.js --vault 34bc729f66106a146b0864e673a3571b28fa23e1 --wait
 *   node vault-sunset-redeem.js --vault d556695364551c8c7eb336f0bed9aed9e1acd69d --node-url https://app.testnet.strato.nexus --dry-run
 *
 * Required environment variables (.env) for submitting:
 *   OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD [, OAUTH_TOTP]
 * Authentication happens exactly once per run, so a single OTP code (OAUTH_TOTP) covers
 * every batch.
 *
 * Safe to re-run: a batch whose holders are unchanged maps to the same issue id (no
 * duplicate vote), holders already redeemed are skipped by the contract, and nothing
 * executes until admin 2 approves.
 *
 * Preconditions: the vault proxy must already point at the implementation that has
 * redeemAllFor, and the vault should be paused so user withdrawals cannot race the sweep.
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');
const { getIssueId, saveCallListTXDataAsFile } = require('./util');

const DEFAULT_NODE_URL = 'https://app.strato.nexus';
const POLL_INTERVAL_MS = 10000;
const ISSUE_LOOKUP_TIMEOUT_MS = 120000;

function printUsage() {
  console.error(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*\n/, ''));
}

function parseArgs() {
  const parsed = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry-run' || key === 'wait') {
      parsed[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for argument: ${arg}`);
    parsed[key] = value;
    i++;
  }
  return parsed;
}

const strip0x = (a) => String(a || '').trim().replace(/^0x/i, '').toLowerCase();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmtShares = (wei) => (Number(wei / 10n ** 12n) / 1e6).toFixed(6);

async function cirrus(nodeUrl, tokenObj, table, params) {
  const url = `${nodeUrl.replace(/\/$/, '')}/cirrus/search/${table}?${new URLSearchParams(params)}`;
  const headers = { 'User-Agent': 'strato-vault-sunset-redeem/1.0' };
  if (tokenObj && tokenObj.token) headers.Authorization = `Bearer ${tokenObj.token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadVault(nodeUrl, tokenObj, vault) {
  const rows = await cirrus(nodeUrl, tokenObj, 'BlockApps-Vault', {
    address: `eq.${vault}`,
    select: 'address,shareToken,botExecutor,_paused',
  });
  if (!rows.length || !rows[0].shareToken) {
    throw new Error(`No vault row with a share token at ${vault} on ${nodeUrl}`);
  }
  return rows[0];
}

async function loadHolders(nodeUrl, tokenObj, shareToken) {
  const [balanceRows, tokenRows] = await Promise.all([
    cirrus(nodeUrl, tokenObj, 'BlockApps-Token-_balances', { address: `eq.${shareToken}`, select: 'key,value::text', limit: '10000' }),
    cirrus(nodeUrl, tokenObj, 'BlockApps-Token', { address: `eq.${shareToken}`, select: '_symbol,_totalSupply::text' }),
  ]);
  const holders = balanceRows
    .map((r) => ({ address: strip0x(r.key), shares: BigInt(r.value || '0') }))
    .filter((h) => h.shares > 0n)
    .sort((a, b) => (a.shares === b.shares ? (a.address < b.address ? -1 : 1) : a.shares > b.shares ? -1 : 1));
  return {
    holders,
    symbol: tokenRows[0]?._symbol || '?',
    totalSupply: BigInt(tokenRows[0]?._totalSupply || '0'),
  };
}

function toBatches(holders, batchSize) {
  const batches = [];
  for (let i = 0; i < holders.length; i += batchSize) {
    batches.push(holders.slice(i, i + batchSize).map((h) => h.address));
  }
  return batches;
}

function printHolders(label, { holders, symbol, totalSupply }) {
  const held = holders.reduce((sum, h) => sum + h.shares, 0n);
  console.log(`${label}: ${holders.length} holder(s) with ${fmtShares(held)} ${symbol} of ${fmtShares(totalSupply)} total supply`);
  if (held !== totalSupply) console.log('  WARNING: holder balances do not sum to totalSupply; Cirrus may be lagging behind the chain');
  holders.forEach((h, i) => console.log(`  ${String(i + 1).padStart(3)}  ${h.address}  ${fmtShares(h.shares).padStart(18)}`));
}

// Same async + poll pattern as upgrade.js / backfill-cdp-collateral-assets.js: the sync
// rest.call resolver crashes on user-contract-routed calls, so submit async and assert
// success on the receipt.
async function callAsync(tokenObj, callArgs, baseOptions) {
  const response = await rest.call(tokenObj, callArgs, { ...baseOptions, isAsync: true });
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error('rest.call returned no tx hash; cannot poll for receipt: ' + JSON.stringify(response));
  }
  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    300000
  );
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error('Contract call failed: ' + JSON.stringify(final || finalResults));
  }
  return final;
}

// The receipt does not reliably carry the Solidity return value for user-contract-routed
// calls (see upgrade.js), so read the governance outcome from the AdminRegistry events
// emitted in the same transaction: IssueExecuted means it ran, IssueVoted means it is
// waiting for the other admin, neither means the caller was the direct owner.
async function classifyByRegistryEvents(nodeUrl, tokenObj, txHash) {
  const deadline = Date.now() + ISSUE_LOOKUP_TIMEOUT_MS;
  const params = { transaction_hash: `eq.${txHash}`, select: 'issueId,target,func', limit: '5' };
  while (Date.now() < deadline) {
    const [executed, voted] = await Promise.all([
      cirrus(nodeUrl, tokenObj, 'BlockApps-AdminRegistry-IssueExecuted', params).catch(() => []),
      cirrus(nodeUrl, tokenObj, 'BlockApps-AdminRegistry-IssueVoted', params).catch(() => []),
    ]);
    if (Array.isArray(executed) && executed.length) return { state: 'executed', issueId: executed[0].issueId };
    if (Array.isArray(voted) && voted.length) return { state: 'pending', issueId: voted[0].issueId };
    await sleep(5000);
  }
  return { state: 'unknown', issueId: null };
}

async function waitForIssueExecution(nodeUrl, tokenObj, issueId, submittedAt, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await cirrus(nodeUrl, tokenObj, 'BlockApps-AdminRegistry-IssueExecuted', {
      issueId: `eq.${issueId}`,
      block_timestamp: `gte.${submittedAt}`,
      order: 'block_timestamp.desc',
      limit: '5',
    }).catch(() => []);
    if (Array.isArray(rows) && rows.length) return rows[0];
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
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
  if (!args.vault) {
    console.error('Missing required argument: --vault\n');
    printUsage();
    process.exit(1);
  }

  const dryRun = !!args['dry-run'];
  const vault = strip0x(args.vault);
  const batchSize = Math.max(1, parseInt(args['batch-size'] || '10', 10) || 10);
  const onlyBatch = args.batch ? parseInt(args.batch, 10) : null;
  const timeoutMs = Math.max(1, parseInt(args['timeout-minutes'] || '60', 10) || 60) * 60 * 1000;
  const nodeUrl = args['node-url'] || process.env.NODE_URL || (dryRun ? DEFAULT_NODE_URL : '');
  if (!nodeUrl) throw new Error('NODE_URL is not set (or pass --node-url)');
  config.nodes[0].url = nodeUrl;

  let tokenObj = null;
  if (!dryRun) {
    const requiredVars = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL'];
    const missingVars = requiredVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) {
      console.error(`Missing required environment variables: ${missingVars.join(', ')}\n`);
      printUsage();
      process.exit(1);
    }
    // Authenticate ONCE; the token is reused for every batch so one OTP covers the run.
    const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
    tokenObj = { token };
    console.log(`Authenticated as ${process.env.GLOBAL_ADMIN_NAME}`);
  }

  const vaultRow = await loadVault(nodeUrl, tokenObj, vault);
  console.log(`node:         ${nodeUrl}`);
  console.log(`vault:        ${vault} (paused: ${vaultRow._paused})`);
  console.log(`share token:  ${vaultRow.shareToken}`);
  console.log(`bot executor: ${vaultRow.botExecutor}`);
  if (!vaultRow._paused) {
    console.log('WARNING: vault is not paused; user withdrawals can still race the sweep (harmless, but pause first if you can)');
  }
  console.log('');

  const snapshot = await loadHolders(nodeUrl, tokenObj, vaultRow.shareToken);
  printHolders('Holders before', snapshot);
  console.log('');

  if (snapshot.holders.length === 0) {
    console.log('Nothing to redeem: no holder has shares.');
    return;
  }

  const batches = toBatches(snapshot.holders, batchSize);
  if (onlyBatch !== null && (Number.isNaN(onlyBatch) || onlyBatch < 1 || onlyBatch > batches.length)) {
    throw new Error(`--batch must be between 1 and ${batches.length}`);
  }
  const selected = onlyBatch === null ? batches.map((b, i) => ({ index: i + 1, holders: b })) : [{ index: onlyBatch, holders: batches[onlyBatch - 1] }];

  console.log(`${batches.length} batch(es) of up to ${batchSize}; submitting ${selected.length}:`);
  selected.forEach((b) => {
    console.log(`  batch ${b.index}/${batches.length} (${b.holders.length} holders): redeemAllFor(${JSON.stringify(b.holders)})`);
  });
  console.log('');

  if (dryRun) {
    console.log('Dry run complete. No calls submitted.');
    return;
  }

  const submittedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const results = [];
  for (const batch of selected) {
    console.log(`Submitting batch ${batch.index}/${batches.length} as ${process.env.GLOBAL_ADMIN_NAME}...`);
    const receipt = await callAsync(tokenObj, {
      contract: { address: vault, name: 'Vault' },
      method: 'redeemAllFor',
      args: { holders: batch.holders },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    }, { config, cacheNonce: true });

    const value = getIssueId(receipt);
    const message = receipt.txResult && receipt.txResult.message;
    console.log(`  tx ${receipt.hash}: ${receipt.status}`);
    if (message) console.log(`  node message: ${message}`);

    const outcome = await classifyByRegistryEvents(nodeUrl, tokenObj, receipt.hash);
    const issueId = outcome.state === 'pending' ? outcome.issueId : null;
    if (outcome.state === 'pending') {
      console.log(`  governance issue opened: ${issueId}  -> admin 2 approves this in the admin UI`);
    } else if (outcome.state === 'executed') {
      console.log(`  vote threshold already met; issue ${outcome.issueId} executed in this transaction`);
    } else {
      console.log(`  no AdminRegistry event found for this tx${value ? ` (return value ${value})` : ''}; if ${process.env.GLOBAL_ADMIN_NAME} is the direct vault owner the sweep already ran`);
    }
    results.push({ batch: batch.index, holders: batch.holders, txHash: receipt.hash, status: receipt.status, outcome: outcome.state, issueId: outcome.issueId, returnValue: value });
  }

  await saveCallListTXDataAsFile({
    operation: 'vault-sunset-redeem',
    nodeUrl,
    vault,
    shareToken: vaultRow.shareToken,
    submittedAt: new Date().toISOString(),
    admin: process.env.GLOBAL_ADMIN_NAME,
    batches: results,
  });

  const pending = results.filter((r) => r.issueId);
  console.log('');
  console.log('====== Sweep Submitted ======');
  console.log(`batches submitted: ${results.length}, governance issues awaiting admin 2: ${pending.length}`);
  pending.forEach((r) => console.log(`  batch ${r.batch}: ${r.issueId}`));
  console.log('Nothing is redeemed until each issue reaches the vote threshold.');
  console.log('=============================');

  if (!args.wait || pending.length === 0) {
    console.log(`Re-run with --dry-run to see the remaining holders once admin 2 has approved.`);
    return;
  }

  console.log('');
  console.log(`Waiting up to ${Math.round(timeoutMs / 60000)} min for IssueExecuted on ${pending.length} issue(s)...`);
  for (const r of pending) {
    const executed = await waitForIssueExecution(nodeUrl, tokenObj, r.issueId, submittedAt, timeoutMs);
    console.log(executed
      ? `  batch ${r.batch} executed at ${executed.block_timestamp} (tx ${executed.transaction_hash || '?'})`
      : `  batch ${r.batch} NOT executed within the timeout (issue ${r.issueId})`);
  }

  console.log('');
  const after = await loadHolders(nodeUrl, tokenObj, vaultRow.shareToken);
  printHolders('Holders after', after);
  if (after.holders.length === 0) {
    console.log('All positions redeemed. Only rounding dust should remain with the bot executor.');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Sweep failed:', error.message || error);
    process.exit(1);
  });
}

module.exports = main;
