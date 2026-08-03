/**
 * Initialize freshly deployed native bridge proxies.
 *
 * Usage:
 *   node initialize-native-bridge.js \
 *     --bridge-address <addr> \
 *     --vault-address <addr> \
 *     --token-factory <addr> \
 *     --bridge-operator <addr> \
 *     --guardian <addr>
 */
require('dotenv').config();
const config = require('../config');
const auth = require('../auth');
const { rest, util } = require('blockapps-rest');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
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

function buildTxParams() {
  return { gasPrice: config.gasPrice, gasLimit: config.gasLimit };
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
    'vault-address',
    'token-factory',
    'bridge-operator',
    'guardian',
  ];
  const missing = required.filter((key) => !args[key]);

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.map((key) => `--${key}`).join(', ')}`);
    console.error('\nUsage:');
    console.error(
      '  node initialize-native-bridge.js --bridge-address <addr> --vault-address <addr> --token-factory <addr> --bridge-operator <addr> --guardian <addr>'
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
  const vaultAddress = args['vault-address'];
  const tokenFactory = args['token-factory'];
  const bridgeOperator = args['bridge-operator'];
  const guardian = args.guardian;

  const bridgeArgs = {
    _tokenFactory: tokenFactory,
    _custodyVault: vaultAddress,
    _bridgeOperator: bridgeOperator,
    _guardian: guardian,
  };
  const vaultArgs = {
    _bridge: bridgeAddress,
    _guardian: guardian,
  };

  console.log('Native bridge initialization plan:');
  console.log(JSON.stringify({
    bridgeAddress,
    vaultAddress,
    bridgeArgs,
    vaultArgs,
  }, null, 2));
  console.log('');

  console.log(`Calling StratoNativeBridge(${bridgeAddress}).initialize(...)`);
  const bridgeResult = await callContract(
    tokenObj,
    bridgeAddress,
    'StratoNativeBridge',
    'initialize',
    bridgeArgs
  );
  logCallResult('Bridge initialize', bridgeResult);

  console.log(`\nCalling StratoNativeCustodyVault(${vaultAddress}).initialize(...)`);
  const vaultResult = await callContract(
    tokenObj,
    vaultAddress,
    'StratoNativeCustodyVault',
    'initialize',
    vaultArgs
  );
  logCallResult('Vault initialize', vaultResult);

  console.log('\nNative bridge initialize flow complete.');
  console.log(`Bridge proxy: ${bridgeAddress}`);
  console.log(`Vault proxy: ${vaultAddress}`);
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
