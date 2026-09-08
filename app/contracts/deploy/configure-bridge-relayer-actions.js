/**
 * Add or remove the bridge relayer whitelist entries for action deposits.
 *
 * Usage:
 *   node configure-bridge-relayer-actions.js \
 *     --bridge-address <address> \
 *     --relayer-address <address> \
 *     [--admin-registry <address>] \
 *     [--operation add|remove] \
 *     [--execute]
 *
 * Without --execute, this script only prints the planned calls.
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

const DEFAULT_ADMIN_REGISTRY = '000000000000000000000000000000000000100c';
const METHODS = ['depositWithAction', 'depositBatchWithAction', 'depositWithRoute'];

function parseArgs() {
  const parsed = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--execute') {
      parsed.execute = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    parsed[arg.slice(2)] = value;
    i++;
  }
  return parsed;
}

function normalizeAddress(value, label) {
  const normalized = String(value || '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
  return normalized.toLowerCase();
}

async function callAndWait(tokenObj, address, method, args) {
  const response = await rest.call(
    tokenObj,
    {
      contract: { address, name: 'AdminRegistry' },
      method,
      args,
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    { config, cacheNonce: true, isAsync: true }
  );
  const responses = Array.isArray(response) ? response : [response];
  const hashes = responses.map((item) => item && item.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error(`AdminRegistry.${method} returned no transaction hash`);
  }

  const results = await util.until(
    (items) =>
      Array.isArray(items) &&
      items.length > 0 &&
      items.every((item) => item && item.status && item.status !== 'Pending'),
    (options) => rest.getBlocResults(tokenObj, hashes, options),
    { config, isAsync: true },
    60000
  );
  const final = Array.isArray(results) ? results[0] : results;
  if (!final || final.status !== 'Success') {
    throw new Error(
      `AdminRegistry.${method} failed: ${JSON.stringify(final || results)}`
    );
  }
  return final;
}

async function main() {
  const args = parseArgs();
  const bridgeAddress = normalizeAddress(args['bridge-address'], 'bridge-address');
  const relayerAddress = normalizeAddress(args['relayer-address'], 'relayer-address');
  const adminRegistry = normalizeAddress(
    args['admin-registry'] || process.env.ADMIN_REGISTRY || DEFAULT_ADMIN_REGISTRY,
    'admin-registry'
  );
  const operation = args.operation || 'add';
  if (!['add', 'remove'].includes(operation)) {
    throw new Error('operation must be add or remove');
  }
  const registryMethod =
    operation === 'add' ? 'addWhitelist' : 'removeWhitelist';
  const plan = METHODS.map((_func) => ({
    contract: adminRegistry,
    method: registryMethod,
    args: { _target: bridgeAddress, _func, _user: relayerAddress },
  }));

  console.log(JSON.stringify({ operation, plan }, null, 2));
  if (!args.execute) {
    console.log('Dry run only. Re-run with --execute to submit these calls.');
    return;
  }

  const required = [
    'GLOBAL_ADMIN_NAME',
    'GLOBAL_ADMIN_PASSWORD',
    'OAUTH_CLIENT_SECRET',
    'OAUTH_CLIENT_ID',
    'OAUTH_URL',
    'NODE_URL',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const token = await auth.getUserToken(
    process.env.GLOBAL_ADMIN_NAME,
    process.env.GLOBAL_ADMIN_PASSWORD
  );
  const tokenObj = { token };
  for (const call of plan) {
    const result = await callAndWait(
      tokenObj,
      call.contract,
      call.method,
      call.args
    );
    console.log(
      `${call.method} ${call.args._func}: submitted successfully (${result.hash})`
    );
  }
  console.log(
    'If governance approval is required, repeat as the remaining admins and verify both whitelist mappings before starting the relayer.'
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = main;
