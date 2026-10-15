// Deploy and fund the TGE tokenomics schedules from schedule.json (the spreadsheet)
// and deployment.json (TGE, addresses, grants). Every step reads chain state first,
// so any step can be rerun. Run from app/contracts/deploy, in order:
//
//   node tokenomics/deploy-tokenomics.js plan        the plan and chain state; run any time
//   node tokenomics/deploy-tokenomics.js gen         combine sources, identical for every admin
//   node tokenomics/deploy-tokenomics.js create      each admin: vote to create missing schedules
//   node tokenomics/deploy-tokenomics.js setup       setup admin: push TGE, grants, emission tables
//   node tokenomics/deploy-tokenomics.js fund        each admin: vote STRATO.mint for each shortfall
//   node tokenomics/deploy-tokenomics.js finalize    setup admin: lock everything; needs supply == 100M
//   node tokenomics/deploy-tokenomics.js ephemeral   write a copy of the config with random addresses
//
// Options: --config <file> (default tokenomics/deployment.json).
//
// TGE: edit "tge" and rerun setup; it can move until finalize.
// Freeze other STRATO mints between setup and finalize: the bootstrapping deduction
// is computed from live supply, so a mint in between leaves admins voting on
// different amounts or the total above 100M (finalize refuses).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const { rest, util, importer } = require('blockapps-rest');
const { buildPlan, fillPlaceholders, formatWei } = require('./plan');

const SOURCES = { VestingSchedule: 'Tokenomics/VestingSchedule.sol', EmissionSchedule: 'Tokenomics/EmissionSchedule.sol' };
const sourceFile = (name) => path.join(__dirname, `${name}-source.txt`);
const GRANT_BATCH = 100;
const addr = (value) => ({ type: 'address', value });

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// Cirrus serialises uint columns as bare JSON numbers; quote long ones before parsing
// so they survive as exact strings. A table that does not exist yet (no schedule
// created on this chain) reads as empty.
async function cirrus(tokenObj, table, params) {
  try {
    const res = await axios.get(`${config.nodes[0].url}/cirrus/search/${table}`, {
      headers: { Authorization: `Bearer ${tokenObj.token}` }, params, transformResponse: r => r,
    });
    return JSON.parse(res.data.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
  } catch (e) {
    if (e.response && e.response.status === 404) return [];
    throw e;
  }
}

async function poll(tokenObj, resp) {
  const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts), { config, isAsync: true }, 300000);
  return Array.isArray(results) ? results[0] : results;
}

async function send(tokenObj, address, name, method, args, label) {
  const resp = await rest.call(tokenObj, {
    contract: { address, name }, method, args, txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  }, { config, isAsync: true, cacheNonce: true });
  const final = await poll(tokenObj, resp);
  console.log(`  ${label}: ${final && final.status}`);
  if (!final || final.status !== 'Success') throw new Error(`${label} failed: ${JSON.stringify(final && final.txResult && final.txResult.message)}`);
  return final;
}

async function login() {
  const auth = require('../auth');
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  tokenObj.me = (await rest.getKey(tokenObj, { config })).replace(/^0x/, '').toLowerCase();
  return tokenObj;
}

// Chain state: the schedules already created for this token, their balances, and
// the STRATO minted outside them.
async function readChain(tokenObj, deployment, schedule) {
  const prefix = deployment.cirrusPrefix;
  const [vesting, emission, tokenRows] = await Promise.all([
    cirrus(tokenObj, `${prefix}-VestingSchedule`, { token: `eq.${deployment.token}` }),
    cirrus(tokenObj, `${prefix}-EmissionSchedule`, { token: `eq.${deployment.token}` }),
    cirrus(tokenObj, `${prefix}-Token`, { address: `eq.${deployment.token}`, select: '_totalSupply' }),
  ]);
  if (!tokenRows.length) throw new Error(`token ${deployment.token} not found in ${prefix}-Token`);
  const rows = [...vesting.map(r => ({ ...r, contract: 'VestingSchedule' })), ...emission.map(r => ({ ...r, contract: 'EmissionSchedule' }))];

  const found = {};
  const problems = [];
  for (const c of schedule.categories) {
    const pinned = deployment.addresses?.[c.key];
    const matches = rows.filter(r => (pinned ? r.address === pinned : r.category === c.label));
    if (matches.length > 1) problems.push(`${c.key}: ${matches.length} schedules named "${c.label}"; pin one in addresses.${c.key}`);
    else if (matches.length === 1) found[c.key] = matches[0];
  }

  const instanceAddrs = Object.values(found).map(r => r.address);
  const balances = {};
  if (instanceAddrs.length) {
    const rowsB = await cirrus(tokenObj, `${prefix}-Token-_balances`, { address: `eq.${deployment.token}`, key: `in.(${instanceAddrs.join(',')})` });
    for (const r of rowsB) balances[r.key] = BigInt(r.value);
  }
  const held = instanceAddrs.reduce((s, a) => s + (balances[a] || 0n), 0n);
  const totalSupply = BigInt(tokenRows[0]._totalSupply);
  return { found, balances, totalSupply, externalSupply: totalSupply - held, problems };
}

