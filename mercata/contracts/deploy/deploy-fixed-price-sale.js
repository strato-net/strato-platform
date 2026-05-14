/**
 * Deploy + configure a FixedPriceSale for the STRATO token launch.
 *
 * Two modes:
 *   1. `--mode factory`  — deploys a fresh FixedPriceSaleFactory behind a Proxy and initializes
 *                          it with the given PriceOracle. Prints the factory address.
 *   2. `--mode sale`     — calls `createSale` on an existing factory and then adds the listed
 *                          payment tokens. Prints the new sale address.
 *
 * Operator runbook for a complete launch:
 *
 *   # 1) Deploy the factory once per network
 *   node deploy-fixed-price-sale.js --mode factory --price-oracle <oracleAddr>
 *   # → prints FIXED_PRICE_SALE_FACTORY=<factoryAddr>
 *
 *   # 2) Create the sale
 *   node deploy-fixed-price-sale.js --mode sale \
 *     --factory <factoryAddr> \
 *     --name "STRATO Launch" \
 *     --sale-token 2680dc6693021cd3fefb84351570874fbef8332a \
 *     --price-usd 500000000000000000 \           # $0.50 in 1e18
 *     --hard-cap 10000000000000000000000000 \    # 10,000,000 STRATO
 *     --per-wallet-cap 50000000000000000000000 \ # 50,000 STRATO (or 0 to disable)
 *     --start-time 1715616000 \
 *     --end-time 1716220800 \
 *     --payment-tokens 937efa7e3a77e20bbdbd7c0d32b6514f368c1010,<usdcAddr>
 *   # → prints FIXED_PRICE_SALE=<saleAddr>
 *
 *   # 3) Transfer the STRATO allocation into <saleAddr> (manual step — `Token.transfer`)
 *
 * Required env vars: OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL,
 *                    GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, importer, util } = require('blockapps-rest');
const fs = require('fs-extra');
const path = require('path');

function printUsage() {
  console.error('Usage:');
  console.error('  node deploy-fixed-price-sale.js --mode factory --price-oracle <oracleAddr>');
  console.error('  node deploy-fixed-price-sale.js --mode sale --factory <factoryAddr> \\');
  console.error('    --name <name> --sale-token <addr> --price-usd <wad> \\');
  console.error('    --hard-cap <wad> --per-wallet-cap <wad> --start-time <unix> --end-time <unix> \\');
  console.error('    [--payment-tokens <addr1,addr2,...>]');
}

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

const stripComments = (str) => {
  let out = str.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.split('\n').map((ln) => {
    const t = ln.trim();
    if (t.startsWith('//')) {
      return t.includes('SPDX-License-Identifier') ? ln : '';
    }
    return ln.replace(/\/\/.*$/, '');
  }).join('\n');
  return out;
};

async function combineSource(contractFilePath) {
  let source = await importer.combine(contractFilePath);
  if (Buffer.isBuffer(source)) return stripComments(source.toString());
  if (typeof source === 'string') return stripComments(source);
  if (typeof source === 'object') {
    return Object.keys(source).map((k) => {
      let content = source[k];
      content = typeof content === 'string' ? content : String(content);
      content = content.replace(/^.*?\.sol,\s*/i, '');
      return stripComments(content);
    }).join('\n');
  }
  return stripComments(String(source));
};

// Async createContract + poll for receipt — same approach as deployProxy.js
async function deployContractAsync(tokenObj, contractArgs, baseOptions) {
  const asyncOptions = { ...baseOptions, isAsync: true };
  const response = await rest.createContract(tokenObj, contractArgs, asyncOptions);
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error('rest.createContract returned no tx hash: ' + JSON.stringify(response));
  }

  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    60000
  );

  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error('Deployment failed: ' + JSON.stringify(final || finalResults));
  }
  const created = final.txResult && final.txResult.contractsCreated;
  const address = Array.isArray(created) ? created[0] : created;
  if (!address) {
    throw new Error('Deployment succeeded but no contractsCreated entry: ' + JSON.stringify(final));
  }
  return address;
}

