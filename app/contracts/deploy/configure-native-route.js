/**
 * Configure a STRATO-native bridge route.
 *
 * Usage:
 *   node configure-native-route.js \
 *     --bridge-address <addr> \
 *     --external-chain-id <id> \
 *     --external-bridge <addr> \
 *     --representation-token <addr> \
 *     --external-name <name> \
 *     --external-symbol <symbol> \
 *     --max-per-withdrawal <amount> \
 *     [--instant-withdrawal-threshold <amount>] \
 *     --strato-token <addr> \
 *     [--token-router <addr>] \
 *     [--auto-route-enabled <true|false>] \
 *     [--enabled <true|false>] \
 *     [--settlement-verifiers <addr,addr,...> \
 *      --settlement-verifier-threshold <count>] \
 *     [--admin-registry <addr>] \
 *     [--deposits-disabled <true|false> \
 *      --withdrawals-disabled <true|false> \
 *      --max-outstanding-withdrawal <amount>] \
 *     [--execute]
 *
 * Dry-run is the default. Owner-only calls are submitted through AdminRegistry
 * when --execute is supplied.
 */
require('dotenv').config();
const auth = require('./auth');
const { submit } = require('./configure-external-bridge');

const DEFAULT_ADMIN_REGISTRY = '000000000000000000000000000000000000100c';

function parseArgs(args = process.argv.slice(2)) {
  const parsed = { execute: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute') {
      parsed.execute = true;
      continue;
    }
    if (!args[i].startsWith('--')) continue;

    const key = args[i].slice(2);
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for argument: ${args[i]}`);
    }

    parsed[key] = value;
    i++;
  }

  return parsed;
}

function parseBoolean(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function ensurePositiveIntegerString(value, label) {
  const normalized = String(value).trim();
  if (!/^[0-9]+$/.test(normalized)) {
    throw new Error(`${label} must be an unsigned integer string`);
  }
  if (normalized === '0') {
    throw new Error(`${label} must be greater than zero`);
  }
  return normalized;
}

function normalizeAddress(value, label) {
  const normalized = String(value || '').replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized) || /^0{40}$/.test(normalized)) {
    throw new Error(`${label} must be a nonzero 20-byte hex address`);
  }
  return normalized;
}

const parameter = (type, value) => ({ type, value });

function governanceCall(adminRegistry, target, func, args) {
  return {
    contract: adminRegistry,
    method: 'castVoteOnIssue',
    args: { _target: target, _func: func, _args: args },
  };
}

function buildPlan(args) {
  const required = [
    'bridge-address',
    'external-chain-id',
    'external-bridge',
    'representation-token',
    'external-name',
    'external-symbol',
    'max-per-withdrawal',
    'strato-token',
  ];
  const tokenRouter = args['token-router'];
  const autoRouteEnabled = parseBoolean(args['auto-route-enabled'], undefined);
  const missing = required.filter((key) => !args[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.map((key) => `--${key}`).join(', ')}`);
  }

  const bridgeAddress = normalizeAddress(args['bridge-address'], 'bridge-address');
  const adminRegistry = normalizeAddress(
    args['admin-registry'] || DEFAULT_ADMIN_REGISTRY,
    'admin-registry'
  );
  const callArgs = {
    enabled: parseBoolean(args.enabled, true),
    externalChainId: ensurePositiveIntegerString(args['external-chain-id'], 'external-chain-id'),
    externalBridge: normalizeAddress(args['external-bridge'], 'external-bridge'),
    representationToken: normalizeAddress(args['representation-token'], 'representation-token'),
    externalName: args['external-name'],
    externalSymbol: args['external-symbol'],
    maxPerWithdrawal: String(args['max-per-withdrawal']).trim(),
    instantWithdrawalThreshold: String(
      args['instant-withdrawal-threshold'] == null
        ? '0'
        : args['instant-withdrawal-threshold']
    ).trim(),
    stratoToken: normalizeAddress(args['strato-token'], 'strato-token'),
  };
  const settlementVerifierInput = args['settlement-verifiers'];
  const settlementThresholdInput = args['settlement-verifier-threshold'];
  if ((settlementVerifierInput == null) !== (settlementThresholdInput == null)) {
    throw new Error(
      '--settlement-verifiers and --settlement-verifier-threshold must be provided together'
    );
  }
  const settlementVerifiers = settlementVerifierInput == null
    ? []
    : settlementVerifierInput.split(',').map((value, index) =>
        normalizeAddress(value.trim(), `settlement-verifiers[${index}]`)
      );
  const settlementVerifierThreshold = settlementThresholdInput == null
    ? null
    : Number(ensurePositiveIntegerString(
        settlementThresholdInput,
        'settlement-verifier-threshold'
      ));
  if (
    settlementVerifiers.length > 0 &&
    (
      new Set(settlementVerifiers).size !== settlementVerifiers.length ||
      settlementVerifierThreshold < 2 ||
      settlementVerifierThreshold > settlementVerifiers.length
    )
  ) {
    throw new Error(
      'Settlement verifiers must be distinct and the threshold must be between 2 and the verifier count'
    );
  }
  const normalizedTokenRouter = tokenRouter
    ? normalizeAddress(tokenRouter, 'token-router')
    : null;
  const tokenConfigKeys = [
    'deposits-disabled',
    'withdrawals-disabled',
    'max-outstanding-withdrawal',
  ];
  const providedTokenConfigKeys = tokenConfigKeys.filter((key) => args[key] != null);
  if (providedTokenConfigKeys.length > 0 && providedTokenConfigKeys.length !== tokenConfigKeys.length) {
    throw new Error(`Token bridge configuration requires: ${tokenConfigKeys.map((key) => `--${key}`).join(', ')}`);
  }
  const tokenConfigArgs = providedTokenConfigKeys.length === tokenConfigKeys.length
    ? {
        stratoToken: callArgs.stratoToken,
        depositsDisabled: parseBoolean(args['deposits-disabled']),
        withdrawalsDisabled: parseBoolean(args['withdrawals-disabled']),
        maxOutstandingWithdrawal: String(args['max-outstanding-withdrawal']).trim(),
      }
    : null;

  if (!/^[0-9]+$/.test(callArgs.maxPerWithdrawal)) {
    throw new Error('max-per-withdrawal must be an unsigned integer string');
  }
  if (!/^[0-9]+$/.test(callArgs.instantWithdrawalThreshold)) {
    throw new Error('instant-withdrawal-threshold must be an unsigned integer string');
  }
  if (tokenConfigArgs && !/^[0-9]+$/.test(tokenConfigArgs.maxOutstandingWithdrawal)) {
    throw new Error('max-outstanding-withdrawal must be an unsigned integer string');
  }

  const calls = [];
  const add = (func, methodArgs) =>
    calls.push(governanceCall(adminRegistry, bridgeAddress, func, methodArgs));
  settlementVerifiers.forEach((verifier) =>
    add('setSettlementVerifier', [
      parameter('address', verifier),
      parameter('bool', true),
    ])
  );
  if (settlementVerifierThreshold != null) {
    add('setSettlementVerifierThreshold', [
      parameter('uint8', String(settlementVerifierThreshold)),
    ]);
  }
  add('setAsset', [
    parameter('bool', callArgs.enabled),
    parameter('uint256', callArgs.externalChainId),
    parameter('address', callArgs.externalBridge),
    parameter('address', callArgs.representationToken),
    parameter('string', callArgs.externalName),
    parameter('string', callArgs.externalSymbol),
    parameter('uint256', callArgs.maxPerWithdrawal),
    parameter('uint256', callArgs.instantWithdrawalThreshold),
    parameter('address', callArgs.stratoToken),
  ]);
  if (tokenConfigArgs) {
    add('setTokenBridgeConfig', [
      parameter('address', tokenConfigArgs.stratoToken),
      parameter('bool', tokenConfigArgs.depositsDisabled),
      parameter('bool', tokenConfigArgs.withdrawalsDisabled),
      parameter('uint256', tokenConfigArgs.maxOutstandingWithdrawal),
    ]);
  }
  if (normalizedTokenRouter) {
    add('setTokenRouter', [parameter('address', normalizedTokenRouter)]);
  }
  if (autoRouteEnabled !== undefined) {
    add('setAutoRouteEnabled', [
      parameter('address', callArgs.stratoToken),
      parameter('uint256', callArgs.externalChainId),
      parameter('bool', autoRouteEnabled),
    ]);
  }
  return { adminRegistry, bridgeAddress, calls };
}

