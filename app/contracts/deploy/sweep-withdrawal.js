/**
 * One-shot incident response: cancel in-flight MercataBridge withdrawals and move
 * their escrow to a triage wallet. Dry run by default; nothing is submitted
 * without --execute.
 *
 * Runbook: deploy/RUNBOOK-sweep-withdrawal.md. In short, with --execute this
 * command does everything on the STRATO side, in order and idempotently:
 *
 *   1. Makes sure the bridge proxy runs logic that has cancelAndSweepWithdrawal.
 *      If it does not, a MercataBridge implementation is deployed from the current
 *      concrete/Bridge/MercataBridge.sol (or one another admin already deployed is
 *      reused) and the proxy is pointed at it.
 *   2. Calls cancelAndSweepWithdrawalBatch(ids, triageWallet).
 *   3. Prints the custody (Safe) proposals that must now be REJECTED on the
 *      external chain, one per swept withdrawal that was already PENDING_REVIEW.
 *
 * The bridge is owned by the AdminRegistry. On a network with several admins every
 * step above is a vote: the command records the vote, waits a bounded time, and
 * exits 2 with what is pending. The other admins then run the SAME command with
 * the SAME ids and triage wallet; each run advances whatever is pending, and the
 * last one finishes. Nothing is deployed twice.
 *
 * Usage (from app/contracts):
 *   node deploy/sweep-withdrawal.js --env prod --ids 274 --triage <addr>            # dry run
 *   node deploy/sweep-withdrawal.js --env prod --ids 274 --triage <addr> --execute  # do it
 *
 * Options:
 *   --env testnet|prod     Network (required).
 *   --ids a,b,c            Withdrawal ids (required). INITIATED (1) or PENDING_REVIEW (2) only.
 *   --triage <addr>        Wallet that receives the escrow (or TRIAGE_WALLET in the env file).
 *   --execute              Submit transactions.
 *   --impl <addr>          Reuse a specific sweep-capable MercataBridge implementation.
 *   --no-upgrade           Fail instead of upgrading if the deployed logic cannot sweep.
 *   --allow-hot-wallet     Sweep withdrawals flagged useHotWallet (read the warning first).
 *   --bridge <addr>        MercataBridge proxy (default 0x1008).
 *   --poll-timeout <ms>    How long to wait for each on-chain effect (default 180000).
 *   --env-file <path>      Credentials file (default app/contracts/.env).
 *
 * Credentials (only for --execute): OAUTH_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET,
 * GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD (an AdminRegistry admin), OAUTH_TOTP if OTP-gated.
 * NODE_URL is set from --env (NODE_URL_OVERRIDE replaces it).
 *
 * Exit codes: 0 = done (or dry run); 2 = a step is awaiting other admins' votes; 1 = error.
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
const BRIDGE_IMPL = { name: 'MercataBridge', file: 'Bridge/MercataBridge.sol' };
// MercataBridge's constructor parameter is `_owner`; the value is ignored in favour of the proxy owner.
const BRIDGE_CONSTRUCTOR_ARGS = { _owner: 'deadbeef' };
const SWEEP_FUNCTION = 'cancelAndSweepWithdrawal';
const STATUS_NAMES = { 0: 'NONE', 1: 'INITIATED', 2: 'PENDING_REVIEW', 3: 'COMPLETED', 4: 'ABORTED', 5: 'SWEPT' };
const SWEEPABLE = new Set(['1', '2']);
const SWEPT = '5';
const EFFECT_POLL_INTERVAL_MS = 5000;

const normalizeAddr = (v) => String(v || '').toLowerCase().replace(/^0x/, '');
const isAddr = (v) => /^[0-9a-f]{40}$/.test(normalizeAddr(v));
const isZeroAddr = (v) => !v || /^0+$/.test(normalizeAddr(v));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function printUsage() {
  console.error('Usage: node deploy/sweep-withdrawal.js --env testnet|prod --ids a,b,c --triage <addr> [--execute]');
  console.error('       [--impl <addr>] [--no-upgrade] [--allow-hot-wallet] [--bridge <addr>] [--poll-timeout <ms>] [--env-file <path>]');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { execute: false };
  const flags = new Set(['execute', 'dry-run', 'no-upgrade', 'allow-hot-wallet']);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw new Error(`Unexpected argument: ${args[i]}`);
    const key = args[i].slice(2);
    if (flags.has(key)) { parsed[key] = true; continue; }
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for argument: ${args[i]}`);
    parsed[key] = value;
    i++;
  }
  if (parsed['dry-run'] && parsed.execute) throw new Error('--dry-run and --execute are mutually exclusive');
  if (!parsed.env || !PROFILES[parsed.env]) throw new Error('--env must be testnet or prod');
  if (!parsed.ids) throw new Error('--ids is required');
  parsed.ids = [...new Set(parsed.ids.split(',').map((s) => s.trim()).filter(Boolean))];
  if (parsed.ids.length === 0 || parsed.ids.some((id) => !/^\d+$/.test(id) || id === '0')) {
    throw new Error('--ids must be a comma-separated list of positive integers');
  }
  parsed.bridge = normalizeAddr(parsed.bridge || DEFAULT_BRIDGE);
  parsed.pollTimeoutMs = parseInt(parsed['poll-timeout'] || '180000', 10);
  return parsed;
}

// ---------------------------------------------------------------------------
// Cirrus (public read endpoints; dry runs need no credentials)
// ---------------------------------------------------------------------------

function makeCirrus(profile) {
  return async function cirrus(tableName, params) {
    const { data } = await axios.get(`${profile.cirrusUrl}/cirrus/search/${tableName}`, { params });
    return Array.isArray(data) ? data : [];
  };
}

async function getProxyLogic(cirrus, bridge) {
  const rows = await cirrus('BlockApps-Proxy', { address: `eq.${bridge}`, select: 'address,logicContract,_owner' });
  return rows[0] ? { logic: normalizeAddr(rows[0].logicContract), owner: normalizeAddr(rows[0]._owner) } : null;
}

async function getWithdrawals(cirrus, bridge, ids) {
  const rows = await cirrus('BlockApps-MercataBridge-withdrawals', {
    address: `eq.${bridge}`, key: `in.(${ids.join(',')})`, select: 'key,value',
  });
  const byId = new Map();
  for (const row of rows) byId.set(String(row.key), row.value || {});
  return byId;
}

async function getChains(cirrus, bridge, chainIds) {
  if (chainIds.length === 0) return new Map();
  const rows = await cirrus('BlockApps-MercataBridge-chains', {
    address: `eq.${bridge}`, key: `in.(${chainIds.join(',')})`, select: 'key,value',
  });
  const byId = new Map();
  for (const row of rows) byId.set(String(row.key), row.value || {});
  return byId;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function describeWithdrawals(ids, rows, chains, allowHotWallet) {
  const problems = [];
  const alreadySwept = [];
  const targets = [];
  const rejections = [];
  for (const id of ids) {
    const w = rows.get(id);
    if (!w) {
      console.log(`  - #${id}: NOT FOUND on this bridge/network`);
      problems.push(`#${id} not found`);
      continue;
    }
    const status = String(w.bridgeStatus);
    const name = STATUS_NAMES[status] || status;
    const chain = chains.get(String(w.externalChainId)) || {};
    console.log(`  - #${id}: ${name}`);
    console.log(`      sender ${w.stratoSender}  token ${w.stratoToken}  amount ${w.stratoTokenAmount}`);
    console.log(`      -> ${chain.chainName || `chain ${w.externalChainId}`} recipient ${w.externalRecipient} (${w.externalTokenAmount} of ${w.externalToken})`);
    if (status === SWEPT) {
      console.log('      already SWEPT (nothing to do)');
      alreadySwept.push(id);
    } else if (!SWEEPABLE.has(status)) {
      console.log('      !! not sweepable');
      problems.push(`#${id} is ${name}`);
    } else {
      targets.push(id);
    }
    if (status === '2' || status === SWEPT) {
      const custody = chain.custody ? normalizeAddr(chain.custody) : '(custody unknown)';
      console.log(`      custody proposal: safeTxHash ${w.custodyTxHash} on Safe ${custody}${w.useHotWallet ? ' (HOT WALLET)' : ''}`);
      rejections.push({ id, chainName: chain.chainName || String(w.externalChainId), chainId: String(w.externalChainId), custody, safeTxHash: w.custodyTxHash, hot: !!w.useHotWallet });
    }
    if (w.useHotWallet && SWEEPABLE.has(status)) {
      console.log('      !! flagged useHotWallet: the relayer pays these from the hot wallet WITHOUT signatures.');
      console.log('         PENDING_REVIEW may already be paid on the external chain (double payment if swept);');
      console.log('         INITIATED can be paid at any moment unless withdrawals are paused.');
      if (!allowHotWallet) problems.push(`#${id} is a hot-wallet withdrawal (pass --allow-hot-wallet after checking the explorer)`);
    }
  }
  return { problems, alreadySwept, targets, rejections };
}

function printRejections(rejections) {
  const needed = rejections.filter((r) => r.safeTxHash);
  if (needed.length === 0) {
    console.log('No custody proposal exists for these withdrawals; nothing to reject on the external chain.');
    return;
  }
  console.log('NOW REJECT THESE CUSTODY PROPOSALS ON THE EXTERNAL CHAIN (do NOT execute them):');
  for (const r of needed) {
    console.log(`  - withdrawal #${r.id}: ${r.chainName} (chainId ${r.chainId}), Safe ${r.custody}, safeTxHash ${r.safeTxHash}${r.hot ? '  [hot wallet: verify on the explorer whether it already went through]' : ''}`);
  }
  console.log('  In the Safe app: open the Safe, find the transaction by that hash under Queue, choose Reject,');
  console.log('  collect signatures and execute the rejection. The relayer will notice the rejection and try to');
  console.log('  abort on STRATO, which fails harmlessly because the withdrawal is already SWEPT.');
}

// ---------------------------------------------------------------------------
// Source preparation (same conventions as upgrade.js)
// ---------------------------------------------------------------------------

const stripComments = (str) => {
  let out = str.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.split('\n').map((ln) => {
    const t = ln.trim();
    if (t.startsWith('//')) return t.includes('SPDX-License-Identifier') ? ln : '';
    return ln.replace(/\/\/.*$/, '');
  }).join('\n');
  return out;
};

async function combineSource(config, importer, contractFile) {
  const contractFilePath = path.join(config.resolvePath(config.contractsDir), contractFile);
  if (!fs.existsSync(contractFilePath)) throw new Error(`Contract file not found: ${contractFilePath}`);
  let source = await importer.combine(contractFilePath);
  if (Buffer.isBuffer(source)) return stripComments(source.toString());
  if (typeof source === 'string') return stripComments(source);
  if (typeof source === 'object') {
    return Object.keys(source).map((k) => {
      let content = source[k];
      content = typeof content === 'string' ? content : String(content);
      content = content.replace(/^.*?\.sol,\s*/i, '');
      return stripComments(content);
    }).join('\n');
  }
  return stripComments(String(source));
}

