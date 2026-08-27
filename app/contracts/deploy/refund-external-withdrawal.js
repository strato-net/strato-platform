/**
 * Vote to refund an expired or cancelled ExternalAssetBridge withdrawal.
 *
 * Usage:
 *   node refund-external-withdrawal.js \
 *     --bridge-address <address> \
 *     --withdrawal-id <id> \
 *     [--admin-registry <address>] \
 *     [--execute]
 *
 * Without --execute, this script only prints the planned governance call.
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

const DEFAULT_ADMIN_REGISTRY = '000000000000000000000000000000000000100c';

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

async function callAndWait(tokenObj, registry, args) {
  const response = await rest.call(
    tokenObj,
    {
      contract: { address: registry, name: 'AdminRegistry' },
      method: 'castVoteOnIssue',
      args,
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    { config, cacheNonce: true, isAsync: true }
  );
  const responses = Array.isArray(response) ? response : [response];
  const hashes = responses.map((item) => item && item.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error('AdminRegistry.castVoteOnIssue returned no transaction hash');
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
      `Refund vote failed: ${JSON.stringify(final || results)}`
    );
  }
  return final;
}

async function main() {
  const args = parseArgs();
  const bridgeAddress = normalizeAddress(
    args['bridge-address'],
    'bridge-address'
  );
  const withdrawalId = String(args['withdrawal-id'] || '');
  if (!/^[1-9][0-9]*$/.test(withdrawalId)) {
    throw new Error('withdrawal-id must be a positive integer');
  }
  const adminRegistry = normalizeAddress(
    args['admin-registry'] || process.env.ADMIN_REGISTRY || DEFAULT_ADMIN_REGISTRY,
    'admin-registry'
  );
  const voteArgs = {
    _target: bridgeAddress,
    _func: 'refundWithdrawal',
    _args: [{ type: 'uint256', value: withdrawalId }],
  };

  console.log(JSON.stringify({
    contract: adminRegistry,
    method: 'castVoteOnIssue',
    args: voteArgs,
  }, null, 2));
  if (!args.execute) {
    console.log('Dry run only. Re-run with --execute to submit this vote.');
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
  const result = await callAndWait({ token }, adminRegistry, voteArgs);
  console.log(`Refund vote submitted successfully (${result.hash})`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = main;
