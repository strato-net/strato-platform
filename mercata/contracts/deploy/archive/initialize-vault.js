/**
 * Initialize a freshly deployed YieldVault proxy.
 *
 * Usage:
 *   node initialize-vault.js --vault-address <addr> --asset <token> --name <name> --symbol <symbol>
 *
 * See deploy-yield-vault.md for the full deployment runbook.
 */
require('dotenv').config();
const config = require('../config');
const auth = require('../auth');
const { rest } = require('blockapps-rest');

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

async function main() {
  const args = parseArgs();

  const required = ['vault-address', 'asset', 'name', 'symbol'];
  const missing = required.filter(k => !args[k]);
  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.map(a => '--' + a).join(', ')}`);
    console.error('\nUsage:');
    console.error('  node initialize-vault.js --vault-address <addr> --asset <token> --name <name> --symbol <symbol>');
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

  const vaultAddress = args['vault-address'];
  const initArgs = {
    asset_:  args['asset'],
    name_:   args['name'],
    symbol_: args['symbol'],
  };

  console.log(`Calling YieldVault(${vaultAddress}).initialize(${JSON.stringify(initArgs)})`);

  const result = await rest.call(
    tokenObj,
    {
      contract: { address: vaultAddress, name: 'YieldVault' },
      method: 'initialize',
      args: initArgs,
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    { config, cacheNonce: true }
  );

  if (result && result[0]) {
    console.log('\nGovernance vote required. Vote Issue ID:', result[0]);
  } else {
    console.log('\nInitialize successful.');
  }

  console.log(`\nVault address: ${vaultAddress}`);
}

main().catch(error => {
  console.error('Failed:', error.message);
  process.exit(1);
});