// ---------------------------------------------------------------------------
// State file: implementation address / in-flight create-issue survive re-runs
// ---------------------------------------------------------------------------

function stateFilePath(env) {
  return path.join(__dirname, `sweep-withdrawal.state.${env}.json`);
}

function loadState(env, nodeUrl) {
  const file = stateFilePath(env);
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed.nodeUrl && parsed.nodeUrl !== nodeUrl) {
    throw new Error(`State file ${file} was written for a different node (${parsed.nodeUrl}); delete it or fix the node before re-running.`);
  }
  return parsed;
}

function saveState(env, nodeUrl, state) {
  fs.writeFileSync(stateFilePath(env), JSON.stringify({ ...state, nodeUrl }, null, 2));
}

// ---------------------------------------------------------------------------
// Chain access (only with --execute)
// ---------------------------------------------------------------------------

function issueIdFromReceipt(final) {
  const v = final && final.txResult && final.txResult.response && final.txResult.response.v;
  const value = Array.isArray(v) ? v[0] : v;
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value) ? value : null;
}

async function awaitReceipt(chain, hashes, label) {
  const finalResults = await chain.util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => chain.rest.getBlocResults(chain.tokenObj, hashes, opts),
    { config: chain.config, isAsync: true },
    120000
  );
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') throw new Error(`${label} failed: ` + JSON.stringify(final || finalResults));
  return final;
}