async function callContract(tokenObj, contractAddress, contractName, method, args) {
  return rest.call(
    tokenObj,
    {
      contract: { address: contractAddress, name: contractName },
      method,
      args,
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    { config, cacheNonce: true }
  );
}

async function deployFactory(tokenObj, source, args, deployOptions) {
  const priceOracle = args['price-oracle'];
  if (!priceOracle) throw new Error('--price-oracle is required for --mode factory');

  console.log('Step 1/3: deploying FixedPriceSaleFactory implementation...');
  const implArgs = {
    name: 'FixedPriceSaleFactory',
    source,
    args: { initialOwner: 'deadbeef' }, // ignored; proxy owner takes over
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
  const implAddress = await deployContractAsync(tokenObj, implArgs, deployOptions);
  console.log(`  impl: ${implAddress}`);

  console.log('\nStep 2/3: deploying Proxy pointing at the factory impl...');
  const ownerAddr = (await rest.getKey(tokenObj, { config })).toLowerCase();
  const proxyArgs = {
    name: 'Proxy',
    source,
    args: {
      _logicContract: implAddress,
      _initialOwner: ownerAddr,
    },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
  const factoryAddress = await deployContractAsync(tokenObj, proxyArgs, deployOptions);
  console.log(`  factory: ${factoryAddress}`);

  console.log('\nStep 3/3: initializing factory with PriceOracle...');
  await callContract(tokenObj, factoryAddress, 'FixedPriceSaleFactory', 'initialize', {
    _priceOracle: priceOracle,
  });

  console.log('\n====== FixedPriceSaleFactory Deployed ======');
  console.log(`FIXED_PRICE_SALE_FACTORY=${factoryAddress}`);
  console.log(`Impl:        ${implAddress}`);
  console.log(`Price Oracle: ${priceOracle}`);
  console.log('==========================================');
}

async function createSale(tokenObj, args) {
  const required = ['factory', 'name', 'sale-token', 'price-usd', 'hard-cap', 'per-wallet-cap', 'start-time', 'end-time'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required arguments for --mode sale: ${missing.map((a) => '--' + a).join(', ')}`);
  }

  const factoryAddr = args['factory'];
  const createArgs = {
    name: args['name'],
    saleToken: args['sale-token'],
    pricePerTokenUSD: args['price-usd'],
    hardCap: args['hard-cap'],
    perWalletCap: args['per-wallet-cap'],
    startTime: args['start-time'],
    endTime: args['end-time'],
  };

  console.log('Calling FixedPriceSaleFactory.createSale with:');
  console.log(JSON.stringify(createArgs, null, 2));

  const result = await callContract(tokenObj, factoryAddr, 'FixedPriceSaleFactory', 'createSale', createArgs);
  const saleAddress = Array.isArray(result) ? result[0] : result;
  console.log(`\nSale created at: ${saleAddress}`);

  // Add payment tokens
  const paymentArg = args['payment-tokens'];
  if (paymentArg) {
    const tokens = paymentArg.split(',').map((s) => s.trim()).filter(Boolean);
    for (const pt of tokens) {
      console.log(`  Adding payment token ${pt}...`);
      await callContract(tokenObj, saleAddress, 'FixedPriceSale', 'addPaymentToken', { paymentToken: pt });
    }
  }

  console.log('\n====== FixedPriceSale Created ======');
  console.log(`FIXED_PRICE_SALE=${saleAddress}`);
  console.log(`Factory:     ${factoryAddr}`);
  console.log(`Sale token:  ${args['sale-token']}`);
  console.log(`Price (USD): ${args['price-usd']}  (1e18 = $1)`);
  console.log(`Hard cap:    ${args['hard-cap']}`);
  console.log(`Wallet cap:  ${args['per-wallet-cap']}  (0 = disabled)`);
  console.log(`Schedule:    ${args['start-time']} → ${args['end-time']}`);
  if (paymentArg) console.log(`Payment(s):  ${paymentArg}`);
  console.log('\nNext step: transfer the sale-token allocation into the sale address.');
  console.log('===================================');
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

  const mode = args['mode'];
  if (mode !== 'factory' && mode !== 'sale') {
    console.error('--mode must be "factory" or "sale"\n');
    printUsage();
    process.exit(1);
  }

  const requiredVars = [
    'GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD',
    'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL', 'NODE_URL',
  ];
  const missingVars = requiredVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
  }

  const username = process.env.GLOBAL_ADMIN_NAME;
  const password = process.env.GLOBAL_ADMIN_PASSWORD;
  console.log(`Authenticating as ${username}...`);
  const accessToken = await auth.getUserToken(username, password);
  const tokenObj = { token: accessToken };
  console.log('Authenticated.\n');

  if (mode === 'factory') {
    const contractFile = args['contract-file'] || config.mainFile || 'BaseCodeCollection.sol';
    const contractsDir = config.resolvePath(config.contractsDir);
    const contractFilePath = path.join(contractsDir, contractFile);
    if (!fs.existsSync(contractFilePath)) {
      throw new Error(`Contract file not found: ${contractFilePath}`);
    }
    console.log(`Combining source from: ${contractFilePath}`);
    const source = await combineSource(contractFilePath);
    console.log('Comments stripped from combined source(s).\n');

    const deployOptions = {
      config,
      logger: console,
      history: ['FixedPriceSaleFactory', 'FixedPriceSale', 'Proxy'],
      cacheNonce: true,
      query: { username: 'BlockApps' },
    };

    await deployFactory(tokenObj, source, args, deployOptions);
  } else {
    await createSale(tokenObj, args);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nFailed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  });
}

module.exports = main;
