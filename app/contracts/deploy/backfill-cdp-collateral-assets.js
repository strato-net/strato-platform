/**
 * One-time backfill after upgrading the CDPEngine logic contract to the version
 * that adds collateral enumeration (collateralAssets / totalDebtAll).
 *
 * The enumeration array starts empty on the existing proxy, so assets configured
 * before the upgrade must be registered once via registerCollateralAssets.
 * New assets enumerate automatically from setCollateralAssetParams.
 *
 * Usage:
 *   node backfill-cdp-collateral-assets.js --engine-address <proxyAddress> --assets <addr1,addr2,...>
 *
 * If the admin account is OTP-gated, pass the current code via OAUTH_TOTP (same as
 * upgrade-poolv3-nft.js — auth.getUserToken switches to the TOTP grant when it is set).
 * TOTP codes are single-use, so the script authenticates exactly once per run:
 *   OAUTH_TOTP=123456 node backfill-cdp-collateral-assets.js --engine-address ... --assets ...
 *
 * Find the asset list from the Cirrus event table for CollateralConfigured on the
 * engine proxy (dedup the asset column), or from the collateralConfigs record table.
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, util } = require('blockapps-rest');

function printUsage() {
  console.error('Usage: node backfill-cdp-collateral-assets.js --engine-address <address> --assets <addr1,addr2,...>');
  console.error('');
  console.error('Required environment variables (.env):');
  console.error('  OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD [, OAUTH_TOTP]');
  console.error('');
  console.error('OAUTH_TOTP: one-time password, only if the admin account is OTP-gated');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for argument: ${arg}`);
      }
      parsed[key] = value;
      i++;
    }
  }
  return parsed;
}

// Same async + poll pattern as upgrade.js: the sync rest.call resolver crashes on
// user-contract-routed calls, so we submit async and assert success on the receipt.
async function callAsync(tokenObj, callArgs, baseOptions) {
  const asyncOptions = { ...baseOptions, isAsync: true };
  const response = await rest.call(tokenObj, callArgs, asyncOptions);
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error(
      'rest.call returned no tx hash; cannot poll for receipt: ' + JSON.stringify(response)
    );
  }

  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    300000
  );

  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error('Contract call failed: ' + JSON.stringify(final || finalResults));
  }
  return final;
}

async function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(`Error parsing arguments: ${error.message}\n`);
    printUsage();
    process.exit(1);
  }

  const missingArgs = ['engine-address', 'assets'].filter((a) => !args[a]);
  if (missingArgs.length > 0) {
    console.error(`Missing required arguments: ${missingArgs.map((a) => '--' + a).join(', ')}\n`);
    printUsage();
    process.exit(1);
  }

  const requiredVars = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL', 'NODE_URL'];
  const missingVars = requiredVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}\n`);
    printUsage();
    process.exit(1);
  }

  const strip0x = (a) => a.trim().replace(/^0x/i, '');
  const engineAddress = strip0x(args['engine-address']);
  const assets = args['assets'].split(',').map(strip0x).filter(Boolean);
  if (assets.length === 0) {
    throw new Error('No assets provided');
  }

  console.log(`Engine proxy: ${engineAddress}`);
  console.log(`Assets to register (${assets.length}):`);
  assets.forEach((a) => console.log(`  ${a}`));

  // Authenticate ONCE — the token is reused below, so a single OTP code (OAUTH_TOTP)
  // covers the whole run. auth.getUserToken picks the TOTP grant when OAUTH_TOTP is set.
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const tokenObj = { token };
  console.log(`Authenticated as ${process.env.GLOBAL_ADMIN_NAME}\n`);

  const callArgs = {
    contract: { address: engineAddress, name: 'CDPEngine' },
    method: 'registerCollateralAssets',
    args: { assets },
    txParams: {
      gasPrice: config.gasPrice,
      gasLimit: config.gasLimit,
    },
  };

  const receipt = await callAsync(tokenObj, callArgs, { config, cacheNonce: true });
  console.log('====== Backfill Submitted ======');
  console.log(`Tx status: ${receipt.status}`);
  console.log('Verify with (public RPC):');
  console.log(`  cast call 0x${engineAddress} "collateralAssetCount()(uint256)" --rpc-url ${process.env.NODE_URL}/rpc`);
  console.log(`  cast call 0x${engineAddress} "totalDebtAll()(uint256)" --rpc-url ${process.env.NODE_URL}/rpc`);
  console.log('================================');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Backfill failed:', error.message);
    process.exit(1);
  });
}

module.exports = main;