/** The state read of an implementation lists its functions, so this is a reliable capability probe. */
async function isSweepCapable(chain, address) {
  try {
    const state = await chain.rest.getState(chain.tokenObj, { address, name: BRIDGE_IMPL.name }, { config: chain.config });
    return !!state && Object.prototype.hasOwnProperty.call(state, SWEEP_FUNCTION);
  } catch (error) {
    return false;
  }
}

async function submitImplementationDeploy(chain, source) {
  console.log(`  Deploying a new ${BRIDGE_IMPL.name} implementation from ${BRIDGE_IMPL.file} (${source.length} bytes)...`);
  const response = await chain.rest.createContract(chain.tokenObj, {
    name: BRIDGE_IMPL.name,
    source,
    args: BRIDGE_CONSTRUCTOR_ARGS,
    txParams: { gasPrice: chain.config.gasPrice, gasLimit: chain.config.gasLimit },
  }, { config: chain.config, logger: console, history: [BRIDGE_IMPL.name], cacheNonce: true, isAsync: true, query: { username: 'BlockApps' } });
  const hashes = (Array.isArray(response) ? response : [response]).map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) throw new Error('rest.createContract returned no tx hash: ' + JSON.stringify(response));
  const final = await awaitReceipt(chain, hashes, 'implementation deployment');
  const created = final.txResult && final.txResult.contractsCreated;
  const address = Array.isArray(created) ? created[0] : created;
  if (address) return { address: normalizeAddr(address) };
  const issueId = issueIdFromReceipt(final);
  if (issueId) return { issueId };
  throw new Error('Deployment succeeded but no contractsCreated in receipt: ' + JSON.stringify(final));
}

