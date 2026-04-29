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
 *     [--enabled <true|false>]
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
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

function buildTxParams() {
  return { gasPrice: config.gasPrice, gasLimit: config.gasLimit };
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

async function callContract(tokenObj, address, name, method, args) {
  const callArgs = {
    contract: { address, name },
    method,
    args,
    txParams: buildTxParams(),
  };
  const response = await rest.call(
    tokenObj,
    callArgs,
    { config, cacheNonce: true, isAsync: true }
  );
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((item) => item && item.hash).filter(Boolean);

  if (hashes.length === 0) {
    throw new Error(
      `rest.call returned no tx hash for ${name}.${method}: ${JSON.stringify(response)}`
    );
  }

  const finalResults = await util.until(
    (results) =>
      Array.isArray(results) &&
      results.length > 0 &&
      results.every((result) => result && result.status && result.status !== 'Pending'),
    (options) => rest.getBlocResults(tokenObj, hashes, options),
    { config, isAsync: true },
    60000
  );

  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error(
      `Contract call failed for ${name}.${method}: ${JSON.stringify(final || finalResults)}`
    );
  }

  return final;
}

function logCallResult(label, result) {
  const suffix = result && result.hash ? ` (tx: ${result.hash})` : '';
  console.log(`${label}: submitted successfully${suffix}`);
}

async function main() {
  const args = parseArgs();
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
  const missing = required.filter((key) => !args[key]);

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.map((key) => `--${key}`).join(', ')}`);
    console.error('\nUsage:');
    console.error(
      '  node configure-native-route.js --bridge-address <addr> --external-chain-id <id> --external-bridge <addr> --representation-token <addr> --external-name <name> --external-symbol <symbol> --max-per-withdrawal <amount> --strato-token <addr> [--enabled <true|false>]'
    );
    process.exit(1);
  }

  const username = process.env.GLOBAL_ADMIN_NAME;
  const password = process.env.GLOBAL_ADMIN_PASSWORD;
  if (!username || !password) {
    console.error('Missing GLOBAL_ADMIN_NAME / GLOBAL_ADMIN_PASSWORD in .env');
    process.exit(1);
  }

  console.log(`Authenticating as ${username}...`);
  const token = await auth.getUserToken(username, password);
  const tokenObj = { token };
  console.log('Authenticated.\n');

  const bridgeAddress = args['bridge-address'];
  const callArgs = {
    enabled: parseBoolean(args.enabled, true),
    externalChainId: ensurePositiveIntegerString(args['external-chain-id'], 'external-chain-id'),
    externalBridge: args['external-bridge'],
    representationToken: args['representation-token'],
    externalName: args['external-name'],
    externalSymbol: args['external-symbol'],
    maxPerWithdrawal: String(args['max-per-withdrawal']).trim(),
    instantWithdrawalThreshold: String(
      args['instant-withdrawal-threshold'] == null
        ? '0'
        : args['instant-withdrawal-threshold']
    ).trim(),
    stratoToken: args['strato-token'],
  };

  if (!/^[0-9]+$/.test(callArgs.maxPerWithdrawal)) {
    throw new Error('max-per-withdrawal must be an unsigned integer string');
  }
  if (!/^[0-9]+$/.test(callArgs.instantWithdrawalThreshold)) {
    throw new Error('instant-withdrawal-threshold must be an unsigned integer string');
  }

  console.log('Native route configuration plan:');
  console.log(JSON.stringify({ bridgeAddress, callArgs }, null, 2));
  console.log('');

  console.log(`Calling StratoNativeBridge(${bridgeAddress}).setAsset(...)`);
  const result = await callContract(
    tokenObj,
    bridgeAddress,
    'StratoNativeBridge',
    'setAsset',
    callArgs
  );
  logCallResult('Route configuration', result);

  console.log('\nNative route configuration complete.');
  console.log(`Bridge proxy: ${bridgeAddress}`);
  console.log(`STRATO token: ${callArgs.stratoToken}`);
  console.log(`External chain id: ${callArgs.externalChainId}`);
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
