/**
 * Deploy a YieldVault for ETH (ERC-4626 vault accepting ETH deposits).
 *
 * Steps performed:
 *   1. Deploy YieldVault contract (owner = AdminRegistry)
 *   2. Initialize with ETH as the underlying asset
 *
 * Usage:
 *   node deploy-eth-carry-vault.js
 *
 * Required environment variables (.env):
 *   OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,
 *   GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD
 *
 * Optional overrides (env):
 *   ADMIN_REGISTRY, ETH_TOKEN
 *
 * SolidVM / blockapps-rest: combined sources include lines like `//import "..."`
 * from the SDK importer; SolidVM rejects the `/` in those lines. We strip every
 * whole-line // comment before compile.
 */
require('dotenv').config();
const path = require('path');
const config = require('./config');
const auth = require('./auth');
const { saveCreateTXDataAsFile } = require('./util');
const { rest, importer, util } = require('blockapps-rest');

// ── Addresses (mainnet defaults, overridable via env) ──────────────────────

const ADMIN_REGISTRY = process.env.ADMIN_REGISTRY || '000000000000000000000000000000000000100c';
const ETH_TOKEN      = process.env.ETH_TOKEN      || '93fb7295859b2d70199e0a4883b7c320cf874e6c';

// ── Helpers ────────────────────────────────────────────────────────────────

/** STRATO / bloc returns `contractsCreated` as a single-element array. */
function addressFromDeployResult(txResult) {
  const c = txResult && txResult.contractsCreated;
  if (Array.isArray(c)) return c[0] || '';
  return c || '';
}

/** SolidVM rejects line comments that start with // (e.g. //import, // SPDX). */
function stripSolidVMFullLineComments(src) {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (t.startsWith('//')) return false;
      return true;
    })
    .join('\n');
}

function callArgs(address, contractName, method, args) {
  return {
    contract: { address, name: contractName },
    method,
    args,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
}

const callOpts = { config, cacheNonce: true };

async function call(tokenObj, address, contractName, method, args) {
  console.log(`  → ${contractName}(${address}).${method}(${JSON.stringify(args)})`);
  const result = await rest.call(
    tokenObj,
    callArgs(address, contractName, method, args),
    callOpts
  );
  return result;
}

async function deployYieldVault(tokenObj) {
  const entryPath = path.resolve(__dirname, '../concrete/YieldVault/YieldVault.sol');
  const contractsRoot = path.resolve(__dirname, '..');

  console.log('  Resolving imports (blockapps-rest importer)...');
  const combined = await importer.combineToString(entryPath, contractsRoot);
  const source = stripSolidVMFullLineComments(combined);
  console.log(`  Combined source: ${combined.length} chars → ${source.length} after SolidVM comment strip\n`);

  const contractArgs = {
    name: 'YieldVault',
    source,
    args: { initialOwner: ADMIN_REGISTRY },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };

  const options = {
    config,
    history: 'YieldVault',
    cacheNonce: true,
    isAsync: true,
  };

  console.log('Deploying via rest.createContract...');
  const response = await rest.createContract(tokenObj, contractArgs, options);
  const responseArray = Array.isArray(response) ? response : [response];

  const predicate = (results) =>
    results.filter((r) => r.status === 'Pending').length === 0;
  const action = async (opts) =>
    rest.getBlocResults(
      tokenObj,
      responseArray.map((r) => r.hash),
      opts
    );
  const finalResults = await util.until(predicate, action, { config, isAsync: true }, 3600000);
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (final.status !== 'Success') {
    throw new Error('Contract deployment failed (see bloc results for detail).');
  }
  return final;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  try {
    console.log('Deploy ETH Yield Vault');
    console.log('======================\n');

    const requiredVars = [
      'GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD',
      'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL', 'NODE_URL',
    ];
    const missing = requiredVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      console.error(`Missing env vars: ${missing.join(', ')}`);
      process.exit(1);
    }

    console.log('Addresses:');
    console.log(`  AdminRegistry:  ${ADMIN_REGISTRY}`);
    console.log(`  ETH token:      ${ETH_TOKEN}\n`);

    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;

    console.log(`Authenticating as ${username}...`);
    const token = await auth.getUserToken(username, password);
    const tokenObj = { token };
    console.log('Authenticated.\n');

    // ── Step 1: Deploy YieldVault ─────────────────────────────────────────

    console.log('Step 1: Deploy YieldVault contract');
    console.log('----------------------------------');

    const deployResult = await deployYieldVault(tokenObj);

    const vaultAddress = addressFromDeployResult(deployResult.txResult);
    if (!vaultAddress) {
      throw new Error('Could not read contract address from deploy txResult.contractsCreated');
    }
    console.log(`  YieldVault deployed at: ${vaultAddress}\n`);

    await saveCreateTXDataAsFile('YieldVault-ETH', deployResult);

    // ── Step 2: Initialize the vault ──────────────────────────────────────

    console.log('Step 2: Initialize vault');
    console.log('------------------------');

    await call(tokenObj, vaultAddress, 'YieldVault', 'initialize', {
      asset_:  ETH_TOKEN,
      name_:   'ETH Carry Vault',
      symbol_: 'carryETH',
    });
    console.log('  initialize submitted\n');

    // ── Done ─────────────────────────────────────────────────────────────

    console.log('====== Deployment Complete ======');
    console.log(`Vault:  ${vaultAddress}`);
    console.log('================================\n');
    console.log('Next steps:');
    console.log(`  1. If initialize shows governance pending, vote to approve it`);
    console.log(`  2. Set ETH_CARRY_VAULT=${vaultAddress} in backend .env`);
    console.log(`  3. Verify vault state: exchangeRate(), totalAssets(), paused()`);
    console.log(`  4. Seed an initial deposit to establish the exchange rate\n`);

    return { vaultAddress };
  } catch (error) {
    console.error('\nDeployment failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = main;