async function issueExecutedAddress(chain, cirrus, issueId) {
  const rows = await cirrus('BlockApps-AdminRegistry-IssueExecuted', {
    issueId: `eq.${issueId}`, select: 'transaction_hash', order: 'block_timestamp.desc', limit: '1',
  });
  const txHash = rows[0] && rows[0].transaction_hash;
  if (!txHash) return null;
  const finalResults = await chain.rest.getBlocResults(chain.tokenObj, [txHash], { config: chain.config, isAsync: true });
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  const created = final && final.txResult && final.txResult.contractsCreated;
  const address = Array.isArray(created) ? created[0] : created;
  return address ? normalizeAddr(address) : null;
}

/**
 * Find or create a sweep-capable implementation, in this order: the proxy's current
 * logic (already upgraded), --impl, the state file, the newest MercataBridge on the
 * network that can sweep (another admin deployed it), else deploy. Returns null while
 * a create-issue is awaiting votes.
 */
async function ensureSweepCapableImpl(chain, cirrus, args, state, currentLogic) {
  if (await isSweepCapable(chain, currentLogic)) {
    console.log(`  Bridge logic ${currentLogic} already has ${SWEEP_FUNCTION}.`);
    return currentLogic;
  }
  if (args['no-upgrade']) {
    throw new Error(`Bridge logic ${currentLogic} cannot sweep and --no-upgrade was given. Upgrade it first (deploy/upgrade.js).`);
  }
  const candidates = [];
  if (args.impl) candidates.push({ addr: normalizeAddr(args.impl), why: '--impl' });
  if (state.bridgeImpl) candidates.push({ addr: state.bridgeImpl, why: 'recorded in the state file' });
  const recent = await cirrus('BlockApps-MercataBridge', {
    address: `neq.${args.bridge}`, select: 'address,block_number', order: 'block_number.desc', limit: '5',
  });
  for (const row of recent) candidates.push({ addr: normalizeAddr(row.address), why: 'newest implementation on the network' });
  for (const c of candidates) {
    if (await isSweepCapable(chain, c.addr)) {
      console.log(`  Reusing sweep-capable implementation ${c.addr} (${c.why}).`);
      state.bridgeImpl = c.addr;
      saveState(args.env, chain.nodeUrl, state);
      return c.addr;
    }
    if (c.why === '--impl') throw new Error(`--impl ${c.addr} is not a MercataBridge with ${SWEEP_FUNCTION}.`);
  }

  if (!state.bridgeImplIssue) {
    const source = await combineSource(chain.config, chain.importer, BRIDGE_IMPL.file);
    if (!source.includes(`function ${SWEEP_FUNCTION}(`)) {
      throw new Error(`Local ${BRIDGE_IMPL.file} does not contain ${SWEEP_FUNCTION}; check out the branch that has it.`);
    }
    const submitted = await submitImplementationDeploy(chain, source);
    if (submitted.address) {
      state.bridgeImpl = submitted.address;
      saveState(args.env, chain.nodeUrl, state);
      console.log(`  -> implementation ${submitted.address}`);
      return submitted.address;
    }
    state.bridgeImplIssue = submitted.issueId;
    saveState(args.env, chain.nodeUrl, state);
    console.log(`  Deployment raised governance issue ${submitted.issueId}; waiting for votes...`);
  } else {
    console.log(`  Resuming governance create-issue ${state.bridgeImplIssue}...`);
  }
  const deadline = Date.now() + args.pollTimeoutMs;
  for (;;) {
    const address = await issueExecutedAddress(chain, cirrus, state.bridgeImplIssue);
    if (address) {
      state.bridgeImpl = address;
      saveState(args.env, chain.nodeUrl, state);
      console.log(`  -> implementation ${address} (create-issue executed)`);
      return address;
    }
    if (Date.now() >= deadline) return null;
    await sleep(EFFECT_POLL_INTERVAL_MS);
  }
}

