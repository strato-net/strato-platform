/**
 * Confirm, abort, or owner-authorize reuse of a reviewed deposit identity.
 *
 * Confirm calls the bridge operator service. Abort submits an owner-governance
 * vote through AdminRegistry. Abort is final until a separate reuse vote.
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
    if (args[i] === '--execute') {
      parsed.execute = true;
    } else if (args[i].startsWith('--')) {
      parsed[args[i].slice(2)] = args[++i];
    }
  }
  return parsed;
}

function address(value, label) {
  const normalized = String(value || '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
  return normalized.toLowerCase();
}

function operationUrl(args, action) {
  const baseUrl = String(
    args['bridge-service-url'] || process.env.BRIDGE_SERVICE_URL || ''
  ).replace(/\/$/, '');
  if (!baseUrl) throw new Error('BRIDGE_SERVICE_URL is required');
  return `${baseUrl}/operations/deposits/${args['external-chain-id']}/${address(
    args['deposit-router'],
    'deposit-router'
  )}/${args['deposit-id']}/${action}`;
}

async function callOperator(url) {
  if (!process.env.DEPOSIT_OPERATIONS_TOKEN) {
    throw new Error('DEPOSIT_OPERATIONS_TOKEN is required');
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DEPOSIT_OPERATIONS_TOKEN}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Operator call failed (${response.status}): ${await response.text()}`);
  }
  console.log(await response.text());
}

async function getDepositStatus(token, args) {
  const baseUrl = String(config.nodes[0].url || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('NODE_URL is required');
  const params = new URLSearchParams({
    address: `eq.${address(args['bridge-address'], 'bridge-address')}`,
    key: `eq.${args['external-chain-id']}`,
    key2: `eq.${address(args['deposit-router'], 'deposit-router')}`,
    key3: `eq.${args['deposit-id']}`,
    select: 'value->>status',
    limit: '1',
  });
  const response = await fetch(
    `${baseUrl}/cirrus/search/BlockApps-ExternalAssetBridge-deposits?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    throw new Error(`Deposit status query failed (${response.status}): ${await response.text()}`);
  }
  const rows = await response.json();
  return rows[0]?.status == null ? undefined : String(rows[0].status);
}

async function waitForReuseAuthorization(token, args) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const status = await getDepositStatus(token, args);
    if (status === '0') return true;
    if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function confirm(args) {
  const chainId = String(args['external-chain-id'] || '');
  const depositId = String(args['deposit-id'] || '');
  if (!/^[1-9][0-9]*$/.test(chainId) || !/^[1-9][0-9]*$/.test(depositId)) {
    throw new Error('external-chain-id and deposit-id must be positive integers');
  }
  const url = operationUrl(args, 'confirm');
  console.log(JSON.stringify({ method: 'POST', url }, null, 2));
  if (!args.execute) return;
  await callOperator(url);
}

async function governDeposit(args, method, label, resetAfter) {
  const bridge = address(args['bridge-address'], 'bridge-address');
  const router = address(args['deposit-router'], 'deposit-router');
  const chainId = String(args['external-chain-id'] || '');
  const depositId = String(args['deposit-id'] || '');
  if (!/^[1-9][0-9]*$/.test(chainId) || !/^[1-9][0-9]*$/.test(depositId)) {
    throw new Error('external-chain-id and deposit-id must be positive integers');
  }
  const registry = address(
    args['admin-registry'] || process.env.ADMIN_REGISTRY || DEFAULT_ADMIN_REGISTRY,
    'admin-registry'
  );
  const voteArgs = {
    _target: bridge,
    _func: method,
    _args: [
      { type: 'uint256', value: chainId },
      { type: 'address', value: router },
      { type: 'uint256', value: depositId },
    ],
  };
  console.log(JSON.stringify({
    contract: registry,
    method: 'castVoteOnIssue',
    args: voteArgs,
  }, null, 2));
  const resetUrl = resetAfter ? operationUrl(args, 'reset') : undefined;
  if (resetUrl) {
    console.log(JSON.stringify({ afterGovernanceExecution: resetUrl }, null, 2));
  }
  if (!args.execute) return;
  const required = [
    'GLOBAL_ADMIN_NAME',
    'GLOBAL_ADMIN_PASSWORD',
    'OAUTH_CLIENT_SECRET',
    'OAUTH_CLIENT_ID',
    'OAUTH_URL',
    'NODE_URL',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  const token = await auth.getUserToken(
    process.env.GLOBAL_ADMIN_NAME,
    process.env.GLOBAL_ADMIN_PASSWORD
  );
  const response = await rest.call(
    { token },
    {
      contract: { address: registry, name: 'AdminRegistry' },
      method: 'castVoteOnIssue',
      args: voteArgs,
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    { config, cacheNonce: true, isAsync: true }
  );
  const hashes = (Array.isArray(response) ? response : [response])
    .map((item) => item && item.hash)
    .filter(Boolean);
  if (!hashes.length) {
    throw new Error('AdminRegistry.castVoteOnIssue returned no transaction hash');
  }
  const results = await util.until(
    (items) =>
      Array.isArray(items) &&
      items.length > 0 &&
      items.every((item) => item && item.status && item.status !== 'Pending'),
    (options) => rest.getBlocResults({ token }, hashes, options),
    { config, isAsync: true },
    60000
  );
  const final = Array.isArray(results) ? results[0] : results;
  if (!final || final.status !== 'Success') {
    throw new Error(`${label} vote failed: ${JSON.stringify(final || results)}`);
  }
  console.log(`${label} vote submitted successfully (${final.hash})`);
  if (resetUrl) {
    if (!(await waitForReuseAuthorization(token, args))) {
      console.log('Reuse authorization has not executed; local state was not reset');
      return;
    }
    await callOperator(resetUrl);
  }
}

async function main() {
  const args = parseArgs();
  if (args.decision === 'confirm') return confirm(args);
  if (args.decision === 'abort') {
    return governDeposit(args, 'abortDeposit', 'Abort', false);
  }
  if (args.decision === 'reuse') {
    return governDeposit(args, 'authorizeDepositReuse', 'Reuse authorization', true);
  }
  throw new Error('--decision must be confirm, abort, or reuse');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = main;