async function main() {
  let args = parseArgs();
  if (args.config) {
    const routes = JSON.parse(require('fs').readFileSync(args.config, 'utf8'));
    const index = Number(args.route);
    if (!Array.isArray(routes) || args.route == null || !Number.isSafeInteger(index) || index < 0 || !routes[index]) {
      throw new Error('--config requires --route <zero-based index> from native-routes.json');
    }
    args = { ...routes[index], ...args };
    if (JSON.stringify(args).includes('REVIEW_REQUIRED')) throw new Error('Resolve the native route inputs before generating votes');
  }
  const plan = buildPlan(args);
  console.log(JSON.stringify(plan, null, 2));
  if (!args.execute) {
    console.log('Dry run only. Re-run with --execute to submit governance votes.');
    return;
  }
  const username = process.env.GLOBAL_ADMIN_NAME;
  const password = process.env.GLOBAL_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('Missing GLOBAL_ADMIN_NAME / GLOBAL_ADMIN_PASSWORD in .env');
  }
  const token = await auth.getUserToken(username, password);
  for (let index = 0; index < plan.calls.length; index += 1) {
    const call = plan.calls[index];
    const result = await submit({ token }, call);
    console.log(JSON.stringify({
      call: index + 1,
      function: call.args._func,
      ...result,
    }));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('configure-native-route failed:', error.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, buildPlan };
