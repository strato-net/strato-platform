// Upgrade a staking proxy's logic to the repo's StratoStaking / ValidatorRegistry.
//
//   node deploy-staking.js gen <staking|registry> [--splice <file.sol>] [--out <file>]
//       Combine the source and its imports once into <target>-source.txt, so every admin
//       submits byte-identical source and votes on the same create-contract issue.
//       --splice inserts the file's functions just before the contract's closing brace,
//       for a temporary surgery logic that keeps the contract name (and so its storage
//       layout, Cirrus tables and bloc name).
//   GLOBAL_ADMIN_NAME=... node deploy-staking.js deploy <staking|registry> [--source <file>]
//       Create the logic contract from that file, then vote setLogicContract on the proxy.
//       Run once per admin; the run that executes the create reports the address and casts
//       the first setLogicContract vote (cast the second with vote-setlogic.js).
//
// Both proxies keep their storage: SolidVM storage is keyed by name and the contracts keep
// their historical names (see the header comments in StratoStaking.sol / ValidatorRegistry.sol).
// Follow RUNBOOK-staking-validator-keyed.md for the surrounding steps.
require('dotenv').config();
const config = require('./config');
const path = require('path');
const fs = require('fs');
const { rest, util, importer } = require('blockapps-rest');

const TARGETS = {
  staking: {
    file: 'Staking/StratoStaking.sol',
    name: 'StratoStaking',
    proxy: process.env.STAKING_PROXY || 'd6726e06c3c71a3bad80b5eb6925707a31729b81',
  },
  registry: {
    file: 'Staking/ValidatorRegistry.sol',
    name: 'ValidatorRegistry',
    proxy: process.env.VALIDATOR_REGISTRY_PROXY || 'bfbb75bb6bd0bafa2f5c5b735fe518ade76808dd',
  },
};

const stripComments = (str) => {
  let out = str.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.split('\n').map((ln) => {
    const t = ln.trim();
    if (t.startsWith('//')) return t.includes('SPDX-License-Identifier') ? ln : '';
    return ln.replace(/\/\/.*$/, '');
  }).join('\n');
  return out;
};

function option(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function combine(target) {
  const fp = path.join(config.resolvePath(config.contractsDir), target.file);
  let source = await importer.combine(fp);
  if (Buffer.isBuffer(source)) source = stripComments(source.toString());
  else if (typeof source === 'object') {
    source = Object.keys(source).map((k) => {
      let c = source[k];
      c = typeof c === 'string' ? c : String(c);
      c = c.replace(/^.*?\.sol,\s*/i, '');
      return stripComments(c);
    }).join('\n');
  } else source = stripComments(String(source));
  return source;
}

// Insert `extra` before the closing brace of `contract <name>`. The contract must be the
// last declaration in the combined source, which holds for both targets (their imports
// come first), so its closing brace is the source's final one.
function splice(source, name, extra) {
  const declarations = [...source.matchAll(/^\s*(?:abstract\s+)?(?:contract|interface|library)\s+(?:record\s+)?(\w+)/gm)];
  const last = declarations[declarations.length - 1];
  if (!last || last[1] !== name) {
    throw new Error(`cannot splice: the last declaration is ${last && last[1]}, not ${name}`);
  }
  const brace = source.lastIndexOf('}');
  return `${source.slice(0, brace)}\n${extra.trim()}\n${source.slice(brace)}`;
}

async function poll(tokenObj, hashes) {
  const results = await util.until(
    rs => Array.isArray(rs) && rs.length > 0 && rs.every(r => r && r.status && r.status !== 'Pending'),
    opts => rest.getBlocResults(tokenObj, hashes, opts), { config, isAsync: true }, 300000);
  return Array.isArray(results) ? results[0] : results;
}

(async () => {
  const [mode, key, ...args] = process.argv.slice(2);
  const target = TARGETS[key];
  if (!target || !['gen', 'deploy'].includes(mode)) {
    throw new Error('usage: node deploy-staking.js <gen|deploy> <staking|registry> [options]');
  }

  if (mode === 'gen') {
    let source = await combine(target);
    const spliceFile = option(args, 'splice');
    if (spliceFile) source = splice(source, target.name, fs.readFileSync(spliceFile, 'utf8'));
    const out = option(args, 'out') || `${key}-source.txt`;
    fs.writeFileSync(out, source);
    console.log(`${out} written: ${source.length} bytes${spliceFile ? ` (spliced ${spliceFile})` : ''}`);
    return;
  }

  const auth = require('./auth');
  const { getCreatedAddress, getIssueId, pollForCreateIssueExecution } = require('./util');
  const source = fs.readFileSync(option(args, 'source') || `${key}-source.txt`, 'utf8');
  const user = process.env.GLOBAL_ADMIN_NAME;
  const token = await auth.getUserToken(user, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  const submittedAt = new Date().toISOString();

  const resp = await rest.createContract(tokenObj, {
    name: target.name,
    source,
    args: { initialOwner: 'deadbeef' }, // ignored: the proxy's owner governs
    txParams: { gasPrice: 10, gasLimit: 8000000 },
  }, { config, isAsync: true, cacheNonce: true, query: { username: 'BlockApps' } });

  const hashes = (Array.isArray(resp) ? resp : [resp]).map(r => r && r.hash).filter(Boolean);
  if (!hashes.length) throw new Error('no tx hash: ' + JSON.stringify(resp));
  const final = await poll(tokenObj, hashes);

  let impl = getCreatedAddress(final);
  if (!impl) {
    const issueId = getIssueId(final);
    if (issueId) impl = await pollForCreateIssueExecution(tokenObj, issueId, final, submittedAt, `${target.name} logic`);
  }
  console.log(`${user} create ${target.name}: ${final && final.status} | logic: ${impl || '(awaiting another vote)'}`);
  if (!impl) return;

  const up = await rest.call(tokenObj, {
    contract: { address: target.proxy, name: 'Proxy' },
    method: 'setLogicContract',
    args: { _logicContract: impl },
    txParams: { gasPrice: 10, gasLimit: 5000000 },
  }, { config, isAsync: true, cacheNonce: true });
  const uf = await poll(tokenObj, (Array.isArray(up) ? up : [up]).map(r => r && r.hash).filter(Boolean));
  console.log(`${user} setLogicContract(${target.proxy} -> ${impl}): ${uf && uf.status}`);
})().catch(e => { console.error(process.env.GLOBAL_ADMIN_NAME || '', 'FAILED:', e.message.slice(0, 300)); process.exit(1); });
