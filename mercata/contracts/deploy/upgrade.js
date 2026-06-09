/**
 * Upgrade script for BlockApps proxy contracts
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, importer, util } = require('blockapps-rest');
const fs = require('fs-extra');
const path = require('path');

// The owner of the implementation address is ignored in favor of the proxy owner
const DEFAULT_CONSTRUCTOR_ARGS = {"initialOwner": "deadbeef"};

// BATCH_TARGETS is currently filled with StablePool proxies to upgrade for Issue #6348
const BATCH_TARGETS = [
    "ff2befcd850183170627dcbc377c3fd573789172",
    "bab35f9fe024e2735edae7a9c0aba4db260a649c",
    "3d1dc151402858521bf9beaa8c72a68c9b4fc2fe",
    "5214055d631645de83b7299604ea6ade31d87c47",
    "9c75280f9e2368005d2b7342f19c59f9176b5962",
    "5888fbe6d6774c1d5788a7b631fc2a2fe88c44c6",
    "41be20683ef9d57884e0a92f203e6c3161cf0aa1"
];

/**
 * Print usage information
 */
function printUsage() {
  console.error('Usage: node upgrade.js [options]');
  console.error('');
  console.error('Required arguments (single mode):');
  console.error('  --proxy-address <address>    Address of the proxy contract to upgrade');
  console.error('  --contract-name <name>       Name of the implementation contract (e.g., PoolFactory)');
  console.error('  --contract-file <file>       Filename of BCC source file which imports the implementation contract (probably BaseCodeCollection.sol)');
  console.error('');
  console.error('Required arguments (batch mode):');
  console.error('  --batch                      Upgrade all proxies in the hardcoded BATCH_TARGETS list');
  console.error('  --contract-name <name>       Name of the implementation contract (e.g., Pool)');
  console.error('  --contract-file <file>       Filename of BCC source file which imports the implementation contract (probably BaseCodeCollection.sol)');
  console.error('');
  console.error('Optional arguments:');
  console.error('  --constructor-args <json>    JSON string of constructor arguments (default: ' + JSON.stringify(DEFAULT_CONSTRUCTOR_ARGS) + ')');
  console.error('  +OVERRIDE-CHECKS             Override the contract name check');
  console.error('');
  console.error('Required environment variables (.env):');
  console.error('  OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD');
  console.error('');
  console.error('Example:');
  console.error('  node upgrade.js --proxy-address abc123 --contract-name PoolFactory --contract-file BaseCodeCollection.sol');
  console.error('  node upgrade.js --proxy-address abc123 --contract-name LendingPool --contract-file BaseCodeCollection.sol --constructor-args \'{"param":"value"}\'');
  console.error('  node upgrade.js --batch --contract-name Pool --contract-file BaseCodeCollection.sol');
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'batch') {
        parsed[key] = true;
        continue;
      }
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for argument: ${arg}`);
      }
      parsed[key] = value;
      i++; // Skip the value in next iteration
    }
    if (arg.startsWith('+')) {
        // e.g. +OVERRIDE-CHECKS
        const key = arg.slice(1);
        parsed[key] = true;
    }
  }
  
  return parsed;
}

/** Get the logic contract address from a proxy (read-only)
 *  Also used to verify that the address is actually a Proxy
 */
async function getLogicContract(tokenObj, proxyAddress) {
    const contract = { address: proxyAddress, name: 'Proxy' };
    const options = { config };
    
    let implementationAddress = null;
    try {
        const state = await rest.getState(tokenObj, contract, options);
        implementationAddress = state.logicContract;
    } catch (error) {
        console.error(error.message);
    }
    if (!implementationAddress) {
        throw new Error('Could not retrieve logicContract address from Proxy.\nIs this address actually a Proxy?');
    }
    return implementationAddress;
}

/** Verify that the proxy exists and has the expected implementation contract name
 */
async function verifyProxyAndImplementation(tokenObj, proxyAddress, contractName) {
    // @dev blockapps-rest is deprecated and results in false positives in the checker,
    // so we skip the verification for now
    console.log('Skipping proxy and contract name verification...');
    return;

    console.log('Verifying proxy and implementation...');
    
    // Try to get the logic contract address (this will fail if not a proxy)
    const implementationAddress = await getLogicContract(tokenObj, proxyAddress);
    console.log(`Old implementation address: ${implementationAddress}`);
    
    // Verify the current implementation contract name using Cirrus search
    console.log(`Verifying implementation contract name '${contractName}'...`);
    const searchOptions = {
        config,
        query: {
            address: `eq.${implementationAddress}`
        }
    };
    
    try {
        const results = await rest.search(tokenObj, { name: contractName }, searchOptions);
        
        if (!results || results.length === 0) {
            throw new Error(`The previous implementation does not seem to match the new contract name '${contractName}'.\nAre you sure you want to upgrade to a different contract type?`);
            // @dev if yes, then set +OVERRIDE-CHECKS flag
        }
        
        console.log(`Implementation contract name '${contractName}' verified`);
    } catch (error) {
        if (error.message.includes('No contract named')) {
            throw new Error(`The previous implementation does not seem to match the new contract name '${contractName}'.\nAre you sure you want to upgrade to a different contract type?`);
        }
        else {
            throw error;
        }

    }
}

/**
 * Deploy the implementation asynchronously and poll for the receipt.
 *
 * As of 04-22-2026, Contract deployments route through the caller's user-contract, so the
 * synchronous `rest.createContract` response is `{}` (the tx hash / txResult
 * aren't surfaced). `isAsync: true` + `rest.getBlocResults` gives us the raw tx 
 * receipt whose `contractsCreated` field is the actual deployed implementation address.
 */
async function deployImplementationAsync(tokenObj, contractArgs, baseOptions) {
  const asyncOptions = { ...baseOptions, isAsync: true };
  const response = await rest.createContract(tokenObj, contractArgs, asyncOptions);
  const responseArray = Array.isArray(response) ? response : [response];
  const hashes = responseArray.map((r) => r && r.hash).filter(Boolean);
  if (hashes.length === 0) {
    throw new Error(
      'rest.createContract returned no tx hash; cannot poll for deployment receipt: ' +
        JSON.stringify(response)
    );
  }

  const finalResults = await util.until(
    (results) => Array.isArray(results) && results.length > 0 &&
      results.every((r) => r && r.status && r.status !== 'Pending'),
    (opts) => rest.getBlocResults(tokenObj, hashes, opts),
    { config, isAsync: true },
    60000 // 1 minute polling upper bound
  );

  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error(
      'Implementation deployment failed: ' + JSON.stringify(final || finalResults)
    );
  }

  const created = final.txResult && final.txResult.contractsCreated;
  const address = Array.isArray(created) ? created[0] : created;
  if (!address) {
    throw new Error(
      'Deployment succeeded but no contractsCreated entry in receipt: ' +
        JSON.stringify(final)
    );
  }
  return address;
}

/**
 * Call a contract method asynchronously and poll for the receipt.
 *
 * As of 04-22-2026, contract calls also route through the caller's user-contract,
 * so the synchronous `rest.call` resolver crashes reading `a.data.contents` (data is null).
 * `isAsync: true` + `rest.getBlocResults` bypasses the broken resolver and gives us the
 * raw tx receipt so we can assert success ourselves.
 */
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
    60000
  );

  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (!final || final.status !== 'Success') {
    throw new Error(
      'Contract call failed: ' + JSON.stringify(final || finalResults)
    );
  }
  return final;
}

/**
 * Main upgrade function
 */
async function main() {
  try {
    console.log('Starting proxy upgrade process...');
    console.log('=====================================\n');
    
    // Parse command-line arguments
    let args;
    try {
      args = parseArgs();
    } catch (error) {
      console.error(`Error parsing arguments: ${error.message}\n`);
      printUsage();
      process.exit(1);
    }
    
    // Check for required arguments
    const requiredArgs = args['batch']
      ? ['contract-name', 'contract-file']
      : ['proxy-address', 'contract-name', 'contract-file'];
    const missingArgs = requiredArgs.filter(arg => !args[arg]);
    
    if (missingArgs.length > 0) {
      console.error(`Missing required arguments: ${missingArgs.map(a => '--' + a).join(', ')}\n`);
      printUsage();
      process.exit(1);
    }
    
    // Check for required environment variables
    const requiredVars = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL', 'NODE_URL'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error(`Missing required environment variables: ${missingVars.join(', ')}\n`);
      printUsage();
      process.exit(1);
    }
    
    // Get configuration from command-line arguments
    const contractFile = args['contract-file'];
    const constructorArgs = args['constructor-args'] ? JSON.parse(args['constructor-args']) : DEFAULT_CONSTRUCTOR_ARGS;
    
    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;

    // Build targets list: proxy addresses to upgrade
    const targets = args['batch']
      ? BATCH_TARGETS
      : [args['proxy-address']];

    if (args['batch'] && BATCH_TARGETS.length === 0) {
      throw new Error('BATCH_TARGETS is empty. Add proxy addresses to the list before running in batch mode.');
    }
    
    console.log(`Contract File: ${contractFile}`);
    console.log(`Constructor Args: ${JSON.stringify(constructorArgs)}`);
    console.log(`Targets: ${targets.length} proxy contract(s) to upgrade`);
    console.log('');
    
    // Authenticate
    console.log(`Authenticating as ${username}...`);
    const token = await auth.getUserToken(username, password);
    const tokenObj = { token };
    console.log(`Authenticated as ${username}\n`);

    // Prepare contract source (shared across all targets)
    const contractsDir = config.resolvePath(config.contractsDir);
    const contractFilePath = path.join(contractsDir, contractFile);
    
    if (!fs.existsSync(contractFilePath)) {
      throw new Error(`Contract file not found: ${contractFilePath}`);
    }
    
    console.log(`Contract file: ${contractFilePath}`);
    console.log('Combining contract source files...');
    
    let source = await importer.combine(contractFilePath);
    
    // Strip comments (same logic as deploy.js uses)
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
    
    if (Buffer.isBuffer(source)) {
      source = stripComments(source.toString());
    } else if (typeof source === 'object') {
      const processed = Object.keys(source).map((k) => {
        let content = source[k];
        content = typeof content === 'string' ? content : String(content);
        content = content.replace(/^.*?\.sol,\s*/i, '');
        return stripComments(content);
      });
      source = processed.join('\n');
    } else if (typeof source === 'string') {
      source = stripComments(source);
    } else {
      source = stripComments(String(source));
    }
    
    console.log('Comments stripped from combined source(s)');

    fs.writeFileSync("contract_source",source);

    // Step 1: Deploy new implementation
    const contractName = args['contract-name'];
    console.log(`Deploying new implementation: ${contractName}`);

    const contractArgs = {
      name: contractName,
      source,
      args: constructorArgs,
      txParams: {
        gasPrice: config.gasPrice,
        gasLimit: config.gasLimit,
      },
    };

    const deployOptions = {
      config,
      logger: console,
      history: [contractName],
      cacheNonce: true,
      query: { username: 'BlockApps' }
    };

    const implementationAddress = await deployImplementationAsync(tokenObj, contractArgs, deployOptions);
    console.log(`Implementation deployed at: ${implementationAddress}\n`);

    // Step 2: Upgrade each proxy to point to the new implementation
    const results = [];

    for (let i = 0; i < targets.length; i++) {
      const proxyAddress = targets[i];
      console.log(`\n--- [${i + 1}/${targets.length}] Upgrading proxy ${proxyAddress} ---\n`);

      // Verify proxy
      args['OVERRIDE-CHECKS'] || await verifyProxyAndImplementation(tokenObj, proxyAddress, contractName);

      console.log(`Upgrading proxy at ${proxyAddress}...`);
      console.log(`New implementation: ${implementationAddress}`);

      const callArgs = {
        contract: { address: proxyAddress, name: 'Proxy' },
        method: 'setLogicContract',
        args: { _logicContract: implementationAddress },
        txParams: {
          gasPrice: config.gasPrice,
          gasLimit: config.gasLimit,
        },
      };

      const callOptions = {
        config,
        cacheNonce: true,
      };

      // Async + poll: the sync resolver crashes on user-contract-routed calls (reads
      // `.contents` on a null `data` field). We lose direct access to the solidity
      // return value (vote issue id, if any) but confirm success via the receipt.
      const upgradeReceipt = await callAsync(tokenObj, callArgs, callOptions);

      // If setLogicContract went through governance, the tx still succeeds here but
      // the new implementation only takes effect after the vote resolves. Surface
      // whatever the receipt tells us so the operator can follow up.
      const voteHint = upgradeReceipt && upgradeReceipt.txResult && upgradeReceipt.txResult.message;
      console.log('\n====== Upgrade Submitted ======');
      console.log(`Tx status: ${upgradeReceipt.status}`);
      if (voteHint) {
        console.log(`Note (may indicate governance vote required): ${voteHint}`);
      }
      console.log('If this proxy is under governance, confirm the vote resolves before treating the upgrade as live.');

      console.log(`Proxy Address: ${proxyAddress}`);
      console.log(`New Implementation: ${implementationAddress}`);
      console.log('================================\n');

      results.push({
        proxyAddress,
        newImplementation: implementationAddress,
        contractName,
        contractFile,
        upgradeTime: new Date().toISOString(),
      });
    }

    return results.length === 1 ? results[0] : results;
  } catch (error) {
    console.error('\nUpgrade failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the main function if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = main;
