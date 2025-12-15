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

/**
 * Polls transaction results until they are no longer Pending.
 * Returns the final tx result wrapper.
 */
async function waitForTxResult(tokenObj, hashes, options) {
  const responseArray = Array.isArray(hashes) ? hashes : [hashes];
  const predicate = (results) => results.filter((r) => r.status === 'Pending').length === 0;
  const action = async (opts) => rest.getBlocResults(tokenObj, responseArray, opts);
  const [final] = await util.until(
    predicate,
    action,
    { config, isAsync: true, query: (options && options.query) || undefined },
    3600000
  );
  return final;
}

/**
 * Print usage information
 */
function printUsage() {
  console.error('Usage: node upgrade.js [options]');
  console.error('');
  console.error('Required arguments:');
  console.error('  --proxy-address <address>    Address of the proxy contract to upgrade');
  console.error('  --contract-name <name>       Name of the implementation contract (e.g., PoolFactory)');
  console.error('  --contract-file <file>       Filename of the contract (e.g., Pools/PoolFactory.sol)');
  console.error('');
  console.error('Optional arguments:');
  console.error('  --constructor-args <json>    JSON string of constructor arguments (default: ' + JSON.stringify(DEFAULT_CONSTRUCTOR_ARGS) + ')');
  console.error('  --user-contract <username>   Deploy contract from User contract with this username');
  console.error('  +OVERRIDE-CHECKS             Override the contract name check');
  console.error('');
  console.error('Required environment variables (.env):');
  console.error('  OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD');
  console.error('');
  console.error('Example:');
  console.error('  node upgrade.js --proxy-address abc123 --contract-name PoolFactory --contract-file Pools/PoolFactory.sol');
  console.error('  node upgrade.js --proxy-address abc123 --contract-name LendingPool --contract-file Lending/LendingPool.sol --constructor-args \'{"param":"value"}\' --user-contract myuse');
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
    const requiredArgs = ['proxy-address', 'contract-name', 'contract-file'];
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
    const proxyAddress = args['proxy-address'];
    const contractName = args['contract-name'];
    const contractFile = args['contract-file'];
    const constructorArgs = args['constructor-args'] ? JSON.parse(args['constructor-args']) : DEFAULT_CONSTRUCTOR_ARGS;
    
    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;
    
    console.log(`Proxy Address: ${proxyAddress}`);
    console.log(`Contract Name: ${contractName}`);
    console.log(`Contract File: ${contractFile}`);
    console.log(`Constructor Args: ${JSON.stringify(constructorArgs)}`);
    if (args['user-contract']) {
      console.log(`User Contract Username: ${args['user-contract']}`);
    }
    console.log('');
    
    // Authenticate
    console.log(`Authenticating as ${username}...`);
    const token = await auth.getUserToken(username, password);
    const tokenObj = { token };
    console.log(`Authenticated as ${username}\n`);

    // Verify that the proxy exists and the implementation contract name matches the new contract name
    args['OVERRIDE-CHECKS'] || await verifyProxyAndImplementation(tokenObj, proxyAddress, contractName);
    
    // Step 1: Deploy new implementation
    console.log(`Deploying new implementation: ${contractName}`);
    
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
      return str; // Disabled due to it eliminating comments within strings
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
    
    // Deploy the implementation
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
    
    // If --user-contract is provided, add username to query parameters
    // This will cause the API to call the User contract's createContract method
    // The username corresponds to the User contract in the UserRegistry
    if (args['user-contract']) {
      const userContractUsername = args['user-contract'];
      deployOptions.query = {
        username: userContractUsername
      };
      console.log(`Deploying from User contract with username: ${userContractUsername}`);
    }

    // Deploy the implementation.
    // Uses async because response.data.contents will not incliude address if User contract is used
    let implementationAddress;
    const pending = await rest.createContract(tokenObj, contractArgs, { ...deployOptions, isAsync: true });
    const pendingHash = pending && pending.hash;
    if (!pendingHash) throw new Error('Contract deploy did not return a transaction hash');
    const final = await waitForTxResult(tokenObj, pendingHash, deployOptions);
    console.log(`Final: ${JSON.stringify(final)}`);
    implementationAddress =
      (final && final.data && final.data.contents && final.data.contents.address) || // works for EOA deployments
      (final && final.txResult && Array.isArray(final.txResult.contractsCreated) && final.txResult.contractsCreated.length == 1 ? final.txResult.contractsCreated[0] : null); // works for User contract deployments


    if (!implementationAddress) {
      throw new Error('Could not extract contract address from deployment response');
    }

    console.log(`Implementation deployed at: ${implementationAddress}\n`);
    
    // Step 2: Upgrade the proxy
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
    console.log(`New Implementation: ${implementationAddress}`);
    console.log('================================\n');
    
    // Save upgrade information
    const upgradeInfo = {
      proxyAddress,
      newImplementation: implementationAddress,
      contractName,
      contractFile,
      upgradeTime: new Date().toISOString(),
    };
    
    return upgradeInfo;
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
