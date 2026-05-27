/**
 * Deploy a new Proxy contract.
 *
 * Usage:
 *   node deployProxy.js --impl <implAddr> --owner <initialOwnerAddr>
 *   node deployProxy.js --empty --owner <initialOwnerAddr>
 *
 * Optional:
 *   --contract-file <file>  Source file to combine (default: BaseCodeCollection.sol)
 *
 * Required environment variables (.env):
 *   OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,
 *   GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, importer, util } = require('blockapps-rest');
const fs = require('fs-extra');
const path = require('path');

const ZERO_ADDRESS = '0000000000000000000000000000000000000000';

function printUsage() {
  console.error('Usage: node deployProxy.js (--impl <implAddr> | --empty) --owner <initialOwnerAddr> [--contract-file <file>]');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (key === 'empty') {
        parsed[key] = true;
        continue;
      }
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for argument: ${args[i]}`);
      }
      parsed[key] = value;
      i++;
    }
  }
  return parsed;
}

const stripComments = (str) => {
  let out = str.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.split('\n').map((ln) => {
    const t = ln.trim();
    if (t.startsWith('//')) {
      return t.includes('SPDX-License-Identifier') ? ln : '';
    }
    return ln.replace(/\/\/.*$/, '');
  }).join('\n');
  return out;
};

async function combineSource(contractFilePath) {
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

/**
 * Async createContract + poll for receipt. Same pattern as upgrade.js's
 * deployImplementationAsync — sync createContract returns `{}`, so we have
 * to pull the new address out of `txResult.contractsCreated` ourselves.
 */
async function deployContractAsync(tokenObj, contractArgs, baseOptions) {
  const asyncOptions = { ...baseOptions, isAsync: true };
  const response = await rest.createContract(tokenObj, contractArgs, asyncOptions);
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) {
    const voteIssueId = responseArray.find((r) => typeof r === 'string');
    if (voteIssueId) {
      return { voteRequired: true, voteIssueId, rawResponse: response };
    }
    throw new Error('rest.createContract returned no tx hash: ' + JSON.stringify(response));
  }

  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    60000
  );

  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error('Proxy deployment failed: ' + JSON.stringify(final || finalResults));
  }

  const created = final.txResult && final.txResult.contractsCreated;
  const address = Array.isArray(created) ? created[0] : created;
  if (!address) {
    const voteHint = final.txResult && final.txResult.message;
    if (voteHint) {
      return { voteRequired: true, voteHint, receipt: final };
    }
    throw new Error('Deployment succeeded but no contractsCreated entry: ' + JSON.stringify(final));
  }
  return { proxyAddress: address, receipt: final };
}

async function main() {
  console.log('Deploy new Proxy');
  console.log('================\n');

  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(`Error parsing arguments: ${error.message}\n`);
    printUsage();
    process.exit(1);
  }

  const required = ['owner'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.map((a) => '--' + a).join(', ')}\n`);
    printUsage();
    process.exit(1);
  }
  if (!args.impl && !args.empty) {
    console.error('Missing required argument: provide either --impl <implAddr> or --empty\n');
    printUsage();
    process.exit(1);
  }
  if (args.impl && args.empty) {
    console.error('Invalid arguments: use either --impl <implAddr> or --empty, not both\n');
    printUsage();
    process.exit(1);
  }

  const requiredVars = [
    'GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD',
    'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL', 'NODE_URL',
  ];
  const missingVars = requiredVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }

  const username = process.env.GLOBAL_ADMIN_NAME;
  const password = process.env.GLOBAL_ADMIN_PASSWORD;
  const contractFile = args['contract-file'] || config.mainFile || 'BaseCodeCollection.sol';

  console.log(`Authenticating as ${username}...`);
  const token = await auth.getUserToken(username, password);
  const tokenObj = { token };
  console.log('Authenticated.\n');

  const contractsDir = config.resolvePath(config.contractsDir);
  const contractFilePath = path.join(contractsDir, contractFile);
  if (!fs.existsSync(contractFilePath)) {
    throw new Error(`Contract file not found: ${contractFilePath}`);
  }

  console.log(`Combining source from: ${contractFilePath}`);
  const source = await combineSource(contractFilePath);
  console.log('Comments stripped from combined source(s)\n');

  const logicContract = args.empty ? ZERO_ADDRESS : args.impl;

  const contractArgs = {
    name: 'Proxy',
    source,
    args: {
      _logicContract: logicContract,
      _initialOwner:  args['owner'],
    },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };

  const deployOptions = {
    config,
    logger: console,
    history: ['Proxy'],
    cacheNonce: true,
    query: { username: 'BlockApps' },
  };

  console.log('Deploying Proxy with:');
  console.log(`  _logicContract: ${logicContract}${args.empty ? ' (empty proxy)' : ''}`);
  console.log(`  _initialOwner:  ${args['owner']}\n`);

  const result = await deployContractAsync(tokenObj, contractArgs, deployOptions);

  if (result.voteRequired) {
    console.log('\n====== Proxy Deployment Submitted ======');
    console.log('Governance approval appears to be required before the proxy address is created.');
    if (result.voteIssueId) {
      console.log(`Vote Issue ID: ${result.voteIssueId}`);
    }
    if (result.voteHint) {
      console.log(`Note: ${result.voteHint}`);
    }
    console.log(`Logic:         ${logicContract}${args.empty ? ' (empty proxy)' : ''}`);
    console.log(`Owner:         ${args['owner']}`);
    console.log('After the vote executes, record the created Proxy address before continuing.');
    console.log('========================================');
    return result;
  }

  console.log('\n====== Proxy Deployed ======');
  console.log(`Proxy Address: ${result.proxyAddress}`);
  console.log(`Logic:         ${logicContract}${args.empty ? ' (empty proxy)' : ''}`);
  console.log(`Owner:         ${args['owner']}`);
  console.log('============================');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nDeployment failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  });
}

module.exports = main;
