/**
 * Upgrade script for BlockApps proxy contracts
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, importer } = require('blockapps-rest');
const fs = require('fs-extra');
const path = require('path');

// The owner of the implementation address is ignored in favor of the proxy owner
const DEFAULT_CONSTRUCTOR_ARGS = {"initialOwner": "deadbeef"};

// Batch upgrade targets: proxy addresses
// All tokens + LP tokens that will be renamed (must upgrade before calling setNameAndSymbol)
// -----------------------------
// PROD DEPLOYMENTS
// -----------------------------
const BATCH_TARGETS = [
    // Wrapped tokens (8)
    "93fb7295859b2d70199e0a4883b7c320cf874e6c", // ETHST -> ETH
    "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9", // WBTCST -> WBTC
    "2e4789eb7db143576da25990a3c0298917a8a87d", // rETHST -> rETH
    "f2aa370405030a434ae07e7826178325c675e925", // wstETHST -> wstETH
    "c6c3e9881665d53ae8c222e24ca7a8d069aa56ca", // syrupUSDCST -> syrupUSDC
    "6e2d93d323edf1b3cc4672a909681b6a430cae64", // SUSDSST -> sUSDS
    "47de839c03a3b014c0cc4f3b9352979a5038f910", // XAUTST -> XAUt
    "491cdfe98470bfe69b662ab368826dca0fc2f24d", // PAXGST -> PAXG
    // LP tokens (8)
    "0000000000000000000000000000000000001018", // ETHST-USDST-LP -> ETH-USDST-LP
    "69010124cdaa64286f6e413267a7001ea9379df4", // ETHST-WBTCST-LP -> ETH-WBTC-LP
    "000000000000000000000000000000000000101a", // WBTCST-USDST-LP -> WBTC-USDST-LP
    "2e99b16c78474c437c7003c814ca79a3ba50e5d8", // wstETHST-USDST-LP -> wstETH-USDST-LP
    "d18a739fc9daa5ff19d2083b1f9b20823133b0cb", // rETHST-wstETHST-LP -> rETH-wstETH-LP
    "a049efb1a3417801b3dd3877dd566aa24b95b3a0", // syrupUSDCST-USDST-LP -> syrupUSDC-USDST-LP
    "96c26f8306a0097d985d1654b4596c48bb6277c4", // SUSDSST-USDST-LP -> sUSDS-USDST-LP
    "af543d9086416b048564fa165f9587aa565cce2f", // XAUTST-GOLDST-LP -> XAUt-GOLDST-LP
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
    };

    const implementation = await rest.createContract(tokenObj, contractArgs, deployOptions);
    console.log(`Implementation deployed at: ${implementation.address}\n`);

    // Step 2: Upgrade each proxy to point to the new implementation
    const results = [];

    for (let i = 0; i < targets.length; i++) {
      const proxyAddress = targets[i];
      console.log(`\n--- [${i + 1}/${targets.length}] Upgrading proxy ${proxyAddress} ---\n`);

      // Verify proxy
      args['OVERRIDE-CHECKS'] || await verifyProxyAndImplementation(tokenObj, proxyAddress, contractName);

      console.log(`Upgrading proxy at ${proxyAddress}...`);
      console.log(`New implementation: ${implementation.address}`);

      const callArgs = {
        contract: { address: proxyAddress, name: 'Proxy' },
        method: 'setLogicContract',
        args: { _logicContract: implementation.address },
        txParams: {
          gasPrice: config.gasPrice,
          gasLimit: config.gasLimit,
        },
      };

      const callOptions = {
        config,
        cacheNonce: true,
      };

      const upgradeResult = await rest.call(tokenObj, callArgs, callOptions);

      if (upgradeResult[0]) {
          console.log('\n======  Upgrade  Pending  ======');
          console.log("Proxy Uploaded and Upgrade Requested.")
          console.log("Governance Vote Required.\nVote Issue ID: " + upgradeResult[0]);
      }
      else {
          console.log('\n====== Upgrade Successful ======');
      }

      console.log(`Proxy Address: ${proxyAddress}`);
      console.log(`New Implementation: ${implementation.address}`);
      console.log('================================\n');

      results.push({
        proxyAddress,
        newImplementation: implementation.address,
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