function loadPlan(deployment, schedule, chain) {
  const plan = buildPlan(schedule, deployment, chain.externalSupply);
  plan.problems.unshift(...chain.problems);
  return plan;
}

function requireClean(plan) {
  if (plan.problems.length) throw new Error('plan has problems:\n  ' + plan.problems.join('\n  '));
}

function onChainRequired(row) {
  return BigInt(row.contract === 'VestingSchedule' ? row.totalGranted : row.total);
}

function printPlan(plan, chain) {
  console.log(`TGE ${new Date(plan.tgeTimestamp * 1000).toISOString()} (${plan.tgeTimestamp})`);
  console.log(`STRATO supply ${formatWei(chain.totalSupply)}, of which outside the schedules ${formatWei(chain.externalSupply)}`);
  console.log(`  pre-minted remainder taken from bootstrapping year 1: ${formatWei(plan.remainder)}`);
  for (const i of plan.instances) {
    const row = chain.found[i.key];
    const terms = i.contract === 'VestingSchedule'
      ? `cliff ${i.cliffMonths}m, ${i.cliffUnlockBps / 100}% at cliff, ${i.vestingMonths}m vest, ${i.grants.length} grant(s)`
      : `10y emission to ${i.recipient}, year 1 ${formatWei(i.yearlyWei[0])}`;
    const state = row ? `${row.address}${row.finalized ? ' finalized' : ''} holds ${formatWei(chain.balances[row.address] || 0n)}` : 'not created';
    console.log(`${i.key.padEnd(14)} ${formatWei(i.fundWei).padStart(26)}  ${terms}\n${''.padEnd(16)}${state}`);
  }
  if (plan.problems.length) console.log('PROBLEMS:\n  ' + plan.problems.join('\n  '));
}

async function gen() {
  for (const [name, file] of Object.entries(SOURCES)) {
    const fp = path.join(config.resolvePath(config.contractsDir), file);
    let source = await importer.combine(fp);
    if (Buffer.isBuffer(source)) source = source.toString();
    else if (typeof source === 'object') source = Object.values(source).map(c => String(c).replace(/^.*?\.sol,\s*/i, '')).join('\n');
    fs.writeFileSync(sourceFile(name), source);
    console.log(`${sourceFile(name)} written: ${source.length} bytes`);
  }
}

async function create(tokenObj, plan, chain, { schedule }) {
  const { getCreatedAddress, getIssueId, pollForCreateIssueExecution } = require('../util');
  for (const i of plan.instances) {
    if (chain.found[i.key]) continue;
    const sheet = schedule.categories.find(c => c.key === i.key);
    // Created with the sheet's own figures, so every admin votes on identical args;
    // setup applies the supply-dependent adjustment afterwards.
    const args = i.contract === 'VestingSchedule'
      ? { _category: i.label, _token: addr(plan.token), _tgeTimestamp: plan.tgeTimestamp, _cliffMonths: i.cliffMonths,
          _cliffUnlockBps: i.cliffUnlockBps, _vestingMonths: i.vestingMonths, _setupAdmin: addr(plan.setupAdmin) }
      : { _category: i.label, _token: addr(plan.token), _tgeTimestamp: plan.tgeTimestamp, _recipient: addr(i.recipient),
          _yearlyAmounts: sheet.yearlyWei, _setupAdmin: addr(plan.setupAdmin) };
    const submittedAt = new Date().toISOString();
    const resp = await rest.createContract(tokenObj, {
      name: i.contract, source: fs.readFileSync(sourceFile(i.contract), 'utf8'), args,
      txParams: { gasPrice: config.gasPrice, gasLimit: 8000000 },
    }, { config, isAsync: true, cacheNonce: true, query: { username: 'BlockApps' } });
    const final = await poll(tokenObj, resp);
    let created = getCreatedAddress(final);
    if (!created) {
      const issueId = getIssueId(final);
      if (issueId) created = await pollForCreateIssueExecution(tokenObj, issueId, final, submittedAt, `${i.key} schedule`);
    }
    console.log(`${i.key}: ${final && final.status} | ${created || '(awaiting another vote)'}`);
  }
}

