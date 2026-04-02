/**
 * Deploy a multi-token yield-bearing stable pool (syrupUSDC–sUSDS–saveUSDST).
 *
 * Steps performed:
 *   1. createMultiTokenStablePool via PoolFactory
 *   2. Whitelist the new pool for mint/burn on its LP token via AdminRegistry
 *   3. Configure the pool: setUsdst, setIsYieldToken (saveUSDST)
 *
 * Usage:
 *   node deploy-yield-pool.js
 *
 * Required environment variables (.env):
 *   OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,
 *   GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD
 *
 * Optional overrides (env):
 *   POOL_FACTORY, ADMIN_REGISTRY, PRICE_ORACLE, USDST_ADDRESS,
 *   SYRUP_USDC, SUSDS, SAVE_USDST_VAULT
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest } = require('blockapps-rest');
const { cirrusSearch } = require('./util');

// ── Addresses (mainnet defaults, overridable via env) ──────────────────────

const POOL_FACTORY    = process.env.POOL_FACTORY      || '000000000000000000000000000000000000100a';
const ADMIN_REGISTRY  = process.env.ADMIN_REGISTRY    || '000000000000000000000000000000000000100c';
const PRICE_ORACLE    = process.env.PRICE_ORACLE      || '0000000000000000000000000000000000001002';
const USDST           = process.env.USDST_ADDRESS     || '937efa7e3a77e20bbdbd7c0d32b6514f368c1010';
const SYRUP_USDC      = process.env.SYRUP_USDC        || 'c6c3e9881665d53ae8c222e24ca7a8d069aa56ca';
const SUSDS           = process.env.SUSDS             || '6e2d93d323edf1b3cc4672a909681b6a430cae64';
const SAVE_USDST      = process.env.SAVE_USDST_VAULT  || '22550671fcad04a213697ac7ae4f4366e96446ed';

// ── Helpers ────────────────────────────────────────────────────────────────

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

async function getPoolAddress(tokenObj, poolFactoryAddress) {
  const state = await rest.getState(
    tokenObj,
    { address: poolFactoryAddress, name: 'PoolFactory' },
    { config }
  );
  const allPools = state.allPools || [];
  return allPools[allPools.length - 1];
}

async function getLpToken(tokenObj, poolAddress) {
  const state = await rest.getState(
    tokenObj,
    { address: poolAddress, name: 'StablePool' },
    { config }
  );
  return state.lpToken;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  try {
    console.log('Deploy yield-bearing stable pool');
    console.log('================================\n');

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
    console.log(`  PoolFactory:    ${POOL_FACTORY}`);
    console.log(`  AdminRegistry:  ${ADMIN_REGISTRY}`);
    console.log(`  PriceOracle:    ${PRICE_ORACLE}`);
    console.log(`  USDST:          ${USDST}`);
    console.log(`  syrupUSDC:      ${SYRUP_USDC}`);
    console.log(`  sUSDS:          ${SUSDS}`);
    console.log(`  saveUSDST:      ${SAVE_USDST}\n`);

    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;

    console.log(`Authenticating as ${username}...`);
    const token = await auth.getUserToken(username, password);
    const tokenObj = { token };
    console.log('Authenticated.\n');

    // ── Step 1: Create the multi-token stable pool ───────────────────────

    console.log('Step 1: createMultiTokenStablePool');
    console.log('----------------------------------');

    const createResult = await call(tokenObj, POOL_FACTORY, 'PoolFactory', 'createMultiTokenStablePool', {
      tokens:              [SYRUP_USDC, SUSDS, SAVE_USDST],
      rateMultipliers:     ['1000000000000000000', '1000000000000000000', '1000000000000000000'],
      assetTypes:          ['1', '1', '1'],
      oracles:             [PRICE_ORACLE, PRICE_ORACLE, PRICE_ORACLE],
      containsYieldVaults: true,
    });

    console.log('  createMultiTokenStablePool result:', JSON.stringify(createResult).slice(0, 200));

    const poolAddress = await getPoolAddress(tokenObj, POOL_FACTORY);
    if (!poolAddress) {
      throw new Error('Could not determine new pool address from PoolFactory.allPools');
    }
    console.log(`\n  Pool created at: ${poolAddress}`);

    const lpToken = await getLpToken(tokenObj, poolAddress);
    if (!lpToken) {
      throw new Error('Could not read lpToken from new pool');
    }
    console.log(`  LP token: ${lpToken}\n`);

    // ── Step 2: Whitelist pool for LP mint/burn ──────────────────────────

    console.log('Step 2: Whitelist LP token mint/burn');
    console.log('------------------------------------');

    await call(tokenObj, ADMIN_REGISTRY, 'AdminRegistry', 'addWhitelist', {
      _target: lpToken,
      _func: 'mint',
      _user: poolAddress,
    });
    console.log('  mint whitelist submitted');

    await call(tokenObj, ADMIN_REGISTRY, 'AdminRegistry', 'addWhitelist', {
      _target: lpToken,
      _func: 'burn',
      _user: poolAddress,
    });
    console.log('  burn whitelist submitted\n');

    // ── Step 3: Configure yield-token pricing ────────────────────────────

    console.log('Step 3: Configure yield-token pricing');
    console.log('-------------------------------------');

    await call(tokenObj, poolAddress, 'StablePool', 'setUsdst', {
      _usdst: USDST,
    });
    console.log('  setUsdst submitted');

    await call(tokenObj, poolAddress, 'StablePool', 'setIsYieldToken', {
      token: SAVE_USDST,
      enabled: true,
    });
    console.log('  setIsYieldToken(saveUSDST, true) submitted\n');

    // ── Done ─────────────────────────────────────────────────────────────

    console.log('====== Deployment Complete ======');
    console.log(`Pool:     ${poolAddress}`);
    console.log(`LP Token: ${lpToken}`);
    console.log('================================\n');
    console.log('Next steps:');
    console.log('  1. If any calls above show governance pending, vote to approve them');
    console.log('  2. Seed initial liquidity via StablePool.addLiquidityGeneral()');
    console.log('  3. Verify LP token pricing in the backend\n');

    return { poolAddress, lpToken };
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