async function callBridge(chain, target, method, callArgs) {
  const response = await chain.rest.call(chain.tokenObj, {
    contract: target,
    method,
    args: callArgs,
    txParams: { gasPrice: chain.config.gasPrice, gasLimit: chain.config.gasLimit },
  }, { config: chain.config, cacheNonce: true, isAsync: true });
  const hashes = (Array.isArray(response) ? response : [response]).map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) throw new Error(`rest.call(${method}) returned no tx hash: ` + JSON.stringify(response));
  return awaitReceipt(chain, hashes, `${method} call`);
}

async function waitForEffect(checkFn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await checkFn()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(EFFECT_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
  const cirrus = makeCirrus(profile);

  // The env file is read early only so TRIAGE_WALLET can serve as the default destination.
  const envFile = args['env-file'] ? path.resolve(args['env-file']) : path.resolve(__dirname, '../.env');
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile });
  const triage = normalizeAddr(args.triage || process.env.TRIAGE_WALLET || '');
  if (!isAddr(triage) || isZeroAddr(triage) || triage === args.bridge) {
    console.error('A triage wallet is required: --triage <40-hex address> (or TRIAGE_WALLET in the env file), not zero and not the bridge.\n');
    printUsage();
    process.exit(1);
  }

  console.log(`MercataBridge withdrawal sweep — ${args.execute ? 'EXECUTE' : 'DRY RUN'} on ${args.env}`);
  console.log('=====================================================\n');

  // -------- Discovery (public Cirrus) --------
  const proxy = await getProxyLogic(cirrus, args.bridge);
  if (!proxy) throw new Error(`${args.bridge} is not a Proxy on this network (no BlockApps-Proxy row).`);
  const rows = await getWithdrawals(cirrus, args.bridge, args.ids);
  const chainIds = [...new Set([...rows.values()].map((w) => String(w.externalChainId)).filter((c) => c && c !== 'undefined'))];
  const chains = await getChains(cirrus, args.bridge, chainIds);

  console.log(`Bridge proxy:   ${args.bridge}  (logic ${proxy.logic}, owner ${proxy.owner})`);
  console.log(`Triage wallet:  ${triage}`);
  console.log('Withdrawals:');
  const { problems, alreadySwept, targets, rejections } = describeWithdrawals(args.ids, rows, chains, !!args['allow-hot-wallet']);
  console.log('');
  if (problems.length > 0) {
    throw new Error('Refusing: ' + problems.join('; ') + '. Fix the id list; a batch with one bad id reverts as a whole.');
  }
  if (targets.length === 0) {
    console.log('Every listed withdrawal is already SWEPT on STRATO.\n');
    printRejections(rejections);
    return;
  }
  console.log(`Plan: ${args['no-upgrade'] ? 'require' : 'ensure'} sweep-capable bridge logic, then sweep ${targets.length} withdrawal(s) [${targets.join(', ')}] to ${triage}.`);
  if (alreadySwept.length > 0) console.log(`(${alreadySwept.length} already swept and skipped: ${alreadySwept.join(', ')})`);
  if (!args.execute) {
    console.log('\nDry run only. Re-run with --execute to do it.');
    return;
  }

  // -------- Credentials --------
  if (!fs.existsSync(envFile)) throw new Error(`Credentials file not found: ${envFile}`);
  process.env.NODE_URL = process.env.NODE_URL_OVERRIDE || profile.nodeUrl;
  const missing = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL'].filter((v) => !process.env[v]);
  if (missing.length > 0) throw new Error(`Missing required environment variables in ${envFile}: ${missing.join(', ')}`);
  // config.js reads NODE_URL at load time, so require it only after setting it.
  const config = require('./config');
  const auth = require('./auth');
  const { rest, importer, util } = require('blockapps-rest');
  console.log(`\nAuthenticating as ${process.env.GLOBAL_ADMIN_NAME} against ${config.nodes[0].url}...`);
  const chain = {
    rest, importer, util, config, nodeUrl: config.nodes[0].url,
    tokenObj: { token: await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD) },
  };
  console.log('Authenticated.\n');
  const state = loadState(args.env, chain.nodeUrl);
  const pending = [];

  // -------- Step 1: sweep-capable logic on the proxy --------
  console.log('Step 1/3: bridge logic');
  const impl = await ensureSweepCapableImpl(chain, cirrus, args, state, proxy.logic);
  let logicReady = false;
  if (!impl) {
    pending.push(`MercataBridge implementation — vote on create-issue ${state.bridgeImplIssue}`);
  } else if (impl === proxy.logic) {
    logicReady = true;
  } else {
    console.log(`  Pointing proxy ${args.bridge} at ${impl}...`);
    const receipt = await callBridge(chain, { address: args.bridge, name: 'Proxy' }, 'setLogicContract', { _logicContract: impl });
    const issue = issueIdFromReceipt(receipt);
    if (issue) console.log(`  setLogicContract recorded as governance vote (issue ${issue})`);
    logicReady = await waitForEffect(async () => {
      const now = await getProxyLogic(cirrus, args.bridge);
      return now && now.logic === impl;
    }, args.pollTimeoutMs);
    if (logicReady) console.log('  Proxy upgraded.');
    else pending.push(`proxy ${args.bridge} -> ${impl} (setLogicContract vote)`);
  }
  console.log('');

  // -------- Step 2: sweep --------
  console.log(`Step 2/3: sweep ${targets.length} withdrawal(s)`);
  let sweptAll = false;
  if (!logicReady) {
    console.log('  Skipped — the proxy does not run sweep-capable logic yet.');
  } else {
    const receipt = await callBridge(chain, { address: args.bridge, name: BRIDGE_IMPL.name }, 'cancelAndSweepWithdrawalBatch', {
      ids: targets.map(Number), triageWallet: triage,
    });
    const issue = issueIdFromReceipt(receipt);
    if (issue) console.log(`  Sweep recorded as governance vote (issue ${issue}); other admins must submit the same ids and triage wallet.`);
    sweptAll = await waitForEffect(async () => {
      const now = await getWithdrawals(cirrus, args.bridge, targets);
      return targets.every((id) => String((now.get(id) || {}).bridgeStatus) === SWEPT);
    }, args.pollTimeoutMs);
    if (sweptAll) console.log(`  Swept: ${targets.join(', ')} -> ${triage}`);
    else pending.push(`sweep of ${targets.join(', ')} -> ${triage} (governance vote)`);
  }
  console.log('');

  // -------- Step 3: what must happen on the external chain --------
  console.log('Step 3/3: external chain');
  if (sweptAll) {
    printRejections(rejections);
  } else {
    console.log('  (shown once the sweep has landed)');
  }

  console.log('\n====== Summary ======');
  console.log(`Bridge logic:   ${logicReady ? 'sweep-capable' : 'NOT yet sweep-capable'}`);
  console.log(`Swept on STRATO: ${sweptAll ? 'yes' : 'no'}`);
  if (pending.length > 0) {
    console.log('\nPENDING GOVERNANCE VOTES. Have the other admin(s) run this exact command, then run it again yourself:');
    pending.forEach((p) => console.log(`  - ${p}`));
    console.log('=====================');
    process.exit(2);
  }
  console.log('\nSTRATO side done. Finish with the Safe rejections listed above.');
  console.log('=====================');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nSweep failed:', error.message);
    if (process.env.DEBUG && error.stack) console.error(error.stack);
    process.exit(1);
  });
}

module.exports = main;