async function setup(tokenObj, plan, chain, { deployment }) {
  if (tokenObj.me !== plan.setupAdmin) throw new Error(`signed in as ${tokenObj.me}, setup admin is ${plan.setupAdmin}`);
  for (const i of plan.instances) {
    const row = chain.found[i.key];
    if (!row) throw new Error(`${i.key}: not created yet`);
    if (row.finalized) continue;
    console.log(`${i.key} (${row.address})`);
    if (BigInt(row.tgeTimestamp) !== BigInt(plan.tgeTimestamp)) {
      await send(tokenObj, row.address, i.contract, 'setTgeTimestamp', { _tgeTimestamp: plan.tgeTimestamp }, `setTgeTimestamp ${plan.tgeTimestamp}`);
    }
    if (i.contract === 'EmissionSchedule') {
      if (onChainRequired(row) !== i.fundWei) {
        await send(tokenObj, row.address, i.contract, 'setYearlyAmounts', { _yearlyAmounts: i.yearlyWei.map(String) }, `setYearlyAmounts total ${formatWei(i.fundWei)}`);
      }
      continue;
    }
    // Grants cannot be edited, only added: anything on chain that disagrees with
    // the plan means redeploying this schedule (before it is funded).
    const onChain = await cirrus(tokenObj, `${deployment.cirrusPrefix}-VestingSchedule-granted`, { address: `eq.${row.address}` });
    const have = Object.fromEntries(onChain.filter(r => BigInt(r.value) > 0n).map(r => [r.key, BigInt(r.value)]));
    const want = Object.fromEntries(i.grants.map(g => [g.address, g.wei]));
    for (const [a, v] of Object.entries(have)) {
      if (want[a] !== v) throw new Error(`${i.key}: on-chain grant ${a} = ${formatWei(v)} is not in the plan; redeploy this schedule`);
    }
    const missing = i.grants.filter(g => !have[g.address]);
    for (let k = 0; k < missing.length; k += GRANT_BATCH) {
      const batch = missing.slice(k, k + GRANT_BATCH);
      await send(tokenObj, row.address, i.contract, 'addGrants',
        { accounts: batch.map(g => g.address), amounts: batch.map(g => g.wei.toString()) },
        `addGrants ${k + 1}-${k + batch.length} of ${missing.length}`);
    }
  }
}

async function fund(tokenObj, plan, chain) {
  for (const i of plan.instances) {
    const row = chain.found[i.key];
    if (!row) throw new Error(`${i.key}: not created yet`);
    if (onChainRequired(row) !== i.fundWei) throw new Error(`${i.key}: on-chain total ${formatWei(onChainRequired(row))} != plan ${formatWei(i.fundWei)}; run setup first`);
    const balance = chain.balances[row.address] || 0n;
    if (balance > i.fundWei) throw new Error(`${i.key}: holds ${formatWei(balance)}, more than ${formatWei(i.fundWei)}`);
    if (balance === i.fundWei) continue;
    const amount = i.fundWei - balance;
    // STRATO is owned by AdminRegistry: an admin's mint is a vote, executed at quorum.
    await send(tokenObj, plan.token, 'Token', 'mint', { to: addr(row.address), amount: amount.toString() },
      `${i.key}: mint ${formatWei(amount)} to ${row.address} (vote)`);
  }
}

async function finalize(tokenObj, plan, chain) {
  if (tokenObj.me !== plan.setupAdmin) throw new Error(`signed in as ${tokenObj.me}, setup admin is ${plan.setupAdmin}`);
  if (chain.totalSupply !== plan.totalSupply) throw new Error(`STRATO supply is ${formatWei(chain.totalSupply)}, not ${formatWei(plan.totalSupply)}`);
  for (const i of plan.instances) {
    const row = chain.found[i.key];
    if (!row) throw new Error(`${i.key}: not created yet`);
    if (BigInt(row.tgeTimestamp) !== BigInt(plan.tgeTimestamp)) throw new Error(`${i.key}: TGE on chain ${row.tgeTimestamp} != plan; run setup`);
    if (onChainRequired(row) !== i.fundWei) throw new Error(`${i.key}: on-chain total != plan; run setup`);
    if ((chain.balances[row.address] || 0n) < i.fundWei) throw new Error(`${i.key}: underfunded; run fund`);
  }
  for (const i of plan.instances) {
    const row = chain.found[i.key];
    if (!row.finalized) await send(tokenObj, row.address, i.contract, 'finalize', {}, `${i.key}: finalize`);
  }
}

(async () => {
  const cmd = process.argv[2];
  const configPath = option('config', path.join(__dirname, 'deployment.json'));
  const deployment = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, 'schedule.json'), 'utf8'));

  if (cmd === 'gen') return gen();
  if (cmd === 'ephemeral') {
    const { deployment: filled, mapping } = fillPlaceholders(deployment);
    const out = configPath.replace(/\.json$/, '.ephemeral.json');
    fs.writeFileSync(out, JSON.stringify(filled, null, 2) + '\n');
    console.log(`${out} written. Dry runs only:`);
    for (const [k, v] of Object.entries(mapping)) console.log(`  ${k} -> ${v}`);
    return;
  }

  const steps = { plan: null, create, setup, fund, finalize };
  if (!(cmd in steps)) throw new Error('usage: node tokenomics/deploy-tokenomics.js <plan|gen|create|setup|fund|finalize|ephemeral> [--config file]');
  const tokenObj = await login();
  const chain = await readChain(tokenObj, deployment, schedule);
  const plan = loadPlan(deployment, schedule, chain);
  if (cmd === 'plan') return printPlan(plan, chain);
  requireClean(plan);
  await steps[cmd](tokenObj, plan, chain, { schedule, deployment });
})().catch(e => { console.error(process.env.GLOBAL_ADMIN_NAME || '', 'FAILED:', e.message.slice(0, 600)); process.exit(1); });
